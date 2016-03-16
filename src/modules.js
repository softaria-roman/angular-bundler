'use strict';

(function() {
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
     * depends on injected service's module; <i>validateProviderConstructor == false</i> disables this check
     * @returns {ModulesStructure} modules description by names
     */
    exports.buildModulesStructure = function(dirs, filePathMapper) {
        var modulesStructure = new ModulesStructure();

        var currentFileName, currentFileSize;
        var angularModuleSandbox = buildAngularModuleSandbox(modulesStructure,
                                                             function() { return currentFileName },
                                                             function() { return currentFileSize });

        dirs.forEach(function(dir) {
            var pattern = dir + (dir.substr(dir.length - 1) === '/' ? '' : '/') + '**/*.js';
            var filenames = glob.sync(pattern);
            console.log("Process path [" + dir + "], found " + filenames.length + " js files");

            filenames.forEach(function(filename) {
                var file = fs.readFileSync(filename) + '';
                currentFileName = filePathMapper ? filePathMapper(filename, dir) : filename;
                currentFileSize = Math.ceil(fs.statSync(filename).size / 1024.0);

                try {
                    vm.runInContext(file, angularModuleSandbox);
                } catch (e) {
                    // do nothing - we are interested only in angular.module calls
                }
            })
        });

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
            modulesStructure.modules[moduleName].dependencies.forEach(function(dep) {
                if (localModules.indexOf(dep) >= 0) {
                    graph += '\t"' + moduleName + '" -> ' + '"' + dep + '";\n';
                }
            });
        });
        graph += "\n}";

        return graph;
    };

    /**
     * @param modulesStructure {ModulesStructure}
     * @returns {string[]}
     */
    exports.validateInjects = function(modulesStructure) {
        var moduleByProvider = Object.keys(modulesStructure.modules).reduce(function(prev, moduleName) {
            modulesStructure.modules[moduleName].providers.forEach(function(provider) {
                prev[provider.name] = moduleName;
            });

            return prev;
        }, {});

        var errors = [];

        Object.keys(modulesStructure.modules).forEach(function(moduleName) {
            var module = modulesStructure.modules[moduleName];

            module.providers.forEach(function(provider) {
                provider.injects.forEach(function(inject) {
                    var moduleDependency = moduleByProvider[inject];
                    var invalidInject = moduleDependency &&
                                        moduleDependency !== moduleName && !module.dependencies.some(function(depName) {
                            return depName === moduleDependency
                        });

                    if (invalidInject) {
                        errors.push("Module " + moduleName + " have provider " + provider.name + " which injects " + inject + " defined in " +
                                    moduleDependency + ", but module " + moduleName + " do not depends on module " + moduleDependency + " explicitly");
                    }
                });
            })
        });

        return errors;
    };

    /**
     *
     * @param moduleName {strict}
     * @param modulesStructure {ModulesStructure}
     * @returns {strict[]}
     */
    exports.resolveDependencies = function(moduleName, modulesStructure) {
        var result = [];
        doResolve([moduleName], result);
        return result;

        function doResolve(moduleNames, result) {
            moduleNames.forEach(function(depName) {
                var dep = modulesStructure.modules[depName];

                if (dep) {
                    var uniqueDeps = dep.dependencies.filter(function(dep) {
                        return result.indexOf(dep) < 0 && modulesStructure.modules[dep];
                    });

                    if (uniqueDeps.length > 0) {
                        Array.prototype.push.apply(result, uniqueDeps);
                        doResolve(uniqueDeps, result);
                    }
                }
            });
        }
    };

    /**
     * @param modulesStructure {ModulesStructure}
     * @returns {string[]} module names' trail containig circular reference
     */
    exports.findCircularReference = function(modulesStructure) {
        var modules = Object.keys(modulesStructure.modules);

        for (var i = 0; i < modules.length; i++) {
            try {
                doFind(modules[i], []);
            } catch (e) {
                if (e instanceof CRef) {
                    return e.trail;
                } else {
                    throw e;
                }
            }
        }

        /**
         * @param module {string}
         * @param trail {string[]}
         */
        function doFind(module, trail) {
            if (trail.indexOf(module) >= 0) {
                throw new CRef(trail.concat(module));
            } else {
                var deps = modulesStructure.modules[module].dependencies;

                if (deps.length > 0) {
                    deps.forEach(function(dep) {
                        if (modulesStructure.modules[dep]) {
                            doFind(dep, trail.concat(module));
                        }
                    })
                }
            }
        }

        function CRef(trail) {
            this.trail = trail;
        }
    };

    function ModulesStructure() {
        /** @type {Object<string, ModuleConfig>} */
        this.modules = {};
    }

    function ModuleConfig() {
        /**
         * @type {string[]}
         */
        this.dependencies = [];

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
     * @param getFileNameFn {function():string}
     * @param getFileSizeFn {function():number}
     * @returns {Object}
     */
    function buildAngularModuleSandbox(modulesStructure, getFileNameFn, getFileSizeFn) {
        var sandbox = {};
        var currentModuleName = null;

        sandbox.angular = {};
        sandbox.angular.module = function(name, dependencies) {
            var module = modulesStructure.modules[name] || (modulesStructure.modules[name] = new ModuleConfig());

            if (dependencies) {
                module.dependencies = dependencies;
            }

            if (module.files.indexOf(getFileNameFn()) < 0) {
                if (dependencies) { //module declaration - put it before other module's files
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
            try {
                var constructed = new constructor();
            } catch (e) {
                console.error("Unable to create provider in file " + getFileNameFn() + ". Possible name is " + name);
                return;
            }

            if (!constructed.$get) {
                console.error("Provider " + name + " is missing $get field");
                return;
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

        return vm.createContext(sandbox);

        function validateConstructor(name, constructor) {
            if (!util.isArray(constructor)) {
                console.error("Some provider in file " + getFileNameFn() + " is not minify-ready. Possible name is " + name);
                return;
            }

            if (!currentModuleName) {
                console.error("Provider " + name + " is defined before it's module");
                return;
            }

            var module = modulesStructure.modules[currentModuleName];
            if (module.providers.some(function(provider) { return provider.name === name })) {
                console.error("Duplicate declaration of " + name);
                return;
            }

            var config = new ProviderConfig();
            config.name = name;
            config.injects = constructor.slice(0, constructor.length - 1);
            module.providers.push(config);
        }
    }
}());