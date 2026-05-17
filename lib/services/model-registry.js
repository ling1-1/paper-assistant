const { getSettings } = require('../db');

const BUILTIN_MODELS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    provider: 'anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    textModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    visionModel: process.env.ANTHROPIC_VISION_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    supportsVision: true,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'openai-compatible',
    apiStyle: 'chat-completions',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    textModel: process.env.DEEPSEEK_TEXT_MODEL || 'deepseek-chat',
    visionModel: process.env.DEEPSEEK_VISION_MODEL || 'deepseek-vl2',
    supportsVision: true,
  },
  doubao: {
    id: 'doubao',
    label: '火山方舟',
    provider: 'openai-compatible',
    apiStyle: 'chat-completions',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    apiKeyEnv: 'VOLC_API_KEY',
    textModel: process.env.VOLC_MODEL || 'doubao-pro-32k',
    visionModel: process.env.VOLC_VISION_MODEL || process.env.VOLC_MODEL || 'doubao-1-5-vision-pro-32k',
    supportsVision: true,
  },
  qwen: {
    id: 'qwen',
    label: '通义千问',
    provider: 'openai-compatible',
    apiStyle: 'chat-completions',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    textModel: process.env.QWEN_TEXT_MODEL || 'qwen-plus',
    visionModel: process.env.QWEN_VISION_MODEL || 'qwen-vl-plus',
    supportsVision: true,
  },
};

function inferApiStyle(model = {}) {
  if (model.apiStyle) return model.apiStyle;
  return String(model.baseUrl || '').includes('/responses') ? 'responses' : 'chat-completions';
}

function sanitizeModel(model, source = 'builtin') {
  const hasSavedKey = Boolean(model.apiKey);
  const hasEnvKey = model.apiKeyEnv ? Boolean(process.env[model.apiKeyEnv]) : false;
  const configured = hasSavedKey || hasEnvKey;

  return {
    id: model.id,
    label: model.label,
    provider: model.provider,
    apiStyle: inferApiStyle(model),
    source,
    configured,
    supportsVision: Boolean(model.supportsVision),
    textModel: model.textModel || '',
    visionModel: model.visionModel || '',
    baseUrl: model.baseUrl || '',
    missing: configured ? [] : ['apiKey'],
    apiKeyPreview: configured
      ? source === 'builtin'
        ? hasSavedKey
          ? maskApiKey(model.apiKey)
          : `${model.apiKeyEnv} 已配置`
        : maskApiKey(model.apiKey)
      : source === 'builtin'
        ? `${model.apiKeyEnv} 未配置`
        : '未配置',
  };
}

function maskApiKey(value = '') {
  if (!value) return '未配置';
  if (value.length <= 8) return '已保存';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function getModelRegistry() {
  const settings = await getSettings();
  const overrides = settings.modelOverrides || {};
  const customModels = Object.values(settings.customModels || {}).map((item) => ({
    id: item.id,
    label: item.label,
    provider: item.provider || 'openai-compatible',
    apiStyle: inferApiStyle(item),
    apiKey: item.apiKey || '',
    baseUrl: item.baseUrl || '',
    textModel: item.textModel || '',
    visionModel: item.visionModel || '',
    supportsVision: Boolean(item.supportsVision),
  }));

  const builtins = Object.values(BUILTIN_MODELS).map((item) => sanitizeModel({
    ...item,
    ...(overrides[item.id] || {}),
  }, 'builtin'));
  const customs = customModels.map((item) => sanitizeModel(item, 'custom'));

  return {
    defaultModel: settings.defaultModel || process.env.DEFAULT_MODEL || 'doubao',
    models: [...builtins, ...customs],
  };
}

async function resolveModelConfig(modelId) {
  const settings = await getSettings();
  const desiredId = modelId || settings.defaultModel || process.env.DEFAULT_MODEL || 'doubao';
  const overrides = settings.modelOverrides || {};

  if (BUILTIN_MODELS[desiredId]) {
    const builtin = BUILTIN_MODELS[desiredId];
    const override = overrides[desiredId] || {};
    return {
      ...builtin,
      ...override,
      apiKey: override.apiKey || process.env[builtin.apiKeyEnv] || '',
      apiStyle: inferApiStyle({ ...builtin, ...override }),
      configured: Boolean(override.apiKey || process.env[builtin.apiKeyEnv]),
      source: 'builtin',
    };
  }

  const custom = settings.customModels?.[desiredId];
  if (custom) {
    return {
      id: custom.id,
      label: custom.label,
      provider: custom.provider || 'openai-compatible',
      apiStyle: inferApiStyle(custom),
      baseUrl: custom.baseUrl,
      apiKey: custom.apiKey,
      textModel: custom.textModel,
      visionModel: custom.visionModel,
      supportsVision: Boolean(custom.supportsVision),
      configured: Boolean(custom.apiKey && custom.baseUrl && custom.textModel),
      source: 'custom',
    };
  }

  const fallback = BUILTIN_MODELS[settings.defaultModel] || BUILTIN_MODELS.doubao;
  const fallbackOverride = overrides[fallback.id] || {};
  return {
    ...fallback,
    ...fallbackOverride,
    apiKey: fallbackOverride.apiKey || process.env[fallback.apiKeyEnv] || '',
    apiStyle: inferApiStyle({ ...fallback, ...fallbackOverride }),
    configured: Boolean(fallbackOverride.apiKey || process.env[fallback.apiKeyEnv]),
    source: 'builtin',
  };
}

function describeVisionFallback(reason = '') {
  if (!reason) return '当前视觉翻译链路不可用，系统已自动回退到文本提取翻译。';

  if (reason.includes('未配置')) {
    return '当前未配置可用的视觉模型或密钥，系统已自动回退到文本提取翻译。';
  }

  if (reason.includes('page limit') || reason.includes('页数')) {
    return '当前 PDF 超出图片页视觉翻译范围，系统已自动回退到文本提取翻译。';
  }

  return '图片页视觉翻译暂时不可用，系统已自动回退到文本提取翻译。';
}

function normalizeModelConfigInput(config = {}) {
  const next = { ...config };
  const rawBaseUrl = String(config.baseUrl || '').trim();
  next.apiStyle = String(config.apiStyle || '').trim() || (rawBaseUrl.includes('/responses') ? 'responses' : 'chat-completions');
  let note = '';

  if (rawBaseUrl.includes('build.nvidia.com')) {
    next.baseUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';
    next.apiStyle = 'chat-completions';

    const match = rawBaseUrl.match(/build\.nvidia\.com\/([^/]+)\/([^/?#]+)/);
    if (match) {
      const derivedModel = `${match[1]}/${match[2]}`;
      if (!next.textModel) next.textModel = derivedModel;
      if (!next.visionModel && next.supportsVision) next.visionModel = derivedModel;
    }

    note = '检测到你填写的是 NVIDIA Build 页面地址，已自动改成官方 OpenAI 兼容接口 `https://integrate.api.nvidia.com/v1/chat/completions`。通常不需要额外代理。';
  } else if (/\/responses\/?$/.test(rawBaseUrl)) {
    next.apiStyle = 'responses';
    note = '检测到你填写的是 `responses` 地址，已按 Responses 协议保存。';
  }

  return {
    config: next,
    note,
  };
}

module.exports = {
  BUILTIN_MODELS,
  getModelRegistry,
  resolveModelConfig,
  describeVisionFallback,
  normalizeModelConfigInput,
};
