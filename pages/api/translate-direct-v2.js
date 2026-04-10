// pages/api/translate-direct-v2.js - 直接上传 PDF 到火山方舟翻译
// 核心：整篇翻译，保持上下文，专业术语准确

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com';

/**
 * 安全解析 JSON
 */
async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * 解码 base64 PDF
 */
function decodePdfBase64(pdfBase64) {
  const base64 = String(pdfBase64 || '').split(',').pop();
  if (!base64) {
    throw new Error('PDF 文件内容缺失');
  }
  return Buffer.from(base64, 'base64');
}

/**
 * 上传 PDF 到火山方舟
 */
async function uploadPdfToArk({ apiKey, buffer, filename }) {
  const formData = new FormData();
  formData.append('purpose', 'user_data');
  formData.append('file', new Blob([buffer]), {
    filename: filename || 'paper.pdf',
    contentType: 'application/pdf',
  });

  const response = await fetch(`${ARK_BASE_URL}/api/v3/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    console.error('[uploadPdfToArk] Error:', data);
    throw new Error(data.error?.message || `文件上传失败：${response.status}`);
  }

  return data;
}

/**
 * 使用火山方舟 Chat Completions API 翻译 PDF
 * 直接上传 PDF 文件，保持完整上下文
 */
async function translatePdfWithArk({ fileId, apiKey, model, field = 'general' }) {
  const fieldMap = {
    chemistry: '化学化工',
    medicine: '医学',
    cs: '计算机科学',
    engineering: '工程',
    biology: '生物学',
    general: '通用'
  };
  
  const fieldName = fieldMap[field] || '通用';
  
  const response = await fetch(`${ARK_BASE_URL}/api/v3/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: 'system',
          content: `你是一位专业的学术论文翻译专家。
学科领域：${fieldName}
要求：
1. 保持上下文连贯，整篇论文作为一个整体翻译
2. 专业术语准确，使用标准中文术语
3. 保留 LaTeX 公式、化学分子式、数学符号、引用编号、图表编号和单位
4. 保持段落结构
5. 学术风格，正式准确
6. 只输出译文正文，不要解释`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '请翻译这篇论文，输出完整的中文译文。',
            },
            {
              type: 'file_url',
              file_url: {
                url: `ark-file:${fileId}`,
              },
            },
          ],
        },
      ],
    }),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    console.error('[translatePdfWithArk] Error:', data);
    throw new Error(data.error?.message || `翻译失败：${response.status}`);
  }

  return data;
}

/**
 * 从 Chat Completions API 响应中提取译文
 */
function extractTranslation(data) {
  return data.choices?.[0]?.message?.content || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const { pdfBase64, filename, field = 'general' } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    const apiKey = process.env.VOLC_API_KEY;
    const model = process.env.VOLC_FILE_MODEL || 'doubao-seed-2-0-pro-260215';

    if (!apiKey) {
      return res.status(500).json({ error: '未配置火山 API Key' });
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendSSE = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    // 步骤 1: 上传 PDF 到火山方舟
    sendSSE({
      stage: 'uploading',
      progress: 10,
      message: '正在上传 PDF 到火山方舟...',
    });

    const buffer = decodePdfBase64(pdfBase64);
    const uploaded = await uploadPdfToArk({ apiKey, buffer, filename });
    const fileId = uploaded.id || uploaded.file_id;

    console.log('[translate-direct-v2] PDF 上传成功，File ID:', fileId);

    sendSSE({
      stage: 'uploaded',
      progress: 30,
      fileId,
      message: 'PDF 上传成功，开始翻译...',
    });

    // 步骤 2: 调用 Responses API 翻译（整篇，保持上下文）
    sendSSE({
      stage: 'translating',
      progress: 50,
      message: '正在翻译整篇论文（保持上下文和专业术语）...',
    });

    const result = await translatePdfWithArk({ fileId, apiKey, model, field });

    sendSSE({
      stage: 'extracting',
      progress: 90,
      message: '正在提取译文...',
    });

    const translation = extractTranslation(result);

    if (!translation) {
      throw new Error('翻译结果为空');
    }

    // 步骤 3: 返回结果
    sendSSE({
      stage: 'done',
      progress: 100,
      translation,
      fileId,
      model,
      message: '翻译完成！',
    });

    res.end();
  } catch (error) {
    console.error('[translate-direct-v2] Error:', error);
    res.write(`data: ${JSON.stringify({
      stage: 'error',
      error: error.message,
      message: '翻译失败',
    })}\n\n`);
    res.end();
  }
}
