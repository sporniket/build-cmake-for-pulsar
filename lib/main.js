'use babel';
'use strict';

import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import CMake from './cmake';

/* SPDX-License-Identifier: MIT */
/****************************************

---
Copyright (C) 2015,2016,2017,2018 Aaron Siegel
Copyright (C) 2025 David SPORN
---
This is part of **build-cmake-for-pulsar**.
Generate and build cmake projects from within Pulsar.
****************************************/

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
	// TODO improve support for quoted arguments
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
	},
	buildRoot: {
		title: 'Build Location',
		description: 'The build directory. The following variables can be used: ' +
        '' +
				'<BR> `${projectFile}` - The path of the root CMakeLists.txt file' +
				'<BR> `${projectDir}` - The current project directory' +
				'<BR> `${thisFile}` - The path to the CMakeSettings.json file if one exits' +
				'<BR> `${name}` - The name of this configuration' +
				'<BR> `${generator}` - Then CMake generator used for this configuration' +
				'<br>`${TMPDIR}` - The operating system\'s default temp directory' +
        '<br>`${PROJECT_DIR}` - The current project directory' +
        '<br>`${PROJECT_DIRNAME}` - The current project directory name' +
        '<br> \n',
		type: 'string',
		default: '${projectDir}/build-${name}',
		order: 2,
	},
	cmakeCommandArgs: {
		title: 'Custom CMake Arguments',
		description: 'Arguments passed to CMake during the generator phase.',
		type: 'string',
		default: '',
		order: 3,
	},
	buildCommandArgs: {
		title: 'Custom Build Tool Arguments',
		description: 'Arguments passed to the build tool while compiling the project.',
		type: 'string',
		default: '',
		order: 4,
	}
};

const FILENAMES_OF_INTEREST = ['CMakeLists.txt','CMakeSettings.json','CMakeCache.txt']

function isOfInterest(path) {
	return FILENAMES_OF_INTEREST.some(e => path.endsWith(e))
}

export function provideCMake() {
	return class CMakeBuildProvider extends EventEmitter {
		constructor(projectDirectory) {
			super();

			this.cmake = new CMake(atom.config.get('build-cmake-for-pulsar-by-sporniket.executable'));
			this.projectDirectory = projectDirectory;

			this.fileWatcher = atom.project.onDidChangeFiles(events => {
				for (const event of events) {
					if (isOfInterest(event.path)) {
						this.refresh();
						break ;
					}
				}
			})

			this.cmakeWatcher = atom.config.onDidChange('build-cmake-for-pulsar-by-sporniket.executable', (values) => {
				this.cmake = new CMake(values.newValue.trim());
				this.refresh();
			});

			this.buildRootWatcher = atom.config.onDidChange('build-cmake-for-pulsar-by-sporniket.buildRoot', () => {
				this.refresh();
			});

			this.cmakeCommandArgsWatcher = atom.config.onDidChange('build-cmake-for-pulsar-by-sporniket.cmakeCommandArgs', () => {
				this.refresh();
			});

			this.buildCommandArgsWatcher = atom.config.onDidChange('build-cmake-for-pulsar-by-sporniket.buildCommandArgs', () => {
				this.refresh();
			});
		}

		destructor() {
			this.fileWatcher.dispose()
			this.cmakeWatcher.dispose();
			this.buildRootWatcher.dispose();
			this.cmakeCommandArgsWatcher.dispose();
			this.buildCommandArgsWatcher.dispose();

			this.fileWatcher = undefined;
			this.cmakeWatcher = undefined;
			this.buildRootWatcher = undefined;
			this.cmakeCommandArgsWatcher = undefined;
			this.buildCommandArgsWatcher = undefined;
		}

		refresh() {
			try {
				this.emit('refresh');
			} catch (e) {
				// Don't care
			}
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
			console.log("build-cmake-for-pulsar-by-sporniket -- process configuration "+configuration.name);

			for (let k of ['buildRoot', 'cmakeCommandArgs', 'buildCommandArgs', 'ctestCommandArgs']) {
				if (configuration[k])
					configuration[k] = variableReplace(configuration[k], replaceVars);
			}

			configuration.cmakeCacheFile = path.join(configuration.buildRoot, 'CMakeCache.txt');
			configuration.cmakeCommandArgs = [
				'-G',configuration.generator,
				'-B',configuration.buildRoot,
				this.projectDirectory,
				'-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
			].concat(parseArguments(configuration.cmakeCommandArgs || ''))
				.concat((configuration.variables || []).map(variable => {
					const finalValue = variableReplace(variable.value, replaceVars);
					return `-D${variable.name}="${finalValue}"`;
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
				sh: false,
				postBuild: () => this.refresh()
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
							postBuild: () => this.refresh()
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
				return this.cmake.supportedGenerators().then(generators => {
					const generator = generators.find(g => g.prefered);

					if (generator) {
						return ['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'].map(configurationType => {
							return {
								name: configurationType,
								generator: generator.name,
								configurationType: configurationType,
								buildRoot: atom.config.get('build-cmake-for-pulsar-by-sporniket.buildRoot'),
								cmakeCommandArgs: atom.config.get('build-cmake-for-pulsar-by-sporniket.cmakeCommandArgs'),
								buildCommandArgs: atom.config.get('build-cmake-for-pulsar-by-sporniket.buildCommandArgs')
							};
						});
					} else {
						return [];
					}
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
					atom.notifications.addError('Could not retrieve settings !', {
						detail: error.message,
						dismissable: true,
						contenttype: 'text/plain',
					});
				});
		}
	};
}
