// Checks the contracts before they reach consumers (run by CI and before every tag: npm run check).
// 1. every schema compiles (JSON Schema 2020-12, formats asserted, strict mode);
// 2. every example in examples/<schema>/ is valid against schemas/events/<schema>.json;
// 3. every schema named in topics.v1.json exists and every example folder has a schema;
// 4. every JSON file in vectors/ parses (vectors may hold deliberately invalid inputs, so their
//    payloads are not validated here; consumers' tests run them).
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const failures = [];
const fail = (msg) => failures.push(msg);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

const schemaFiles = walk(join(ROOT, 'schemas')).filter((p) => p.endsWith('.json'));
for (const path of schemaFiles) {
  try {
    ajv.addSchema(read(path));
  } catch (error) {
    fail(`${relative(ROOT, path)}: ${error.message}`);
  }
}
const byFile = new Map(schemaFiles.map((p) => [relative(ROOT, p), read(p).$id]));
for (const [file, id] of byFile) {
  try {
    ajv.getSchema(id) ?? fail(`${file}: not registered`);
  } catch (error) {
    fail(`${file}: ${error.message}`);
  }
}

let examples = 0;
for (const folder of readdirSync(join(ROOT, 'examples'))) {
  const schemaFile = `schemas/events/${folder}.json`;
  const id = byFile.get(schemaFile);
  if (!id) {
    fail(`examples/${folder}: no schema ${schemaFile}`);
    continue;
  }
  const validate = ajv.getSchema(id);
  for (const path of walk(join(ROOT, 'examples', folder)).filter((p) => p.endsWith('.json'))) {
    examples += 1;
    if (!validate(read(path))) {
      fail(`${relative(ROOT, path)}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
    }
  }
}

const topics = read(join(ROOT, 'topics.v1.json')).topics;
for (const topic of topics) {
  if (topic.schema && !existsSync(join(ROOT, topic.schema))) fail(`topics.v1.json: ${topic.name} -> missing ${topic.schema}`);
}

let vectors = 0;
for (const path of walk(join(ROOT, 'vectors')).filter((p) => p.endsWith('.json'))) {
  vectors += 1;
  try {
    read(path);
  } catch (error) {
    fail(`${relative(ROOT, path)}: ${error.message}`);
  }
}

const withoutSchema = topics.filter((t) => !t.schema).map((t) => t.name);
console.log(`schemas ${schemaFiles.length}, examples ${examples}, topics ${topics.length}, vectors ${vectors}`);
if (withoutSchema.length) console.log(`topics without a schema (known gap, ADR 2026-11-25): ${withoutSchema.join(', ')}`);
if (failures.length) {
  console.error(`FAILED ${failures.length}:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('contracts OK');
