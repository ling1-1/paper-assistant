const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanVisionTranslationText,
  createPageBatches,
  hasRepetitiveGarbage,
  preserveOriginalReferences,
} = require('../lib/services/pdf-translation');

test('createPageBatches groups pages for multi-image model calls', () => {
  const pages = Array.from({ length: 7 }, (_, index) => ({ pageNumber: index + 1 }));
  const batches = createPageBatches(pages, 3);

  assert.deepEqual(
    batches.map((batch) => batch.map((page) => page.pageNumber)),
    [[1, 2, 3], [4, 5, 6], [7]],
  );
});

test('vision quality guard detects repetitive model garbage', () => {
  assert.equal(hasRepetitiveGarbage('MSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMS'), true);
  assert.equal(hasRepetitiveGarbage('这是一段正常的论文译文，包含化学式和实验描述。'), false);
});

test('cleanVisionTranslationText removes repeated garbage lines', () => {
  const cleaned = cleanVisionTranslationText(`正常段落

MSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMSMS

另一段正常译文`);

  assert.equal(cleaned, '正常段落\n\n另一段正常译文');
});

test('cleanVisionTranslationText removes repeated reference hallucination', () => {
  const cleaned = cleanVisionTranslationText(`正常段落

R. C. Burns, R. C. Burns, R. C. Burns, R. C. Burns, R. C. Burns, R. C. Burns, R. C. Burns, R. C. Burns`);

  assert.equal(cleaned, '正常段落');
});

test('preserveOriginalReferences replaces model-generated reference section', () => {
  const result = preserveOriginalReferences({
    translation: `正文译文

References
5. R. C. Burns, R. C. Burns, R. C. Burns`,
    extractedText: `Body text

References
1. G. Krüss, Ann. Chem., 225, 1 (1884).
2. E. Corleis, Ann. Chem., 232, 244 (1886).`,
  });

  assert.match(result, /正文译文/);
  assert.match(result, /1\. G\. Krüss/);
  assert.doesNotMatch(result, /R\. C\. Burns, R\. C\. Burns/);
});
