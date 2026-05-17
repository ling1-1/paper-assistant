const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeParagraphs,
  formatReferenceSection,
  splitReferenceSection,
  stripOrphanPlaceholders,
} = require('../lib/translationPipeline');

test('normalizeParagraphs trims and splits content', () => {
  const result = normalizeParagraphs('A\n\nB\n\n\nC');
  assert.deepEqual(result, ['A', 'B', 'C']);
});

test('splitReferenceSection keeps references out of model translation input', () => {
  const result = splitReferenceSection(`Introduction

This paper studies catalysts.

References
G. Kriiss, Ann. Chem., 225, 1 (1884).
E. Corleis, Ann. Chem., 232, 244 (1886).`);

  assert.equal(result.mainText.includes('This paper studies catalysts.'), true);
  assert.equal(result.mainText.includes('G. Kriiss'), false);
  assert.match(result.referenceText, /^References/);
  assert.match(result.referenceText, /Ann\. Chem\./);
});

test('stripOrphanPlaceholders removes model-created placeholder noise', () => {
  assert.equal(
    stripOrphanPlaceholders('文本 PAPRASSISTTOKEN_12_ 继续 \\text{PAPRASSISTTOKEN\\_13\\_}'),
    '文本 继续',
  );
});

test('formatReferenceSection normalizes references to stable numbered entries', () => {
  const result = formatReferenceSection(`References
G. Kriiss, Ann. Chem., 225, 1
(1884).
2. E. Corleis, Ann. Chem., 232, 244 (1886).`);

  assert.equal(result, `参考文献

1. G. Kriiss, Ann. Chem., 225, 1 (1884).
2. E. Corleis, Ann. Chem., 232, 244 (1886).`);
});
