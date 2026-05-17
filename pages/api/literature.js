import { searchLiterature } from '../../lib/literature';
import { callModel } from '../../lib/services/model-client';

function parseJsonObject(raw = '') {
  const trimmed = String(raw).trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function buildAiSearchQuery({ query, model }) {
  const prompt = `你是学术文献检索助手。请把用户输入的中文或宽泛研究主题改写为适合 CrossRef/OpenAlex/Semantic Scholar 的英文检索式。

要求：
1. 只输出 JSON，不要 Markdown。
2. searchQuery 使用英文关键词，保留核心概念，避免长句。
3. 如果用户已经输入英文关键词，也可轻微优化。
4. 输出格式：{"searchQuery":"...", "reason":"..."}`;

  const result = await callModel(
    [{ role: 'user', content: `用户检索主题：${query}` }],
    prompt,
    model,
  );
  const parsed = parseJsonObject(result.text);
  const searchQuery = String(parsed?.searchQuery || '').trim();

  if (!searchQuery) {
    throw new Error('AI 未返回可用检索式');
  }

  return {
    searchQuery,
    reason: String(parsed?.reason || '').trim(),
    model: result.model,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST 请求' });
  }

  const {
    query,
    limit = 5,
    ai = false,
    model = process.env.DEFAULT_MODEL || 'doubao',
  } = req.body || {};

  if (!query?.trim()) {
    return res.status(400).json({ error: '搜索关键词不能为空' });
  }

  try {
    let finalQuery = query.trim();
    let aiMeta = null;

    if (ai) {
      try {
        aiMeta = await buildAiSearchQuery({ query: finalQuery, model });
        finalQuery = aiMeta.searchQuery;
      } catch (error) {
        aiMeta = {
          searchQuery: finalQuery,
          error: error.message || 'AI 检索式生成失败，已使用原始关键词检索',
        };
      }
    }

    const results = await searchLiterature(finalQuery, Math.min(limit, 10));
    return res.status(200).json({
      results,
      meta: {
        aiEnabled: Boolean(ai),
        originalQuery: query.trim(),
        aiQuery: finalQuery,
        aiReason: aiMeta?.reason || '',
        aiModel: aiMeta?.model || '',
        aiError: aiMeta?.error || '',
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || '文献检索失败', results: [] });
  }
}
