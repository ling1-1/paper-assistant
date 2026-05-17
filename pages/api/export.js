import { exportTranslation } from '../../lib/services/exporter';
import { sendError, sendSuccess } from '../../lib/services/http';

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
      format = 'docx',
      originalText = '',
      translatedText = '',
      pdfBase64 = '',
      filename = 'translation',
      sourceLang = 'en',
      targetLang = 'zh',
    } = req.body || {};

    const result = await exportTranslation({
      format,
      originalText,
      translatedText,
      pdfBase64,
      filename,
      sourceLang,
      targetLang,
    });

    return sendSuccess(res, {
      filename: result.filename,
      downloadUrl: result.downloadUrl,
    }, {
      format,
      pages: result.pages || null,
    });
  } catch (error) {
    return sendError(res, 400, error.message);
  }
}
