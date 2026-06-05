const MAX_PDF_HISTORY_BASE64_CHARS = 3_000_000;

function cleanHistoryText(text = '', cleaner = (value) => String(value || '')) {
  return cleaner(text);
}

function getStorablePdfBase64(value = '', maxChars = MAX_PDF_HISTORY_BASE64_CHARS) {
  const pdfBase64 = String(value || '');
  if (!pdfBase64) return '';
  if (pdfBase64.length > maxChars) return '';
  return pdfBase64;
}

function createPdfHistoryItem({
  item = {},
  defaults = {},
  cleaner,
  maxPdfBase64Chars = MAX_PDF_HISTORY_BASE64_CHARS,
}) {
  const now = defaults.now || new Date().toISOString();
  return {
    id: item.id || defaults.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    filename: item.filename || 'paper.pdf',
    fileSize: item.fileSize || 0,
    totalPages: item.totalPages || 0,
    field: item.field || defaults.field || 'general',
    sourceLang: item.sourceLang || defaults.sourceLang || 'en',
    targetLang: item.targetLang || defaults.targetLang || 'zh',
    transport: item.transport || defaults.transport || 'parsed',
    model: item.model || defaults.model || '',
    status: item.status || 'parsed',
    pdfBase64: getStorablePdfBase64(item.pdfBase64 || defaults.pdfBase64, maxPdfBase64Chars),
    translatedText: cleanHistoryText(item.translatedText || defaults.translatedText, cleaner).slice(0, 80000),
    originalText: cleanHistoryText(item.originalText || defaults.originalText, cleaner).slice(0, 30000),
    overlayPages: Array.isArray(item.overlayPages) ? item.overlayPages : [],
    overlayStatus: item.overlayStatus || '',
    pdf2zhJob: item.pdf2zhJob || defaults.pdf2zhJob || null,
    pdf2zhPreviewType: item.pdf2zhPreviewType || defaults.pdf2zhPreviewType || 'mono',
    updatedAt: now,
  };
}

function canTranslatePdfState({ pdfBase64 = '', pdfText = '' } = {}) {
  return Boolean(String(pdfBase64 || '').trim() || String(pdfText || '').trim());
}

module.exports = {
  MAX_PDF_HISTORY_BASE64_CHARS,
  canTranslatePdfState,
  createPdfHistoryItem,
  getStorablePdfBase64,
};
