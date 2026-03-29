// lib/db.js
// SQLite 对话历史存储模块
// 使用 sql.js (纯 JavaScript 实现，无需编译)

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;
const DB_PATH = path.join(__dirname, '..', 'chat_history.db');

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();
  
  // 加载现有数据库或创建新数据库
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 建表（首次运行自动创建）
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      model TEXT DEFAULT 'claude',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      mode TEXT DEFAULT 'general',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id)`);

  return db;
}

// 保存数据库到文件
function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ── 对话管理 ──────────────────────────────────

/** 创建新对话 */
async function createConversation(id, model = 'claude') {
  const database = await getDb();
  database.run(
    `INSERT OR IGNORE INTO conversations (id, model) VALUES (?, ?)`,
    [id, model]
  );
  saveDb();
}

/** 更新对话标题（用第一条用户消息的前 20 字） */
async function updateConversationTitle(id, title) {
  const database = await getDb();
  database.run(
    `UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [title.slice(0, 30), id]
  );
  saveDb();
}

/** 列出所有对话（最近 50 个） */
async function listConversations() {
  const database = await getDb();
  const stmt = database.prepare(`
    SELECT c.id, c.title, c.model, c.created_at, c.updated_at,
           COUNT(m.id) as message_count
    FROM conversations c
    LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT 50
  `);
  
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  
  return results;
}

/** 删除对话（级联删除消息） */
async function deleteConversation(id) {
  const database = await getDb();
  database.run(`DELETE FROM messages WHERE conversation_id = ?`, [id]);
  database.run(`DELETE FROM conversations WHERE id = ?`, [id]);
  saveDb();
}

// ── 消息管理 ──────────────────────────────────

/** 保存一条消息 */
async function saveMessage(conversationId, role, content, mode = 'general') {
  const database = await getDb();
  await createConversation(conversationId);
  
  database.run(
    `INSERT INTO messages (conversation_id, role, content, mode) VALUES (?, ?, ?, ?)`,
    [conversationId, role, content, mode]
  );
  
  // 更新对话的 updated_at
  database.run(
    `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [conversationId]
  );
  
  saveDb();
}

/** 读取对话历史（最近 N 条，格式符合 AI API 要求） */
async function getHistory(conversationId, limit = 20) {
  const database = await getDb();
  const stmt = database.prepare(`
    SELECT role, content FROM messages
    WHERE conversation_id = ?
    ORDER BY id ASC
    LIMIT ?
  `);
  
  const results = [];
  stmt.bind([conversationId, limit]);
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push({ role: row.role, content: row.content });
  }
  stmt.free();
  
  return results;
}

/** 获取对话详情 */
async function getConversation(id) {
  const database = await getDb();
  const stmt = database.prepare(`SELECT * FROM conversations WHERE id = ?`);
  stmt.bind([id]);
  
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  
  return result;
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
