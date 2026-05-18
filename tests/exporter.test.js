const test = require('node:test');
const assert = require('node:assert/strict');

const {
  exportTranslation,
  normalizePdfSafeText,
  selectPdfFontKeyForChar,
} = require('../lib/services/exporter');

test('docx exporter returns downloadable payload', async () => {
  const result = await exportTranslation({
    format: 'docx',
    originalText: 'Original text',
    translatedText: 'Translated text',
    filename: 'paper.pdf',
    sourceLang: 'en',
    targetLang: 'zh',
  });

  assert.match(result.filename, /translation\.docx$/);
  assert.match(result.downloadUrl, /^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/);
});

test('pdf exporter embeds a local CJK font when Chinese text is exported', async () => {
  const result = await exportTranslation({
    format: 'pdf',
    translatedText: '中文测试 [NH_4]_2[MoO_2S_2]^2-',
    filename: 'paper.pdf',
  });

  assert.match(result.filename, /translation\.pdf$/);
  assert.match(result.downloadUrl, /^data:application\/pdf;base64,/);
  assert.equal(result.pages >= 1, true);
});

test('pdf exporter normalizes chemistry glyphs that are commonly missing in CJK fonts', () => {
  const result = normalizePdfSafeText('AQY(%) = (2 × 生成的H₂分子数 / 入射光子数) × 100%。[NH₄]₂[MoO₂S₂]²⁻ → 产物');

  assert.equal(result, 'AQY(%) = (2 x 生成的H2分子数 / 入射光子数) x 100%。[NH4]2[MoO2S2]2- -> 产物');
});

test('pdf exporter uses a latin fallback for ASCII inside Chinese documents', () => {
  assert.equal(selectPdfFontKeyForChar('J'), 'latin');
  assert.equal(selectPdfFontKeyForChar('2'), 'latin');
  assert.equal(selectPdfFontKeyForChar('中'), 'cjk');
  assert.equal(selectPdfFontKeyForChar('。'), 'cjk');
});
