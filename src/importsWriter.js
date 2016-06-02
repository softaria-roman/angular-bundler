'use strict';

var fs = require('fs');
var util = require('util');
var modulesBuilder = require('./modulesBuilder');
var htmlBeautify = require('js-beautify').html;

var importTemplate = '<script$async type="text/javascript" src="$src"></script>';
var importCssTemplate = '<link$async rel="stylesheet" type="text/css" href="$src">';

var moduleCommentTemplate = '<!-- module $ -->';

var asyncFileFlag = '+async';

var modulesJsStartLabel = '<!-- modules js begin -->';
var modulesJsEndLabel = '<!-- modules js end -->';

var staticJsStartLabel = '<!-- static js [$] begin -->';
var staticJsEndLabel = '<!-- static js [$] end -->';
var staticCssStartLabel = '<!-- static css [$] begin -->';
var staticCssEndLabel = '<!-- static css [$] end -->';

/**
 * @typedef {Array<string | Object<string, string> | Object<string,string[]>>} StaticImportConfig
 */

/**
 * Write non-static js imports to config's html files according to build modules structure and list of static imports according to provided labels (if any)
 * @param filePath {string}
 * @param modules {ModulesStructure}
 * @param staticImportsConfig {StaticImportConfig | Object<string, StaticImportConfig>}
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
            var importEntries = sortModuleFiles(modules[depName].files).map(buildImportEntry);

            return moduleCommentTemplate.replace('$', depName) +
                   '\n' +
                   printImports(importEntries).js;
        })
        .join('\n');

    var staticImports;
    if (Array.isArray(staticImportsConfig)) {
        staticImports = printImports(collectImports(staticImportsConfig));
    } else {
        if (!(staticImportsConfig instanceof Object)) {
            throw Error("Wrong 'static' format - expected object or array");
        }

        Object.keys(staticImportsConfig).forEach(function(name) {
            var imports = printImports(collectImports(staticImportsConfig[name]));

            if (imports.js) {
                file = insertBetweenLabels(staticJsStartLabel.replace('$', name),
                                           staticJsEndLabel.replace('$', name),
                                           imports.js,
                                           file);
            }

            if (imports.css) {
                file = insertBetweenLabels(staticCssStartLabel.replace('$', name),
                                           staticCssEndLabel.replace('$', name),
                                           imports.css,
                                           file);
            }
        });
    }

    file = insertBetweenLabels(modulesJsStartLabel,
                               modulesJsEndLabel,
                               (staticImports ? staticImports + '\n' : '') + dependenciesImports,
                               file);

    var beautified = htmlBeautify(file, {
        extra_liners: [],
        indent_body_inner_html: false
    });

    fs.writeFileSync(filePath, beautified);

    var dependenciesSize = mainModule.size +
                           dependencies.reduce(function(prev, dep) {
                               return prev + modules[dep].size
                           }, 0);
    console.log("App " + mainModuleName + " has " + dependenciesSize + "KB of non-static imports");

    /**
     * @param startLabel {string}
     * @param endLabel {string}
     * @param content {string}
     * @param file {string}
     * @returns {string}
     */
    function insertBetweenLabels(startLabel, endLabel, content, file) {
        var start = file.indexOf(startLabel);
        if (start <= 0) {
            throw Error("Imports label '" + startLabel + "' was not found in file " + filePath);
        }

        var end = file.indexOf(endLabel);
        if (end <= 0) {
            throw Error("Imports label '" + endLabel + "' was not found in file " + filePath);
        }

        return file.substring(0, start + startLabel.length) +
               '\n' +
               content +
               file.substring(end);
    }
};

/**
 * @param files {string[]}
 * @returns {string[]}
 */
function sortModuleFiles(files) {
    var head = files[0]; // keep module definition first
    var tail = files.slice(1);
    tail.sort();

    return [head].concat(tail);
}

/**
 * @param fileEntry {string}
 * @returns {ImportEntry}
 */
function buildImportEntry(fileEntry) {
    var isAsync = fileEntry.indexOf(asyncFileFlag) >= 0;
    var type;

    fileEntry = fileEntry.replace(asyncFileFlag, '');

    if (fileEntry.endsWith('.js')) {
        type = 'js';
    } else if (fileEntry.endsWith('.css')) {
        type = 'css';
    } else {
        throw Error("Unrecognized file format for import file " + fileEntry);
    }

    return new ImportEntry(fileEntry, type, isAsync);
}

/**
 * Reads config in all possible import formats and returns import model entries
 * @param importConfigsList {StaticImportConfig}
 * @returns {(ImportEntry | ImportGroup)[]}
 */
function collectImports(importConfigsList) {
    return importConfigsList.map(function(config) {
        if (typeof config === 'string') {
            return buildImportEntry(config);
        }

        if (Array.isArray(config)) {
            return config.map(buildImportEntry);
        }

        if (typeof config === 'object') {
            var comment = Object.keys(config)[0];

            return new ImportGroup(
                comment,
                Array.isArray(config[comment]) ?
                    config[comment].map(buildImportEntry) :
                    [buildImportEntry(config[comment])]
            );
        }

        throw Error("Unrecognized format for static import " + config.toString());
    });
}

/**
 * @param imports {(ImportEntry | ImportGroup)[]}
 * @returns {{js: string, css: string}}
 */
function printImports(imports) {
    return {
        js: doPrint(imports, 'js'),
        css: doPrint(imports, 'css')
    };

    function doPrint(imports, typeFilter) {
        return imports.map(function(importEntry) {
            if (importEntry instanceof ImportEntry) {
                if (importEntry.type !== typeFilter) {
                    return null;
                }

                return printSingle(importEntry) + '\n';
            }

            if (importEntry instanceof ImportGroup) {
                if (!importEntry.entries.some(function(entry) { return entry.type === typeFilter })) {
                    return null;
                }

                return '<!-- ' + importEntry.comment + ' -->' +
                       '\n' +
                       importEntry.entries
                           .filter(function(entry) {
                               return entry.type === typeFilter;
                           })
                           .map(printSingle)
                           .join('\n') +
                       '\n';
            }

            throw Error("Unrecognized import model " + importEntry);
        }).filter(function(importString) {
            return !!importString;
        }).join('\n');

        /**
         * @param entry {ImportEntry}
         */
        function printSingle(entry) {
            var template;

            switch (entry.type) {
                case 'js':
                    template = importTemplate;
                    break;
                case 'css':
                    template = importCssTemplate;
                    break;
                default:
                    throw Error("Unrecognized file format for import file " + entry.src);
            }

            if (entry.async) {
                template = template.replace('$async', ' async');
            } else {
                template = template.replace('$async', '');
            }

            return template.replace('$src', entry.src);
        }
    }
}

if (!String.prototype.endsWith) {
    String.prototype.endsWith = function(searchString, position) {
        var subjectString = this.toString();
        if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
            position = subjectString.length;
        }
        position -= searchString.length;
        var lastIndex = subjectString.indexOf(searchString, position);
        return lastIndex !== -1 && lastIndex === position;
    };
}

/**
 * @param src {string}
 * @param type {'js'|'css'}
 * @param async {boolean}
 * @constructor
 */
function ImportEntry(src, type, async) {
    /**
     * @type {string}
     */
    this.src = src;

    /**
     * @type {'js'|'css'}
     */
    this.type = type;

    /**
     * @type {boolean}
     */
    this.async = async;
}

/**
 * @param comment {string}
 * @param entries {ImportEntry[]}
 * @constructor
 */
function ImportGroup(comment, entries) {
    /**
     * @type {string}
     */
    this.comment = comment;

    /**
     * @type {ImportEntry[]}
     */
    this.entries = entries;
}