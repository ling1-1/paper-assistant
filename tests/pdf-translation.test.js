const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanVisionTranslationText,
  createPageBatches,
  createPageNumberBatches,
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

test('createPageNumberBatches covers every page in long PDFs', () => {
  const batches = createPageNumberBatches(45, 3, 60);

  assert.equal(batches.length, 15);
  assert.deepEqual(batches[0], [1, 2, 3]);
  assert.deepEqual(batches.at(-1), [43, 44, 45]);
  assert.deepEqual(batches.flat(), Array.from({ length: 45 }, (_, index) => index + 1));
});

test('createPageNumberBatches can disable the translation page cap', () => {
  const batches = createPageNumberBatches(45, 8, null);

  assert.equal(batches.length, 6);
  assert.deepEqual(batches.at(-1), [41, 42, 43, 44, 45]);
});

test('createPageNumberBatches rejects PDFs over configured hard cap', () => {
  assert.throws(
    () => createPageNumberBatches(45, 3, 20),
    /PDF 共 45 页，已超过图片视觉翻译上限 20 页/,
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

test('cleanVisionTranslationText normalizes html chemistry tags before preview', () => {
  const cleaned = cleanVisionTranslationText('一旦制备好，[NH<sub>4</sub>]<sub>2</sub>[MoS<sub>4</sub>] 与 H<sub>2</sub>O 反应。<br>继续加热。');

  assert.equal(cleaned, '一旦制备好，[NH₄]₂[MoS₄] 与 H₂O 反应。\n\n继续加热。');
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
