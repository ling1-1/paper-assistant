// pages/api/translate-chunked.js - 分块翻译 API
// 核心改进：分块翻译 + 实时进度 + 错误处理

import { callAIStream } from '../../lib/aiCaller';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const TRANSLATE_PROMPT = `你是一位专业的学术论文翻译专家。请翻译下面的论文片段，要求：
1. 仅输出译文正文，不要解释。
2. 保留 LaTeX 公式、化学分子式、数学符号、引用编号、图表编号和单位。
3. 保留段落结构。
4. 输出语言为中文，风格正式、准确。`;

/**
 * 将文本分割成块 (每块约 500 字符)
 */
function splitIntoChunks(text, maxChars = 500) {
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length <= maxChars) {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = paragraph;
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

/**
 * 发送 SSE 消息
 */
function sendSSE(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const { text, field = 'general', sourceLang = 'en', targetLang = 'zh' } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: '请输入要翻译的内容' });
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // 分割文本
    const chunks = splitIntoChunks(text, 500);
    const totalChunks = chunks.length;

    console.log(`[translate-chunked] 开始翻译，共${totalChunks}块`);

    // 发送开始消息
    sendSSE(res, {
      stage: 'start',
      totalChunks,
      message: `开始翻译，共 ${totalChunks} 块`,
    });

    let translatedText = '';
    let currentChunk = 0;

    // 逐块翻译
    for (const chunk of chunks) {
      currentChunk += 1;
      const progress = Math.round((currentChunk / totalChunks) * 100);

      sendSSE(res, {
        stage: 'chunk_start',
        chunkIndex: currentChunk,
        totalChunks,
        progress,
        message: `翻译第 ${currentChunk}/${totalChunks} 块`,
      });

      // 翻译当前块
      let chunkTranslation = '';
      await callAIStream(
        [{ role: 'user', content: chunk }],
        `${TRANSLATE_PROMPT}\n\n学科领域：${field}`,
        'doubao',
        (text) => {
          chunkTranslation += text;
          sendSSE(res, {
            stage: 'chunk_stream',
            chunkIndex: currentChunk,
            text: text,
          });
        },
      );

      translatedText += chunkTranslation + '\n\n';

      sendSSE(res, {
        stage: 'chunk_done',
        chunkIndex: currentChunk,
        progress,
        message: `第 ${currentChunk} 块完成`,
      });
    }

    // 完成
    sendSSE(res, {
      stage: 'done',
      progress: 100,
      message: '翻译完成',
      translation: translatedText.trim(),
    });

    res.end();
  } catch (error) {
    console.error('[translate-chunked] Error:', error);
    sendSSE(res, {
      stage: 'error',
      error: error.message,
      message: '翻译失败',
    });
    res.end();
  }
}
