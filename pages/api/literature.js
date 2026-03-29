// pages/api/literature.js
// 文献独立检索接口（前端可单独调用）

import { searchLiterature } from '../../lib/literature';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST 请求' });
  }

  const { query, limit = 5 } = req.body;

  if (!query?.trim()) {
    return res.status(400).json({ error: '搜索关键词不能为空' });
  }

  const results = await searchLiterature(query, Math.min(limit, 10));
  return res.status(200).json({ results });
}
