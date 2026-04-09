// pages/api/translate.js — 论文翻译接口
import { callAIStream, callAI } from '../../lib/aiCaller';

export const config = { api: { bodyParser: true } };

// 翻译专用 System Prompt
const TRANSLATION_PROMPT = `你是一位专业的学术论文翻译专家，具有以下特点：
- 精通中英文学术写作，熟悉各学科专业术语
- 翻译准确、流畅，保持学术论文的严谨性
- 保留原文的段落结构、公式、引用标记
- 遇到不确定的术语时，在括号中标注原文

翻译要求：
1. 准确传达原文意思，不随意增删
2. 保持学术语言的正式性和专业性
3. 专业术语首次出现时，格式：中文译名（English Term）
4. 【重要】保留所有 LaTeX 公式（$...$, $$...$$, \\ce{}, \\frac{}, \\alpha 等），不要翻译公式内容
5. 【重要】保留引用编号（如 [1], [2], [10-15]）、图表编号（Figure 1, Table 2）
6. 【重要】保留化学分子式、数学符号、单位（mL, mg, °C 等）
7. 保留段落结构，按原文分段输出
8. 长句适当拆分，确保中文可读性

输出格式：
直接输出翻译结果，不需要额外解释。保留原文的段落分隔。`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  const {
    text,
    mode = 'translate', // translate / explain / polish
    sourceLang = 'en',  // en / zh
    targetLang = 'zh',  // zh / en
    model = process.env.DEFAULT_MODEL || 'doubao',
    stream = true,
    field = 'general', // general / cs / medicine / engineering / biology
  } = req.body;

  if (!text?.trim()) {
    return res.status(400).json({ error: '翻译内容不能为空' });
  }

  // 学科特定术语提示
  const fieldPrompts = {
    general: '',
    cs: '【计算机科学领域】熟悉 AI、机器学习、分布式系统、算法、数据结构等术语。',
    medicine: '【医学领域】熟悉临床医学、药理学、病理学、解剖学等术语。',
    engineering: '【工程领域】熟悉机械工程、电子工程、土木工程、自动化等术语。',
    biology: '【生物学领域】熟悉分子生物学、遗传学、生态学、生物化学等术语。',
    chemistry: '【化学化工领域】熟悉有机化学、无机化学、分析化学、化学工程、材料科学等术语。',
  };

  // 不同模式的 System Prompt
  const modePrompts = {
    translate: `${TRANSLATION_PROMPT}\n${fieldPrompts[field] || ''}\n请将${sourceLang === 'en' ? '英文' : '中文'}内容翻译成${targetLang === 'en' ? '英文' : '中文'}。`,
    explain: `你是一位学术论文术语解释专家。请解释用户提供的专业术语或句子，包括：
- 基本含义
- 在学科中的使用场景
- 相关概念
用${targetLang === 'en' ? '英文' : '中文'}回答。`,
    polish: `你是一位学术论文润色专家。请优化用户提供的文本，使其更加：
- 学术化、正式
- 逻辑清晰
- 语法正确
保持原意不变，仅改进表达方式。用${targetLang === 'en' ? '英文' : '中文'}输出。`,
  };

  const systemPrompt = modePrompts[mode] || modePrompts.translate;
  const messages = [{ role: 'user', content: text }];

  try {
    if (stream) {
      // 流式输出（SSE）
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      let fullTranslation = '';
      try {
        await callAIStream(messages, systemPrompt, model, (chunk) => {
          fullTranslation += chunk;
          res.write(`data: ${JSON.stringify({ chunk, type: 'translation' })}\n\n`);
        });
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message, type: 'error' })}\n\n`);
        res.end();
        return;
      }

      res.write(`data: ${JSON.stringify({ done: true, translation: fullTranslation })}\n\n`);
      res.end();
    } else {
      // 非流式输出
      const translation = await callAI(messages, systemPrompt, model);
      return res.status(200).json({ translation, mode, sourceLang, targetLang });
    }
  } catch (err) {
    console.error('[translate]', err);
    return res.status(500).json({ error: err.message });
  }
}
