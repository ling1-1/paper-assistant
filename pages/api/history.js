// pages/api/history.js — 获取某对话的完整历史消息
import { getHistory } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: '缺少 id' });
  const history = getHistory(id, 60);
  return res.status(200).json({ history });
}
