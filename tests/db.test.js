import assert from 'node:assert/strict';
import { commitLegacyRescue, dbTestUtils, putProgressMonotonic, STORE_NAMES } from '../src/db.js';

assert.equal(dbTestUtils.DB_NAME, 'shiyue-reader');
assert.equal(dbTestUtils.DB_VERSION, 2);
assert.ok(STORE_NAMES.includes('books'));
assert.ok(STORE_NAMES.includes('files'));
assert.ok(STORE_NAMES.includes('progress'));
assert.ok(STORE_NAMES.includes('notes'));
assert.ok(STORE_NAMES.includes('highlights'));
assert.ok(STORE_NAMES.includes('bookmarks'));
assert.ok(STORE_NAMES.includes('drafts'));
assert.deepEqual(dbTestUtils.STORE_DEFINITIONS.sections.indexes[1][1], ['bookId', 'order']);
assert.equal(dbTestUtils.STORE_DEFINITIONS.drafts.keyPath, 'id');
assert.equal(typeof commitLegacyRescue, 'function');
assert.equal(typeof putProgressMonotonic, 'function');
console.log('db schema: 13 assertions passed');
