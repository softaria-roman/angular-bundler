'use strict';

(function(){
    var glob = require('glob');
    var vm = require('vm');
    var fs = require('fs');
    var util = require('util');

    exports.ModulesStructure = ModulesStructure;
    exports.ProviderConfig = ProviderConfig;

    /**
     * Read all js files from given directories and build modules structure.
     * @param dirs {string[]} directories containig .js files to look for modules/providers/... declarations
     * @param filePathMapper {function(string, string):string=} function that maps given filename in given directory to new filename which is saved in structure
     * @param validateProviderConstructor {boolean} if true, will check that all provider/factory/service/... declarations are minify-ready
     * @param validateDependencies {boolean} if true, will check that if provider/factory/serivce/... injects service, then provider's module <b>explicitly</b>
     * depends on injected service's module; <i>validateProviderConstructor == false</i> disables this check
     * @returns {ModulesStructure} modules description by names
     */
    exports.buildModulesStructure = function(dirs, filePathMapper, validateProviderConstructor, validateDependencies) {
        var modulesStructure = new ModulesStructure();

        var currentFileName, currentFileSize;
        var angularModuleSandbox = buildAngularModuleSandbox(modulesStructure,
                                                             validateProviderConstructor,
                                                             function() { return currentFileName },
                                                             function() { return currentFileSize });

        dirs.forEach(function(dir) {
            var pattern = dir + (dir.substr(dir.length - 1) === '/' ? '' : '/') + '**/*.js';
            var filenames = glob.sync(pattern);
            console.log("Process path [" + dir + "], found " + filenames.length + " js files");

            var context = vm.createContext(angularModuleSandbox);
            filenames.forEach(function(filename) {
                var file = fs.readFileSync(filename) + '';
                currentFileName = filePathMapper ? filePathMapper(filename, dir) : filename;
                currentFileSize = Math.ceil(fs.statSync(filename).size / 1024.0);

                try {
                    vm.runInContext(file, context);
                } catch (e) {
                    // do nothing - we are interested only in angular.module calls
                }
            })
        });

        if (validateProviderConstructor && validateDependencies) {
            var moduleByProvider = Object.keys(modulesStructure.modules).reduce(function(prev, moduleName) {
                modulesStructure.modules[moduleName].providers.forEach(function(provider) {
                    prev[provider.name] = moduleName;
                });

                return prev;
            }, {});

            Object.keys(modulesStructure.modules).forEach(function(moduleName) {
                var module = modulesStructure.modules[moduleName];

                module.providers.forEach(function(provider) {
                    provider.injects.forEach(function(inject) {
                        var moduleDependency = moduleByProvider[inject];

                        if (moduleDependency && !module.deps.some(function(depName) { return depName === moduleDependency })) {
                            console.error("Module " + moduleName + " have provider " + provider.name + " which injects " + inject + " defined in " +
                                          moduleDependency + ", but module " + moduleName + " do not depends on module " + moduleDependency + " explicitly");
                        }
                    });
                })
            })
        }

        return modulesStructure;
    };

    /**
     * Builds modules dependencies DOT diagram. It contains declaration all of graph elements and enumeration of all graph edges.
     * @param modulesStructure {ModulesStructure}
     * @returns {string}
     */
    exports.buildDOTDiagram = function(modulesStructure) {
        var graph = 'digraph dependencies {\n';
        var localModules = Object.keys(modulesStructure.modules);

        // build elements declaration
        graph += localModules.map(function(name) {
            return '"' + name + '";'
        }).join('\n');
        graph += '\n';

        // build edges declaration
        localModules.forEach(function(moduleName) {
            modulesStructure.modules[moduleName].deps.forEach(function(dep) {
                if (localModules.indexOf(dep) >= 0) {
                    graph += '\t"' + moduleName + '" -> ' + '"' + dep + '";\n';
                }
            });
        });
        graph += "\n}";

        return graph;
    };

    function ModulesStructure() {
        var self = this;

        /** @type {Object<string, ModuleConfig>} */
        this.modules = {};

        /**
         * @param moduleNames {string[]}
         */
        this.resolveDependencies = function(moduleNames) {
            return moduleNames.reduce(function(prev, dep) {
                if (self.modules[dep]) {
                    prev = prev.concat(self.resolveDependencies(self.modules[dep].deps));
                    prev.push(dep);
                }

                return prev;
            }, []).filter(function dropDuplicates(element, index, array) {
                return index === array.indexOf(element);
            });
        }
    }

    function ModuleConfig() {
        /**
         * @type {string[]}
         */
        this.deps = [];

        /**
         * @type {string[]}
         */
        this.files = [];

        /**
         * @type {number}
         */
        this.size = 0;

        /**
         * @type {ProviderConfig[]}
         */
        this.providers = [];
    }

    function ProviderConfig() {
        /**
         * @type {string}
         */
        this.name = null;

        /**
         * @type {string[]}
         */
        this.injects = [];
    }

    /**
     * @param modulesStructure {ModulesStructure}
     * @param validateProviderConstructor {boolean}
     * @param getFileNameFn {function():string}
     * @param getFileSizeFn {function():number}
     * @returns {Object}
     */
    function buildAngularModuleSandbox(modulesStructure, validateProviderConstructor, getFileNameFn, getFileSizeFn) {
        var sandbox = {};
        var currentModuleName = null;

        sandbox.angular = {};
        sandbox.angular.module = function(name, deps) {
            var module = modulesStructure.modules[name] || (modulesStructure.modules[name] = new ModuleConfig());

            if (deps) {
                module.deps = deps;
            }

            if (module.files.indexOf(getFileNameFn()) < 0) {
                if (deps) { //module declaration - put it before other module's files
                    module.files = [getFileNameFn()].concat(module.files);
                } else {
                    module.files.push(getFileNameFn());
                }

                module.size += getFileSizeFn();
            }

            currentModuleName = name;

            return sandbox.angular.module;
        };

        sandbox.angular.module.provider = function(name, constructor) {
            var constructed = new constructor();
            if (!constructed.$get) {
                throw Error("Provider " + name + " is missing $get field");
            }

            validateConstructor(name, constructed.$get);
        };
        sandbox.angular.module.factory = function(name, constructor) {
            validateConstructor(name, constructor);
        };
        sandbox.angular.module.service = function(name, constructor) {
            validateConstructor(name, constructor);
        };
        sandbox.angular.module.value = function(name, instance) {
        };
        sandbox.angular.module.constant = function(name, instance) {
        };
        sandbox.angular.module.decorator = function() {
        };
        sandbox.angular.module.animation = function() {
        };
        sandbox.angular.module.filter = function() {
        };
        sandbox.angular.module.controller = function(name, constructor) {
            validateConstructor(name, constructor);
        };
        sandbox.angular.module.directive = function(name, constructor) {
            validateConstructor(name, constructor);
        };
        sandbox.angular.module.config = function() {
            return sandbox.angular.module;
        };
        sandbox.angular.module.run = function() {
            return sandbox.angular.module;
        };

        return sandbox;

        function validateConstructor(name, constructor) {
            if (validateProviderConstructor) {
                if (!util.isArray(constructor)) {
                    throw Error(name + " is not minify-ready");
                }

                if (!currentModuleName) {
                    throw Error("Provider " + name + " is defined before it's module");
                }

                var module = modulesStructure.modules[currentModuleName];
                if (module.providers.some(function(provider) { return provider.name === name })) {
                    throw Error("Duplicate declaration of " + name);
                }

                var config = new ProviderConfig();
                config.name = name;
                config.injects = constructor.slice(0, constructor.length - 1);
                module.providers.push(config);
            }
        }
    }
}());