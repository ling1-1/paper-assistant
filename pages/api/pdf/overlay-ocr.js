const { sendError, sendSuccess } = require('../../../lib/services/http');
const { runOverlayOcr } = require('../../../lib/services/pdf-overlay-ocr');

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
      pdfBase64 = '',
      provider = process.env.DEFAULT_MODEL || 'doubao',
      engine = 'auto',
      pageLimit,
    } = req.body || {};

    const result = await runOverlayOcr({
      pdfBase64,
      provider,
      engine,
      pageLimit,
    });

    return sendSuccess(res, {
      totalPages: result.totalPages,
      pages: result.pages,
    }, result.meta);
  } catch (error) {
    return sendError(res, 500, error.message || '原位 OCR 失败');
  }
}
