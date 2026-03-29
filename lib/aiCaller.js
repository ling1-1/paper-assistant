// lib/aiCaller.js v2 — 支持流式输出 + 多模型

// ── 非流式调用 ────────────────────────────────────────
async function callAI(messages, systemPrompt, model = 'claude') {
  switch (model) {
    case 'claude':    return callClaude(messages, systemPrompt);
    case 'deepseek':  return callOpenAICompat(messages, systemPrompt, 'deepseek');
    case 'doubao':    return callOpenAICompat(messages, systemPrompt, 'doubao');
    case 'qwen':      return callOpenAICompat(messages, systemPrompt, 'qwen');
    default:          return callClaude(messages, systemPrompt);
  }
}

// ── 流式调用（onChunk 回调接收文本片段）──────────────
async function callAIStream(messages, systemPrompt, model = 'claude', onChunk) {
  switch (model) {
    case 'claude':    return callClaudeStream(messages, systemPrompt, onChunk);
    case 'deepseek':
    case 'doubao':
    case 'qwen':      return callOpenAIStream(messages, systemPrompt, model, onChunk);
    default:          return callClaudeStream(messages, systemPrompt, onChunk);
  }
}

// ── Claude ────────────────────────────────────────────
async function callClaude(messages, systemPrompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('未配置 ANTHROPIC_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: systemPrompt, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

async function callClaudeStream(messages, systemPrompt, onChunk) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('未配置 ANTHROPIC_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: systemPrompt, messages, stream: true }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Claude ${res.status}: ${t}`); }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;
      try {
        const ev = JSON.parse(raw);
        if (ev.type === 'content_block_delta' && ev.delta?.text) onChunk(ev.delta.text);
      } catch {}
    }
  }
}

// ── OpenAI 兼容（DeepSeek / 火山 / 通义）─────────────
const OPENAI_COMPAT = {
  deepseek: { url: 'https://api.deepseek.com/chat/completions',                            keyEnv: 'DEEPSEEK_API_KEY',  model: 'deepseek-chat' },
  doubao:   { url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',             keyEnv: 'VOLC_API_KEY',      model: () => process.env.VOLC_MODEL || 'doubao-pro-32k' },
  qwen:     { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',   keyEnv: 'DASHSCOPE_API_KEY', model: 'qwen-plus' },
};

async function callOpenAICompat(messages, systemPrompt, provider) {
  const cfg = OPENAI_COMPAT[provider];
  const key = process.env[cfg.keyEnv];
  if (!key) throw new Error(`未配置 ${cfg.keyEnv}`);
  const modelId = typeof cfg.model === 'function' ? cfg.model() : cfg.model;

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: modelId, max_tokens: 4096, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function callOpenAIStream(messages, systemPrompt, provider, onChunk) {
  const cfg = OPENAI_COMPAT[provider];
  const key = process.env[cfg.keyEnv];
  if (!key) throw new Error(`未配置 ${cfg.keyEnv}`);
  const modelId = typeof cfg.model === 'function' ? cfg.model() : cfg.model;

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: modelId, max_tokens: 4096, stream: true, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`${provider} ${res.status}: ${t}`); }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;
      try {
        const ev = JSON.parse(raw);
        const text = ev.choices?.[0]?.delta?.content;
        if (text) onChunk(text);
      } catch {}
    }
  }
}

module.exports = { callAI, callAIStream };
