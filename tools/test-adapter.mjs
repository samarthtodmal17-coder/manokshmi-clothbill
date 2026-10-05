// Run: node tools/test-adapter.mjs   (needs Node 22+, uses built-in node:sqlite)
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const A = require('../www/sqlite-adapter.js');

const raw = new DatabaseSync(':memory:');
raw.exec(readFileSync(new URL('../src-tauri/migrations/0001_init.sql', import.meta.url), 'utf8'));
assert.equal(readFileSync(new URL('../src-tauri/migrations/0001_init.sql', import.meta.url), 'utf8'), A.buildSchemaSql(), 'migration out of sync with SCHEMA');

let busyOnce = 0;
const driver = {
  async execute(sql, params){
    if(busyOnce > 0){ busyOnce--; throw new Error('database is locked'); }
    const r = raw.prepare(sql.replace(/\$(\d+)/g, '?$1')).run(...params);
    return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  },
  async select(sql, params){ return raw.prepare(sql.replace(/\$(\d+)/g, '?$1')).all(...params).map(r => ({...r})); },
  async close(){ raw.close(); }
};
const db = A.create(driver);

// add w/o id -> autoincrement
const id1 = await db.add('products', {name:'Saree', category:'Women', stock:5, sizes:{S:1}});
const id2 = await db.add('products', {name:'Shirt', category:'Men'});
assert.equal(id1, 1); assert.equal(id2, 2);
assert.deepEqual(await db.get('products', 1), {name:'Saree', category:'Women', stock:5, sizes:{S:1}, id:1});
// put update keeps id, no cascade/dup
await db.put('products', {id:1, name:'Saree', category:'Women', stock:4});
assert.equal((await db.getAll('products')).length, 2);
assert.equal((await db.get('products',1)).stock, 4);
assert.equal(raw.prepare('SELECT "ix_name" n FROM products WHERE id=1').get().n, 'Saree');
// put w/o id inserts
const id3 = await db.put('products', {name:'Kurta'});
assert.equal(id3, 3);
// put with explicit new id, then autoincrement continues above it
await db.put('products', {id:50, name:'X'});
assert.equal(await db.add('products', {name:'Y'}), 51);
// add duplicate id rejects (IndexedDB ConstraintError parity)
await assert.rejects(db.add('products', {id:1, name:'dup'}));
// get missing -> undefined
assert.equal(await db.get('products', 999), undefined);
// delete
await db.delete('products', 50);
assert.equal(await db.get('products', 50), undefined);
// settings text key (the app's shape {key:'shop', value:{...}})
await db.put('settings', {key:'shop', value:{name:'Test', n:1}});
await db.put('settings', {key:'shop', value:{name:'Test2'}});
assert.deepEqual(await db.get('settings','shop'), {key:'shop', value:{name:'Test2'}});
assert.equal((await db.getAll('settings')).length, 1);
// openBills string ids
await db.put('openBills', {id:'tab-1', firmId:1, label:'A', cart:[{p:1}], createdAt:'2026-10-01T00:00:00Z'});
assert.deepEqual((await db.get('openBills','tab-1')).cart, [{p:1}]);
await assert.rejects(db.put('openBills', {label:'no id'}));
// unknown store
await assert.rejects(db.getAll('nope'));
// busy retry
busyOnce = 2;
await db.put('coupons', {code:'SAVE10', pct:10});
assert.equal((await db.getAll('coupons'))[0].code, 'SAVE10');
// ordering + concurrency: 200 parallel adds all land, in order of issue
await Promise.all(Array.from({length:200}, (_, i) => db.add('bills', {date:'2026-10-01', total:i})));
const bills = await db.getAll('bills');
assert.equal(bills.length, 200);
assert.deepEqual(bills.map(b => b.total), Array.from({length:200}, (_, i) => i));
// replaceAll keeps ids, wipes old
await db.replaceAll('bills', [{id:7, total:1}, {id:9, total:2}]);
assert.deepEqual((await db.getAll('bills')).map(b => b.id), [7, 9]);
await db.replaceAll('bills', []);
assert.equal((await db.getAll('bills')).length, 0);
// clear
await db.clear('products');
assert.equal((await db.getAll('products')).length, 0);
// a failed op doesn't poison the queue
await assert.rejects(db.add('coupons', {id:1, code:'a'}).then(() => db.add('coupons', {id:1, code:'a'})));
assert.ok(await db.getAll('coupons'));
// every store in SCHEMA round-trips
for(const name of Object.keys(A.SCHEMA)){
  const s = A.SCHEMA[name];
  const rec = {[s.key]: s.text ? 'k1' : 1, name:'n', date:'2026-10-01', nested:{a:[1,2]}, flag:true};
  await db.put(name, rec);
  assert.deepEqual(await db.get(name, rec[s.key]), rec, name);
}
await db.flushAndClose();
await assert.rejects(db.getAll('products'));
console.log('ALL ADAPTER TESTS PASSED (' + Object.keys(A.SCHEMA).length + ' stores)');
