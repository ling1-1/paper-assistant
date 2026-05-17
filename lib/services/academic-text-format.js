const SUBSCRIPT_MAP = {
  0: '₀',
  1: '₁',
  2: '₂',
  3: '₃',
  4: '₄',
  5: '₅',
  6: '₆',
  7: '₇',
  8: '₈',
  9: '₉',
  '+': '₊',
  '-': '₋',
  '(': '₍',
  ')': '₎',
};

const SUPERSCRIPT_MAP = {
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '+': '⁺',
  '-': '⁻',
  '(': '⁽',
  ')': '⁾',
};

function convertMappedChars(value, map) {
  return String(value)
    .split('')
    .map((char) => map[char] || char)
    .join('');
}

function unwrapLatexCommands(text = '') {
  return String(text)
    .replace(/\\text\{PAPRASSISTTOKEN(?:\\_|_)?\d+(?:\\_|_)?\}/g, '')
    .replace(/PAPRASSISTTOKEN(?:\\_|_)\d+(?:\\_|_)?/g, '')
    .replace(/\\boldsymbol\{\\ce\{([^{}]+)\}\}/g, '$1')
    .replace(/\\boldsymbol\{([^{}]+)\}/g, '$1')
    .replace(/\\ce\{([^{}]+)\}/g, '$1')
    .replace(/\\text\{([^{}]+)\}/g, '$1')
    .replace(/\\mathrm\{([^{}]+)\}/g, '$1')
    .replace(/\\left|\\right/g, '')
    .replace(/\\cdot/g, '·')
    .replace(/\\times/g, '×')
    .replace(/\\rightarrow/g, '→')
    .replace(/\\leftarrow/g, '←')
    .replace(/\\(?:alpha|beta|gamma|delta|mu|nu|sigma|lambda)\b/g, '')
    .replace(/\\boldsymbol/g, '');
}

function normalizeAcademicText(text = '') {
  return unwrapLatexCommands(text)
    .replace(/\$\s*([^$]+?)\s*\$/g, '$1')
    .replace(/_\{([0-9+\-()]+)\}/g, (_, value) => convertMappedChars(value, SUBSCRIPT_MAP))
    .replace(/\^\{([0-9+\-()]+)\}/g, (_, value) => convertMappedChars(value, SUPERSCRIPT_MAP))
    .replace(/_([0-9+\-()]+)/g, (_, value) => convertMappedChars(value, SUBSCRIPT_MAP))
    .replace(/\^([0-9+\-()]+)/g, (_, value) => convertMappedChars(value, SUPERSCRIPT_MAP))
    .replace(/([A-Z][a-z]?[₀₁₂₃₄₅₆₇₈₉]*)\s+([A-Z][a-z]?[₀₁₂₃₄₅₆₇₈₉]*)/g, '$1$2')
    .replace(/([A-Za-z\]₀-₉])\s+·\s*([0-9₀-₉])/g, '$1·$2')
    .replace(/[{}$]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  normalizeAcademicText,
  unwrapLatexCommands,
};
