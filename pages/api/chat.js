import { callAIStream } from '../../lib/aiCaller';
import { saveMessage, getHistory, updateConversationTitle } from '../../lib/db';
import { searchLiterature } from '../../lib/literature';
import { callVisionModel } from '../../lib/services/model-client';
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
    attachments = [],
  } = req.body || {};

  if (!userMessage?.trim() && !attachments.length) {
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
    const normalizedAttachments = Array.isArray(attachments) ? attachments.slice(0, 6) : [];
    const textAttachmentContext = normalizedAttachments
      .filter((item) => item.kind !== 'image' && item.text)
      .map((item, index) => `附件 ${index + 1}：${item.name || '未命名文件'}${item.meta ? `（${item.meta}）` : ''}\n${String(item.text).slice(0, 12000)}`)
      .join('\n\n');
    const imageAttachments = normalizedAttachments
      .filter((item) => item.kind === 'image' && item.dataUrl)
      .map((item) => item.dataUrl);
    const visibleUserMessage = userMessage?.trim() || '请阅读并处理附件。';
    const modelUserMessage = [
      visibleUserMessage,
      textAttachmentContext ? `以下是用户上传附件的文本内容，请作为上下文使用，不要把附件说明原样复述：\n\n${textAttachmentContext}` : '',
    ].filter(Boolean).join('\n\n');
    const messages = history.map(({ role, content }) => ({ role, content }));
    messages.push({ role: 'user', content: modelUserMessage });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let fullReply = '';

    try {
      if (imageAttachments.length > 0) {
        const result = await callVisionModel({
          provider: model,
          images: imageAttachments,
          prompt: `${systemPrompt}\n\n用户请求：\n${modelUserMessage}`,
          strict: true,
        });
        fullReply = result.text || '';
        if (fullReply) {
          res.write(`data: ${JSON.stringify({ chunk: fullReply, meta: { model: result.model, attachmentMode: 'vision' } })}\n\n`);
        }
      } else {
        await callAIStream(messages, systemPrompt, model, (chunk) => {
          fullReply += chunk;
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        });
      }
    } catch (error) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
      return;
    }

    const savedUserMessage = normalizedAttachments.length
      ? `${visibleUserMessage}\n\n附件：${normalizedAttachments.map((item) => item.name || '未命名附件').join('、')}`
      : visibleUserMessage;
    await saveMessage(conversationId, 'user', savedUserMessage, mode);
    await saveMessage(conversationId, 'assistant', fullReply, mode);

    if (history.length === 0) {
      await updateConversationTitle(conversationId, visibleUserMessage);
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
