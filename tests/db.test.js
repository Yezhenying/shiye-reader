import assert from 'node:assert/strict';
import { dbTestUtils, STORE_NAMES } from '../src/db.js';

assert.equal(dbTestUtils.DB_NAME, 'shiyue-reader');
assert.equal(dbTestUtils.DB_VERSION, 1);
assert.ok(STORE_NAMES.includes('books'));
assert.ok(STORE_NAMES.includes('files'));
assert.ok(STORE_NAMES.includes('progress'));
assert.ok(STORE_NAMES.includes('notes'));
assert.ok(STORE_NAMES.includes('highlights'));
assert.ok(STORE_NAMES.includes('bookmarks'));
assert.deepEqual(dbTestUtils.STORE_DEFINITIONS.sections.indexes[1][1], ['bookId', 'order']);
console.log('db schema: 9 assertions passed');
