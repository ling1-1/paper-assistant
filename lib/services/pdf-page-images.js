const path = require('path');
const { pathToFileURL } = require('url');

const STANDARD_FONT_DATA_URL = `${pathToFileURL(
  path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/'),
).href}`;
const WASM_URL = `${pathToFileURL(
  path.join(process.cwd(), 'node_modules/pdfjs-dist/wasm/'),
).href}`;

const MAX_RENDER_PAGES = Number(process.env.PDF_IMAGE_FALLBACK_MAX_PAGES || 20);
const DEFAULT_RENDER_SCALE = Number(process.env.PDF_IMAGE_RENDER_SCALE || 1);
const DEFAULT_IMAGE_QUALITY = Number(process.env.PDF_IMAGE_JPEG_QUALITY || 0.78);

function loadCanvasModule() {
  try {
    return require('@napi-rs/canvas');
  } catch (error) {
    throw new Error(`当前环境缺少 PDF 图片渲染依赖：@napi-rs/canvas ${error.code || error.message}`);
  }
}

function createCanvasFactory() {
  const { createCanvas } = loadCanvasModule();

  return {
    create(width, height) {
      const canvas = createCanvas(width, height);
      return {
        canvas,
        context: canvas.getContext('2d'),
      };
    },
    reset(canvasAndContext, width, height) {
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    },
    destroy(canvasAndContext) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    },
  };
}

async function renderPdfPagesToImages(pdfBase64, options = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = decodePdfBase64ToPdfjsData(pdfBase64);

  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    wasmUrl: WASM_URL,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const pageCount = doc.numPages;
  const pageLimit = options.pageLimit === null ? pageCount : (options.pageLimit || MAX_RENDER_PAGES);
  const pageNumbers = getRenderPageNumbers(pageCount, pageLimit, Boolean(options.allowPartial));

  const scale = options.scale || DEFAULT_RENDER_SCALE;
  const imageQuality = options.imageQuality || DEFAULT_IMAGE_QUALITY;
  const canvasFactory = createCanvasFactory();
  const pages = [];

  for (const pageNumber of pageNumbers) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvasAndContext = canvasFactory.create(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );

    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvasFactory,
    }).promise;

    pages.push({
      pageNumber,
      width: Math.ceil(viewport.width),
      height: Math.ceil(viewport.height),
      imageUrl: canvasAndContext.canvas.toDataURL('image/jpeg', imageQuality),
    });

    canvasFactory.destroy(canvasAndContext);
  }

  return {
    totalPages: pageCount,
    pages,
  };
}

function getRenderPageNumbers(pageCount, pageLimit, allowPartial = false) {
  if (pageCount > pageLimit && !allowPartial) {
    throw new Error(`PDF 共 ${pageCount} 页，已超过图片视觉翻译上限 ${pageLimit} 页`);
  }

  const count = allowPartial ? Math.min(pageCount, pageLimit) : pageCount;
  return Array.from({ length: count }, (_, index) => index + 1);
}

function decodePdfBase64ToPdfjsData(pdfBase64) {
  const raw = String(pdfBase64 || '').split(',').pop();

  if (!raw) {
    throw new Error('未提供 PDF 内容');
  }

  const buffer = Buffer.from(raw, 'base64');
  return new Uint8Array(buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ));
}

module.exports = {
  renderPdfPagesToImages,
  MAX_RENDER_PAGES,
  getRenderPageNumbers,
  decodePdfBase64ToPdfjsData,
  loadCanvasModule,
  WASM_URL,
};
