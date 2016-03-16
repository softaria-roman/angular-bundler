'use strict';

(function() {
    var fs = require("fs");
    var util = require("util");
    var modulesBuilder = require('./modules');
    var importsWriter = require('./imports');

    var configPath = process.argv[2];
    if (!configPath || !fs.existsSync(configPath)) {
        throw Error("Config file not found");
    }

    /** @type {GeneratorConfig} */
    var config = JSON.parse(fs.readFileSync(configPath));
    validateConfig(config);

    var directories = config.js.map(function(jsConfig) {
        return jsConfig.dir
    });
    // replace real fs paths of modules files with server ones during modules collection
    var filenameMapper = function(filename, dir) {
        var replacement = config.js.filter(function(jsConfig) {
            return jsConfig.dir === dir
        })[0].mapping;

        return filename
            .replace(replacement[0], replacement[1])
            .replace(/\/\//, '/');
    };
    var modulesStructure = modulesBuilder.buildModulesStructure(directories, filenameMapper, true, true);

    fs.writeFileSync('generated.json', JSON.stringify(modulesStructure));
    console.log("Collected " +
                Object.keys(modulesStructure.modules).length +
                " modules with total size " +
                Object.keys(modulesStructure.modules).reduce(function(prev, m) { return prev + modulesStructure.modules[m].size }, 0) +
                "KB");

    config.html.forEach(function(htmlFilePath) {
        importsWriter.writeImports(htmlFilePath, modulesStructure, config.static);
    });

    var graph = modulesBuilder.buildDOTDiagram(modulesStructure);
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

        config.js.forEach(function(jsConfig, index) {
            if (!jsConfig) {
                throw Error("Empty js config");
            }
            if (!jsConfig.dir) {
                throw Error("Directory path is missing in entry " + index + " of 'js' part of config");
            }
            if (jsConfig.mapping && (!util.isArray(jsConfig.mapping) || !jsConfig.mapping.length === 2)) {
                throw Error("Wrong file path mapping in entry " + index + " of 'js' part of config - expected 2-element array");
            }
        });
    }
}());

/**
 * @typedef {Object} GeneratorConfig
 * @property {Array<JsConfig>} js
 * @property {Array<string>} html
 * @property {StaticConfig | Object<string, StaticConfig>} static
 * @property {boolean} validateProviderConstructor
 * @property {boolean} strictDependenciesMode
 */

/**
 * @typedef {Object} JsConfig
 * @property {string} dir
 * @property {string[]} mapping
 */