#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const jsonPath = process.argv[2] || 'metadata.json';
const schemaPath = process.argv[3] || 'metadata.schema.json';

function exitErr(msg) {
  console.error(msg);
  process.exit(1);
}

let json, schema;
try {
  json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  exitErr(`Failed to parse ${jsonPath}: ${e.message}`);
}
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
} catch (e) {
  // Fallback: try resolving schema relative to the script (project root)
  try {
    const alt = path.join(__dirname, '..', schemaPath);
    schema = JSON.parse(fs.readFileSync(alt, 'utf8'));
  } catch (e2) {
    exitErr(`Failed to parse ${schemaPath}: ${e2 && e2.message ? e2.message : e.message}`);
  }
}

// Use Ajv programmatically for robust JSON Schema validation
try {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(json);
  if (!valid) {
    console.error('JSON Schema validation failed:');
    console.error(JSON.stringify(validate.errors, null, 2));
    process.exit(1);
  }
  console.log(`${jsonPath} — schema validation passed`);
  process.exit(0);
} catch (e) {
  // Fallback: minimal required-keys check
  const required = schema.required || [];
  const missing = required.filter(k => !(k in json));
  if (missing.length) {
    exitErr(`Validation failed — missing required keys: ${missing.join(', ')}`);
  }
  console.log(`${jsonPath} — basic validation passed (required keys present).`);
  process.exit(0);
}
