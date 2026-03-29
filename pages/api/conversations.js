// pages/api/conversations.js v2
import { listConversations, deleteConversation, getHistory } from '../../lib/db';

export default async function handler(req, res) {
  // GET /api/conversations — 列出所有对话
  if (req.method === 'GET' && !req.query.action) {
    try {
      const conversations = await listConversations();
      return res.status(200).json({ conversations: conversations || [] });
    } catch (e) {
      console.error('[conversations] list error:', e);
      return res.status(500).json({ conversations: [], error: e.message });
    }
  }
  // GET /api/conversations?id=xxx&action=history — 获取历史消息
  if (req.method === 'GET' && req.query.action === 'history') {
    try {
      const history = await getHistory(req.query.id, 50);
      return res.status(200).json({ history: history || [] });
    } catch (e) {
      return res.status(500).json({ history: [], error: e.message });
    }
  }
  // DELETE /api/conversations?id=xxx
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: '缺少 id' });
    try {
      await deleteConversation(id);
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  return res.status(405).end();
}
