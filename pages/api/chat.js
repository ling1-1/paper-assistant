// pages/api/chat.js  v3 — 流式 SSE + historyLen 控制
import { callAIStream } from '../../lib/aiCaller';
import { buildSystemPrompt } from '../../lib/systemPrompt';
import { saveMessage, getHistory, updateConversationTitle } from '../../lib/db';
import { searchLiterature } from '../../lib/literature';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    userMessage, conversationId,
    mode = 'general',
    model = process.env.DEFAULT_MODEL || 'claude',
    searchLit = false, litQuery = '',
    historyLen = 20,
  } = req.body;

  if (!userMessage?.trim()) return res.status(400).json({ error: '消息不能为空' });
  if (!conversationId)      return res.status(400).json({ error: '缺少 conversationId' });

  try {
    const history = await getHistory(conversationId, Math.min(historyLen, 40));
    let literatureResults = [];
    if (searchLit && litQuery.trim()) {
      try { literatureResults = await searchLiterature(litQuery.trim(), 5); }
      catch (e) { console.warn('[chat] lit search failed:', e.message); }
    }
    const systemPrompt = buildSystemPrompt(mode, literatureResults);
    const messages = [...history, { role: 'user', content: userMessage }];

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let fullReply = '';
    try {
      await callAIStream(messages, systemPrompt, model, (chunk) => {
        fullReply += chunk;
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end(); return;
    }

    await saveMessage(conversationId, 'user', userMessage, mode);
    await saveMessage(conversationId, 'assistant', fullReply, mode);
    if (history.length === 0) await updateConversationTitle(conversationId, userMessage);

    res.write(`data: ${JSON.stringify({ done: true, literatureResults })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[chat]', err);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}
