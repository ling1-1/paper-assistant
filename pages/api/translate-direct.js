import { callAI, callAIStream } from '../../lib/aiCaller';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com';

const DIRECT_PROMPT = `你是一位专业的学术论文翻译专家。请直接基于用户上传的论文 PDF 完成整篇翻译，并严格遵守以下要求：
1. 仅输出译文正文，不要输出解释、总结、前言或额外说明。
2. 保留原文段落顺序和标题层级。
3. 保留 LaTeX 公式、数学表达式、化学分子式、反应式、引用编号、图表编号和单位。
4. 遇到无法安全翻译的公式或符号时，保持原样。
5. 输出语言为中文，风格正式、准确、符合论文阅读习惯。`;

const FALLBACK_PROMPT = `你是一位专业的学术论文翻译专家。请翻译下面这篇论文文本，要求：
1. 仅输出译文正文，不要解释。
2. 保留段落结构。
3. 保留 LaTeX 公式、化学分子式、数学符号、引用编号、图表编号和单位。
4. 遇到不确定的公式或符号时保持原样。
5. 输出语言为中文，风格正式、自然。`;

function decodePdfBase64(pdfBase64) {
  const base64 = String(pdfBase64 || '').split(',').pop();
  if (!base64) {
    throw new Error('PDF 文件内容缺失');
  }
  return Buffer.from(base64, 'base64');
}

function sendSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function uploadAssistantFile({ apiKey, buffer, filename }) {
  const formData = new FormData();
  formData.append('purpose', 'assistants');
  formData.append('file', new Blob([buffer], { type: 'application/pdf' }), filename || 'paper.pdf');

  const response = await fetch(`${ARK_BASE_URL}/api/v1/files`, {
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

function extractChatText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || item?.content || '')
      .join('\n')
      .trim();
  }
  return '';
}

async function translateViaArkChat({ pdfBase64, filename }) {
  const apiKey = process.env.VOLC_API_KEY;
  const model = process.env.VOLC_FILE_MODEL || 'doubao-seed-2-0-pro-260215';

  if (!apiKey) {
    throw new Error('未配置 VOLC_API_KEY');
  }

  const buffer = decodePdfBase64(pdfBase64);
  const uploaded = await uploadAssistantFile({ apiKey, buffer, filename });

  const fileId = uploaded.id || uploaded.file_id;
  if (!fileId) {
    throw new Error('Ark 文件上传成功，但未返回 file_id');
  }

  const response = await fetch(`${ARK_BASE_URL}/api/v3/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: DIRECT_PROMPT,
            },
            {
              type: 'file_id',
              file_id: fileId,
            },
          ],
        },
      ],
    }),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `文件翻译失败：${response.status}`);
  }

  const translation = extractChatText(data);
  if (!translation) {
    throw new Error('Ark 已返回结果，但未提取到译文');
  }

  return {
    translation,
    fileId,
    model,
  };
}

async function streamTranslateViaArkChat({ pdfBase64, filename, onChunk }) {
  const apiKey = process.env.VOLC_API_KEY;
  const model = process.env.VOLC_FILE_MODEL || 'doubao-seed-2-0-pro-260215';

  if (!apiKey) {
    throw new Error('未配置 VOLC_API_KEY');
  }

  const buffer = decodePdfBase64(pdfBase64);
  const uploaded = await uploadAssistantFile({ apiKey, buffer, filename });

  const fileId = uploaded.id || uploaded.file_id;
  if (!fileId) {
    throw new Error('Ark 文件上传成功，但未返回 file_id');
  }

  const response = await fetch(`${ARK_BASE_URL}/api/v3/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: DIRECT_PROMPT,
            },
            {
              type: 'file_id',
              file_id: fileId,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const data = await parseJsonSafe(response);
    throw new Error(data.error?.message || data.message || `文件翻译失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bufferText = '';
  let translation = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    bufferText += decoder.decode(value, { stream: true });
    const lines = bufferText.split('\n');
    bufferText = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) {
        continue;
      }
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') {
        continue;
      }
      try {
        const event = JSON.parse(raw);
        const chunk = event?.choices?.[0]?.delta?.content;
        if (chunk) {
          translation += chunk;
          onChunk(chunk);
        }
      } catch {}
    }
  }

  if (!translation.trim()) {
    throw new Error('Ark 流式返回为空');
  }

  return {
    translation,
    fileId,
    model,
  };
}

async function translateViaTextFallback({ extractedText, onChunk }) {
  if (!extractedText.trim()) {
    throw new Error('PDF 预处理数据缺失，请重新上传 PDF');
  }

  if (onChunk) {
    let translation = '';
    await callAIStream(
      [{ role: 'user', content: extractedText }],
      FALLBACK_PROMPT,
      'doubao',
      (chunk) => {
        translation += chunk;
        onChunk(chunk);
      },
    );
    return translation;
  }

  return callAI(
    [{ role: 'user', content: extractedText }],
    FALLBACK_PROMPT,
    'doubao',
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const {
      pdfBase64 = '',
      filename = 'paper.pdf',
      extractedText = '',
      stream = true,
      mode = 'translate',
    } = req.body;

    if (mode !== 'translate') {
      return res.status(400).json({ error: 'PDF 模式当前仅支持翻译' });
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      try {
        sendSse(res, {
          stage: 'uploading',
          progress: 10,
          message: '正在上传原始 PDF 到火山方舟',
        });

        let emitted = 20;
        const arkResult = await streamTranslateViaArkChat({
          pdfBase64,
          filename,
          onChunk: (chunk) => {
            emitted = Math.min(emitted + 1, 92);
            sendSse(res, {
              stage: 'translating',
              progress: emitted,
              message: '正在基于原始 PDF 直接生成译文',
              chunk,
            });
          },
        });

        sendSse(res, {
          stage: 'done',
          progress: 100,
          done: true,
          message: '已使用原始 PDF 直接完成翻译',
          translation: arkResult.translation,
          transport: 'ark-file',
          fileId: arkResult.fileId,
          model: arkResult.model,
        });
        res.end();
        return;
      } catch (arkError) {
        console.warn('[translate-direct] ark-file fallback', arkError.message);
        sendSse(res, {
          stage: 'fallback',
          progress: 20,
          message: '原始 PDF 直传失败，正在回退到文本直出模式',
        });
      }

      try {
        sendSse(res, {
          stage: 'translating',
          progress: 35,
          message: '正在生成译文',
        });

        let emitted = 35;
        const translation = await translateViaTextFallback({
          extractedText,
          onChunk: (chunk) => {
            emitted = Math.min(emitted + 1, 95);
            sendSse(res, {
              stage: 'translating',
              progress: emitted,
              message: '正在生成译文',
              chunk,
            });
          },
        });

        sendSse(res, {
          stage: 'done',
          progress: 100,
          done: true,
          message: '已使用文本直出模式完成翻译',
          translation,
          transport: 'text-fallback',
          fileId: null,
          model: 'doubao-seed-2.0-pro',
        });
        res.end();
        return;
      } catch (fallbackError) {
        console.error('[translate-direct] fallback failed', fallbackError);
        sendSse(res, {
          stage: 'error',
          error: fallbackError.message,
          message: 'PDF 翻译失败',
        });
        res.end();
        return;
      }
    }

    try {
      const arkResult = await translateViaArkChat({ pdfBase64, filename });
      return res.status(200).json({
        success: true,
        translation: arkResult.translation,
        transport: 'ark-file',
        fileId: arkResult.fileId,
        model: arkResult.model,
      });
    } catch (arkError) {
      console.warn('[translate-direct] non-stream ark fallback', arkError.message);
    }

    const translation = await translateViaTextFallback({ extractedText });
    return res.status(200).json({
      success: true,
      translation,
      transport: 'text-fallback',
      fileId: null,
      model: 'doubao-seed-2.0-pro',
    });
  } catch (err) {
    console.error('[translate-direct]', err);
    return res.status(500).json({
      error: err.message,
      message: 'PDF 翻译失败',
    });
  }
}
