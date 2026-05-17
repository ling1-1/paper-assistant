const FormData = require('form-data');
const { extractOutputText } = require('../arkFileApi');
const { callModel, callVisionModel } = require('./model-client');
const { buildPdfDirectPrompt, buildPdfVisionBatchPrompt, buildTextTranslationPrompt } = require('./prompt-builder');
const { renderPdfPagesToImages, MAX_RENDER_PAGES } = require('./pdf-page-images');
const { splitReferenceSection, translateDocumentText } = require('../translationPipeline');
const { decodePdfBase64 } = require('./pdf-parser');
const { describeVisionFallback, resolveModelConfig } = require('./model-registry');

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com';
const ARK_FILE_MODEL = process.env.VOLC_FILE_MODEL || 'doubao-seed-2-0-pro-260215';
const MAX_IMAGE_BATCH_PAGES = Number(process.env.PDF_IMAGE_BATCH_PAGES || 6);

function emitSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createSseEvent({
  stage,
  progress,
  message,
  chunk,
  done = false,
  data,
  meta,
  error,
}) {
  return { stage, progress, message, chunk, done, data, meta, error };
}

async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function uploadAssistantFile({ apiKey, buffer, filename }) {
  const formData = new FormData();
  formData.append('purpose', 'user_data');
  formData.append('file', buffer, {
    filename: filename || 'paper.pdf',
    contentType: 'application/pdf',
  });

  const response = await fetch(`${ARK_BASE_URL}/api/v3/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...formData.getHeaders(),
    },
    body: formData,
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || `文件上传失败：${response.status}`);
  }
  return payload;
}

async function translateViaArkFile({ pdfBase64, filename, targetLang }) {
  const doubaoConfig = await resolveModelConfig('doubao');
  const apiKey = process.env.VOLC_API_KEY || doubaoConfig.apiKey;
  if (!apiKey) {
    throw new Error('未配置火山方舟 API Key');
  }

  const uploadPayload = await uploadAssistantFile({
    apiKey,
    buffer: decodePdfBase64(pdfBase64),
    filename,
  });
  const fileId = uploadPayload.id || uploadPayload.file_id;

  if (!fileId) {
    throw new Error('Ark 文件上传成功，但未返回 file_id');
  }

  const response = await fetch(`${ARK_BASE_URL}/api/v3/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ARK_FILE_MODEL,
      input: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPdfDirectPrompt({ targetLang }) },
            { type: 'input_file', file_id: fileId },
          ],
        },
      ],
    }),
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || `PDF 直传失败：${response.status}`);
  }

  const translation = extractOutputText(payload);
  if (!translation) {
    throw new Error('Ark 已返回结果，但未提取到译文');
  }

  return {
    translation,
    meta: {
      transport: 'ark-file',
      model: ARK_FILE_MODEL,
      fileId,
      fallbackUsed: false,
    },
  };
}

function buildReadableDocumentText({ extractedText = '', pages = [] }) {
  const pageText = pages
    .map((page) => {
      const blocks = Array.isArray(page.blocks) ? page.blocks : [];
      const blockText = blocks
        .map((block) => String(block.text || '').trim())
        .filter(Boolean)
        .join('\n\n');
      return blockText || String(page.text || '').trim();
    })
    .filter(Boolean)
    .join('\n\n');

  return pageText || extractedText;
}

function createPageBatches(pages = [], size = MAX_IMAGE_BATCH_PAGES) {
  const batches = [];
  const batchSize = Math.max(1, Number(size) || MAX_IMAGE_BATCH_PAGES);

  for (let index = 0; index < pages.length; index += batchSize) {
    batches.push(pages.slice(index, index + batchSize));
  }

  return batches;
}

function hasRepetitiveGarbage(text = '') {
  const compact = String(text).replace(/\s+/g, '');
  if (!compact) return false;

  if (/(.{2,6})\1{8,}/.test(compact)) return true;
  if (/(.{7,32})\1{5,}/.test(compact)) return true;
  if (/(MS|SM|M|S){40,}/i.test(compact)) return true;

  const letters = compact.match(/[A-Za-z]/g)?.length || 0;
  const uniqueLetters = new Set(compact.match(/[A-Za-z]/g) || []).size;
  return compact.length > 120 && letters / compact.length > 0.8 && uniqueLetters <= 3;
}

function preserveOriginalReferences({ translation = '', extractedText = '' }) {
  const { referenceText } = splitReferenceSection(extractedText);
  if (!referenceText) return translation;

  const translatedParts = splitReferenceSection(translation);
  if (!translatedParts.referenceText) {
    return `${translation.trim()}\n\n${referenceText}`.trim();
  }

  return [translatedParts.mainText, referenceText]
    .filter(Boolean)
    .join('\n\n');
}

function cleanVisionTranslationText(text = '') {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !hasRepetitiveGarbage(line))
    .join('\n\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function validateVisionTranslation(text = '') {
  const cleaned = cleanVisionTranslationText(text);
  if (!cleaned) {
    throw new Error('视觉模型未返回可用译文');
  }
  if (hasRepetitiveGarbage(cleaned)) {
    throw new Error('视觉模型输出疑似重复乱码，已停止展示该结果');
  }
  return cleaned;
}

async function translateViaTextFallback({ extractedText, pages = [], sourceLang, targetLang, field, provider }) {
  const prompt = buildTextTranslationPrompt({ sourceLang, targetLang, field });
  const targetProvider = provider || process.env.DEFAULT_MODEL || 'doubao';
  const documentText = buildReadableDocumentText({ extractedText, pages });

  const translation = await translateDocumentText({
    text: documentText,
    sourceLang,
    targetLang,
    field,
    translateChunk: async (chunkPrompt) => {
      const result = await callModel([{ role: 'user', content: chunkPrompt }], prompt, targetProvider);
      return result.text;
    },
  });

  return {
    translation,
    meta: {
      transport: 'text-fallback',
      model: targetProvider,
      fileId: null,
      fallbackUsed: true,
      fallbackLevel: 3,
      documentMode: true,
    },
  };
}

async function translateViaPageImages({
  pdfBase64,
  extractedText = '',
  sourceLang,
  targetLang,
  field,
  provider,
  onPage,
}) {
  const rendered = await renderPdfPagesToImages(pdfBase64, {
    pageLimit: MAX_RENDER_PAGES,
  });

  const batches = createPageBatches(rendered.pages, MAX_IMAGE_BATCH_PAGES);
  const pages = [];
  let model = null;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const firstPage = batch[0]?.pageNumber || 1;
    const lastPage = batch[batch.length - 1]?.pageNumber || firstPage;
    const result = await callVisionModel({
      prompt: buildPdfVisionBatchPrompt({
        sourceLang,
        targetLang,
        field,
        pages: batch,
        totalPages: rendered.totalPages,
      }),
      images: batch.map((page) => page.imageUrl),
      provider,
    });
    model = result.model;
    const text = validateVisionTranslation(result.text || '');
    pages.push(text);
    onPage?.({
      pageNumber: lastPage,
      startPage: firstPage,
      endPage: lastPage,
      totalPages: rendered.totalPages,
      batchIndex: index + 1,
      totalBatches: batches.length,
      translation: text,
      progress: Math.min(92, Math.round(((index + 1) / batches.length) * 100)),
      model,
    });
  }

  const translation = preserveOriginalReferences({
    translation: pages.filter(Boolean).join('\n\n'),
    extractedText,
  });

  return {
    translation,
    meta: {
      transport: 'page-images',
      model,
      fileId: null,
      fallbackUsed: true,
      fallbackLevel: 2,
      renderedPages: rendered.totalPages,
      imageBatches: batches.length,
    },
  };
}

async function translatePdf(payload) {
  try {
    return await translateViaArkFile(payload);
  } catch (error) {
    try {
      const imageFallback = await translateViaPageImages(payload);
      return {
        ...imageFallback,
        meta: {
          ...imageFallback.meta,
          fallbackReason: error.message,
        },
      };
    } catch (imageError) {
      const fallback = await translateViaTextFallback(payload);
      return {
        ...fallback,
        meta: {
          ...fallback.meta,
          fallbackReason: `${error.message}; ${imageError.message}`,
        },
      };
    }
  }
}

async function streamTranslatePdf(res, payload) {
  emitSse(res, createSseEvent({
    stage: 'uploading',
    progress: 10,
    message: '正在尝试原始 PDF 直传',
  }));

  try {
    const direct = await translateViaArkFile(payload);
    emitSse(res, createSseEvent({
      stage: 'done',
      progress: 100,
      message: '原始 PDF 直传完成',
      done: true,
      data: { translation: direct.translation },
      meta: direct.meta,
    }));
    res.end();
    return;
  } catch (arkError) {
    emitSse(res, createSseEvent({
      stage: 'fallback-image',
      progress: 30,
      message: '原始 PDF 直传不可用，正在切换图片页视觉翻译',
      meta: {
        transport: 'page-images',
        fallbackUsed: true,
        fallbackLevel: 2,
        fallbackReason: arkError.message,
      },
    }));

    try {
      const imageFallback = await translateViaPageImages({
        ...payload,
        onPage: ({ startPage, endPage, totalPages, translation, progress, model }) => {
          emitSse(res, createSseEvent({
            stage: 'page-images',
            progress,
            message: startPage === endPage
              ? `正在翻译第 ${endPage}/${totalPages} 页图像`
              : `正在翻译第 ${startPage}-${endPage}/${totalPages} 页图像`,
            chunk: `${startPage > 1 ? '\n\n' : ''}${translation}`,
            meta: {
              transport: 'page-images',
              fallbackUsed: true,
              fallbackLevel: 2,
              model,
            },
          }));
        },
      });

      emitSse(res, createSseEvent({
        stage: 'done',
        progress: 100,
        message: '已切换为图片页视觉翻译',
        done: true,
        data: { translation: imageFallback.translation },
        meta: imageFallback.meta,
      }));
      res.end();
      return;
    } catch (imageError) {
      emitSse(res, createSseEvent({
        stage: 'fallback-text',
        progress: 60,
        message: describeVisionFallback(imageError.message),
        meta: {
          transport: 'text-fallback',
          fallbackUsed: true,
          fallbackLevel: 3,
          fallbackReason: imageError.message,
        },
      }));
    }
  }

  const fallback = await translateViaTextFallback(payload);
  emitSse(res, createSseEvent({
    stage: 'translating',
    progress: 80,
    message: '正在输出文本翻译结果',
    chunk: fallback.translation,
    meta: fallback.meta,
  }));
  emitSse(res, createSseEvent({
    stage: 'done',
    progress: 100,
    message: '已切换为文本提取翻译',
    done: true,
    data: { translation: fallback.translation },
    meta: fallback.meta,
  }));
  res.end();
}

module.exports = {
  translatePdf,
  streamTranslatePdf,
  createSseEvent,
  emitSse,
  translateViaPageImages,
  createPageBatches,
  hasRepetitiveGarbage,
  cleanVisionTranslationText,
  preserveOriginalReferences,
};
