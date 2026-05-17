const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePreviewForDisplay,
  segmentPreviewBlocks,
} = require('../lib/services/preview-format');

test('normalizePreviewForDisplay removes noisy latex wrappers', () => {
  const result = normalizePreviewForDisplay('本文报道了 $\\boldsymbol{\\ce{[NH4]2[MoS4]}}$ 的合成。');

  assert.equal(result, '本文报道了 [NH4]2[MoS4] 的合成。');
});

test('normalizePreviewForDisplay renders common chemistry indices readably', () => {
  const result = normalizePreviewForDisplay('一旦制备好，[NH_4]_2[MoO_2S_2]^2- 可与 [Et_4N]OH 反应。将 Na_2 MoO_4 \\cdot 2H_2 O 溶解。');

  assert.equal(result, '一旦制备好，[NH₄]₂[MoO₂S₂]²⁻ 可与 [Et₄N]OH 反应。将 Na₂MoO₄·2H₂O 溶解。');
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
