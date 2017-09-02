'use babel';
'use strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import glob from 'glob';
import {spawn} from 'child_process';

/**
 */
export default class CMake {
  /**
   *@param {path} executable
   */
  constructor(executable) {
    this.executable = executable.trim();
    this.generators = null;
  }

  /**
   * @param {string} command
   * @param {Array} commandArguments
   * @param {regex} outputRegex
   * @param {function} callback
   * @param {string} outputMessage
   * @param {function} prefilter
   * @return {Promise}
   */
  grepStdout(
      command, commandArguments, outputRegex, callback, outputMessage,
      prefilter) {
    return new Promise((resolve, reject) => {
      let child = spawn(command, commandArguments, {shell: false});
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => {
        stdout = stdout + data.toString('utf8');
      });
      child.stderr.on('data', (data) => {
        stderr = stderr + data.toString('utf8');
      });
      child.on('close', (code) => {
        if (code !== 0) {
          reject(stderr.replace('/bin/sh: ', '').trim() + '!');
        } else {
          if (prefilter) stdout = prefilter(stdout);

          let matches = [];
          let match = outputRegex.exec(stdout);
          while (match != null) {
            matches = matches.concat(callback(match));
            match = outputRegex.exec(stdout);
          }
          if (outputMessage != null && matches.length <= 0)
            reject(outputMessage);
          else
            resolve(matches);
        }
      });
    });
  }

  /**
   * @return {Promise}
   */
  validateExecutable() {
    const that = this;
    if (that.generators == null) {
      return that
          .grepStdout(
              that.executable, ['--help'],
              /\s{3}(.*)\s*=\sGenerates?(.*\.|.*\s*.*\.)(\s*Optional\s\[arch\]\scan\sbe\s(\".*\").)?/g,
              (match) => {
                if (match[4]) {
                  const arches = match[4].split('or').map(
                      (arch) => arch.replace(/\"/g, ''));
                  return arches.map(
                      (arch) => match[1].replace(/\[arch\]/g, arch).trim());
                } else {
                  return [match[1].trim()];
                }
              },
              'The executable "' + that.executable +
                  '" failed to produce generators!',
              (stdout) => {
                return stdout.substring(stdout.indexOf('Generators'));
              })
          .then((generators) => {
            that.generators = generators;
          });
    }
  }

  /**
   * @param {path} cachePath
   * @return {Promise}
   */
  extractGeneratorFromCache(cachePath) {
    return new Promise(function(resolve, reject) {
      fs.readFile(cachePath, 'utf8', function(err, cache) {
        if (err) {
          reject(err);
        } else {
          const matches = cache.match(/CMAKE_GENERATOR:INTERNAL=(.*)/);
          if (matches.length != 2)
            reject('Could not find generator in cmake cache!');
          else
            resolve(matches[1]);
        }
      });
    });
  }

  /**
   * @param {string} targetName
   * @param {path} sourceDirectory
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {target}
   */
  createMakeFileTarget(
      targetName, sourceDirectory, buildDirectory, parallelBuild,
      extraBuildArguments) {
    argumentList = ['--build', buildDirectory, '--target', targetName, '--'];
    if (parallelBuild) argumentList.push('-j' + os.cpus().length);
    return {
      name: targetName,
      exec: this.executable,
      cwd: buildDirectory,
      args: argumentList.concat(extraBuildArguments),
    };
  }

  /**
   * @param {path} sourceDirectory
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {Promise}
   */
  makeFileTargets(
      sourceDirectory, buildDirectory, parallelBuild, extraBuildArguments) {
    const that = this;
    return that.grepStdout(
        that.executable, ['--build', buildDirectory, '--target', 'help'],
        /\.{3}\s(.[^\s]+)/g, (match) => {
          return [that.createMakeFileTarget(
              match[1].trim(), sourceDirectory, buildDirectory, parallelBuild,
              extraBuildArguments)];
        });
  }

  /**
   * @param {string} targetName
   * @param {path} sourceDirectory
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {target}
   */
  ninjaTarget(
      targetName, sourceDirectory, buildDirectory, parallelBuild,
      extraBuildArguments) {
    argumentList = ['--build', buildDirectory, '--target', targetName, '--'];
    if (parallelBuild) argumentList.push('-j' + os.cpus().length);
    return {
      name: targetName,
      exec: this.executable,
      cwd: buildDirectory,
      args: argumentList.concat(extraBuildArguments),
    };
  }

  /**
   * @param {path} sourceDirectory
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {Promise}
   */
  ninjaTargets(
      sourceDirectory, buildDirectory, parallelBuild, extraBuildArguments) {
    const that = this;
    return that
        .grepStdout(
            that.executable, ['--build', buildDirectory, '--', '-t', 'targets'],
            /(.+):/g,
            (match) => {
              return [that.ninjaTarget(
                  match[1].trim(), sourceDirectory, buildDirectory,
                  parallelBuild, extraBuildArguments)];
            })
        .then((targets) => {
          return that
              .grepStdout(
                  that.executable,
                  ['--build', buildDirectory, '--', '-t', 'query', 'all'],
                  /^\s{4}(.*)$/gm,
                  (match) => {
                    return [that.ninjaTarget(
                        match[1].trim(), sourceDirectory, buildDirectory,
                        parallelBuild, extraBuildArguments)];
                  })
              .then((allTargets) => {
                return targets.concat(allTargets);
              });
        });
  }

  /**
   * @param {string} targetName
   * @param {path} sourceDirectory
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {target}
   */
  createVisualStudioTarget(
      targetName, sourceDirectory, buildDirectory, parallelBuild,
      extraBuildArguments) {
    argumentList = ['--build', buildDirectory, '--target', targetName, '--'];
    if (parallelBuild) argumentList.push('/maxcpucount');
    return {
      name: targetName,
      exec: this.executable,
      cwd: buildDirectory,
      args: argumentList.concat(extraBuildArguments),
    };
  }

  /**
   * @param {path} sourceDirectory
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {Promise}
   */
  visualStudioTargets(
      sourceDirectory, buildDirectory, parallelBuild, extraBuildArguments) {
    const that = this;
    return new Promise(function(resolve, reject) {
      glob(
          '**/*.vcxproj', {
            cwd: buildDirectory,
            nodir: true,
            ignore: 'CMakeFiles/**',
          },
          (error, files) => {
            if (error)
              reject(error);
            else
              resolve(files.map((file) => path.basename(file, '.vcxproj'))
                          .concat(['clean'])
                          .map(
                              (targetName) => that.createVisualStudioTarget(
                                  targetName, sourceDirectory, buildDirectory,
                                  parallelBuild, extraBuildArguments)));
          });
    });
  }

  /**
   * @param {path} sourceDirectory
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {Promise}
   */
  extractTargets(
      sourceDirectory, buildDirectory, parallelBuild, extraBuildArguments) {
    const that = this;
    return that
        .extractGeneratorFromCache(path.join(buildDirectory, 'CMakeCache.txt'))
        .then((generator) => {
          if (generator.match('Visual Studio'))
            return that
                .visualStudioTargets(
                    sourceDirectory, buildDirectory, parallelBuild,
                    extraBuildArguments)
                .then((targets) => {
                  return {generator: generator, targets: targets};
                });
          else if (generator.match('Ninja'))
            return that
                .ninjaTargets(
                    sourceDirectory, buildDirectory, parallelBuild,
                    extraBuildArguments)
                .then((targets) => {
                  return {generator: generator, targets: targets};
                });
          else if (generator.match('Makefiles'))
            return that
                .makeFileTargets(
                    sourceDirectory, buildDirectory, parallelBuild,
                    extraBuildArguments)
                .then((targets) => {
                  return {generator: generator, targets: targets};
                });
          else
            throw Error(
                'Cannot extract targets for generator \"' + generator + '\"');
        });
  }
};
