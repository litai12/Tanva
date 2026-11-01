#!/usr/bin/env node
/**
 * Production build = `tsc -p tsconfig.build.json` + the official @nestjs/swagger
 * compiler plugin. The plugin derives OpenAPI fields for every *.dto.ts class from
 * its TypeScript types and class-validator decorators, so /api/docs-json describes
 * real request bodies (external agents rely on it) without hand-written @ApiProperty.
 *
 * Same semantics as tsc: all diagnostics are printed and any error fails the build.
 */
const path = require('node:path');
const ts = require('typescript');
const { before: swaggerBefore } = require('@nestjs/swagger/plugin');

const configPath = path.resolve(__dirname, '..', process.argv[2] || 'tsconfig.build.json');
const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { report([d]); process.exit(1); } };
const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
const program = ts.createProgram({ rootNames: config.fileNames, options: config.options, projectReferences: config.projectReferences, configFileParsingDiagnostics: config.errors });

const swagger = swaggerBefore({
  dtoFileNameSuffix: ['.dto.ts', '.entity.ts'],
  // Controllers stay untouched: only request/response DTO schemas are generated.
  controllerFileNameSuffix: [],
  classValidatorShim: true,
  // Some legacy DTO comments are mis-encoded; don't publish them as descriptions.
  introspectComments: false,
}, program);

const emitted = program.emit(undefined, undefined, undefined, false, { before: [swagger] });
const diagnostics = ts.sortAndDeduplicateDiagnostics([...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]);
report(diagnostics);
const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length;
if (errors || emitted.emitSkipped) process.exit(1);

function report(list) {
  if (!list.length) return;
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(list, {
    getCanonicalFileName: f => f, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => ts.sys.newLine,
  }));
}
