'use babel';
'use strict';

import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import CMake from './cmake';

export default {
  config: require('./config'),

  /**
   * @return {CMakeBuildProvider}
   */
  providingFunction() {
    const generateErrorMatch =
        ['(.+\n)?CMake Error at (?<file>[\\/0-9a-zA-Z\\._-]+):(?<line>\\d+)'];
    const generateWarningMatch =
        ['(.+\n)?CMake Error at (?<file>[\\/0-9a-zA-Z\\._-]+):(?<line>\\d+)'];
    const compileErrorMatch = [
      '(.+:\\d+:\\d+:\n)?(?<file>.+):(?<line>\\d+):(?<column>\\d+):\\s+(.*\\s+)?error:\\s+(?<message>.+)',  // GCC/Clang Error,
      '(?<file>[a-zA-Z\\._\\-\\\\/:0-9]+)\\((?<line>\\d+)\\):\\s*error\\s*(C\\d+)?\\s*:(?<message>.*)',  // Visual Studio Error
    ];
    const compileWarningMatch = [
      '(.+:\\d+:\\d+:\n)?(?<file>.+):(?<line>\\d+):(?<column>\\d+):\\s+(.*\\s+)?warning:\\s+(?<message>.+)',  // GCC/Clang warning
      '(?<file>[a-zA-Z\\._\\-\\\\/:0-9]+)\\((?<line>\\d+)\\):\\s*warning\\s*(C\\d+)?\\s*:(?<message>.*)',  // Visual Studio Error
    ];

    return class CMakeBuildProvider extends EventEmitter {
      /**
       * @param {string} sourceDirectory
       */
      constructor(projectDirectory) {
        super();
        this.cmake = new CMake(atom.config.get('build-cmake.executable'));
        this.projectDirectory = projectDirectory;


        atom.config.observe('build-cmake.cmakelists', (cmakelists) => {
          this.sourceDirectory = (!!cmakelists) ?
              projectDirectory + cmakelists.trim() :
              projectDirectory;
          this.emit('refresh');
        });
        atom.config.onDidChange('build-cmake.cmakelists', () => {
          this.emit('refresh');
        });


        atom.config.observe('build-cmake.buildDirectory', (buildDir) => {
          const pathVars = {
            TMPDIR: os.tmpdir(),
            PROJECT_DIR: this.projectDirectory,
            PROJECT_DIRNAME: path.basename(this.projectDirectory),
          };

          // @TODO: Add escape for '$'
          let pathVarNames = buildDir.match(/\$([a-zA-Z_]+)/g);

          if (pathVarNames) {
            for (let i = 0; pathVarNames.length > i; i++) {
              let pathVarName = pathVarNames[i];
              let pathVarNameWithoutPrefix = pathVarName.substr(1);
              let pathVarValue = pathVars[pathVarNameWithoutPrefix];

              if (!pathVarValue) {
                pathVarValue = '';
                // @TODO: Maybe include environment variables?
              }

              let pathVarMatch = new RegExp('\\' + pathVarName);

              buildDir = buildDir.replace(pathVarMatch, pathVarValue);
            }
          }

          if (path.isAbsolute(buildDir))
            this.buildDirectory = path.normalize(buildDir);
          else
            this.buildDirectory = path.resolve(sourceDirectory, buildDir);

          this.cachePath = path.join(this.buildDirectory, 'CMakeCache.txt');
          this.emit('refresh');
        });
        atom.config.onDidChange('build-cmake.buildDirectory', () => {
          this.emit('refresh');
        });


        atom.config.observe('build-cmake.generator', (generator) => {
          this.generator = (!!generator) ? generator.trim() : '';
          this.emit('refresh');
        });
        atom.config.onDidChange('build-cmake.generator', () => {
          this.emit('refresh');
        });

        atom.config.onDidChange('build-cmake.executable', (executable) => {
          this.cmake = new CMake(executable.newValue.trim());
        });
        atom.config.onDidChange('build-cmake.executable', () => {
          this.emit('refresh');
        });

        atom.config.observe('build-cmake.cmakeArguments', (args) => {
          this.cmakeArguments = args.split(' ').filter((v) => v !== '');
          this.emit('refresh');
        });
        atom.config.onDidChange('build-cmake.cmakeArguments', () => {
          this.emit('refresh');
        });

        atom.config.observe('build-cmake.buildArguments', (args) => {
          this.buildArguments = args.split(' ').filter((v) => v !== '');
          this.emit('refresh');
        });
        atom.config.onDidChange('build-cmake.buildArguments', () => {
          this.emit('refresh');
        });

        atom.config.observe('build-cmake.parallelBuild', (parallelBuild) => {
          this.parallelBuild = parallelBuild;
          this.emit('refresh');
        });
        atom.config.onDidChange('build-cmake.parallelBuild', () => {
          this.emit('refresh');
        });
      }


      /**
       * @return {string}
       */
      getNiceName() {
        return 'cmake';
      }


      /**
       * @return {boolean}
       */
      isEligible() {
        return fs.existsSync(
                   path.join(this.sourceDirectory, 'CMakeLists.txt')) ||
            fs.existsSync(this.cachePath);
      }


      /**
       * @return {Promise}
       */
      settings() {
        console.log('settings');
        const that = this;
        return this.cmake.validateExecutable()
            .then(() => {
              if (fs.existsSync(that.cachePath)) {
                fs.unwatchFile(that.cachePath);

                fs.watchFile(that.cachePath, (curr, prev) => {
                  if (fs.existsSync(that.cachePath) && curr.mtime != prev.mtime)
                    that.emit('refresh');
                });

                return that.cmake.extractTargets(
                    that.sourceDirectory, that.buildDirectory,
                    that.parallelBuild, that.buildArguments);
              } else {
                return {generator: that.generator, targets: []};
              }
            })
            .then((extracted) => {
              if (!that.generator.match(extracted.generator)) {
                atom.notifications.addWarning(
                    'The build directory "' + that.buildDirectory +
                    '" was configured for "' + extracted.generator +
                    ' . If you would like to use the generator "' +
                    that.generator +
                    '" you will need to change build directories.');
                atom.config.set('build-cmake.generator', extracted.generator);
              } else {
                extracted.generator = that.generator;
              }
              return extracted;
            })
            .then((extracted) => {
              let argumentList = [
                '-G',
                '"' + extracted.generator + '"',
                '-B' + that.buildDirectory,
                '-H' + that.sourceDirectory,
                '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
              ].concat(that.cmakeArguments);

              const generateTarget = {
                atomCommandName:
                    'cmake:generate ( ' + extracted.generator + ' )',
                name: 'generate ( ' + extracted.generator + ' ) ',
                exec: that.cmake.executable,
                cwd: that.sourceDirectory,
                args: argumentList,
                errorMatch: generateErrorMatch,
                warningMatch: generateWarningMatch,
                postBuild: (buildOutcome, stdout, stderr) => {
                  if (buildOutcome) that.emit('refresh');
                },
              };

              extracted.targets.forEach((target) => {
                target.name = target.name + ' ( ' + extracted.generator + ' )';
                target.atomCommandName = 'cmake:' + target.name;
                target.errorMatch =
                    compileErrorMatch.concat(generateErrorMatch);
                target.warningMatch =
                    compileWarningMatch.concat(generateWarningMatch);
              });

              return [generateTarget].concat(extracted.targets);
            })
            .catch((error) => {
              atom.notifications.addError(JSON.stringify(error, null, 2));
            });
      }
    };
  },
};
