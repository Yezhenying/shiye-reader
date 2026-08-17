import assert from 'node:assert/strict';
import { BACKUP_SCHEMA_VERSION, backupTestUtils } from '../src/backup.js';

assert.equal(BACKUP_SCHEMA_VERSION, 1);
assert.equal(backupTestUtils.bytesToHex(new Uint8Array([0, 15, 255]).buffer), '000fff');
console.log('backup: 2 assertions passed');
