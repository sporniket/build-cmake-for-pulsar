'use babel';
'use strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import glob from 'glob';
import {exec} from 'child_process';

/**
 */
export default class CMake {
  /**
   *@param {path} executable
   */
  constructor(executable) {
    this.executable = '"' + executable.trim() + '"';
    this.generators = null;
  }

  /**
   * @return {Promise}
   */
  validateExecutable() {
    const that = this;
    return new Promise((resolve, reject) => {
      if (that.generators != null) {
        resolve(that);
      } else {
        exec(that.executable + ' --help', (err, stdout, stderr) => {
          if (err || stderr.length > 0) {
            reject('failed to execute!');
          } else {
            const generators =
                stdout.toString('utf8').match(/.*\s*=\s*Generates.*/g);
            if (generators) {
              that.generators =
                  generators.map((line) => line.split('=')[0].trim());
              resolve();
            } else
              reject('failed to produce generators!');
          }
        });
      }
    });
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
            reject('could not find generator in cmake cache!');
          else
            resolve(matches[1]);
        }
      });
    });
  }

  /**
   * @param {string} targetName
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {target}
   */
  createMakeFileTarget(
      targetName, buildDirectory, parallelBuild, extraBuildArguments) {
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
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {Promise}
   */
  makeFileTargets(buildDirectory, parallelBuild, extraBuildArguments) {
    const that = this;
    return new Promise((resolve, reject) => {
      exec(
          that.executable + ' --build "' + buildDirectory + '" --target help',
          {cwd: buildDirectory}, (err, stdout, stderr) => {
            if (err || stderr.length > 0) {
              reject('failed to execute!');
            } else {
              let targets = [];
              const targetRegexp = /\.{3}\s(.[^\s]+)/g;
              let match = targetRegexp.exec(stdout);
              while (match != null) {
                targets.push(that.createMakeFileTarget(
                    match[1].trim(), buildDirectory, parallelBuild,
                    extraBuildArguments));
                match = targetRegexp.exec(stdout);
              }

              resolve(targets);
            }
          });
    });
  }

  /**
   * @param {string} targetName
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {target}
   */
  ninjaTarget(targetName, buildDirectory, parallelBuild, extraBuildArguments) {
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
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {Promise}
   */
  ninjaTargets(buildDirectory, parallelBuild, extraBuildArguments) {
    const that = this;
    return new Promise((resolve, reject) => {
      exec(
          that.executable + ' --build "' + buildDirectory + '" -- -t targets',
          {cwd: buildDirectory}, (err, stdout, stderr) => {
            if (err || stderr.length > 0) {
              reject('failed to execute!');
            } else {
              let targets = [];
              const targetRegexp = /(.+):/g;
              let match = targetRegexp.exec(stdout);
              while (match != null) {
                targets.push(that.ninjaTarget(
                    match[1].trim(), buildDirectory, parallelBuild,
                    extraBuildArguments));
                match = targetRegexp.exec(stdout);
              }

              resolve(targets);
            }
          });
    });
  }

  //   createVisualStudioTarget(targetName) {
  //     argumentList =
  //         ['--build', this.buildDirectory, '--target', targetName, '--'];
  //     if (this.parallelBuild) argumentList.push('/maxcpucount');
  //     return {
  //       atomCommandName: 'cmake:' + targetName,
  //       name: targetName,
  //       exec: this.executable,
  //       cwd: this.buildDirectory,
  //       args: argumentList.concat(this.buildArguments),
  //       errorMatch: compileErrorMatch.concat(generateErrorMatch),
  //       warningMatch: compileWarningMatch.concat(generateWarningMatch),
  //     };
  //   }

  /**
   * @param {string} targetName
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {target}
   */
  createVisualStudioTarget(
      targetName, buildDirectory, parallelBuild, extraBuildArguments) {
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
   * @param {path} buildDirectory
   * @param {boolean} parallelBuild
   * @param {Array} extraBuildArguments
   * @return {Promise}
   */
  visualStudioTargets(buildDirectory, parallelBuild, extraBuildArguments) {
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
                              (targetName) =>
                                  that.createVisualStudioTarget(targetName)));
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
                    buildDirectory, parallelBuild, extraBuildArguments)
                .then((targets) => {
                  return {generator: generator, targets: targets};
                });
          else if (generator.match('Ninja'))
            return that
                .ninjaTargets(
                    buildDirectory, parallelBuild, extraBuildArguments)
                .then((targets) => {
                  return {generator: generator, targets: targets};
                });
          else if (generator.match('Unix Makefiles'))
            return that
                .makeFileTargets(
                    buildDirectory, parallelBuild, extraBuildArguments)
                .then((targets) => {
                  return {generator: generator, targets: targets};
                });
        });
  }
};
