const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePdfBuffer } = require('../lib/services/pdf-parser');

test('validatePdfBuffer rejects invalid file header', () => {
  assert.throws(
    () => validatePdfBuffer(Buffer.from('fake')),
    /无效的 PDF 文件|PDF 文件内容为空/,
  );
});
