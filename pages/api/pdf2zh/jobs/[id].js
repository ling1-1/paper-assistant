import { getPdf2zhJob } from '../../../../lib/services/pdf2zh-client';
import { sendError, sendSuccess } from '../../../../lib/services/http';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendError(res, 405, '仅支持 GET 请求');
  }

  try {
    const { id } = req.query || {};
    const job = await getPdf2zhJob(id);
    return sendSuccess(res, { job }, { engine: 'pdf2zh' });
  } catch (error) {
    return sendError(res, 502, error.message, { engine: 'pdf2zh' });
  }
}
