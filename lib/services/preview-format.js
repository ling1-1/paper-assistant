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

function isTableLine(line = '') {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;

  const cells = trimmed
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);

  return cells.length >= 2;
}

function isTableSeparator(line = '') {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseTableRow(line = '') {
  return line
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function segmentPreviewBlocks(text = '') {
  const normalized = normalizePreviewForDisplay(text);
  if (!normalized) return [];

  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks = [];
  let tableRows = [];

  function flushTable() {
    if (!tableRows.length) return;

    const rows = tableRows
      .filter((line) => !isTableSeparator(line))
      .map(parseTableRow)
      .filter((row) => row.length >= 2);

    if (rows.length) {
      blocks.push({ type: 'table', rows });
    }

    tableRows = [];
  }

  for (const line of lines) {
    if (isTableLine(line)) {
      tableRows.push(line);
      continue;
    }

    flushTable();
    blocks.push({
      type: classifyPreviewLine(line, blocks.length),
      text: line,
    });
  }

  flushTable();

  return blocks;
}

module.exports = {
  normalizePreviewForDisplay,
  segmentPreviewBlocks,
};
