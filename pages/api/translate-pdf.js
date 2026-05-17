import { initSse, sendError, sendSuccess } from '../../lib/services/http';
import { streamTranslatePdf, translatePdf } from '../../lib/services/pdf-translation';

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
      filename = 'paper.pdf',
      extractedText = '',
      pages = [],
      sourceLang = 'en',
      targetLang = 'zh',
      field = 'general',
      provider = process.env.DEFAULT_MODEL || 'doubao',
      stream = true,
    } = req.body || {};

    if (!pdfBase64 || !extractedText.trim()) {
      return sendError(res, 400, '请先完成 PDF 解析');
    }

    const payload = {
      pdfBase64,
      filename,
      extractedText,
      pages,
      sourceLang,
      targetLang,
      field,
      provider,
    };

    if (stream) {
      initSse(res);
      await streamTranslatePdf(res, payload);
      return;
    }

    const result = await translatePdf(payload);
    return sendSuccess(res, { translation: result.translation }, result.meta);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
}
