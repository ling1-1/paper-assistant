import { fetchPdf2zhDownload } from '../../../../../lib/services/pdf2zh-client';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: '仅支持 GET 请求',
    });
  }

  try {
    const { id, type = 'dual' } = req.query || {};
    const downloadType = type === 'mono' ? 'mono' : 'dual';
    const inline = req.query?.inline === '1' || req.query?.inline === 'true';
    const response = await fetchPdf2zhDownload(id, downloadType);
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `${id}-${downloadType}.pdf`;

    res.setHeader('Content-Type', response.headers?.get?.('content-type') || 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error.message,
      meta: { engine: 'pdf2zh' },
    });
  }
}
