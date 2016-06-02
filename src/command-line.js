'use strict';

var fs = require("fs");
var util = require("util");
var bundler = require('./bundler');

/**
 * @enum {string}
 */
var OPTIONS = {
    noWrite: 'no-write',
    validateInjects: 'validate-injects',
    makeJson: 'make-json',
    makeDot: 'make-dot'
};

var argv = require('yargs')
    .usage('Usage: $0 [options] <config>')
    .demand(1, 1, "Single config file path required")
    .option(OPTIONS.noWrite, {
        describe: "load and validate modules structure, do not write import tags into html",
        boolean: true
    })
    .option(OPTIONS.validateInjects, {
        describe: "validate providers/services/etc. injects - provider's module must include modules of all injected providers",
        boolean: true
    })
    .option(OPTIONS.makeJson, {
        describe: "write .json file with modules structure",
        boolean: true
    })
    .option(OPTIONS.makeDot, {
        describe: "write .dot file with modules structure diagram",
        boolean: true
    })
    .argv;


var configPath = argv._[0];
if (!configPath || !fs.existsSync(configPath)) {
    throw Error("Config file not found");
}

var bundle = bundler(JSON.parse(fs.readFileSync(configPath)));
console.log("Collected " +
            Object.keys(bundle.modules).length +
            " modules with total size " +
            Object.keys(bundle.modules).reduce(function(prev, m) { return prev + bundle.modules[m].size }, 0) +
            "KB");

var injectsErrors = argv[OPTIONS.validateInjects] ? bundle.validateInjects() : [];
var circular = bundle.findCircularReference();

if (argv[OPTIONS.noWrite]) {
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

    bundle.writeImports();
}

var configName = configPath.replace(/\.json/, '');

if (argv[OPTIONS.makeJson]) {
    fs.writeFileSync(configName + '.modules.json', JSON.stringify(bundle.modules));
}

if (argv[OPTIONS.makeDot]) {
    fs.writeFileSync(configName + '.dot', bundle.buildDOTDiagram());
}