import assert from 'node:assert/strict';
import { describePolishChanges, polishText, normalizeStoredNotes } from '../src/textPolish.js';

assert.equal(polishText(''), '');
assert.equal(polishText(null), '');
assert.equal(polishText('我觉得这本书挺有意思，所以想再看一遍'), '在我看来，这本书颇具启发性，因此，想再看一遍。');
assert.equal(polishText('因为结构很清楚，所以很好懂！'), '其原因在于结构很清楚，因此，很好懂！');
assert.equal(polishText('第一点\n\n\n第二点'), '第一点。\n\n第二点。');
assert.deepEqual(describePolishChanges('我觉得这个想法挺有意思'), ['调整了口语措辞', '整理了标点']);
assert.deepEqual(describePolishChanges('已经很清楚。'), []);
assert.deepEqual(normalizeStoredNotes(null), []);
const restored = normalizeStoredNotes([{ note: '' }, { note: '  有效  ', tags: '错误类型' }, null]);
assert.equal(restored.length, 1);
assert.equal(restored[0].note, '  有效  ');
assert.deepEqual(restored[0].tags, ['思考']);
assert.equal(normalizeStoredNotes(Array.from({ length: 80 }, (_, id) => ({ id, note: 'x' }))).length, 80);

console.log('textPolish: 12 assertions passed');
