const PLACEHOLDER_PREFIX = 'PAPRASSISTTOKEN';
const MAX_CHUNK_CHARS = 5200;
const MAX_SINGLE_PASS_CHARS = 42000;
const DOCUMENT_CONTEXT_CHARS = 2600;
const BLOCK_BATCH_SIZE = 6;

function cleanExtractedText(text = '') {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function cleanTranslatedText(text = '') {
  return stripOrphanPlaceholders(String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

function stripOrphanPlaceholders(text = '') {
  return String(text)
    .replace(new RegExp(`\\\\text\\{${PLACEHOLDER_PREFIX}(?:\\\\_|_)?\\d+(?:\\\\_|_)?\\}`, 'g'), '')
    .replace(new RegExp(`${PLACEHOLDER_PREFIX}_\\d+_`, 'g'), '')
    .replace(new RegExp(`${PLACEHOLDER_PREFIX}\\\\_\\d+\\\\_`, 'g'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function buildProtectedPatterns() {
  return [
    /\$\$[\s\S]+?\$\$/g,
    /\$(?!\s)[^$\n]+?\$/g,
    /\\\[[\s\S]+?\\\]/g,
    /\\\([\s\S]+?\\\)/g,
    /\\ce\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g,
    /\\[a-zA-Z]+(?:\[[^\]]*\])?(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*/g,
    /\[[0-9,\-\s]+\]/g,
    /\b(?:Figure|Fig\.|Table|Scheme|Eq\.|Equation)\s+\d+[A-Za-z-]*/g,
    /\b\d+(?:\.\d+)?\s?(?:mL|mg|g|kg|mm|cm|m|km|mol|mmol|mumol|nm|pm|Hz|kHz|MHz|GHz|K|°C|%|wt%|vol%|MPa|kPa|Pa|V|mV|A|mA|W|kW|eV|meV|s|min|h)\b/g,
    /\b(?:[A-Z][a-z]?[\d._+-]*){2,}(?:\([^)]+\)\d*)?/g,
  ];
}

function protectSpecialTokens(text) {
  const tokens = [];
  let protectedText = text;

  for (const pattern of buildProtectedPatterns()) {
    protectedText = protectedText.replace(pattern, (match) => {
      const placeholder = `${PLACEHOLDER_PREFIX}_${tokens.length}_`;
      tokens.push(match);
      return placeholder;
    });
  }

  return { protectedText, tokens };
}

function restoreSpecialTokens(text, tokens) {
  return text.replace(new RegExp(`${PLACEHOLDER_PREFIX}(?:_|\\\\_)(\\d+)(?:_|\\\\_)`, 'g'), (_, index) => {
    const token = tokens[Number(index)];
    return token ?? _;
  });
}

function normalizeParagraphs(text = '') {
  return cleanExtractedText(text)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitReferenceSection(text = '') {
  const normalized = cleanExtractedText(text);
  const match = normalized.match(/(?:^|\n)\s*(references|bibliography|参考文献|ref erences)\s*(?:\n|$)/i);

  if (!match || typeof match.index !== 'number') {
    return {
      mainText: normalized,
      referenceText: '',
    };
  }

  const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
  return {
    mainText: normalized.slice(0, start).trim(),
    referenceText: normalized.slice(start).trim(),
  };
}

function buildDocumentContext(text = '') {
  const paragraphs = normalizeParagraphs(text);
  const sectionHeadings = paragraphs
    .filter((paragraph) => paragraph.length <= 90)
    .filter((paragraph) => /^(abstract|introduction|experimental|methods?|results?|discussion|conclusion|acknowledg|摘要|引言|方法|实验|结果|讨论|结论)/i.test(paragraph))
    .slice(0, 12);

  const opening = cleanExtractedText(paragraphs.slice(0, 8).join('\n\n')).slice(0, DOCUMENT_CONTEXT_CHARS);
  const headings = sectionHeadings.length ? `\n\n识别到的章节：\n${sectionHeadings.join('\n')}` : '';

  return `${opening}${headings}`.trim();
}

function createChunks(paragraphs, maxChars = MAX_CHUNK_CHARS) {
  const chunks = [];
  let current = [];
  let currentSize = 0;

  for (const paragraph of paragraphs) {
    const length = paragraph.length;
    if (current.length && currentSize + length > maxChars) {
      chunks.push(current.join('\n\n'));
      current = [];
      currentSize = 0;
    }

    current.push(paragraph);
    currentSize += length + 2;
  }

  if (current.length) {
    chunks.push(current.join('\n\n'));
  }

  return chunks;
}

function buildChunkPrompt({
  chunkText,
  sourceLang,
  targetLang,
  field,
  chunkIndex,
  totalChunks,
  documentContext = '',
}) {
  const fieldHints = {
    general: '通用学术论文',
    computer: '计算机科学',
    medicine: '医学',
    finance: '金融',
    law: '法学',
    engineering: '工程',
    biology: '生物学',
    chemistry: '化学化工',
  };

  return `你正在翻译一篇${fieldHints[field] || '学术'}论文的第 ${chunkIndex + 1}/${totalChunks} 个片段。请结合“整篇论文上下文”理解术语、研究对象和前后逻辑，不要把当前片段当作孤立文本直译。

整篇论文上下文：
${documentContext || '未提供额外上下文'}

要求：
1. 将${sourceLang === 'en' ? '英文' : '中文'}准确翻译成${targetLang === 'en' ? '英文' : '中文'}。
2. 保持段落数量和段落顺序，使用空行分隔段落。
3. 所有形如 ${PLACEHOLDER_PREFIX}_数字_ 的占位符必须原样保留，不能翻译、改写、删除、拆分。
4. 保留学术语气，不要添加标题、总结、解释或项目符号。
5. 忽略明显的 PDF 页眉、页脚、页码、断栏混排残片和不可读乱码，不要输出 emoji 或装饰符号。
6. 如果遇到难译术语，可保留英文原词放在括号中。
7. 不要使用 Markdown 标记，例如 #、##、---；标题请直接用普通文本。
8. 参考文献条目不在本片段中时不要自行补充；如果片段中误含参考文献条目，请尽量保持原文格式。

待翻译内容：

${chunkText}`;
}

function buildBlockBatchPrompt({
  blocks,
  sourceLang,
  targetLang,
  field,
  batchIndex,
  totalBatches,
}) {
  const fieldHints = {
    general: '通用学术论文',
    computer: '计算机科学',
    medicine: '医学',
    finance: '金融',
    law: '法学',
    engineering: '工程',
    biology: '生物学',
    chemistry: '化学化工',
  };

  const serializedBlocks = JSON.stringify(
    blocks.map((block) => ({ id: block.id, text: block.text })),
    null,
    2,
  );

  return `你正在翻译一篇${fieldHints[field] || '学术'}论文的第 ${batchIndex + 1}/${totalBatches} 组文本块。

要求：
1. 将${sourceLang === 'en' ? '英文' : '中文'}准确翻译成${targetLang === 'en' ? '英文' : '中文'}。
2. 必须逐块翻译，不能合并块，也不能遗漏块。
3. 所有形如 ${PLACEHOLDER_PREFIX}_数字_ 的占位符必须原样保留。
4. 保留学术语气、引用编号、图表编号、公式、单位和化学式。
5. 忽略明显的 PDF 页眉、页脚、页码、断栏混排残片和不可读乱码，不要输出 emoji 或装饰符号。
6. 只输出 JSON 数组，不要输出 Markdown 代码块，也不要解释。
7. JSON 数组每项格式必须是 {"id":"原样返回","translation":"译文"}。

待翻译块：
${serializedBlocks}`;
}

function parseJsonResponse(raw) {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

function createBatches(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function translateLongText({
  text,
  sourceLang = 'en',
  targetLang = 'zh',
  field = 'general',
  translateChunk,
  onChunk,
  documentContext,
  maxChars = MAX_CHUNK_CHARS,
}) {
  const paragraphs = normalizeParagraphs(text);
  if (!paragraphs.length) {
    return '';
  }

  const context = documentContext || buildDocumentContext(text);
  const chunks = createChunks(paragraphs, maxChars);
  const translatedChunks = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const { protectedText, tokens } = protectSpecialTokens(chunks[index]);
    const translated = await translateChunk(
      buildChunkPrompt({
        chunkText: protectedText,
        sourceLang,
        targetLang,
        field,
        chunkIndex: index,
        totalChunks: chunks.length,
        documentContext: context,
      }),
      index,
      chunks.length,
    );

    const restored = cleanTranslatedText(restoreSpecialTokens(translated, tokens));
    translatedChunks.push(restored);
    onChunk?.(restored, index, chunks.length);
  }

  return translatedChunks.join('\n\n');
}

async function translateDocumentText({
  text,
  sourceLang = 'en',
  targetLang = 'zh',
  field = 'general',
  translateChunk,
  onChunk,
}) {
  const { mainText, referenceText } = splitReferenceSection(text);
  const documentContext = buildDocumentContext(mainText);
  const maxChars = mainText.length <= MAX_SINGLE_PASS_CHARS ? MAX_SINGLE_PASS_CHARS : MAX_CHUNK_CHARS;
  const translatedMain = await translateLongText({
    text: mainText,
    sourceLang,
    targetLang,
    field,
    translateChunk,
    onChunk,
    documentContext,
    maxChars,
  });

  return [translatedMain, referenceText]
    .filter(Boolean)
    .join('\n\n');
}

async function translateBlocks({
  blocks,
  sourceLang = 'en',
  targetLang = 'zh',
  field = 'general',
  translateBatch,
}) {
  if (!blocks.length) {
    return [];
  }

  const batches = createBatches(
    blocks.map((block) => {
      const { protectedText, tokens } = protectSpecialTokens(block.text);
      return {
        ...block,
        protectedText,
        tokens,
      };
    }),
    BLOCK_BATCH_SIZE,
  );

  const translatedMap = new Map();

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    let parsed;

    try {
      const raw = await translateBatch(
        buildBlockBatchPrompt({
          blocks: batch.map((block) => ({ id: block.id, text: block.protectedText })),
          sourceLang,
          targetLang,
          field,
          batchIndex,
          totalBatches: batches.length,
        }),
        batchIndex,
        batches.length,
      );
      parsed = parseJsonResponse(raw);
    } catch {
      parsed = null;
    }

    if (!Array.isArray(parsed) || parsed.length !== batch.length) {
      for (const block of batch) {
        const raw = await translateBatch(
          buildChunkPrompt({
            chunkText: block.protectedText,
            sourceLang,
            targetLang,
            field,
            chunkIndex: batchIndex,
            totalChunks: batches.length,
          }),
          batchIndex,
          batches.length,
        );
        translatedMap.set(block.id, cleanTranslatedText(restoreSpecialTokens(raw.trim(), block.tokens)));
      }
      continue;
    }

    for (const block of batch) {
      const hit = parsed.find((item) => item.id === block.id);
      const translation = typeof hit?.translation === 'string' ? hit.translation : '';
      translatedMap.set(block.id, cleanTranslatedText(restoreSpecialTokens(translation.trim(), block.tokens)));
    }
  }

  return blocks.map((block) => ({
    ...block,
    translation: translatedMap.get(block.id) || '',
  }));
}

module.exports = {
  normalizeParagraphs,
  translateLongText,
  translateDocumentText,
  translateBlocks,
  cleanExtractedText,
  cleanTranslatedText,
  splitReferenceSection,
  stripOrphanPlaceholders,
};
