'use strict';

(function() {
    var fs = require("fs");
    var util = require("util");
    var modulesBuilder = require('./modules');
    var importsWriter = require('./imports');

    /**
     * @enum {string}
     */
    var OPTIONS = {
        validateOnly: 'validate-only',
        validateInjects: 'validate-injects'
    };

    var argv = require('yargs')
        .usage('$0 [options] config_path')
        .demand(1, 1, "single config file path required")
        .option(OPTIONS.validateOnly, {
            describe: "load and validate modules structure, do not write anything",
            default: false
        })
        .option(OPTIONS.validateInjects, {
            describe: "validate providers/services/etc. injects - provider's module must include modules of all injected providers",
            default: true
        })
        .argv;

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

    var configPath = argv._[0];
    if (!configPath || !fs.existsSync(configPath)) {
        throw Error("Config file not found");
    }

    /** @type {GeneratorConfig} */
    var config = JSON.parse(fs.readFileSync(configPath));
    validateConfig(config);

    var modulesStructure = buildModules(config);
    var injectsErrors = argv[OPTIONS.validateInjects] ? modulesBuilder.validateInjects(modulesStructure) : [];
    var circular = modulesBuilder.findCircularReference(modulesStructure);

    if (argv[OPTIONS.validateOnly]) {
        if (circular) {
            throw Error("Found circular reference: " + circular.join(' -> '));
        }
        if (injectsErrors.length > 0) {
            throw Error(injectsErrors[0]);
        }

        return;
    } else {
        if (circular) {
            console.warn("Found circular reference: " + circular.join(' -> '));
        }
        if (injectsErrors.length > 0) {
            injectsErrors.forEach(console.warn);
        }
    }

    fs.writeFileSync('generated.json', JSON.stringify(modulesStructure));
    console.log("Collected " +
                Object.keys(modulesStructure.modules).length +
                " modules with total size " +
                Object.keys(modulesStructure.modules).reduce(function(prev, m) { return prev + modulesStructure.modules[m].size }, 0) +
                "KB");

    var graph = modulesBuilder.buildDOTDiagram(modulesStructure);
    fs.writeFileSync('generated.dot', graph);

    config.html.forEach(function(htmlFilePath) {
        importsWriter.writeImports(htmlFilePath, modulesStructure, config.static);
    });

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

    /**
     * @param config {GeneratorConfig}
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
                var replacement = dirConfig[0].mapping;
                return filename
                    .replace(replacement[0], replacement[1])
                    .replace(/\/\//, '/');
            } else {
                return filename;
            }
        };

        return modulesBuilder.buildModulesStructure(directories, filenameMapper);
    }
}());