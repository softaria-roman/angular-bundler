'use strict';

var glob = require("glob");
var fs = require("fs");
var util = require("util");
var vm = require('vm');

var importsStartLabel = '<!-- angular-module-generator begin -->';
var importsEndLabel = '<!-- angular-module-generator end -->';
var importTemplate = '<script$async type="text/javascript" src="$src"></script>';
var moduleCommentTemplate = '<!-- module $ -->';
var staticImportsStartLabel = '<!-- static imports [$] begin -->';
var staticImportsEndLabel = '<!-- static imports [$] end -->';

var asyncFileFlag = '+async';

var configPath = process.argv[2];
if (!configPath || !fs.existsSync(configPath)) {
    throw Error("Config file not found");
}

/** @type {GeneratorConfig} */
var config = JSON.parse(fs.readFileSync(configPath));
validateConfig(config);

/** @type {Object<string, ModuleConfig>} */
var modules = {};
var angularModuleSandbox = buildAngularModuleSandbox(modules);

// Read all js files according to given config and prepare modules structure
config.js.forEach(function(jsConfig, index) {
    validateJsConfig(jsConfig, index);

    var dir = jsConfig.dir;
    var pattern = dir + (dir.substr(dir.length - 1) === '/' ? '' : '/') + '**/*.js';
    var filenames = glob.sync(pattern);
    console.log("Process path [" + jsConfig.dir + "], found " + filenames.length + " js files");

    var context = vm.createContext(angularModuleSandbox);
    filenames.forEach(function(filename) {
        var file = fs.readFileSync(filename) + '';
        context.generatorFilename = filename
            .replace(jsConfig.dir, jsConfig.serverPrefix)
            .replace('//', '/');

        context.generatorFilesize = Math.ceil(fs.statSync(filename).size / 1024.0);

        try {
            vm.runInContext(file, context);
        } catch (e) {
            // do nothing - we are interested only in angular.module calls
        }
    })
});

fs.writeFileSync('generated.json', JSON.stringify(modules));

// Write non-static js imports to config's html files according to build modules structure
// and list of static imports according to provided labels (if any)
config.html.forEach(function(path) {
    var file = fs.readFileSync(path) + '';
    var mainModuleMatch = file.match(/ng-app="(.*?)"/);
    if (!mainModuleMatch || !mainModuleMatch[1]) {
        throw Error("ng-app declaration was not found in file " + path);
    }
    var mainModuleName = mainModuleMatch[1];

    var mainModule = modules[mainModuleName];
    if (!mainModule) {
        throw Error("Module " + mainModuleName + " declared in file " + path + " was not found");
    }

    var dependenciesImports = resolveDependenciesDeep(mainModule.deps, modules).reduce(function(prev, depName) {
        return prev +
               moduleCommentTemplate.replace('$', depName) +
               '\n' +
               formatImports(modules[depName].files) +
               '\n\n';
    }, '');

    var mainModuleImports = formatImports(mainModule.files);

    var staticImports = collectStaticImports(config);
    var isStaticImportsSimple = typeof staticImports === 'string';

    var importsStart = file.indexOf(importsStartLabel);
    var importsEnd = file.indexOf(importsEndLabel);
    if (importsStart <= 0 || importsEnd <= 0) {
        throw Error("Imports label (" + importsStartLabel + ") was not found in file " + path);
    }

    file = file.substring(0, importsStart + importsStartLabel.length) +
           '\n' +
           (isStaticImportsSimple ? staticImports + '\n' : '') +
           dependenciesImports +
           moduleCommentTemplate.replace('$', mainModuleName) +
           '\n' +
           mainModuleImports +
           '\n' +
           file.substring(importsEnd);

    if (!isStaticImportsSimple) {
        Object.keys(staticImports).forEach(function(tag) {
            var startLabel = staticImportsStartLabel.replace('$', tag);
            var start = file.indexOf(startLabel);
            if (start <= 0) {
                throw Error("Imports label (" + startLabel + ") was not found in file " + path);
            }

            var endLabel = staticImportsEndLabel.replace('$', tag);
            var end = file.indexOf(endLabel);
            if (end <= 0) {
                throw Error("Imports label (" + endLabel + ") was not found in file " + path);
            }

            file = file.substring(0, start + startLabel.length) +
                   '\n' +
                   staticImports[tag] +
                   '\n' +
                   file.substring(end);

        })
    }

    fs.writeFileSync(path, file);
});

// Write modules' dependencies DOT diagram
var graph = 'digraph dependencies {\n';
var localModules = Object.keys(modules);

graph += localModules.map(function(name) {
    return '"' + name + '";'
}).join('\n');
graph += '\n';

localModules.forEach(function(moduleName) {
    modules[moduleName].deps.forEach(function(dep) {
        if (localModules.indexOf(dep) >= 0) {
            graph += '\t"' + moduleName + '" -> ' + '"' + dep + '";\n';
        }
    });
});
graph += "\n}";

fs.writeFileSync('generated.dot', graph);

function validateConfig(config) {
    if (!config) {
        throw Error("Empty config");
    }
    if (!config.js) {
        throw Error("'js' part of config is missing");
    }
    if (!util.isArray(config.js)) {
        throw Error("Wrong 'js' format - array expected");
    }
    if (!config.html) {
        throw Error("'html' part is missing");
    }
    if (!util.isArray(config.html)) {
        throw Error("Wrong 'html' format - array expected");
    }
}

function validateJsConfig(jsConfig, index) {
    if (!jsConfig) {
        throw Error("Empty js config");
    }
    if (!jsConfig.dir) {
        throw Error("Directory path is missing in entry " + index + " of 'js' part of config");
    }
    if (!jsConfig.serverPrefix) {
        throw Error("Server prefix is missing in entry " + index + " of 'js' part of config");
    }
}

function buildAngularModuleSandbox(modules) {
    var sandbox = {};
    sandbox.angular = {};
    sandbox.angular.module = function(name, deps) {
        var module = modules[name] || (modules[name] = {deps: [], files: [], size: 0});

        if (deps) {
            module.deps = deps;
        }

        if (module.files.indexOf(sandbox.generatorFilename) < 0) {
            if (deps) { //module declaration - put it before other module's files
                module.files = [sandbox.generatorFilename].concat(module.files);
            } else {
                module.files.push(sandbox.generatorFilename);
            }

            module.size += sandbox.generatorFilesize;
        }

        return sandbox.angular.module;
    };

    sandbox.angular.module.provider = function() {
    };
    sandbox.angular.module.factory = function() {
    };
    sandbox.angular.module.service = function() {
    };
    sandbox.angular.module.value = function() {
    };
    sandbox.angular.module.constant = function() {
    };
    sandbox.angular.module.decorator = function() {
    };
    sandbox.angular.module.animation = function() {
    };
    sandbox.angular.module.filter = function() {
    };
    sandbox.angular.module.controller = function() {
    };
    sandbox.angular.module.directive = function() {
    };
    sandbox.angular.module.config = function() {
        return sandbox.angular.module;
    };
    sandbox.angular.module.run = function() {
        return sandbox.angular.module;
    };

    return sandbox;
}

/**
 * @param files {string[]}
 * @returns {string}
 */
function formatImports(files) {
    return files.map(function(file) {
        var template = importTemplate;

        var asyncFlag = file.indexOf(asyncFileFlag) >= 0;
        if (asyncFlag) {
            file = file.replace(asyncFileFlag, '');
            template = template.replace('$async', ' async');
        } else {
            template = template.replace('$async', '');
        }

        return template.replace('$src', file);
    }).join('\n')
}

/**
 * @param deps {string[]}
 * @param modules {Object<string, ModuleConfig>}
 * @returns {string[]}
 */
function resolveDependenciesDeep(deps, modules) {
    return deps.reduce(function(prev, dep) {
        if (modules[dep]) {
            prev = prev.concat(resolveDependenciesDeep(modules[dep].deps, modules));
            prev.push(dep);
        }

        return prev;
    }, []).filter(dropDuplicates);
}

function dropDuplicates(element, index, array) {
    return index === array.indexOf(element);
}

/**
 * @param config {GeneratorConfig}
 * @returns {string | Object<string, string>}
 */
function collectStaticImports(config) {
    if (util.isArray(config.static)) {
        return collectList(config.static);
    } else if (config.static instanceof Object) {
        return Object.keys(config.static).reduce(function(prev, key) {
            var list = config.static[key];
            if (!util.isArray(list)) {
                throw Error("Wrong 'static' format - expected array in field [" + key + "]");
            }

            prev[key] = collectList(list);

            return prev;
        }, {});
    } else {
        throw Error("Wrong 'static' format - expected array or object");
    }

    function collectList(list) {
        return list.map(function(staticConfig) {
            if (typeof staticConfig === 'string') {
                return formatImports([staticConfig]);
            } else if (staticConfig instanceof Object) {
                var comment = Object.keys(staticConfig)[0];
                return '<!-- ' + comment + ' -->' +
                       '\n' +
                       formatImports(util.isArray(staticConfig[comment]) ? staticConfig[comment] : [staticConfig[comment]]);
            } else {
                throw Error("Unrecognized format for static import " + staticConfig.toString());
            }
        }).join('\n\n');
    }
}

/**
 * @typedef {Object} GeneratorConfig
 * @property {Array<JsConfig>} js
 * @property {Array<string>} html
 * @property {StaticConfig | Object<string, StaticConfig>} static
 */

/**
 * @typedef {Object} JsConfig
 * @property {string} dir
 * @property {string} serverPrefix
 */

/**
 * @typedef {Object} ModuleConfig
 * @property {string[]} deps
 * @property {string[]} files
 * @property {number} size
 */

/**
 * @typedef {Array<string | Object<string, string> | Object<string,string[]>>} StaticConfig
 */