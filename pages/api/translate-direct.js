// pages/api/translate-direct.js — 直接上传 PDF 给大模型翻译
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fetch = require('node-fetch');

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
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
      model = 'claude', // claude | doubao
    } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: '未提供 PDF 文件' });
    }

    // 翻译 Prompt
    const prompts = {
      translate: `你是一位专业的学术论文翻译专家。请翻译这篇论文，要求：
1. 准确传达原文意思，保持学术语言的正式性和专业性
2. 【极其重要】保留所有 LaTeX 公式、化学分子式、数学符号，不要翻译公式内容
3. 保留引用编号（如 [1], [2]）、图表编号（Figure 1, Table 2）
4. 专业术语首次出现时，格式：中文译名（English Term）
5. 保留段落结构，按原文分段输出
6. 保留单位（mL, mg, °C 等）

请用${targetLang === 'en' ? '英文' : '中文'}输出翻译结果。`,
      
      explain: `你是一位学术论文术语解释专家。请解释这篇论文中的专业术语和概念，包括：
1. 基本含义
2. 在学科中的使用场景
3. 相关概念

请用${targetLang === 'en' ? '英文' : '中文'}回答。`,
      
      polish: `你是一位学术论文润色专家。请优化这篇论文的表达，使其更加：
1. 学术化、正式
2. 逻辑清晰
3. 语法正确

保持原意不变，仅改进表达方式。用${targetLang === 'en' ? '英文' : '中文'}输出。`,
    };

    const systemPrompt = prompts[mode] || prompts.translate;

    // 选择模型
    if (model === 'claude') {
      // 使用 Claude API（支持 PDF）
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      
      if (!anthropicKey || anthropicKey.includes('在此填入')) {
        return res.status(500).json({ 
          error: '未配置 ANTHROPIC_API_KEY',
          message: '请在 .env 文件中配置 Claude API Key'
        });
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: pdfBase64.split(',')[1] || pdfBase64,
                  },
                },
                {
                  type: 'text',
                  text: `请${mode === 'translate' ? '翻译' : mode === 'explain' ? '解释' : '润色'}这篇论文${sourceLang === 'en' ? '（英文→中文）' : '（中文→英文）'}。`,
                },
              ],
            },
          ],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || `Claude API 错误：${response.status}`);
      }

      const translation = data.content[0].text;

      return res.status(200).json({
        success: true,
        translation,
        mode,
        model: 'claude',
      });
    } else {
      // 使用火山方舟（目前不支持 PDF，返回错误）
      return res.status(500).json({
        error: '火山方舟暂不支持 PDF 直接上传',
        message: '请使用 Claude 模型或先提取文本再翻译',
      });
    }
  } catch (err) {
    console.error('[translate-direct]', err);
    return res.status(500).json({
      error: err.message,
      message: 'PDF 翻译失败',
    });
  }
}
