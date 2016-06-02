'use strict';

var fs = require("fs");
var util = require("util");
var modulesBuilder = require('./modulesBuilder');
var importsWriter = require('./importsWriter');

/**
 * @param config {BundlerConfig}
 * @returns {Bundle}
 */
module.exports = function(config) {
    validateConfig(config);

    return new Bundle(config, buildModules(config));
};

/**
 * @param config {BundlerConfig}
 * @param modules {ModulesStructure}
 * @constructor
 */
function Bundle(config, modules) {
    var self = this;
    
    /**
     * @type {BundlerConfig}
     */
    this.config = config;

    /**
     * @type {ModulesStructure}
     */
    this.modules = modules;

    this.writeImports = function() {
        self.config.html.forEach(function(htmlFilePath) {
            importsWriter.writeImports(htmlFilePath, self.modules, self.config.static);
        });
    };

    /**
     * @returns {string}
     */
    this.buildDOTDiagram = function() {
        return modulesBuilder.buildDOTDiagram(self.modules);
    };

    /**
     * @returns {string[]}
     */
    this.validateInjects = function() {
        return modulesBuilder.validateInjects(self.modules);
    };

    /**
     * @returns {string[]}
     */
    this.findCircularReference = function() {
        return modulesBuilder.findCircularReference(self.modules);
    }
}

/**
 * @param config {BundlerConfig}
 */
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
        if (jsConfig.mapping && (!(typeof jsConfig.mapping === 'object')) && Object.keys(jsConfig.mapping).length !== 1) {
            throw Error("Wrong file path mapping in entry " + index + " of 'js' part of config - expected object with 1 field");
        }
    });
}

/**
 * @param config {BundlerConfig}
 * @returns {ModulesStructure}
 */
function buildModules(config) {
    var directories = config.js.map(function(jsConfig) {
        return jsConfig.dir
    });

    // replace real fs paths of modules files with server ones during modules collection
    var filenameMapper = function(filename, dir) {
        var dirConfig = config.js.filter(function(jsConfig) {
            return jsConfig.dir === dir
        });

        if (dirConfig && dirConfig.length === 1) {
            var replacementConfig = dirConfig[0].mapping;
            var from = Object.keys(replacementConfig);
            var to = replacementConfig[from];

            return filename
                .replace(from, to)
                .replace(/\/\//, '/');
        } else {
            return filename;
        }
    };

    return modulesBuilder.buildModulesStructure(directories, filenameMapper);
}

/**
 * @typedef {Object} BundlerConfig
 * @property {Array<JsConfig>} js
 * @property {Array<string>} html
 * @property {StaticImportConfig | Object<string, StaticImportConfig>} static
 * @property {boolean} validateProviderConstructor
 * @property {boolean} strictDependenciesMode
 */

/**
 * @typedef {Object} JsConfig
 * @property {string} dir
 * @property {Object<string, string>} mapping
 */