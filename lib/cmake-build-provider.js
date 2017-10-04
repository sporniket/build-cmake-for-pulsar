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
   * Install atom-build if it is not already.
   */
  activate() {
    require('atom-package-deps').install('build-cmake');
  },

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
       * @param {string} projectDirectory
       */
      constructor(projectDirectory) {
        super();
        this.projectDirectory = projectDirectory;

        this.cmake = new CMake(atom.config.get('build-cmake.executable'));
        this.setSourceDirectory(
            this.projectDirectory, atom.config.get('build-cmake.cmakelists'));
        this.cmakeArguments =
            this.parseArguments(atom.config.get('build-cmake.cmakeArguments'));

        this.setBuildDirectory(atom.config.get('build-cmake.buildDirectory'));
        this.buildArguments =
            this.parseArguments(atom.config.get('build-cmake.buildArguments'));
        this.parallelBuild = atom.config.get('build-cmake.parallelBuild');


        atom.config.onDidChange('build-cmake.executable', (values) => {
          this.cmake = new CMake(values.newValue.trim());
          this.emit('refresh');
        });


        atom.config.onDidChange('build-cmake.cmakelists', (values) => {
          this.setSourceDirectory(this.projectDirectory, values.newValue);
          this.emit('refresh');
        });

        atom.config.onDidChange('build-cmake.cmakeArguments', (values) => {
          this.cmakeArguments = this.parseArguments(values.newValue);
          this.emit('refresh');
        });


        atom.config.onDidChange('build-cmake.buildDirectory', (values) => {
          this.setBuildDirectory(values.newValue);
          this.emit('refresh');
        });


        atom.config.onDidChange('build-cmake.buildArguments', (values) => {
          this.buildArguments = this.parseArguments(values.newValue);
          this.emit('refresh');
        });

        atom.config.onDidChange('build-cmake.parallelBuild', (values) => {
          this.parallelBuild = values.newValue;
          this.emit('refresh');
        });
      }

      /**
       * @param {path} projectDirectory
       * @param {path} cmakelists
       */
      setSourceDirectory(projectDirectory, cmakelists) {
        this.sourceDirectory = (!!cmakelists) ?
            projectDirectory + cmakelists.trim() :
            projectDirectory;
      }

      /**
       * @param {path} buildDirectory
       */
      setBuildDirectory(buildDirectory) {
        this.buildDirectory = this.variableReplace(buildDirectory);
        if (path.isAbsolute(this.buildDirectory))
          this.buildDirectory = path.normalize(this.buildDirectory);
        else
          this.buildDirectory =
              path.resolve(this.sourceDirectory, this.buildDirectory);

        this.cachePath = path.join(this.buildDirectory, 'CMakeCache.txt');
      }

      /**
       * @param {string} input
       * @return {string}
       */
      variableReplace(input) {
        const pathVars = {
          TMPDIR: os.tmpdir(),
          PROJECT_DIR: this.projectDirectory,
          PROJECT_DIRNAME: path.basename(this.projectDirectory),
        };

        // @TODO: Add escape for '$'
        let pathVarNames = input.match(/\$([a-zA-Z_]+)/g);

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

            input = input.replace(pathVarMatch, pathVarValue);
          }
        }

        return input;
      }

      /**
       * @param {string} args
       * @return {Array}
       */
      parseArguments(args) {
        return args.split(' ').filter((v) => v !== '');
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
       * @param {string} generatorName
       * @return {AtomBuildTarget}
       */
      createGenerateTarget(generatorName) {
        let that = this;
        let argumentList = [
          '-G' + generatorName,
          '-B' + that.buildDirectory,
          '-H' + that.sourceDirectory,
          '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
        ].concat(that.cmakeArguments);

        return {
          atomCommandName: 'cmake:generate ( ' + generatorName + ' )',
          name: 'generate ( ' + generatorName + ' ) ',
          exec: that.cmake.executable,
          cwd: that.sourceDirectory,
          args: argumentList,
          errorMatch: generateErrorMatch,
          warningMatch: generateWarningMatch,
          sh: false,
          postBuild: (buildOutcome, stdout, stderr) => {
            if (buildOutcome) that.emit('refresh');
          },
        };
      }

      /**
       * @return {Promise}
       */
      extractTargets() {
        const that = this;
        return that.cmake
            .extractTargets(
                that.sourceDirectory, that.buildDirectory, that.parallelBuild,
                that.buildArguments)
            .then((extracted) => {
              fs.unwatchFile(that.cachePath);

              fs.watchFile(that.cachePath, (curr, prev) => {
                if (curr.mtime != prev.mtime) that.emit('refresh');
              });

              extracted.targets.forEach((target) => {
                target.atomCommandName = 'cmake:' + target.name;
                target.errorMatch =
                    compileErrorMatch.concat(generateErrorMatch);
                target.warningMatch =
                    compileWarningMatch.concat(generateWarningMatch);
                target.sh = false;
              });

              return [that.createGenerateTarget(extracted.generator)].concat(
                  extracted.targets);
            });
      }


      /**
       * @return {Promise}
       */
      settings() {
        const that = this;
        return that.cmake.validateExecutable()
            .then(() => {
              if (fs.existsSync(that.cachePath))
                return that.extractTargets();
              else
                return that.cmake.generators.map(
                    (generator) => that.createGenerateTarget(generator));
            })
            .catch((error) => {
              atom.notifications.addError('Failed to run build-cmake', {
                detail: error.message,
                dismissable: true,
                contenttype: 'text/plain',
              });
            });
      }
    };
  },
};
