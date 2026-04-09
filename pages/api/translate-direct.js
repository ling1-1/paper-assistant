// pages/api/translate-direct.js — 直接上传 PDF 给火山方舟翻译
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fetch = require('node-fetch');

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb', // 火山方舟支持最大 50MB base64
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const {
      pdfBase64,
      filename,
      mode = 'translate',
      sourceLang = 'en',
      targetLang = 'zh',
      field = 'chemistry',
    } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: '未提供 PDF 文件' });
    }

    // 火山方舟 API 配置
    const apiKey = process.env.VOLC_API_KEY;
    const model = process.env.VOLC_MODEL || 'doubao-pro-32k';
    
    if (!apiKey || apiKey.includes('在此填入')) {
      return res.status(500).json({ 
        error: '未配置 VOLC_API_KEY',
        message: '请在 .env 文件中配置火山方舟 API Key'
      });
    }

    // 翻译 Prompt
    const systemPrompt = `你是一位专业的学术论文翻译专家。请翻译这篇 PDF 文档，要求：
1. 准确传达原文意思，保持学术语言的正式性和专业性
2. 【极其重要】保留所有 LaTeX 公式、化学分子式、数学符号，不要翻译公式内容
3. 保留引用编号（如 [1], [2]）、图表编号（Figure 1, Table 2）
4. 专业术语首次出现时，格式：中文译名（English Term）
5. 保留段落结构，按原文分段输出
6. 保留单位（mL, mg, °C 等）

请用${targetLang === 'en' ? '英文' : '中文'}输出翻译结果。`;

    // 火山方舟多模态 API 端点（支持 PDF）
    const endpoint = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

    // 提取纯 base64（去掉 data:application/pdf;base64, 前缀）
    const pureBase64 = pdfBase64.includes(',') 
      ? pdfBase64.split(',')[1] 
      : pdfBase64;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'doubao-vision-pro-32k', // 使用多模态模型
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: [
              {
                type: 'file_url',
                file_url: {
                  url: `data:application/pdf;base64,${pureBase64}`,
                },
              },
              {
                type: 'text',
                text: `请${mode === 'translate' ? '翻译' : mode === 'explain' ? '解释' : '润色'}这篇论文${sourceLang === 'en' ? '（英文→中文）' : '（中文→英文）'}。`,
              },
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || `火山方舟 API 错误：${response.status}`);
    }

    const translation = data.choices?.[0]?.message?.content || '';

    if (!translation) {
      throw new Error('翻译结果为空');
    }

    return res.status(200).json({
      success: true,
      translation,
      mode,
      model: 'doubao-vision-pro-32k',
    });
  } catch (err) {
    console.error('[translate-direct]', err);
    return res.status(500).json({
      error: err.message,
      message: 'PDF 翻译失败',
    });
  }
}
