import { buildTextTranslationPrompt } from '../../lib/services/prompt-builder';
import { callModel } from '../../lib/services/model-client';
import { translateLongText } from '../../lib/translationPipeline';
import { createSseEvent, emitSse } from '../../lib/services/pdf-translation';
import { initSse, sendError, sendSuccess } from '../../lib/services/http';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendError(res, 405, '仅支持 POST 请求');
  }

  try {
    const {
      text = '',
      sourceLang = 'en',
      targetLang = 'zh',
      field = 'general',
      stream = true,
      model = process.env.DEFAULT_MODEL || 'doubao',
    } = req.body || {};

    if (!text.trim()) {
      return sendError(res, 400, '翻译内容不能为空');
    }

    const prompt = buildTextTranslationPrompt({ sourceLang, targetLang, field });

    if (!stream) {
      const translation = await translateLongText({
        text,
        sourceLang,
        targetLang,
        field,
        translateChunk: async (chunkPrompt) => {
          const result = await callModel([{ role: 'user', content: chunkPrompt }], prompt, model);
          return result.text;
        },
      });

      return sendSuccess(res, { translation }, { model });
    }

    initSse(res);
    emitSse(res, createSseEvent({
      stage: 'translating',
      progress: 10,
      message: '正在准备翻译文本',
      meta: { model },
    }));

    const chunks = [];
    const translation = await translateLongText({
      text,
      sourceLang,
      targetLang,
      field,
      translateChunk: async (chunkPrompt, chunkIndex, totalChunks) => {
        const result = await callModel([{ role: 'user', content: chunkPrompt }], prompt, model);
        const progress = Math.min(90, Math.round(((chunkIndex + 1) / totalChunks) * 90));
        chunks.push(result.text);
        emitSse(res, createSseEvent({
          stage: 'translating',
          progress,
          message: `正在翻译第 ${chunkIndex + 1}/${totalChunks} 段`,
          chunk: `${chunkIndex > 0 ? '\n\n' : ''}${result.text}`,
          meta: { model },
        }));
        return result.text;
      },
    });

    emitSse(res, createSseEvent({
      stage: 'done',
      progress: 100,
      message: '文本翻译完成',
      done: true,
      data: { translation: chunks.length ? chunks.join('\n\n') : translation },
      meta: { model },
    }));
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      return sendError(res, 500, error.message);
    }

    emitSse(res, createSseEvent({
      stage: 'error',
      progress: 100,
      message: '翻译失败',
      error: error.message,
    }));
    res.end();
  }
}
