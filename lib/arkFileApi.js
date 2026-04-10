const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function uploadFileToArk({ apiKey, buffer, filename, mimeType = 'application/pdf', purpose = 'user_data' }) {
  const formData = new FormData();
  formData.append('purpose', purpose);
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);

  const response = await fetch(`${ARK_BASE_URL}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `文件上传失败：${response.status}`);
  }

  return data;
}

async function getArkFile({ apiKey, fileId }) {
  const response = await fetch(`${ARK_BASE_URL}/files/${fileId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `文件状态查询失败：${response.status}`);
  }

  return data;
}

export async function waitForArkFileReady({ apiKey, fileId, maxAttempts = 12, delayMs = 1000 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const file = await getArkFile({ apiKey, fileId });
    if (file.status === 'processed' || file.status === 'ready' || file.status === 'uploaded') {
      return file;
    }
    if (file.status === 'error' || file.status === 'failed') {
      throw new Error(file.status_details || '文件处理失败');
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('文件处理超时');
}

export function extractOutputText(responseData) {
  const output = responseData.output || [];
  const texts = [];

  for (const item of output) {
    if (!Array.isArray(item.content)) {
      continue;
    }
    for (const contentItem of item.content) {
      if (contentItem.type === 'output_text' && contentItem.text) {
        texts.push(contentItem.text);
      }
    }
  }

  return texts.join('\n').trim();
}

export async function createArkResponse({ apiKey, model, input }) {
  const response = await fetch(`${ARK_BASE_URL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `Responses API 调用失败：${response.status}`);
  }

  return data;
}
