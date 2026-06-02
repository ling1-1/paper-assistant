import { createPdf2zhJob } from '../../../lib/services/pdf2zh-client';
import { sendError, sendSuccess } from '../../../lib/services/http';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '80mb',
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
      sourceLang = 'en',
      targetLang = 'zh',
      mode = 'dual',
      pages = 'all',
      service = process.env.PDF2ZH_SERVICE || '',
    } = req.body || {};

    const job = await createPdf2zhJob({
      pdfBase64,
      filename,
      sourceLang,
      targetLang,
      mode,
      pages,
      service,
    });

    return sendSuccess(res, { job }, { engine: 'pdf2zh' }, 202);
  } catch (error) {
    return sendError(res, 502, error.message, { engine: 'pdf2zh' });
  }
}
