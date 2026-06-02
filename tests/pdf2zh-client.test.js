const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  createPdf2zhJob,
  deletePdf2zhJob,
  getPdf2zhJob,
  normalizePdf2zhJob,
  toPdf2zhWorkerUrl,
} = require('../lib/services/pdf2zh-client');

test('toPdf2zhWorkerUrl joins worker base URL and path safely', () => {
  assert.equal(toPdf2zhWorkerUrl('/jobs', 'http://worker:8080/'), 'http://worker:8080/jobs');
  assert.equal(toPdf2zhWorkerUrl('jobs/abc', 'http://worker:8080/api'), 'http://worker:8080/api/jobs/abc');
});

test('normalizePdf2zhJob accepts both wrapped and direct worker job payloads', () => {
  assert.deepEqual(normalizePdf2zhJob({ job: { id: 'a', status: 'done' } }), { id: 'a', status: 'done' });
  assert.deepEqual(normalizePdf2zhJob({ id: 'b', status: 'running' }), { id: 'b', status: 'running' });
});

test('createPdf2zhJob posts PDF bytes and language fields to the worker', async () => {
  const pdfBase64 = Buffer.from('%PDF-1.4 test').toString('base64');
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, 'http://worker:8080/jobs');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('filename'), 'paper.pdf');
    assert.equal(options.body.get('source_lang'), 'en');
    assert.equal(options.body.get('target_lang'), 'zh');
    assert.equal(options.body.get('mode'), 'dual');
    assert.equal(options.body.get('pages'), 'all');
    assert.equal(options.body.get('service'), 'openai');

    const file = options.body.get('file');
    assert.equal(file.name, 'paper.pdf');
    assert.equal(file.type, 'application/pdf');

    return {
      ok: true,
      status: 202,
      json: async () => ({
        job: {
          id: 'job-1',
          status: 'queued',
          downloads: {
            mono: '/jobs/job-1/download?type=mono',
            dual: '/jobs/job-1/download?type=dual',
          },
        },
      }),
    };
  };

  const job = await createPdf2zhJob({
    pdfBase64,
    filename: 'paper.pdf',
    sourceLang: 'en',
    targetLang: 'zh',
    mode: 'dual',
    pages: 'all',
    service: 'openai',
  }, {
    workerUrl: 'http://worker:8080/',
    fetchImpl: fakeFetch,
  });

  assert.equal(calls.length, 1);
  assert.equal(job.id, 'job-1');
  assert.equal(job.status, 'queued');
  assert.equal(job.downloads.dual, '/jobs/job-1/download?type=dual');
});

test('createPdf2zhJob reports worker errors as readable messages', async () => {
  const pdfBase64 = Buffer.from('%PDF-1.4 test').toString('base64');
  const fakeFetch = async () => ({
    ok: false,
    status: 502,
    json: async () => ({ error: 'pdf2zh worker unavailable' }),
  });

  await assert.rejects(
    () => createPdf2zhJob({ pdfBase64, filename: 'paper.pdf' }, { workerUrl: 'http://worker:8080', fetchImpl: fakeFetch }),
    /pdf2zh worker unavailable/,
  );
});

test('getPdf2zhJob fetches status from the worker', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'http://worker:8080/jobs/job-2');
    assert.equal(options.method, 'GET');
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'job-2', status: 'done', progress: 100 }),
    };
  };

  const job = await getPdf2zhJob('job-2', { workerUrl: 'http://worker:8080', fetchImpl: fakeFetch });
  assert.equal(job.id, 'job-2');
  assert.equal(job.status, 'done');
  assert.equal(job.progress, 100);
});

test('deletePdf2zhJob removes a worker job directory', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'http://worker:8080/jobs/job-3');
    assert.equal(options.method, 'DELETE');
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, id: 'job-3', deleted: true }),
    };
  };

  const result = await deletePdf2zhJob('job-3', { workerUrl: 'http://worker:8080', fetchImpl: fakeFetch });
  assert.deepEqual(result, { success: true, id: 'job-3', deleted: true });
});
