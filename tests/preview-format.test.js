const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePreviewForDisplay,
  segmentPreviewBlocks,
} = require('../lib/services/preview-format');

test('normalizePreviewForDisplay removes noisy latex wrappers', () => {
  const result = normalizePreviewForDisplay('本文报道了 $\\boldsymbol{\\ce{[NH4]2[MoS4]}}$ 的合成。');

  assert.equal(result, '本文报道了 [NH₄]₂[MoS₄] 的合成。');
});

test('normalizePreviewForDisplay renders common chemistry indices readably', () => {
  const result = normalizePreviewForDisplay('一旦制备好，[NH_4]_2[MoO_2S_2]^2- 可与 [Et_4N]OH 反应。将 Na_2 MoO_4 \\cdot 2H_2 O 溶解。');

  assert.equal(result, '一旦制备好，[NH₄]₂[MoO₂S₂]²⁻ 可与 [Et₄N]OH 反应。将 Na₂MoO₄·2H₂O 溶解。');
});

test('normalizePreviewForDisplay renders plain chemistry formulas without touching material labels', () => {
  const result = normalizePreviewForDisplay('MOFs 的催化 H2 析出活性较低。NH2-MIL-125(Ti) 与 MoS2/WO3 可形成 2D 1T-MoS2。');

  assert.equal(result, 'MOFs 的催化 H₂ 析出活性较低。NH₂-MIL-125(Ti) 与 MoS₂/WO₃ 可形成 2D 1T-MoS₂。');
});

test('normalizePreviewForDisplay converts model-emitted html subscript tags', () => {
  const result = normalizePreviewForDisplay('表1 | [Et<sub>4</sub>N]<sub>2</sub>[MoS<sub>4</sub>] | 470 |<br>NH<sub>4</sub><sup>+</sup>');

  assert.equal(result, '表1 | [Et₄N]₂[MoS₄] | 470 |\nNH₄⁺');
});

test('normalizePreviewForDisplay unwraps display equations without leaking latex containers', () => {
  const result = normalizePreviewForDisplay(`\\[
\\beginalgian*
[NH_4]_2[MS_4] + 2[Et_4N]OH \\longrightarrow [Et_4N]_2[MS_4] + 2H_2O + 2NH_3 \\\\
\\endalign*
\\]`);

  assert.equal(result, '[NH₄]₂[MS₄] + 2[Et₄N]OH → [Et₄N]₂[MS₄] + 2H₂O + 2NH₃');
});

test('segmentPreviewBlocks marks title and sections for paper-like rendering', () => {
  const blocks = segmentPreviewBlocks(`铵盐和四烷基铵硫代钼酸盐及硫代钨酸盐的合成与表征

JOHN W. McDONALD、G. DELBERT FRIESEN

摘要

本文报道了相关合成方法。

引言

这是正文段落。`);

  assert.deepEqual(
    blocks.map((block) => block.type),
    ['title', 'meta', 'section', 'paragraph', 'section', 'paragraph'],
  );
});
