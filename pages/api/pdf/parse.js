import { parsePdfFromBase64 } from '../../../lib/services/pdf-parser';
import { sendError, sendSuccess } from '../../../lib/services/http';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendError(res, 405, '仅支持 POST 请求');
  }

  try {
    const { fileBase64, filename } = req.body || {};
    const parsed = await parsePdfFromBase64(fileBase64, filename);

    return sendSuccess(res, {
      text: parsed.text,
      totalPages: parsed.totalPages,
      pages: parsed.pages,
      metadata: parsed.metadata,
    });
  } catch (error) {
    return sendError(res, 400, error.message);
  }
}
