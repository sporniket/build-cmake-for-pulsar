'use babel';
'use strict';

import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import CMake from './cmake';

const GENERATE_ERROR_MATCH = ['(.+\n)?CMake Error at (?<file>[\\/0-9a-zA-Z\\._-]+):(?<line>\\d+)'];
const GENERATE_WARNING_MATCH = ['(.+\n)?CMake Error at (?<file>[\\/0-9a-zA-Z\\._-]+):(?<line>\\d+)'];
const COMPILE_ERROR_MATCH = [
	'(.+:\\d+:\\d+:\n)?(?<file>.+):(?<line>\\d+):(?<column>\\d+):\\s+(.*\\s+)?error:\\s+(?<message>.+)', // GCC/Clang error
	'(?<file>[a-zA-Z\\._\\-\\\\/:0-9]+)\\((?<line>\\d+)\\):\\s*error\\s*(C\\d+)?\\s*:(?<message>.*)', // Visual Studio error
];
const COMPILE_WARNING_MATCH = [
	'(.+:\\d+:\\d+:\n)?(?<file>.+):(?<line>\\d+):(?<column>\\d+):\\s+(.*\\s+)?warning:\\s+(?<message>.+)', // GCC/Clang warning
	'(?<file>[a-zA-Z\\._\\-\\\\/:0-9]+)\\((?<line>\\d+)\\):\\s*warning\\s*(C\\d+)?\\s*:(?<message>.*)', // Visual Studio warning
];

function parseArguments(args) {
	return args.split(' ').filter((v) => v !== '');
}

function variableReplace(input, replaceVars) {
	for (let varName in replaceVars)
		input = input.replace('${' + varName + '}', replaceVars[varName]);

	return input;
}

export const config = {
	executable: {
		title: 'CMake Executable',
		description: 'Path to the CMake executable.',
		type: 'string',
		default: 'cmake',
		order: 1,
	}
};

export function provideCMake() {
	return class CMakeBuildProvider extends EventEmitter {
		constructor(projectDirectory) {
			super();

			this.cmake = new CMake(atom.config.get('build-cmake.executable'));
			this.projectDirectory = projectDirectory;

			this.fileWatcher = fs.watch(this.projectDirectory, { }, (eventType, filename) => {
				if (filename.match('CMakeLists.txt') || filename.match('CMakeSettings.json') || filename.match('CMakeCache.txt')) {
					try {
						this.emit('refresh');
					} catch (e) {
					// Don't care
					}
				}
			});

			this.cmakeWatcher = atom.config.onDidChange('build-cmake.executable', (values) => {
				this.cmake = new CMake(values.newValue.trim());
				this.emit('refresh');
			});
		}

		destructor() {
			this.fileWatcher.close();
			this.cmakeWatcher.dispose();
			this.fileWatcher = undefined;
			this.cmakeWatcher = undefined;
		}

		getNiceName() {
			return 'cmake';
		}

		isEligible() {
			return fs.existsSync(path.join(this.projectDirectory, 'CMakeLists.txt'));
		}

		configurationTargets(configuration) {
			const replaceVars = {
				TMPDIR: os.tmpdir(),
				PROJECT_DIR: this.projectDirectory,
				PROJECT_DIRNAME: path.basename(this.projectDirectory),
				// TODO workspaceRoot: ???,
				// TODO workspaceHash: ???,
				projectFile: path.join(this.projectDirectory, 'CMakeLists.txt'),
				projectDir: this.projectDirectory,
				thisFile: path.join(this.projectDirectory, 'CMakeSettings.json'),
				name: configuration.name,
				generator: configuration.generator
			};

			for (let k of ['buildRoot', 'cmakeCommandArgs', 'buildCommandArgs', 'ctestCommandArgs'])
				configuration[k] = variableReplace(configuration[k], replaceVars);

			configuration.cmakeCacheFile = path.join(configuration.buildRoot, 'CMakeCache.txt');
			configuration.cmakeCommandArgs = [
				'-G' + configuration.generator,
				'-B' + configuration.buildRoot,
				'-H' + this.projectDirectory,
				'-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
			].concat(parseArguments(configuration.cmakeCommandArgs || ''))
				.concat((configuration.variables || []).map(variable => {
					const finalValue = variableReplace(variable.value, replaceVars);
					return `-D${variable.name}=${finalValue}`;
				}));

			configuration.buildCommandArgs = parseArguments(configuration.buildCommandArgs || '');

			const generateTarget = {
				atomCommandName: `cmake:generate-${configuration.name}`,
				name: `${configuration.name}: generate`,
				exec: this.cmake.executable,
				cwd: this.projectDirectory,
				args: configuration.cmakeCommandArgs,
				errorMatch: GENERATE_ERROR_MATCH.concat(COMPILE_ERROR_MATCH),
				warningMatch: GENERATE_WARNING_MATCH.concat(COMPILE_WARNING_MATCH),
				sh: false
			};

			return this.cmake.extractTargets(configuration)
				.then(targets => {
					return [generateTarget].concat(targets.map(target => {
						return {
							atomCommandName: `cmake:${target}-${configuration.name}`,
							name: `${configuration.name}: ${target}`,
							exec: this.cmake.executable,
							cwd: this.projectDirectory,
							args: ['--build', configuration.buildRoot, '--target', target, '--'].concat(configuration.buildCommandArgs),
							errorMatch: GENERATE_ERROR_MATCH.concat(COMPILE_ERROR_MATCH),
							warningMatch: GENERATE_WARNING_MATCH.concat(COMPILE_WARNING_MATCH),
							sh: false,
						};
					}));
				});
		}

		configurations() {
			const settingsFile = path.join(this.projectDirectory, 'CMakeSettings.json');

			if (fs.existsSync(settingsFile)) {
				return new Promise((resolve, reject) => {
					fs.readFile(settingsFile, 'utf8', (err, contents) => {
						if (err) {
							reject({
								message: err
							});
						}
						else {
							resolve(JSON.parse(contents).configurations || []);
						}
					});
				});
			}
			else {
				return this.cmake.supportedGenerators()
					.then(generators => {
						const configurations = [];
						for (let generator of generators) {
							for (let configType of ['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel']) {
								configurations.push({
									name: `${generator}-${configType}`,
									generator: generator,
									configurationType: configType,
									buildRoot: '${projectDir}/build/${name}',
									cmakeCommandArgs: '',
									buildCommandArgs: '',
									ctestCommandArgs: ''
								});
							}
						}
						return configurations;
					});
			}
		}

		settings() {
			return this.configurations()
				.then(configurations => {
					return Promise.all(configurations.map(configuration => this.configurationTargets(configuration)));
				}).then(targets => {
					return targets.reduce((acc, val) => acc.concat(val), []);
				}).catch(error => {
					atom.notifications.addError('Could not read CMakeSettings.json', {
						detail: error.message,
						dismissable: true,
						contenttype: 'text/plain',
					});
				});
		}
	};
}
