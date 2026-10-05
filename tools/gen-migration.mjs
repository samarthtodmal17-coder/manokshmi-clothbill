// Regenerates src-tauri/migrations/0001_init.sql from the SCHEMA in www/sqlite-adapter.js.
// Only ever run this BEFORE the first release. After that, add 0002_*.sql by hand.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const A = require('../www/sqlite-adapter.js');
writeFileSync(new URL('../src-tauri/migrations/0001_init.sql', import.meta.url), A.buildSchemaSql());
console.log('wrote 0001_init.sql');
