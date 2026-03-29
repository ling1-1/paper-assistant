// pages/api/export.js — 导出对话为文本
import { getHistory, getConversation } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { id, fmt = 'md' } = req.query;
  if (!id) return res.status(400).json({ error: '缺少 id' });

  const conv = getConversation(id);
  const history = getHistory(id, 200);

  if (fmt === 'md') {
    const lines = [`# ${conv?.title || '论文助手对话记录'}`, `\n导出时间：${new Date().toLocaleString('zh-CN')}\n`, '---'];
    history.forEach(m => {
      lines.push(`\n**${m.role === 'user' ? '我' : '助手'}：**\n`);
      lines.push(m.content);
    });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="conversation-${id.slice(0,8)}.md"`);
    return res.send(lines.join('\n'));
  }

  // txt
  const lines = [`对话记录 — ${conv?.title || id}`, `导出时间：${new Date().toLocaleString('zh-CN')}`, '='.repeat(40)];
  history.forEach(m => {
    lines.push(`\n【${m.role === 'user' ? '我' : '助手'}】`);
    lines.push(m.content);
  });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="conversation-${id.slice(0,8)}.txt"`);
  return res.send(lines.join('\n'));
}
