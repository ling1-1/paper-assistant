const DEFAULT_WORKER_URL = process.env.PDF2ZH_WORKER_URL
  || (process.env.NODE_ENV === 'production' ? 'http://pdf2zh-worker:8080' : 'http://127.0.0.1:8088');

function toPdf2zhWorkerUrl(path = '/', workerUrl = DEFAULT_WORKER_URL) {
  const base = String(workerUrl || DEFAULT_WORKER_URL).replace(/\/+$/, '');
  const cleanPath = String(path || '/').replace(/^\/+/, '');
  return `${base}/${cleanPath}`;
}

function normalizePdf2zhJob(payload = {}) {
  const job = payload.job || payload.data?.job || payload.data || payload;
  if (!job || typeof job !== 'object') {
    throw new Error('pdf2zh worker returned an invalid job payload');
  }
  return job;
}

function cleanBase64(value = '') {
  return String(value || '').replace(/^data:application\/pdf;base64,/, '').trim();
}

async function parseWorkerResponse(response) {
  const contentType = response.headers?.get?.('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await safeJson(response);

  if (!response.ok) {
    const message = payload?.error || payload?.message || `pdf2zh worker request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

async function createPdf2zhJob({
  pdfBase64 = '',
  filename = 'paper.pdf',
  sourceLang = 'en',
  targetLang = 'zh',
  mode = 'dual',
  pages = 'all',
  service = '',
} = {}, {
  workerUrl = DEFAULT_WORKER_URL,
  fetchImpl = fetch,
} = {}) {
  const normalizedBase64 = cleanBase64(pdfBase64);
  if (!normalizedBase64) {
    throw new Error('缺少 PDF 内容，无法提交 pdf2zh 任务');
  }

  const pdfBuffer = Buffer.from(normalizedBase64, 'base64');
  if (!pdfBuffer.length) {
    throw new Error('PDF 内容为空，无法提交 pdf2zh 任务');
  }

  const form = new FormData();
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), filename || 'paper.pdf');
  form.append('filename', filename || 'paper.pdf');
  form.append('source_lang', sourceLang || 'en');
  form.append('target_lang', targetLang || 'zh');
  form.append('mode', mode || 'dual');
  form.append('pages', pages || 'all');
  if (service) form.append('service', service);

  const response = await fetchImpl(toPdf2zhWorkerUrl('/jobs', workerUrl), {
    method: 'POST',
    body: form,
  });

  return normalizePdf2zhJob(await parseWorkerResponse(response));
}

async function getPdf2zhJob(jobId, {
  workerUrl = DEFAULT_WORKER_URL,
  fetchImpl = fetch,
} = {}) {
  if (!jobId) {
    throw new Error('缺少 pdf2zh 任务 ID');
  }

  const response = await fetchImpl(toPdf2zhWorkerUrl(`/jobs/${encodeURIComponent(jobId)}`, workerUrl), {
    method: 'GET',
  });

  return normalizePdf2zhJob(await parseWorkerResponse(response));
}

async function fetchPdf2zhDownload(jobId, type = 'dual', {
  workerUrl = DEFAULT_WORKER_URL,
  fetchImpl = fetch,
} = {}) {
  if (!jobId) {
    throw new Error('缺少 pdf2zh 任务 ID');
  }

  const safeType = type === 'mono' ? 'mono' : 'dual';
  const response = await fetchImpl(toPdf2zhWorkerUrl(`/jobs/${encodeURIComponent(jobId)}/download?type=${safeType}`, workerUrl), {
    method: 'GET',
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload.error || payload.message || `pdf2zh download failed with HTTP ${response.status}`);
  }

  return response;
}

module.exports = {
  createPdf2zhJob,
  fetchPdf2zhDownload,
  getPdf2zhJob,
  normalizePdf2zhJob,
  toPdf2zhWorkerUrl,
};
