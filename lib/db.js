// lib/db.js
// 内存存储模块（Vercel 临时方案）
// ⚠️ 注意：重启后数据会清空，仅用于测试

// 内存存储
const conversations = new Map();
const messages = new Map();

// ── 对话管理 ──────────────────────────────────

/** 创建新对话 */
async function createConversation(id, model = 'claude') {
  if (!conversations.has(id)) {
    conversations.set(id, {
      id,
      title: '新对话',
      model,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    messages.set(id, []);
  }
}

/** 更新对话标题（用第一条用户消息的前 20 字） */
async function updateConversationTitle(id, title) {
  if (conversations.has(id)) {
    const conv = conversations.get(id);
    conv.title = title.slice(0, 30);
    conv.updated_at = new Date().toISOString();
  }
}

/** 列出所有对话（最近 50 个） */
async function listConversations() {
  const results = Array.from(conversations.values())
    .map(conv => ({
      ...conv,
      message_count: messages.get(conv.id)?.length || 0
    }))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 50);
  
  return results;
}

/** 删除对话（级联删除消息） */
async function deleteConversation(id) {
  conversations.delete(id);
  messages.delete(id);
}

// ── 消息管理 ──────────────────────────────────

/** 保存一条消息 */
async function saveMessage(conversationId, role, content, mode = 'general') {
  await createConversation(conversationId);
  
  const msgList = messages.get(conversationId);
  msgList.push({
    role,
    content,
    mode,
    created_at: new Date().toISOString()
  });
  
  // 更新对话的 updated_at
  const conv = conversations.get(conversationId);
  if (conv) {
    conv.updated_at = new Date().toISOString();
  }
}

/** 读取对话历史（最近 N 条，格式符合 AI API 要求） */
async function getHistory(conversationId, limit = 20) {
  const msgList = messages.get(conversationId) || [];
  return msgList.slice(-limit).map(({ role, content }) => ({ role, content }));
}

/** 获取对话详情 */
async function getConversation(id) {
  return conversations.get(id) || null;
}

module.exports = {
  createConversation,
  updateConversationTitle,
  listConversations,
  deleteConversation,
  saveMessage,
  getHistory,
  getConversation,
};
