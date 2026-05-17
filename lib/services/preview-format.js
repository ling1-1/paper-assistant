const { normalizeAcademicText } = require('./academic-text-format');

function normalizePreviewForDisplay(text = '') {
  return normalizeAcademicText(text)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .trim();
}

function classifyPreviewLine(line, index) {
  const trimmed = line.trim();

  if (!trimmed) return 'empty';
  if (index === 0 && trimmed.length <= 90) return 'title';
  if (/^(摘要|abstract)$/i.test(trimmed)) return 'section';
  if (/^(引言|introduction)$/i.test(trimmed)) return 'section';
  if (/^(实验|experimental|methods?|methods and materials|结果|results?|讨论|discussion|结论|conclusion|参考文献|references)$/i.test(trimmed)) return 'section';
  if (
    index <= 5
    && /(?:[A-Z]\.\s*)?[A-Z][a-zA-Z'.-]+(?:\s+[A-Z]\.?\s*[A-Z][a-zA-Z'.-]+|、|,| and | 和 )/.test(trimmed)
    && trimmed.length <= 180
  ) {
    return 'meta';
  }
  return 'paragraph';
}

function segmentPreviewBlocks(text = '') {
  const normalized = normalizePreviewForDisplay(text);
  if (!normalized) return [];

  return normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      type: classifyPreviewLine(line, index),
      text: line,
    }));
}

module.exports = {
  normalizePreviewForDisplay,
  segmentPreviewBlocks,
};
