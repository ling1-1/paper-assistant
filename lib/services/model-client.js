const { resolveModelConfig } = require('./model-registry');

const VISION_MAX_TOKENS = Number(process.env.VISION_MAX_TOKENS || 8192);

async function parseJsonSafe(response) {
  const rawText = await response.text();
  try {
    return {
      rawText,
      payload: rawText ? JSON.parse(rawText) : {},
    };
  } catch {
    return {
      rawText,
      payload: null,
    };
  }
}

function buildProviderError(label, response, parsed, fallback) {
  if (response?.url?.includes('build.nvidia.com')) {
    return '当前填写的是 NVIDIA Build 模型展示页，不是可直接调用的 API 地址。请改用 `https://integrate.api.nvidia.com/v1/chat/completions`。';
  }
  const payloadMessage = parsed.payload?.error?.message || parsed.payload?.message;
  if (payloadMessage) {
    return payloadMessage;
  }
  if (parsed.rawText?.trim()) {
    if (parsed.rawText.includes('<!DOCTYPE html') || parsed.rawText.includes('<html')) {
      return `${label} 返回了 HTML 页面而不是 OpenAI 兼容 JSON。请检查接口地址是否填成了网页地址。`;
    }
    return `${label} 返回了非标准响应：${parsed.rawText.trim().slice(0, 120)}`;
  }
  return `${fallback}：${response.status}`;
}

function formatModelError(label, error) {
  return `${label}: ${error.message || '调用失败'}`;
}

function extractCompatContent(payload) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || item?.content || '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function extractResponsesContent(payload) {
  if (typeof payload.output_text === 'string') {
    return payload.output_text;
  }

  if (typeof payload.content === 'string') {
    return payload.content;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((part) => part.text || part.output_text || part.content || '')
    .filter(Boolean)
    .join('\n');
}

function toResponsesInput(messages, systemPrompt) {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

function buildResponsesVisionInput({ prompt, images = [] }) {
  return [{
    role: 'user',
    content: [
      { type: 'input_text', text: prompt },
      ...images.map((imageUrl) => ({
        type: 'input_image',
        image_url: imageUrl,
      })),
    ],
  }];
}

async function callClaude(messages, systemPrompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('未配置 ANTHROPIC_API_KEY');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    }),
  });
  const parsed = await parseJsonSafe(response);
  const payload = parsed.payload || {};
  if (!response.ok || payload.error || !parsed.payload) {
    throw new Error(buildProviderError('Claude', response, parsed, 'Claude 调用失败'));
  }
  return payload.content?.[0]?.text || '';
}

async function callClaudeStream(messages, systemPrompt, onChunk) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('未配置 ANTHROPIC_API_KEY');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude 调用失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;

      try {
        const payload = JSON.parse(raw);
        if (payload.type === 'content_block_delta' && payload.delta?.text) {
          onChunk(payload.delta.text);
        }
      } catch {
      }
    }
  }
}

async function callCompat(messages, systemPrompt, provider) {
  const config = await resolveModelConfig(provider);
  const key = config.apiKey;
  if (!key) {
    throw new Error(`模型 ${config.label || provider} 未配置 API Key`);
  }
  if (!config.baseUrl) {
    throw new Error(`模型 ${config.label || provider} 未配置 baseUrl`);
  }

  const model = config.textModel;
  if (config.apiStyle === 'responses') {
    return callResponses(messages, systemPrompt, config);
  }

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });
  const parsed = await parseJsonSafe(response);
  const payload = parsed.payload || {};
  if (!response.ok || payload.error || !parsed.payload) {
    throw new Error(buildProviderError(config.label || provider, response, parsed, `${provider} 调用失败`));
  }

  return {
    text: extractCompatContent(payload),
    model,
  };
}

async function callResponses(messages, systemPrompt, config) {
  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.textModel,
      max_output_tokens: 4096,
      input: toResponsesInput(messages, systemPrompt),
    }),
  });
  const parsed = await parseJsonSafe(response);
  const payload = parsed.payload || {};
  if (!response.ok || payload.error || !parsed.payload) {
    throw new Error(buildProviderError(config.label || config.id, response, parsed, `${config.label || config.id} 调用失败`));
  }

  return {
    text: extractResponsesContent(payload),
    model: config.textModel,
  };
}

async function callCompatStream(messages, systemPrompt, provider, onChunk) {
  const config = await resolveModelConfig(provider);
  const key = config.apiKey;
  if (!key) {
    throw new Error(`模型 ${config.label || provider} 未配置 API Key`);
  }
  if (!config.baseUrl) {
    throw new Error(`模型 ${config.label || provider} 未配置 baseUrl`);
  }

  const model = config.textModel;
  if (config.apiStyle === 'responses') {
    const result = await callResponses(messages, systemPrompt, config);
    if (result.text) onChunk(result.text);
    return { model: result.model };
  }

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });

  if (!response.ok) {
    throw new Error(`${provider} 调用失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') {
        return { model };
      }
      try {
        const payload = JSON.parse(raw);
        const text = payload.choices?.[0]?.delta?.content;
        if (text) onChunk(text);
      } catch {
      }
    }
  }

  return { model };
}

async function callModel(messages, systemPrompt, provider = process.env.DEFAULT_MODEL || 'doubao') {
  if (provider === 'claude') {
    return {
      text: await callClaude(messages, systemPrompt),
      model: 'claude-sonnet-4-20250514',
    };
  }

  return callCompat(messages, systemPrompt, provider);
}

async function streamModel(messages, systemPrompt, provider = process.env.DEFAULT_MODEL || 'doubao', onChunk) {
  if (provider === 'claude') {
    await callClaudeStream(messages, systemPrompt, onChunk);
    return { model: 'claude-sonnet-4-20250514' };
  }

  return callCompatStream(messages, systemPrompt, provider, onChunk);
}

function buildCompatVisionMessages({ prompt, images = [] }) {
  return [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      ...images.map((imageUrl) => ({
        type: 'image_url',
        image_url: { url: imageUrl },
      })),
    ],
  }];
}

function buildClaudeVisionMessages({ prompt, images = [] }) {
  return [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      ...images.map((imageUrl) => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
          data: imageUrl.split(',').pop(),
        },
      })),
    ],
  }];
}

async function callClaudeVision({ prompt, images = [] }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('未配置 ANTHROPIC_API_KEY');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: VISION_MAX_TOKENS,
      messages: buildClaudeVisionMessages({ prompt, images }),
    }),
  });

  const parsed = await parseJsonSafe(response);
  const payload = parsed.payload || {};
  if (!response.ok || payload.error || !parsed.payload) {
    throw new Error(buildProviderError('Claude 视觉模型', response, parsed, 'Claude 视觉调用失败'));
  }

  return {
    text: payload.content?.[0]?.text || '',
    model: process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-20250514',
  };
}

async function callCompatVision({ prompt, images = [], provider = process.env.DEFAULT_MODEL || 'doubao' }) {
  const config = await resolveModelConfig(provider);
  const key = config.apiKey;
  if (!key) {
    throw new Error(`模型 ${config.label || provider} 未配置 API Key`);
  }
  if (!config.baseUrl) {
    throw new Error(`模型 ${config.label || provider} 未配置 baseUrl`);
  }
  if (!config.supportsVision || !config.visionModel) {
    throw new Error(`模型 ${config.label || provider} 未配置视觉模型`);
  }

  const model = config.visionModel;
  if (config.apiStyle === 'responses') {
    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_output_tokens: VISION_MAX_TOKENS,
        input: buildResponsesVisionInput({ prompt, images }),
      }),
    });

    const parsed = await parseJsonSafe(response);
    const payload = parsed.payload || {};
    if (!response.ok || payload.error || !parsed.payload) {
      throw new Error(buildProviderError(config.label || provider, response, parsed, `${provider} 视觉调用失败`));
    }

    return {
      text: extractResponsesContent(payload),
      model,
    };
  }

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: VISION_MAX_TOKENS,
      messages: buildCompatVisionMessages({ prompt, images }),
    }),
  });

  const parsed = await parseJsonSafe(response);
  const payload = parsed.payload || {};
  if (!response.ok || payload.error || !parsed.payload) {
    throw new Error(buildProviderError(config.label || provider, response, parsed, `${provider} 视觉调用失败`));
  }

  return {
    text: extractCompatContent(payload),
    model,
  };
}

async function callVisionModel({
  prompt,
  images = [],
  provider = process.env.VISION_MODEL_PROVIDER || process.env.DEFAULT_MODEL || 'doubao',
  strict = false,
}) {
  if (strict) {
    if (provider === 'claude') {
      return callClaudeVision({ prompt, images });
    }
    return callCompatVision({ prompt, images, provider });
  }

  const tryProviders = Array.from(new Set([
    provider,
    process.env.VISION_MODEL_PROVIDER,
    'doubao',
    'qwen',
    'claude',
  ].filter(Boolean)));

  const errors = [];

  for (const candidate of tryProviders) {
    try {
      if (candidate === 'claude') {
        return await callClaudeVision({ prompt, images });
      }

      return await callCompatVision({ prompt, images, provider: candidate });
    } catch (error) {
      errors.push(formatModelError(candidate, error));
    }
  }

  throw new Error(errors.length ? errors.join('；') : '未找到可用的视觉模型');
}

module.exports = {
  callModel,
  streamModel,
  callVisionModel,
};
