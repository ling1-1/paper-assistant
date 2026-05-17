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

const FORMULA_SYMBOLS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni',
  'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd',
  'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd',
  'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W',
  'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi',
  'Th', 'Pa', 'U',
  // Common organic-group abbreviations in inorganic chemistry papers.
  'Me', 'Et', 'Pr', 'Bu', 'Ph',
]);

function isPlainFormulaToken(token) {
  if (!/[0-9]/.test(token)) return false;

  const parts = String(token).match(/[A-Z][a-z]?|\d+/g);
  if (!parts || parts.join('') !== token) return false;

  return parts.every((part) => /^\d+$/.test(part) || FORMULA_SYMBOLS.has(part));
}

function convertPlainFormulaDigits(text = '') {
  return String(text)
    .replace(/\b[A-Za-z][A-Za-z0-9]{1,24}\b/g, (token) => {
      if (!isPlainFormulaToken(token)) return token;

      return token.replace(/([A-Z][a-z]?)(\d+)/g, (_, symbol, value) => (
        `${symbol}${convertMappedChars(value, SUBSCRIPT_MAP)}`
      ));
    })
    .replace(/(\[[^\]\n]{1,80}\])(\d+)/g, (_, group, value) => (
      `${group}${convertMappedChars(value, SUBSCRIPT_MAP)}`
    ));
}

function unwrapLatexCommands(text = '') {
  return String(text)
    .replace(/\\text\{PAPRASSISTTOKEN(?:\\_|_)?\d+(?:\\_|_)?\}/g, '')
    .replace(/PAPRASSISTTOKEN(?:\\_|_)\d+(?:\\_|_)?/g, '')
    .replace(/\\\[/g, '\n')
    .replace(/\\\]/g, '\n')
    .replace(/\\begin\{(?:align|aligned|equation|gather)\*?\}/g, '\n')
    .replace(/\\end\{(?:align|aligned|equation|gather)\*?\}/g, '\n')
    .replace(/\\begin(?:align|aligned|algian|equation|gather)\*?/g, '\n')
    .replace(/\\end(?:align|aligned|algian|equation|gather)\*?/g, '\n')
    .replace(/\\\\/g, '\n')
    .replace(/\\boldsymbol\{\\ce\{([^{}]+)\}\}/g, '$1')
    .replace(/\\boldsymbol\{([^{}]+)\}/g, '$1')
    .replace(/\\ce\{([^{}]+)\}/g, '$1')
    .replace(/\\text\{([^{}]+)\}/g, '$1')
    .replace(/\\mathrm\{([^{}]+)\}/g, '$1')
    .replace(/\\left|\\right/g, '')
    .replace(/\\cdot/g, '·')
    .replace(/\\times/g, '×')
    .replace(/\\longrightarrow/g, '→')
    .replace(/\\longleftarrow/g, '←')
    .replace(/\\rightarrow/g, '→')
    .replace(/\\leftarrow/g, '←')
    .replace(/\\(?:alpha|beta|gamma|delta|mu|nu|sigma|lambda)\b/g, '')
    .replace(/\\boldsymbol/g, '');
}

function normalizeAcademicText(text = '') {
  const normalized = unwrapLatexCommands(text)
    .replace(/\$\s*([^$]+?)\s*\$/g, '$1')
    .replace(/_\{([0-9+\-()]+)\}/g, (_, value) => convertMappedChars(value, SUBSCRIPT_MAP))
    .replace(/\^\{([0-9+\-()]+)\}/g, (_, value) => convertMappedChars(value, SUPERSCRIPT_MAP))
    .replace(/_([0-9+\-()]+)/g, (_, value) => convertMappedChars(value, SUBSCRIPT_MAP))
    .replace(/\^([0-9+\-()]+)/g, (_, value) => convertMappedChars(value, SUPERSCRIPT_MAP))
    .replace(/\[\s*([A-Z][A-Za-z0-9₀-₉]+)\s+\]/g, '[$1]')
    .replace(/\[\s*([A-Z][A-Za-z0-9₀-₉]+)\s+/g, '[$1')
    .replace(/\s+\]/g, ']')
    .replace(/([A-Z][a-z]?[₀₁₂₃₄₅₆₇₈₉]*)\s+([A-Z][a-z]?[₀₁₂₃₄₅₆₇₈₉]*)/g, '$1$2')
    .replace(/([A-Za-z\]₀-₉])\s+·\s*([0-9₀-₉])/g, '$1·$2')
    .replace(/([A-Za-z\]₀-₉])\s+([₀-₉])/g, '$1$2')
    .replace(/([₀-₉])\s+([A-Z][a-z]?)/g, '$1$2')
    .replace(/[{}$]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return convertPlainFormulaDigits(normalized);
}

module.exports = {
  normalizeAcademicText,
  unwrapLatexCommands,
};
