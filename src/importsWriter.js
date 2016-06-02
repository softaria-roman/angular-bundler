'use strict';


var fs = require('fs');
var util = require('util');
var modulesBuilder = require('./modulesBuilder');

var importTemplate = '<script$async type="text/javascript" src="$src"></script>';
var moduleCommentTemplate = '<!-- module $ -->';

var asyncFileFlag = '+async';

var importsStartLabel = '<!-- angular-module-generator begin -->';
var importsEndLabel = '<!-- angular-module-generator end -->';

var staticImportsStartLabel = '<!-- static imports [$] begin -->';
var staticImportsEndLabel = '<!-- static imports [$] end -->';

/**
 * @typedef {Array<string | Object<string, string> | Object<string,string[]>>} StaticConfig
 */

/**
 * Write non-static js imports to config's html files according to build modules structure and list of static imports according to provided labels (if any)
 * @param filePath {string}
 * @param modules {ModulesStructure}
 * @param staticImportsConfig {StaticConfig | Object<string, StaticConfig>}
 * @returns {string[]}
 */
module.exports.writeImports = function(filePath, modules, staticImportsConfig) {
    var file = fs.readFileSync(filePath) + '';

    var mainModuleMatch = file.match(/ng-app="(.*?)"/);
    if (!mainModuleMatch || !mainModuleMatch[1]) {
        throw Error("ng-app declaration was not found in file " + filePath);
    }

    var mainModuleName = mainModuleMatch[1];

    var mainModule = modules[mainModuleName];
    if (!mainModule) {
        throw Error("Module " + mainModuleName + " declared in file " + filePath + " was not found");
    }

    var dependencies = modulesBuilder.resolveDependencies(mainModuleName, modules);
    var dependenciesImports = dependencies
        .map(function(depName) {
            return moduleCommentTemplate.replace('$', depName) +
                   '\n' +
                   formatImports(sortModuleFiles(modules[depName].files)) +
                   '\n';
        }).join('\n');

    var staticImports = collectStaticImports(staticImportsConfig);
    var isStaticImportsSimple = typeof staticImports === 'string';

    var importsStart = file.indexOf(importsStartLabel);
    var importsEnd = file.indexOf(importsEndLabel);
    if (importsStart <= 0 || importsEnd <= 0) {
        throw Error("Imports label (" + importsStartLabel + ") was not found in file " + filePath);
    }

    file = file.substring(0, importsStart + importsStartLabel.length) +
           '\n' +
           (isStaticImportsSimple ? staticImports + '\n' : '') +
           dependenciesImports +
           file.substring(importsEnd);

    if (!isStaticImportsSimple) {
        Object.keys(staticImports).forEach(function(tag) {
            var startLabel = staticImportsStartLabel.replace('$', tag);
            var start = file.indexOf(startLabel);
            if (start <= 0) {
                throw Error("Imports label (" + startLabel + ") was not found in file " + filePath);
            }

            var endLabel = staticImportsEndLabel.replace('$', tag);
            var end = file.indexOf(endLabel);
            if (end <= 0) {
                throw Error("Imports label (" + endLabel + ") was not found in file " + filePath);
            }

            file = file.substring(0, start + startLabel.length) +
                   '\n' +
                   staticImports[tag] +
                   '\n' +
                   file.substring(end);

        })
    }

    fs.writeFileSync(filePath, file);

    var dependenciesSize = mainModule.size +
                           dependencies.reduce(function(prev, dep) {
                               return prev + modules[dep].size
                           }, 0);
    console.log("App " + mainModuleName + " has " + dependenciesSize + "KB of non-static imports");

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

    function sortModuleFiles(files) {
        var head = files[0]; // keep definition first
        var tail = files.slice(1);
        tail.sort();

        return [head].concat(tail);
    }

    /**
     * @param config {StaticConfig | Object<string, StaticConfig>}
     * @returns {string | Object<string, string>}
     */
    function collectStaticImports(config) {
        if (util.isArray(config)) {
            return collectList(config);
        } else if (config instanceof Object) {
            return Object.keys(config).reduce(function(prev, key) {
                var list = config[key];
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
};