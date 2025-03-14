'use babel';
'use strict';

import fs from 'fs';
import path from 'path';
import glob from 'glob';
import {spawn} from 'child_process';

/* SPDX-License-Identifier: MIT */
/****************************************

---
Copyright (C) 2015,2016,2017,2018 Aaron Siegel
Copyright (C) 2025 David SPORN
---
This is part of **build-cmake-for-pulsar**.
Generate and build cmake projects from within Pulsar.
****************************************/

export default class CMake {
	constructor(executable) {
		this.executable = executable.trim();
	}

	grepStdout(command, commandArguments, outputRegex, callback, outputMessage, prefilter) {
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
					if (prefilter)
						stdout = prefilter(stdout);

					let matches = [];
					let match = outputRegex.exec(stdout);
					while (match !== null) {
						matches = matches.concat(callback(match));
						match = outputRegex.exec(stdout);
					}

					if (outputMessage !== null && matches.length <= 0)
						reject(outputMessage);
					else
						resolve(matches);
				}
			});
		});
	}

	supportedGenerators() {
		return this.grepStdout(
			this.executable, ['--help'],
			/\n(\s{2}|[*]\s)([^=]+)=\sGenerates?([^\n]*)(\n\s{3,}[^\n]*)?/g,
			(match) => {
				return {
					prefered:match[1].trim() === "*",
					name:match[2].trim(),
					description:match[3].trim(),
					qualifiers:match[4] ? match[4].trim().slice(1,-2).split(",").map(e => e.trim()) : []
				}
			},
			'The executable "' + this.executable + '" failed to produce generators!',
			(stdout) => {
				return stdout.substring(stdout.indexOf('Generators'));
			});
	}

	makeFileTargets(configuration) {
		return this.grepStdout(
			this.executable, ['--build', configuration.buildRoot, '--target', 'help'],
			/\.{3}\s(.[^\s]+)/g, (match) => {
				return [match[1].trim()];
			});
	}

	ninjaTargets(configuration) {
		return this.grepStdout(
			this.executable, ['--build', configuration.buildRoot, '--', '-t', 'targets'],
			/(.+):/g,
			(match) => {
				return [match[1].trim()];
			})
			.then((targets) => {
				return this.grepStdout(
					this.executable,
					['--build', configuration.buildRoot, '--', '-t', 'query', 'all'],
					/^\s{4}(.*)$/gm,
					(match) => {
						return [match[1].trim()];
					})
					.then((allTargets) => {
						return targets.concat(allTargets);
					});
			});
	}

	visualStudioTargets(configuration) {
		return new Promise((resolve, reject) => {
			glob(
				'**/*.vcxproj', {
					cwd: configuration.buildRoot,
					nodir: true,
					ignore: 'CMakeFiles/**',
				},
				(error, files) => {
					if (error)
						reject(error);
					else
						resolve(files.map((file) => path.basename(file, '.vcxproj')).concat(['clean']));
				});
		});
	}

	extractTargets(configuration) {
		if (!fs.existsSync(configuration.cmakeCacheFile))
			return Promise.resolve([]);
		else if (configuration.generator.match('Visual Studio'))
			return this.visualStudioTargets(configuration);
		else if (configuration.generator.match('Ninja'))
			return this.ninjaTargets(configuration);
		else if (configuration.generator.match('Makefiles'))
			return this.makeFileTargets(configuration);
		else
			return Promise.reject({message: `Cannot extract targets for generator "${configuration.generator}"`});
	}
}
