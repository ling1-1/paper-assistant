const { callModel } = require('./model-client');
const { normalizeAcademicText } = require('./academic-text-format');

const OVERLAY_BLOCK_TYPES = new Set([
  'title',
  'paragraph',
  'table',
  'formula',
  'reference',
  'figure_caption',
  'other',
]);

const NON_TRANSLATABLE_TYPES = new Set(['formula', 'reference']);

const PAPER_METADATA_PATTERNS = [
  /\b(received|accepted|published|copyright|doi|correspondence|corresponding author)\b/i,
  /\b(journal|vol\.|volume|issue|pp\.|pages?|inorganica|acta|chem\.|soc\.|rev\.)\b/i,
  /\b(laboratory|university|institute|department|college|corporation|springs|u\.s\.a\.|usa)\b/i,
];

function extractJsonText(text = '') {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  if (candidate.startsWith('{') || candidate.startsWith('[')) {
    return candidate;
  }

  const objectStart = candidate.indexOf('{');
  const objectEnd = candidate.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    return candidate.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return candidate.slice(arrayStart, arrayEnd + 1);
  }

  return candidate;
}

function parseJsonFromModel(text = '', label = '模型 JSON') {
  const candidate = extractJsonText(text);
  const attempts = [
    candidate,
    repairLooseJson(candidate),
  ].filter(Boolean);

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  const salvaged = salvageBlocksPayload(candidate);
  if (salvaged) return salvaged;

  const snippet = candidate.replace(/\s+/g, ' ').slice(0, 240);
  throw new Error(`${label} 失败：${lastError?.message || '无法解析 JSON'}；片段：${snippet}`);
}

function repairLooseJson(text = '') {
  return String(text || '')
    .trim()
    .replace(/("x"\s*:\s*-?\d+(?:\.\d+)?\s*,\s*)"(-?\d+(?:\.\d+)?)"\s*,\s*"width"/g, '$1"y":$2,"width"')
    .replace(/("width"\s*:\s*-?\d+(?:\.\d+)?\s*,\s*)"(-?\d+(?:\.\d+)?)"\s*([,}])/g, '$1"height":$2$3')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value) => `:"${value.replace(/"/g, '\\"')}"`)
    .replace(/:\s*\.(\d+)/g, ':0.$1')
    .replace(/,\s*([}\]])/g, '$1');
}

function salvageBlocksPayload(text = '') {
  const repaired = repairLooseJson(text);
  const markerIndex = repaired.indexOf('"blocks"');
  if (markerIndex < 0) return null;

  const arrayStart = repaired.indexOf('[', markerIndex);
  if (arrayStart < 0) return null;

  const blocks = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = arrayStart + 1; index < repaired.length; index += 1) {
    const char = repaired[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = repaired.slice(start, index + 1);
        try {
          blocks.push(JSON.parse(candidate));
        } catch {
          // Keep scanning; one malformed block should not discard earlier OCR.
        }
        start = -1;
      }
    }
  }

  return blocks.length ? { blocks } : null;
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeBbox(bbox, pageWidth, pageHeight) {
  const raw = Array.isArray(bbox)
    ? { x: bbox[0], y: bbox[1], width: bbox[2], height: bbox[3] }
    : (bbox || {});

  const x = clamp(toFiniteNumber(raw.x), 0, pageWidth);
  const y = clamp(toFiniteNumber(raw.y), 0, pageHeight);
  const width = clamp(toFiniteNumber(raw.width), 1, pageWidth - x || pageWidth);
  const height = clamp(toFiniteNumber(raw.height), 1, pageHeight - y || pageHeight);

  return { x, y, width, height };
}

function normalizeBlockType(type) {
  const normalized = String(type || 'paragraph').toLowerCase().trim();
  return OVERLAY_BLOCK_TYPES.has(normalized) ? normalized : 'other';
}

function looksLikeAuthorLine(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;

  const commaCount = (value.match(/,/g) || []).length;
  const initialCount = (value.match(/\b[A-Z]\./g) || []).length;
  const uppercaseWords = (value.match(/\b[A-Z]{2,}\b/g) || []).length;
  const nameSeparators = /\b(and|AND)\b|、|，|,/.test(value);

  return value.length <= 180 && nameSeparators && (initialCount >= 2 || uppercaseWords >= 3 || commaCount >= 2);
}

function looksLikePaperMetadata(block, context) {
  if (!block || block.type === 'title' || block.type === 'table') return false;
  const text = String(block.text || '');
  const topRatio = context.height ? (block.bbox.y / context.height) : 1;

  if (block.type === 'reference' || block.type === 'formula') return true;
  if (looksLikeAuthorLine(text)) return true;
  if (topRatio < 0.32 && PAPER_METADATA_PATTERNS.some((pattern) => pattern.test(text))) return true;

  return false;
}

function normalizeOverlayBlock(block, index, context) {
  const text = normalizeAcademicText(block?.text || block?.sourceText || '');
  if (!text) return null;

  const normalized = {
    id: String(block.id || `p${context.pageNumber}-b${index + 1}`),
    type: normalizeBlockType(block.type),
    text,
    confidence: typeof block.confidence === 'number' ? block.confidence : null,
    bbox: normalizeBbox(block.bbox || block.box, context.width, context.height),
  };

  return {
    ...normalized,
    preserveOriginal: Boolean(block.preserveOriginal) || looksLikePaperMetadata(normalized, context),
  };
}

function parseOverlayOcrResponse(text = '', context = {}) {
  const payload = parseJsonFromModel(text, '结构化 OCR');
  const rawBlocks = Array.isArray(payload) ? payload : payload.blocks;

  if (!Array.isArray(rawBlocks)) {
    throw new Error('结构化 OCR 失败：模型未返回 blocks 数组');
  }

  const pageNumber = Number(context.pageNumber || payload.pageNumber || 1);
  const width = Number(context.width || payload.width || 0);
  const height = Number(context.height || payload.height || 0);

  if (!width || !height) {
    throw new Error('结构化 OCR 失败：缺少页面尺寸');
  }

  return {
    pageNumber,
    width,
    height,
    imageUrl: context.imageUrl || payload.imageUrl || '',
    blocks: rawBlocks
      .map((block, index) => normalizeOverlayBlock(block, index, { pageNumber, width, height }))
      .filter(Boolean),
  };
}

function buildOverlayOcrPrompt({ pageNumber, totalPages }) {
  return `你是论文 PDF 页面 OCR 与版面分析器。请读取当前页面图片，返回严格 JSON，不要解释，不要 markdown。

输出格式：
{"blocks":[{"bbox":{"x":0,"y":0,"width":100,"height":20},"text":"原文","type":"paragraph","confidence":0.9}]}

要求：
- bbox 必须使用图片像素坐标，x/y 为左上角。
- type 只能是 title、paragraph、table、formula、reference、figure_caption、other。
- 按阅读顺序返回 block。
- 每个 block 的 bbox 必须紧贴原文所在区域，不能跨栏，不能把左右两栏合并成一个 block。
- 多栏论文按左栏从上到下、再右栏从上到下返回；同一段落若跨栏，必须拆成两个 block。
- 不要为了摘要或长段落返回很大的整页区域，宁可按自然段或视觉行组拆小块。
- 公式、参考文献、表格也要识别为独立 block。
- 作者、期刊、DOI、收稿日期、单位、版权等元信息用 other，并设置 preserveOriginal=true。
- 当前页：${pageNumber}/${totalPages}`;
}

function shouldTranslateBlock(block) {
  return !NON_TRANSLATABLE_TYPES.has(block.type) && !block.preserveOriginal;
}

function buildOverlayTranslationPrompt({ page, sourceLang = 'en', targetLang = 'zh', field = 'general' }) {
  const blocks = page.blocks
    .filter(shouldTranslateBlock)
    .map((block) => ({
      id: block.id,
      type: block.type,
      text: block.text,
    }));

  return `你是学术论文原位覆盖翻译器。请基于整页上下文翻译 blocks，并返回严格 JSON，不要解释，不要 markdown。

翻译方向：${sourceLang} -> ${targetLang}
领域：${field}

规则：
- 必须按输入 id 返回 translatedText。
- formula 与 reference 不会出现在输入中，不要新增。
- 作者、期刊、DOI、收稿日期、单位、版权、参考文献不翻译，不要新增。
- table 类型只轻量翻译文字，不改数字、单位和化学式。
- 不要输出 Markdown 标题符号。

输入：
${JSON.stringify({ pageNumber: page.pageNumber, blocks }, null, 2)}

输出格式：
{"blocks":[{"id":"p1-b1","translatedText":"译文"}]}`;
}

function parseTranslatedBlocks(text = '') {
  const payload = parseJsonFromModel(text, '原位翻译');
  const blocks = Array.isArray(payload) ? payload : payload.blocks;
  if (!Array.isArray(blocks)) {
    throw new Error('原位翻译失败：模型未返回 blocks 数组');
  }
  return new Map(blocks
    .filter((block) => block?.id && typeof block.translatedText === 'string')
    .map((block) => [String(block.id), normalizeAcademicText(block.translatedText)]));
}

async function translateOverlayPages({
  pages = [],
  sourceLang = 'en',
  targetLang = 'zh',
  field = 'general',
  provider = process.env.DEFAULT_MODEL || 'doubao',
  translatePageBlocks,
}) {
  const translatedPages = [];
  let model = null;
  let blockCount = 0;

  for (const page of pages) {
    const normalizedPage = {
      ...page,
      blocks: page.blocks.map((block, index) => normalizeOverlayBlock(block, index, page)).filter(Boolean),
    };
    const translatableBlocks = normalizedPage.blocks.filter(shouldTranslateBlock);
    let translations = new Map();

    if (translatableBlocks.length) {
      const translate = translatePageBlocks || (async (prompt) => callModel(
        [{ role: 'user', content: prompt }],
        '你只返回合法 JSON。',
        provider,
      ));
      const result = await translate(buildOverlayTranslationPrompt({ page: normalizedPage, sourceLang, targetLang, field }), normalizedPage);
      model = result.model || model;
      translations = parseTranslatedBlocks(result.text || '');
    }

    const blocks = normalizedPage.blocks.map((block) => {
      const translatedText = shouldTranslateBlock(block)
        ? translations.get(block.id) || block.text
        : block.text;
      return { ...block, translatedText };
    });

    blockCount += blocks.length;
    translatedPages.push({ ...normalizedPage, blocks });
  }

  return {
    pages: translatedPages,
    meta: {
      model: model || provider,
      blockCount,
    },
  };
}

module.exports = {
  OVERLAY_BLOCK_TYPES,
  NON_TRANSLATABLE_TYPES,
  buildOverlayOcrPrompt,
  buildOverlayTranslationPrompt,
  parseOverlayOcrResponse,
  shouldTranslateBlock,
  translateOverlayPages,
};
