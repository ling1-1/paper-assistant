const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'paper-assistant-db.json');

const EMPTY_DB = {
  conversations: {},
  messages: {},
  settings: {
    defaultModel: process.env.DEFAULT_MODEL || 'doubao',
    customModels: {},
    modelOverrides: {},
  },
};

let writeQueue = Promise.resolve();

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(EMPTY_DB, null, 2), 'utf8');
  }
}

async function readStore() {
  await ensureStore();

  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      conversations: parsed.conversations || {},
      messages: parsed.messages || {},
      settings: {
        defaultModel: parsed.settings?.defaultModel || EMPTY_DB.settings.defaultModel,
        customModels: parsed.settings?.customModels || {},
        modelOverrides: parsed.settings?.modelOverrides || {},
      },
    };
  } catch {
    return { ...EMPTY_DB };
  }
}

function writeStore(data) {
  writeQueue = writeQueue.then(async () => {
    await ensureStore();
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  });

  return writeQueue;
}

async function createConversation(id, model = 'claude') {
  const db = await readStore();

  if (!db.conversations[id]) {
    const now = new Date().toISOString();
    db.conversations[id] = {
      id,
      title: '新对话',
      model,
      created_at: now,
      updated_at: now,
    };
    db.messages[id] = [];
    await writeStore(db);
  }

  return db.conversations[id];
}

async function updateConversationTitle(id, title) {
  const db = await readStore();
  const conversation = db.conversations[id];
  if (!conversation) return null;

  conversation.title = (title || '新对话').slice(0, 30);
  conversation.updated_at = new Date().toISOString();
  await writeStore(db);
  return conversation;
}

async function listConversations() {
  const db = await readStore();

  return Object.values(db.conversations)
    .map((conversation) => ({
      ...conversation,
      message_count: db.messages[conversation.id]?.length || 0,
    }))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 50);
}

async function deleteConversation(id) {
  const db = await readStore();
  delete db.conversations[id];
  delete db.messages[id];
  await writeStore(db);
}

async function saveMessage(conversationId, role, content, mode = 'general') {
  const db = await readStore();
  const now = new Date().toISOString();

  if (!db.conversations[conversationId]) {
    db.conversations[conversationId] = {
      id: conversationId,
      title: '新对话',
      model: 'claude',
      created_at: now,
      updated_at: now,
    };
  }

  if (!db.messages[conversationId]) {
    db.messages[conversationId] = [];
  }

  db.messages[conversationId].push({
    role,
    content,
    mode,
    created_at: now,
  });

  db.conversations[conversationId].updated_at = now;
  await writeStore(db);
}

async function getHistory(conversationId, limit = 20) {
  const db = await readStore();
  const history = db.messages[conversationId] || [];
  return history.slice(-limit).map(({ role, content, mode, created_at }) => ({
    role,
    content,
    mode,
    created_at,
  }));
}

async function getConversation(id) {
  const db = await readStore();
  return db.conversations[id] || null;
}

async function getSettings() {
  const db = await readStore();
  return {
    defaultModel: db.settings?.defaultModel || EMPTY_DB.settings.defaultModel,
    customModels: db.settings?.customModels || {},
    modelOverrides: db.settings?.modelOverrides || {},
  };
}

async function setDefaultModel(modelId) {
  const db = await readStore();
  db.settings = {
    ...EMPTY_DB.settings,
    ...(db.settings || {}),
    defaultModel: modelId || EMPTY_DB.settings.defaultModel,
  };
  await writeStore(db);
  return db.settings;
}

async function upsertCustomModelConfig(config = {}) {
  const db = await readStore();
  const id = String(config.id || '').trim();
  if (!id) {
    throw new Error('缺少模型 id');
  }

  const previous = db.settings?.customModels?.[id] || null;
  const nextApiKey = String(config.apiKey || '').trim() || previous?.apiKey || '';

  db.settings = {
    ...EMPTY_DB.settings,
    ...(db.settings || {}),
    customModels: {
      ...(db.settings?.customModels || {}),
      [id]: {
        ...(previous || {}),
        id,
        label: String(config.label || id).trim(),
        provider: String(config.provider || 'openai-compatible').trim(),
        apiStyle: String(config.apiStyle || 'chat-completions').trim(),
        apiKey: nextApiKey,
        baseUrl: String(config.baseUrl || '').trim(),
        textModel: String(config.textModel || '').trim(),
        visionModel: String(config.visionModel || '').trim(),
        supportsVision: Boolean(config.supportsVision),
        updatedAt: new Date().toISOString(),
      },
    },
  };

  await writeStore(db);
  return db.settings.customModels[id];
}

async function upsertModelOverride(id, config = {}) {
  const db = await readStore();
  const modelId = String(id || '').trim();
  if (!modelId) {
    throw new Error('缺少模型 id');
  }

  const previous = db.settings?.modelOverrides?.[modelId] || {};
  const apiKey = String(config.apiKey || '').trim() || previous.apiKey || '';

  db.settings = {
    ...EMPTY_DB.settings,
    ...(db.settings || {}),
    modelOverrides: {
      ...(db.settings?.modelOverrides || {}),
      [modelId]: {
        ...(previous || {}),
        id: modelId,
        label: String(config.label || previous.label || modelId).trim(),
        apiStyle: String(config.apiStyle || previous.apiStyle || 'chat-completions').trim(),
        baseUrl: String(config.baseUrl || previous.baseUrl || '').trim(),
        textModel: String(config.textModel || previous.textModel || '').trim(),
        visionModel: String(config.visionModel || previous.visionModel || '').trim(),
        supportsVision: config.supportsVision ?? previous.supportsVision ?? true,
        apiKey,
        updatedAt: new Date().toISOString(),
      },
    },
  };

  await writeStore(db);
  return db.settings.modelOverrides[modelId];
}

async function deleteCustomModelConfig(id) {
  const db = await readStore();
  if (!db.settings?.customModels?.[id]) {
    return false;
  }

  delete db.settings.customModels[id];
  if (db.settings.defaultModel === id) {
    db.settings.defaultModel = EMPTY_DB.settings.defaultModel;
  }
  await writeStore(db);
  return true;
}

async function deleteModelConfig(id) {
  const db = await readStore();
  let changed = false;

  if (db.settings?.customModels?.[id]) {
    delete db.settings.customModels[id];
    changed = true;
  }

  if (db.settings?.modelOverrides?.[id]) {
    delete db.settings.modelOverrides[id];
    changed = true;
  }

  if (!changed) {
    return false;
  }

  if (db.settings.defaultModel === id && !db.settings.customModels?.[id]) {
    db.settings.defaultModel = EMPTY_DB.settings.defaultModel;
  }

  await writeStore(db);
  return true;
}

module.exports = {
  createConversation,
  updateConversationTitle,
  listConversations,
  deleteConversation,
  saveMessage,
  getHistory,
  getConversation,
  getSettings,
  setDefaultModel,
  upsertCustomModelConfig,
  upsertModelOverride,
  deleteCustomModelConfig,
  deleteModelConfig,
};
