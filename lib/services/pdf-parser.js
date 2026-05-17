const { extractPdfLayout } = require('../pdfLayout');

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function decodePdfBase64(fileBase64) {
  const raw = String(fileBase64 || '').split(',').pop();
  if (!raw) {
    throw new Error('未提供 PDF 内容');
  }
  return Buffer.from(raw, 'base64');
}

function validatePdfBuffer(buffer) {
  if (!buffer || buffer.length < 4) {
    throw new Error('PDF 文件内容为空');
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error('PDF 文件不能超过 10MB');
  }
  if (buffer.slice(0, 4).toString('ascii') !== '%PDF') {
    throw new Error('无效的 PDF 文件');
  }
}

async function parsePdfFromBase64(fileBase64, filename = 'paper.pdf') {
  const buffer = decodePdfBase64(fileBase64);
  validatePdfBuffer(buffer);

  const result = await extractPdfLayout(buffer);
  return {
    filename,
    buffer,
    text: result.text.replace(/\n{3,}/g, '\n\n'),
    totalPages: result.totalPages,
    pages: result.pages,
    metadata: {
      extractor: 'pdfjs-dist',
      fileSize: buffer.length,
      processedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  parsePdfFromBase64,
  decodePdfBase64,
  validatePdfBuffer,
};
