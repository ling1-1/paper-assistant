import { listConversations, deleteConversation, getHistory } from '../../lib/db';
import { updateConversationTitle } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method === 'GET' && !req.query.action) {
    try {
      const conversations = await listConversations();
      return res.status(200).json({ conversations });
    } catch (error) {
      return res.status(500).json({ conversations: [], error: error.message });
    }
  }

  if (req.method === 'GET' && req.query.action === 'history') {
    try {
      const history = await getHistory(req.query.id, 50);
      return res.status(200).json({ history });
    } catch (error) {
      return res.status(500).json({ history: [], error: error.message });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: '缺少 id' });
    }

    try {
      await deleteConversation(id);
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'POST' && req.query.action === 'rename') {
    const { id, title } = req.body || {};
    if (!id || !title?.trim()) {
      return res.status(400).json({ error: '缺少 id 或 title' });
    }

    try {
      const conversation = await updateConversationTitle(id, title.trim());
      return res.status(200).json({ success: true, conversation });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).end();
}
