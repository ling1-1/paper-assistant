const { sendError, sendSuccess } = require('../../lib/services/http');
const { translateOverlayPages } = require('../../lib/services/overlay-translation');

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendError(res, 405, '仅支持 POST 请求');
  }

  try {
    const {
      pages = [],
      sourceLang = 'en',
      targetLang = 'zh',
      field = 'general',
      provider = process.env.DEFAULT_MODEL || 'doubao',
    } = req.body || {};

    if (!Array.isArray(pages) || pages.length === 0) {
      return sendError(res, 400, '请先完成原位 OCR');
    }

    const result = await translateOverlayPages({
      pages,
      sourceLang,
      targetLang,
      field,
      provider,
    });

    return sendSuccess(res, {
      pages: result.pages,
    }, result.meta);
  } catch (error) {
    return sendError(res, 500, error.message || '原位覆盖翻译失败');
  }
}
