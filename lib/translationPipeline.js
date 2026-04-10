const PLACEHOLDER_PREFIX = 'PAPRASSISTTOKEN';
const MAX_CHUNK_CHARS = 2600;
const BLOCK_BATCH_SIZE = 6;

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
  return text.replace(new RegExp(`${PLACEHOLDER_PREFIX}_(\\d+)_`, 'g'), (_, index) => {
    const token = tokens[Number(index)];
    return token ?? _;
  });
}

function normalizeParagraphs(text = '') {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
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
}) {
  const fieldHints = {
    general: '通用学术论文',
    cs: '计算机科学',
    medicine: '医学',
    engineering: '工程',
    biology: '生物学',
    chemistry: '化学化工',
  };

  return `你正在翻译一篇${fieldHints[field] || '学术'}论文的第 ${chunkIndex + 1}/${totalChunks} 个片段。

要求：
1. 将${sourceLang === 'en' ? '英文' : '中文'}准确翻译成${targetLang === 'en' ? '英文' : '中文'}。
2. 保持段落数量和段落顺序，使用空行分隔段落。
3. 所有形如 ${PLACEHOLDER_PREFIX}_数字_ 的占位符必须原样保留，不能翻译、改写、删除、拆分。
4. 保留学术语气，不要添加标题、总结、解释或项目符号。
5. 如果遇到难译术语，可保留英文原词放在括号中。

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
    cs: '计算机科学',
    medicine: '医学',
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
5. 只输出 JSON 数组，不要输出 Markdown 代码块，也不要解释。
6. JSON 数组每项格式必须是 {"id":"原样返回","translation":"译文"}。

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
}) {
  const paragraphs = normalizeParagraphs(text);
  if (!paragraphs.length) {
    return '';
  }

  const chunks = createChunks(paragraphs);
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
      }),
      index,
      chunks.length,
    );

    const restored = restoreSpecialTokens(translated, tokens).trim();
    translatedChunks.push(restored);
    onChunk?.(restored, index, chunks.length);
  }

  return translatedChunks.join('\n\n');
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
        translatedMap.set(block.id, restoreSpecialTokens(raw.trim(), block.tokens));
      }
      continue;
    }

    for (const block of batch) {
      const hit = parsed.find((item) => item.id === block.id);
      const translation = typeof hit?.translation === 'string' ? hit.translation : '';
      translatedMap.set(block.id, restoreSpecialTokens(translation.trim(), block.tokens));
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
  translateBlocks,
};
