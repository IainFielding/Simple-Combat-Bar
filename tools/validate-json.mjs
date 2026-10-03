/**
 * Fail-fast JSON validation for the files Foundry parses at load: the module manifest and
 * every language file it lists. A stray trailing comma in `lang/en.json` silently breaks localisation
 * in the live game with no build step to catch it, so CI parses them here on every push.
 *
 * `module.json` carries `#{VERSION}#`-style release tokens that are substituted at publish
 * time; those live *inside* JSON string values, so the file is still valid JSON as committed
 * and parses fine here.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The manifest, then every language file it lists, so a new translation is checked as soon as it's
// added to module.json (and one listed there but missing fails too).
const files = ["module.json"];
try {
  const manifest = JSON.parse(await readFile(resolve(root, "module.json"), "utf8"));
  for ( const { path } of manifest.languages ?? [] ) files.push(path);
} catch { /* reported below, when module.json itself is parsed */ }

let failures = 0;
for ( const rel of files ) {
  const path = resolve(root, rel);
  try {
    JSON.parse(await readFile(path, "utf8"));
    console.log(`ok    ${rel}`);
  } catch ( err ) {
    failures++;
    console.error(`FAIL  ${rel}: ${err.message}`);
  }
}

if ( failures ) {
  console.error(`\n${failures} JSON file(s) failed to parse.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} JSON file(s) valid.`);
