// pages/api/translate-direct-v2.js - 整篇翻译（不本地解析，用豆包解析）
// 正确方案：本地解析 PDF → 整篇文本发给豆包 → 一次翻译完成

import { extractPdfLayout } from '../../lib/pdfLayout';
import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const { pdfBase64, filename, field = 'general' } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
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

    // 步骤 1: 本地解析 PDF 提取文本
    sendSSE({
      stage: 'parsing',
      progress: 10,
      message: '正在解析 PDF...',
    });

    const buffer = Buffer.from(pdfBase64.split(',')[1], 'base64');
    const parseResult = await extractPdfLayout(buffer);
    const fullText = parseResult.text;

    console.log('[translate-direct-v2] PDF 解析成功:', fullText.length, '字符');

    sendSSE({
      stage: 'parsed',
      progress: 20,
      message: `PDF 解析成功：${parseResult.totalPages}页，${fullText.length}字符`,
    });

    // 步骤 2: 整篇发送给豆包翻译（不分段）
    const fieldMap = {
      chemistry: '化学化工',
      medicine: '医学',
      cs: '计算机科学',
      engineering: '工程',
      biology: '生物学',
      general: '通用'
    };
    const fieldName = fieldMap[field] || '通用';

    const apiKey = process.env.VOLC_API_KEY;
    const model = process.env.VOLC_MODEL || 'doubao-seed-2-0-pro-260215';

    sendSSE({
      stage: 'translating',
      progress: 30,
      message: `正在整篇翻译（${fieldName}领域，保持上下文和专业术语）...`,
    });

    const startTime = Date.now();

    const volcRes = await fetch(`${ARK_BASE_URL}/api/v3/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
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
            content: `请翻译这篇完整的论文，输出完整的中文译文：\n\n${fullText}`,
          },
        ],
      }),
    });

    if (!volcRes.ok) {
      const errorData = await volcRes.text();
      throw new Error(`火山 API 错误：${volcRes.status} - ${errorData}`);
    }

    // 步骤 3: 流式接收译文
    const reader = volcRes.body.getReader();
    const decoder = new TextDecoder();
    let bufferText = '';
    let fullTranslation = '';
    let lastProgress = 30;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bufferText += decoder.decode(value, { stream: true });
      const lines = bufferText.split('\n');
      bufferText = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const text = data.choices?.[0]?.delta?.content || '';
            
            if (text) {
              fullTranslation += text;
              
              // 计算进度（根据接收的字符数估算）
              const progress = Math.min(95, 30 + Math.round((fullTranslation.length / (fullText.length * 0.7)) * 65));
              if (progress > lastProgress) {
                lastProgress = progress;
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
                sendSSE({
                  stage: 'streaming',
                  progress,
                  text,
                  message: `翻译中... (${elapsed}秒)`,
                });
              } else {
                sendSSE({
                  stage: 'streaming',
                  progress: lastProgress,
                  text,
                });
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }

    // 步骤 4: 完成
    sendSSE({
      stage: 'done',
      progress: 100,
      translation: fullTranslation,
      message: `✅ 翻译完成！（整篇翻译，保持上下文和专业术语）- 耗时${((Date.now() - startTime) / 1000).toFixed(0)}秒`,
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
