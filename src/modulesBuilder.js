'use strict';

var glob = require('glob');
var vm = require('vm');
var fs = require('fs');
var util = require('util');

exports.ProviderConfig = ProviderConfig;

exports.buildModulesStructure = buildModulesStructure;
exports.buildDOTDiagram = buildDOTDiagram;
exports.validateInjects = validateInjects;
exports.resolveDependencies = resolveDependencies;
exports.findCircularReference = findCircularReference;

/**
 * Read all js files from given directories and build modules structure.
 * @param dirs {string[]} directories containig .js files to look for modules/providers/... declarations
 * @param filePathMapper {function(string, string):string=} function that maps given filename in given directory to new filename which is saved in structure
 * depends on injected service's module; <i>validateProviderConstructor == false</i> disables this check
 * @returns {ModulesStructure} modules description by names
 */
function buildModulesStructure(dirs, filePathMapper) {
    var modulesStructure = {};

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
}

/**
 * Builds modules dependencies DOT diagram. It contains declaration all of graph elements and enumeration of all graph edges.
 * @param modules {ModulesStructure}
 * @returns {string}
 */
function buildDOTDiagram(modules) {
    var graph = 'digraph dependencies {\n';
    var localModules = Object.keys(modules);

    // build elements declaration
    graph += localModules.map(function(name) {
        return '"' + name + '";'
    }).join('\n');
    graph += '\n';

    // build edges declaration
    localModules.forEach(function(moduleName) {
        modules[moduleName].dependencies.forEach(function(dep) {
            if (localModules.indexOf(dep) >= 0) {
                graph += '\t"' + moduleName + '" -> ' + '"' + dep + '";\n';
            }
        });
    });
    graph += "\n}";

    return graph;
}

/**
 * @param modules {ModulesStructure}
 * @returns {string[]}
 */
function validateInjects(modules) {
    var moduleByProvider = Object.keys(modules).reduce(function(prev, moduleName) {
        modules[moduleName].providers.forEach(function(provider) {
            prev[provider.name] = moduleName;
        });

        return prev;
    }, {});

    var errors = [];

    Object.keys(modules).forEach(function(moduleName) {
        var module = modules[moduleName];

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
}

/**
 *
 * @param moduleName {strict}
 * @param modules {ModulesStructure}
 * @returns {strict[]}
 */
function resolveDependencies(moduleName, modules) {
    if (findCircularReference(modules)) {
        throw Error("Can not build dependency tree - found circular dependency");
    }

    return doResolve([moduleName]);

    function doResolve(deps) {
        return deps.reduce(function(prev, dep) {
            if (modules[dep]) {
                prev = prev.concat(doResolve(modules[dep].dependencies));
                prev.push(dep);
            }

            return prev;
        }, []).filter(function dropDuplicates(element, index, array) {
            return index === array.indexOf(element);
        });
    }
}

/**
 * @param modules {ModulesStructure}
 * @returns {string[]} module names trail containig circular reference
 */
function findCircularReference(modules) {
    var modulesNames = Object.keys(modules);

    for (var i = 0; i < modulesNames.length; i++) {
        try {
            doFind(modulesNames[i], []);
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
            var deps = modules[module].dependencies;

            if (deps.length > 0) {
                deps.forEach(function(dep) {
                    if (modules[dep]) {
                        doFind(dep, trail.concat(module));
                    }
                })
            }
        }
    }

    function CRef(trail) {
        this.trail = trail;
    }
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
 * @param modules {ModulesStructure}
 * @param getFileNameFn {function():string}
 * @param getFileSizeFn {function():number}
 * @returns {Object}
 */
function buildAngularModuleSandbox(modules, getFileNameFn, getFileSizeFn) {
    var sandbox = {};
    var currentModuleName = null;

    sandbox.angular = {};
    sandbox.angular.module = function(name, dependencies) {
        var module = modules[name] || (modules[name] = new ModuleConfig());

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
        var isArrayConstructor = util.isArray(constructor);
        if (isArrayConstructor) {
            validateConstructor(name + 'Provider', constructor);
        }

        var serviceConstructor = isArrayConstructor ? constructor[constructor.length - 1] : constructor;

        try {
            var constructed = new serviceConstructor();
        } catch (e) {
            console.error("Unable to create provider in file " + getFileNameFn() + ". Possible name is " + name + '. Error: ' + e);
            return;
        }

        if (!constructed.$get) {
            console.error("Provider " + name + " is missing $get field");
            return;
        } else if (Object.keys(constructed.$get).length === 0) {
            // provider not creating service explicitly
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
        var isArrayMinifyReadyConstructor = util.isArray(constructor);
        var isFunctionMinifyReadyConstructor = (typeof constructor === 'function') && constructor.length === 0;

        if (!isArrayMinifyReadyConstructor && !isFunctionMinifyReadyConstructor) {
            console.error("Some provider in file " + getFileNameFn() + " is not minify-ready. Possible name is " + name);
            return;
        }

        if (!currentModuleName) {
            console.error("Provider " + name + " is defined before it's module");
            return;
        }

        var module = modules[currentModuleName];
        if (module.providers.some(function(provider) { return provider.name === name })) {
            console.error("Duplicate declaration of " + name);
            return;
        }

        var config = new ProviderConfig();
        config.name = name;
        config.injects = isArrayMinifyReadyConstructor ? constructor.slice(0, constructor.length - 1) : [];
        module.providers.push(config);
    }
}

/**
 * @typedef {Object<string, ModuleConfig>} ModulesStructure
 */