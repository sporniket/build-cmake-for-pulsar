'use babel';

import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {execSync,
    exec} from 'child_process';
import voucher from 'voucher';
import glob from 'glob';

import defaultConfig from "./config";
export config from "./config";

// Store this because the default schema will overwrite it
var initialGeneratorValue = atom.config.get("build-cmake.generator");

export function providingFunction()
{
    const generateErrorMatch = [
        "(.+\n)?CMake Error at (?<file>[\\/0-9a-zA-Z\\._-]+):(?<line>\\d+)"
    ];
    const generateWarningMatch = [
        "(.+\n)?CMake Error at (?<file>[\\/0-9a-zA-Z\\._-]+):(?<line>\\d+)"
    ];
    const compileErrorMatch = [
        "(.+:\\d+:\\d+:\n)?(?<file>.+):(?<line>\\d+):(?<column>\\d+):\\s+(.*\\s+)?error:\\s+(?<message>.+)", // GCC/Clang Error,
        "(?<file>[a-zA-Z\\._\\-\\\\/:0-9]+)\\((?<line>\\d+)\\):\\s*error\\s*(C\\d+)?\\s*:(?<message>.*)" // Visual Studio Error
    ];
    const compileWarningMatch = [
        "(.+:\\d+:\\d+:\n)?(?<file>.+):(?<line>\\d+):(?<column>\\d+):\\s+(.*\\s+)?warning:\\s+(?<message>.+)", // GCC/Clang warning
        "(?<file>[a-zA-Z\\._\\-\\\\/:0-9]+)\\((?<line>\\d+)\\):\\s*warning\\s*(C\\d+)?\\s*:(?<message>.*)" // Visual Studio Error
    ];

    return class CMakeBuildProvider extends EventEmitter {
        constructor(source_dir)
        {
            super();
            // Set default value of generator. Wihtout this errors overwrite
            // the visual selection of the generator.
            this.generator = atom.config.get("build-cmake.generator");
            atom.config.observe('build-cmake.cmakelists', (cmakelists) => {
                this.source_dir = (!!cmakelists) ? source_dir + cmakelists.trim() : source_dir;
            });
            atom.config.observe('build-cmake.build_dir', (buildDir) => {

                const pathVars = {
                    TMPDIR : os.tmpdir(),
                    PROJECT_DIR : this.source_dir,
                    PROJECT_DIRNAME : path.basename(this.source_dir)
                };

                // @TODO: Add escape for '$'
                var pathVarNames = buildDir.match(/\$([a-zA-Z_]+)/g);

                if (pathVarNames) {
                    for (let i = 0; pathVarNames.length > i; i++) {
                        let pathVarName = pathVarNames[i];
                        let pathVarNameWithoutPrefix = pathVarName.substr(1);
                        let pathVarValue = pathVars[pathVarNameWithoutPrefix];

                        if (!pathVarValue) {
                            pathVarValue = "";
                            // @TODO: Maybe include environment variables?
                        }

                        let pathVarMatch = new RegExp(
                            "\\" + pathVarName);

                        buildDir = buildDir.replace(
                            pathVarMatch,
                            pathVarValue);
                    }
                }

                if (path.isAbsolute(buildDir)) {
                    this.build_dir = path.normalize(buildDir);
                } else {
                    this.build_dir = path.resolve(source_dir, buildDir);
                }

                this.cache_path = path.join(this.build_dir, 'CMakeCache.txt');
            });
            atom.config.observe('build-cmake.generator', (generator) => {
                this.generator = (!!generator) ? generator.trim() : '';
            });
            atom.config.observe('build-cmake.executable', executable => {
                this.executable = executable.trim();

                // Prevent any arguments since this could be exploited
                let firstWhiteSpace = this.executable.search(/\s/);
                if (firstWhiteSpace > -1) {
                    this.executable = this.executable.substr(0, firstWhiteSpace);
                }

                // @TODO: Either set their executable without arguments or
                //        give them an error message saying they cannot use
                //        arguments.
                // atom.config.set("build-cmake.executable", this.executable);
            });
            atom.config.observe('build-cmake.cmake_arguments', (args) => {
                this.cmake_arguments = args.split(' ').filter(v => v !== '');
            });
            atom.config.observe('build-cmake.build_arguments', (args) => {
                this.build_arguments = args.split(' ').filter(v => v !== '');
            });
            atom.config.observe('build-cmake.parallel_build', (parallel_build) => {
                this.parallel_build = parallel_build;
            });
            atom.config.onDidChange('build-cmake.build_dir', () => { this.emit('refresh'); });
            atom.config.onDidChange('build-cmake.executable', () => { this.emit('refresh'); });
            atom.config.onDidChange('build-cmake.generator', () => { this.emit('refresh'); });
            atom.config.onDidChange('build-cmake.cmakelists', () => { this.emit('refresh'); });
            atom.config.onDidChange('build-cmake.cmake_arguments', () => { this.emit('refresh'); });
            atom.config.onDidChange('build-cmake.build_arguments', () => { this.emit('refresh'); });
            atom.config.onDidChange('build-cmake.parallel_build', () => { this.emit('refresh'); });
        }

        destructor()
        {
        }

        getNiceName()
        {
            return 'cmake';
        }

        getDefaultGenerator()
        {
            // @TODO: Determine the platforms default generator instead of the
            //        first one in the list
            return this.availableGenerators[0];
        }

        getGeneratorSelectElement()
        {
            return document.getElementById("build-cmake.generator");
        }

        setAvailableGenerators(generators)
        {
            let selectEl = this.getGeneratorSelectElement();
            let currentGenerator = atom.config.get("build-cmake.generator");

            if (selectEl) {

                // Clear select element children.
                while (selectEl.lastChild) {
                    selectEl.lastChild.remove();
                }

                [""].concat(generators).forEach(generator => {
                    let optionEl = document.createElement("option");
                    optionEl.value = generator;
                    optionEl.textContent = generator;

                    selectEl.appendChild(optionEl);
                });

                // Clear above causes the selected value to disapear so we set
                // it here.
                selectEl.value = currentGenerator;
            }

            // Update schema with new enum values
            atom.config.setSchema("build-cmake.generator", Object.assign(defaultConfig.generator, { enum : [ '' ].concat(generators) }));

            if (!currentGenerator) {
                atom.config.set("build-cmake.generator", initialGeneratorValue);
                // Clear this once we've set it.
                initialGeneratorValue = "";
            }

            this.availableGenerators = generators;
        }

        setGeneratorSelectorError(msg)
        {
            let selectEl = this.getGeneratorSelectElement();
            if (selectEl) { // TODO
                let optionEl = document.createElement("option");
                optionEl.value = "";
                optionEl.textContent = msg;

                while (selectEl.lastChild) {
                    selectEl.lastChild.remove();
                }

                selectEl.appendChild(optionEl);
                selectEl.value = "";
            }
        }

        validateExecutable()
        {
            let executable = this.executable;

            function extractGenerators(stdout)
            {
                let generatorNames = [];
                let startIndex = stdout.search(/\s*Generators\s*(\r\n|\n)/);
                if (startIndex === -1) {
                    return false;
                }

                let generatorsStr = stdout.toString().substr(startIndex);
                let colonIndex = generatorsStr.indexOf(':');

                if (colonIndex === -1) {
                    return false;
                }

                generatorsStr = generatorsStr.substring(colonIndex + 1);

                let generatorsSplit = generatorsStr.split(/\n  (\w)/gi);

                if (generatorsSplit[0].trim() === "") {
                    generatorsSplit.shift();
                }

                for (let i = 0; generatorsSplit.length > i; i += 2) {
                    let generatorStr = generatorsSplit[i] + generatorsSplit[i + 1];
                    let generatorSplit = generatorStr.split("=");
                    let generatorName = generatorSplit[0].trim();
                    let generatorDesc = generatorSplit[1].trim();
                    let genNameNoArch = generatorName.replace("[arch]", "");
                    genNameNoArch = genNameNoArch.trim();

                    generatorNames.push(genNameNoArch);

                    if (generatorName.indexOf("[arch]") > -1) {
                        let archIndex = generatorDesc.indexOf("[arch]");
                        if (archIndex > -1) {
                            let archs = generatorDesc.match(/"\S*"/gi);

                            archs.forEach(arch => {
                                arch = arch.substring(1, arch.length - 1);
                                generatorNames.push(genNameNoArch + " " + arch);
                            });
                        }
                    }
                }

                return generatorNames;
            }

            return new Promise((resolve, reject) => {
                exec(executable + " --help", (err, stdout, stderr) => {

                    if (err) {
                        this.setGeneratorSelectorError(
                            `<ERROR: Failed to execute '${executable}'>`);
                        return reject();
                    }

                    if (stdout.length === 0) {
                        this.setGeneratorSelectorError(
                            `<ERROR: '${executable}' produced empty stdout>`);
                        return reject();
                    }

                    if (stderr.length > 0) {
                        this.setGeneratorSelectorError(
                            `<ERROR: Failed to execute '${executable}'>`);
                        return reject();
                    }

                    let generators = extractGenerators(stdout);

                    if (!generators) {
                        this.setGeneratorSelectorError(
                            `<ERROR: Invalid CMake executable '${executable}'>`);
                        return reject();
                    }

                    this.setAvailableGenerators(generators);
                    this.executable = executable;

                    return resolve();
                });
            });
        }

        isEligible()
        {
            return fs.existsSync(path.join(this.source_dir, 'CMakeLists.txt')) || fs.existsSync(this.cache_path);
        }

        createVisualStudioTarget(target_name)
        {
            args_list = [ '--build', this.build_dir, '--target', target_name, '--' ];
            if (this.parallel_build)
                args_list.push('/maxcpucount');
            return {
                atomCommandName : 'cmake:' + target_name,
                name : target_name,
                exec : this.executable,
                cwd : this.build_dir,
                args : args_list.concat(this.build_arguments),
                errorMatch : compileErrorMatch.concat(generateErrorMatch),
                warningMatch : compileWarningMatch.concat(generateWarningMatch),
                sh : false
            };
        }

        visualStudioTargets()
        {
            return Array.from(new Set(glob.sync("**/*.vcxproj", { cwd : this.build_dir, nodir : true, ignore : "CMakeFiles/**" })
                                          .map(target => path.basename(target, '.vcxproj'))))
                .map(target => this.createVisualStudioTarget(target))
                .concat([ this.createVisualStudioTarget('clean') ]);
        }

        createMakeFileTarget(target_name)
        {
            args_list = [ '--build', this.build_dir, '--target', target_name, '--' ];
            if (this.parallel_build)
                args_list.push('-j' + os.cpus().length);
            return {
                atomCommandName : 'cmake:' + target_name,
                name : target_name,
                exec : this.executable,
                cwd : this.build_dir,
                args : args_list.concat(this.build_arguments),
                errorMatch : compileErrorMatch.concat(generateErrorMatch),
                warningMatch : compileWarningMatch.concat(generateWarningMatch),
                sh : false
            };
        }

        makeFileTargets()
        {
            output = execSync(
                this.executable + ' --build "' + this.build_dir + '" --target help', { cwd : this.build_dir });
            return output.toString('utf8')
                .split(/[\r\n]{1,2}/)
                .filter(line => line.startsWith('...'))
                .map((line) => this.createMakeFileTarget(line.replace('... ', '').split(' ')[0]));
        }

        createNinjaTarget(target_name)
        {
            return {
                atomCommandName : 'cmake:' + target_name,
                name : target_name,
                exec : this.executable,
                cwd : this.build_dir,
                args : [ '--build', this.build_dir, '--target', target_name ].concat(this.build_arguments),
                errorMatch : compileErrorMatch.concat(generateErrorMatch),
                warningMatch : compileWarningMatch.concat(generateWarningMatch),
                sh : false
            };
        }

        ninjaTargets()
        {
            output = execSync(
                this.executable + ' --build "' + this.build_dir + '" -- -t query all', { cwd : this.build_dir });
            return output.toString('utf8')
                .split(/[\r\n]{1,2}/)
                .map((line) => this.createNinjaTarget(line.split(':')[0].trim()));
        }

        settings()
        {
            fs.unwatchFile(this.cache_path);

            fs.watchFile(this.cache_path, (curr, prev) => {
                if (fs.existsSync(this.cache_path) && curr.mtime != prev.mtime)
                    this.emit('refresh');
            });

            var args = this.cmake_arguments.concat([ '-B' + this.build_dir, '-H' + this.source_dir, '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON' ]);
            // Add custom generator if specified.
            if (!!this.generator) {
                args.unshift('-G' + this.generator);
            }
            const generateTarget = {
                atomCommandName : 'cmake:generate',
                name : 'generate',
                exec : this.executable,
                cwd : this.source_dir,
                args : args,
                errorMatch : generateErrorMatch,
                warningMatch : generateWarningMatch,
                sh : false
            };

            return this.validateExecutable()
                .then(() => {
                    return voucher(fs.readFile, this.cache_path, {
                        encoding : 'utf8'
                    });
                })
                .then(cache => {
                    var generator = cache.match(/CMAKE_GENERATOR:INTERNAL=(.*)/)[1];
                    if (generator.match('Visual Studio'))
                        return [ generateTarget ].concat(this.visualStudioTargets());
                    else if (generator.match('Ninja'))
                        return [ generateTarget ].concat(this.ninjaTargets());
                    else
                        return [ generateTarget ].concat(this.makeFileTargets());
                })
                .catch(e => {
                    return [ generateTarget ];
                });
        }
    };
}
