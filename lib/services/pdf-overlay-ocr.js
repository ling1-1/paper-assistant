const { callVisionModel } = require('./model-client');
const { renderPdfPagesToImages } = require('./pdf-page-images');
const { buildOverlayOcrPrompt, parseOverlayOcrResponse } = require('./overlay-translation');
const { decodePdfBase64 } = require('./pdf-parser');
const { extractPdfLayout } = require('../pdfLayout');

const DEFAULT_OVERLAY_PAGE_LIMIT = Number(process.env.PDF_OVERLAY_MAX_PAGES || 3);
const OVERLAY_RENDER_SCALE = Number(process.env.PDF_OVERLAY_RENDER_SCALE || 1.8);
const OVERLAY_IMAGE_QUALITY = Number(process.env.PDF_OVERLAY_IMAGE_QUALITY || 0.86);
const TEXT_LAYER_MAX_LINES_PER_BLOCK = Number(process.env.PDF_OVERLAY_MAX_LINES_PER_BLOCK || 5);

function normalizeOverlayPageLimit(pageLimit) {
  if (pageLimit === 'all' || pageLimit === 0 || pageLimit === null) {
    return null;
  }

  const numeric = Number(pageLimit || DEFAULT_OVERLAY_PAGE_LIMIT);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_OVERLAY_PAGE_LIMIT;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function getTextLayerBlockText(block = {}) {
  const lineText = (block.lines || [])
    .map((line) => String(line.text || '').trim())
    .filter(Boolean)
    .join('\n');
  return lineText || String(block.text || '').trim();
}

function classifyTextLayerBlock(block = {}, layoutPage = {}) {
  if (block.overlayType) return block.overlayType;

  const text = getTextLayerBlockText(block);
  const firstLine = block.lines?.[0] || block;
  const yRatio = layoutPage.height ? firstLine.y / layoutPage.height : 0;

  if (/^(references|参考文献)$/i.test(text)) return 'reference';
  if (looksLikeMetadataText(text)) return 'other';
  if (/^(abstract|摘要|introduction|引言|experimental|results|discussion|conclusion|acknowledg)/i.test(text)) return 'title';
  if (yRatio > 0.88 || firstLine.fontSize >= 13 || text.length < 80 && block.lines?.length === 1 && yRatio > 0.75) return 'title';
  if (looksLikeReferenceText(text)) return 'reference';
  if (looksLikeFormulaText(text)) return 'formula';
  return 'paragraph';
}

function looksLikeMetadataText(text = '') {
  const value = String(text || '').trim();
  if (/\bdoi\b|received|accepted|available online|copyright|corresponding author/i.test(value)) return true;
  if (/\b(laboratory|university|institute|department|college|corporation|springs|u\.s\.a\.|usa)\b/i.test(value)) return true;

  const commaCount = (value.match(/,/g) || []).length;
  const initialCount = (value.match(/\b[A-Z]\./g) || []).length;
  const uppercaseWords = (value.match(/\b[A-Z]{2,}\b/g) || []).length;
  const hasNameJoiner = /\b(and|AND)\b|、|，|,/.test(value);
  return value.length <= 180 && hasNameJoiner && (initialCount >= 2 || uppercaseWords >= 3 || commaCount >= 2);
}

function looksLikeReferenceText(text = '') {
  const value = String(text || '').trim();
  if (/^\s*\d+\s*[\].)]/.test(value)) return true;
  if (!/^[\d\s.,;:()[\]A-Za-z'’&-]+$/.test(value) || value.length < 12) return false;
  return /\b(?:J\.|Ann\.|Chem\.|Soc\.|Rev\.|Angew\.|Coord\.|Int\.|Ed\.)\b/i.test(value)
    && /\b(18|19|20)\d{2}\b/.test(value);
}

function looksLikeFormulaText(text = '') {
  const value = String(text || '').trim();
  if (/\\frac|\\begin|\\end|→|⇌|↔|\\\[|\\\]/.test(value)) return true;
  if (!value.includes('=')) return false;

  const wordCount = (value.match(/[A-Za-z]{3,}/g) || []).length;
  const mathTokenCount = (value.match(/[=+\-_^{}[\]()/]/g) || []).length;
  const mathDensity = mathTokenCount / Math.max(value.length, 1);
  return wordCount <= 4 && mathDensity > 0.08;
}

function isStandaloneTextLayerHeading(line = {}) {
  const text = String(line.text || '').trim();
  if (!text || text.length > 80) return false;
  return /^(abstract|摘要|introduction|引言|experimental|results|discussion|conclusion|acknowledg|references|参考文献|methods and materials)$/i.test(text);
}

function groupTextLayerLines(lines = [], overlayType) {
  const sortedLines = lines.filter((line) => line?.text?.trim());
  const x = Math.min(...sortedLines.map((line) => line.x));
  const right = Math.max(...sortedLines.map((line) => line.x + line.width));
  const top = Math.max(...sortedLines.map((line) => line.y));
  const bottom = Math.min(...sortedLines.map((line) => line.y - Math.max(line.height || line.fontSize || 8, 4)));

  return {
    text: sortedLines.map((line) => line.text).join('\n'),
    x: round(x),
    y: round(top),
    width: round(right - x),
    height: round(top - bottom),
    lines: sortedLines,
    overlayType,
  };
}

function splitTextLayerBlock(block = {}) {
  const lines = (block.lines || []).filter((line) => line?.text?.trim());
  if (!lines.length) return [block];

  const groups = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    groups.push(groupTextLayerLines(current));
    current = [];
  };

  for (const line of lines) {
    if (isStandaloneTextLayerHeading(line)) {
      flush();
      groups.push(groupTextLayerLines([line], 'title'));
      continue;
    }

    const previous = current[current.length - 1];
    const verticalGap = previous ? previous.y - line.y : 0;
    const lineSize = Math.max(line.fontSize || line.height || 8, 8);
    const startsNewParagraph = current.length > 0 && verticalGap > lineSize * 1.85;
    const tooTallForOverlay = current.length >= TEXT_LAYER_MAX_LINES_PER_BLOCK;

    if (startsNewParagraph || tooTallForOverlay) {
      flush();
    }

    current.push(line);
  }

  flush();

  if (!groups.length) return [block];
  return groups;
}

function blockToOverlayBlock({ block, index, layoutPage, renderedPage }) {
  const scaleX = renderedPage.width / layoutPage.width;
  const scaleY = renderedPage.height / layoutPage.height;
  const firstLine = block.lines?.[0] || block;
  const topLineHeight = Math.max(firstLine.height || firstLine.fontSize || 8, 4);
  const rawHeight = Math.max(block.height || topLineHeight, topLineHeight);
  const type = classifyTextLayerBlock(block, layoutPage);
  const heightFactor = type === 'title' ? 1.28 : type === 'table' ? 1.18 : 1.18;
  const height = Math.max(rawHeight * scaleY * heightFactor, type === 'title' ? 22 : 26);
  const y = (layoutPage.height - block.y - topLineHeight) * scaleY;

  return {
    id: `p${layoutPage.pageNumber}-tl-${index + 1}`,
    type,
    text: getTextLayerBlockText(block),
    confidence: 1,
    source: 'text-layer',
    bbox: {
      x: round(block.x * scaleX),
      y: round(Math.max(0, y)),
      width: round(Math.max(block.width * scaleX, 12)),
      height: round(height),
    },
  };
}

function createTextLayerOverlayPages({ renderedPages = [], layoutPages = [] }) {
  const pages = renderedPages.map((renderedPage) => {
    const layoutPage = layoutPages.find((page) => page.pageNumber === renderedPage.pageNumber);
    const blocks = [];

    if (layoutPage) {
      for (const block of layoutPage.blocks || []) {
        for (const textBlock of splitTextLayerBlock(block)) {
          if (getTextLayerBlockText(textBlock).length < 2) continue;
          blocks.push(blockToOverlayBlock({
            block: textBlock,
            index: blocks.length,
            layoutPage,
            renderedPage,
          }));
        }
      }
    }

    return {
      pageNumber: renderedPage.pageNumber,
      width: renderedPage.width,
      height: renderedPage.height,
      imageUrl: renderedPage.imageUrl,
      blocks,
    };
  });

  const blockCount = pages.reduce((sum, page) => sum + page.blocks.length, 0);
  return {
    pages,
    meta: {
      engine: 'text-layer',
      model: 'pdfjs-text-layer',
      blockCount,
      renderedPages: renderedPages.length,
    },
  };
}

async function runTextLayerOverlayOcr({
  pdfBase64,
  pageLimit = DEFAULT_OVERLAY_PAGE_LIMIT,
}) {
  const normalizedPageLimit = normalizeOverlayPageLimit(pageLimit);
  const [rendered, layout] = await Promise.all([
    renderPdfPagesToImages(pdfBase64, {
      pageLimit: normalizedPageLimit,
      allowPartial: Boolean(normalizedPageLimit),
      scale: OVERLAY_RENDER_SCALE,
      imageQuality: OVERLAY_IMAGE_QUALITY,
    }),
    extractPdfLayout(decodePdfBase64(pdfBase64)),
  ]);

  const selectedLayoutPages = layout.pages.filter((page) => (
    rendered.pages.some((renderedPage) => renderedPage.pageNumber === page.pageNumber)
  ));
  const textLayer = createTextLayerOverlayPages({
    renderedPages: rendered.pages,
    layoutPages: selectedLayoutPages,
  });

  return {
    totalPages: rendered.totalPages,
    pages: textLayer.pages,
    meta: {
      ...textLayer.meta,
      pageLimit: normalizedPageLimit || 'all',
      partial: rendered.pages.length < rendered.totalPages,
      renderScale: OVERLAY_RENDER_SCALE,
    },
  };
}

async function runVisionOverlayOcr({
  pdfBase64,
  provider,
  pageLimit = DEFAULT_OVERLAY_PAGE_LIMIT,
  onPage,
}) {
  const normalizedPageLimit = normalizeOverlayPageLimit(pageLimit);
  const rendered = await renderPdfPagesToImages(pdfBase64, {
    pageLimit: normalizedPageLimit,
    allowPartial: Boolean(normalizedPageLimit),
    scale: OVERLAY_RENDER_SCALE,
    imageQuality: OVERLAY_IMAGE_QUALITY,
  });
  const pages = [];
  let model = null;

  for (const page of rendered.pages) {
    const result = await callVisionModel({
      prompt: buildOverlayOcrPrompt({
        pageNumber: page.pageNumber,
        totalPages: rendered.totalPages,
      }),
      images: [page.imageUrl],
      provider,
      // Allow fallback to another configured vision-capable model if the
      // selected text model has no visual endpoint.
      strict: false,
    });

    model = result.model || model;
    const parsedPage = parseOverlayOcrResponse(result.text || '', page);
    pages.push(parsedPage);
    onPage?.({
      pageNumber: page.pageNumber,
      totalPages: rendered.totalPages,
      blockCount: parsedPage.blocks.length,
      model,
    });
  }

  return {
    totalPages: rendered.totalPages,
    pages,
    meta: {
      engine: 'vision',
      model,
      pageLimit: normalizedPageLimit || 'all',
      partial: rendered.pages.length < rendered.totalPages,
      renderedPages: rendered.pages.length,
      renderScale: OVERLAY_RENDER_SCALE,
    },
  };
}

async function runPaddleOverlayOcr() {
  throw new Error('PaddleOCR provider 已预留，但本地 MVP 暂未启用。请使用 engine=vision 或 engine=auto。');
}

async function runOverlayOcr({
  pdfBase64,
  provider,
  engine = 'auto',
  pageLimit = DEFAULT_OVERLAY_PAGE_LIMIT,
  onPage,
}) {
  if (!pdfBase64) {
    throw new Error('未提供 PDF 内容');
  }

  if (engine === 'paddle') {
    return runPaddleOverlayOcr();
  }

  if (engine === 'text' || engine === 'auto') {
    const textLayerResult = await runTextLayerOverlayOcr({
      pdfBase64,
      pageLimit,
    });
    const blockCount = textLayerResult.pages.reduce((sum, page) => sum + page.blocks.length, 0);
    if (engine === 'text' || blockCount >= textLayerResult.pages.length * 5) {
      return textLayerResult;
    }
  }

  return runVisionOverlayOcr({
    pdfBase64,
    provider,
    pageLimit,
    onPage,
  });
}

module.exports = {
  DEFAULT_OVERLAY_PAGE_LIMIT,
  OVERLAY_RENDER_SCALE,
  normalizeOverlayPageLimit,
  createTextLayerOverlayPages,
  runTextLayerOverlayOcr,
  runOverlayOcr,
  runVisionOverlayOcr,
  runPaddleOverlayOcr,
};
