import { callAIStream } from '../../lib/aiCaller';
import { saveMessage, getHistory, updateConversationTitle } from '../../lib/db';
import { searchLiterature } from '../../lib/literature';
import { buildAssistantIntentPrompt } from '../../lib/services/prompt-builder';
import { buildSystemPrompt } from '../../lib/systemPrompt';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  const {
    userMessage,
    conversationId,
    mode = 'general',
    intent = 'general',
    model = process.env.DEFAULT_MODEL || 'doubao',
    searchLit = false,
    litQuery = '',
    contextFlags = {},
    historyLen = 20,
  } = req.body || {};

  if (!userMessage?.trim()) {
    return res.status(400).json({ error: '消息不能为空' });
  }

  if (!conversationId) {
    return res.status(400).json({ error: '缺少 conversationId' });
  }

  try {
    const history = await getHistory(conversationId, Math.min(historyLen, 40));
    let literatureResults = [];

    if (searchLit && litQuery.trim()) {
      try {
        literatureResults = await searchLiterature(litQuery.trim(), 5);
      } catch (error) {
        console.warn('[chat] literature search failed:', error.message);
      }
    }

    const systemPrompt = buildSystemPrompt(
      mode,
      literatureResults,
      buildAssistantIntentPrompt({ mode, intent, contextFlags }),
    );
    const messages = history.map(({ role, content }) => ({ role, content }));
    messages.push({ role: 'user', content: userMessage });

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
    } catch (error) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
      return;
    }

    await saveMessage(conversationId, 'user', userMessage, mode);
    await saveMessage(conversationId, 'assistant', fullReply, mode);

    if (history.length === 0) {
      await updateConversationTitle(conversationId, userMessage);
    }

    res.write(`data: ${JSON.stringify({ done: true, literatureResults })}\n\n`);
    res.end();
  } catch (error) {
    console.error('[chat]', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message || '对话失败' });
    }
    res.write(`data: ${JSON.stringify({ error: error.message || '对话失败' })}\n\n`);
    res.end();
  }
}
