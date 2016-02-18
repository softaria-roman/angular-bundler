'use strict';

var glob = require("glob");
var fs = require("fs");
var util = require("util");
var vm = require('vm');

var importsStartLabel = '<!-- angular-module-generator begin -->';
var importsEndLabel = '<!-- angular-module-generator end -->';
var importTemplate = '<script type="text/javascript" src="$"></script>';
var moduleCommentTemplate = '<!-- module $ -->';

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

        try {
            vm.runInContext(file, context);
        } catch (e) {
            // do nothing - we are interested only in angular.module calls
        }
    })
});

fs.writeFileSync('generated.json', JSON.stringify(modules));

// Write js imports to config's html files according to build modules structure and list of static imports
config.html.forEach(function(path) {
    var file = fs.readFileSync(path) + '';
    var mainModuleName = file.match(/ng-app="(.*?)"/)[1];
    if (!mainModuleName) {
        throw Error("ng-app declaration was not found in file " + path);
    }

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

    var staticImports = config.static.reduce(function(prev, staticConfig) {
        if (typeof staticConfig === 'string') {
            return prev + formatImports([staticConfig]) + '\n\n';
        } else if (staticConfig instanceof Object) {
            var comment = Object.keys(staticConfig)[0];
            return prev +
                   '<!-- ' + comment + ' -->' +
                   '\n' +
                   formatImports(util.isArray(staticConfig[comment]) ? staticConfig[comment] : [staticConfig[comment]]) +
                   '\n\n';
        } else {
            throw Error("Unrecognized format for static import " + staticConfig.toString());
        }
    }, '');

    var importsStart = file.indexOf(importsStartLabel);
    var importsEnd = file.indexOf(importsEndLabel);
    if (importsStart <= 0 || importsEnd <= 0) {
        throw Error("Imports label (" + importsStartLabel + ") was not found in file " + path);
    }

    file = file.substring(0, importsStart + importsStartLabel.length) +
           '\n' +
           "<!-- static imports -->" +
           '\n' +
           staticImports +
           '\n' +
           dependenciesImports +
           moduleCommentTemplate.replace('$', mainModuleName) +
           '\n' +
           mainModuleImports +
           '\n' +
           file.substring(importsEnd);

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
        var module = modules[name] || (modules[name] = {deps: [], files: []});

        if (deps) {
            module.deps = deps;
        }

        if (module.files.indexOf(sandbox.generatorFilename) < 0) {
            if (deps) { //module declaration - put it before other module's files
                module.files = [sandbox.generatorFilename].concat(module.files);
            } else {
                module.files.push(sandbox.generatorFilename);
            }
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
        return importTemplate.replace('$', file)
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
 * @typedef {Object} GeneratorConfig
 * @property {Array<JsConfig>} js
 * @property {Array<string>} html
 * @property {Array<string | Object<string, string> | Object<string,string[]>>} static
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
 */