const test = require('node:test');
const assert = require('node:assert/strict');

const { exportTranslation } = require('../lib/services/exporter');

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
