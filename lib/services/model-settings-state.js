function formatSaveMessage(note = '') {
  const trimmed = String(note || '').trim();
  return trimmed
    ? `模型配置已保存，当前使用模型未改变。${trimmed}`
    : '模型配置已保存，当前使用模型未改变。';
}

function applyModelConfigSave({
  assistantModel,
  defaultModelId,
  formModelId,
  payload = {},
}) {
  return {
    assistantModel,
    defaultModelId: payload.defaultModel || defaultModelId,
    models: payload.models || [],
    savedModelId: formModelId,
    message: formatSaveMessage(payload.note),
  };
}

function applyDefaultModelUpdate({
  assistantModel,
  modelId,
  payload = {},
}) {
  return {
    assistantModel,
    defaultModelId: payload.defaultModel || modelId,
    models: payload.models || [],
    message: '默认模型已更新，当前使用模型未改变。',
  };
}

function formatTestPart(part, label, fallback) {
  if (part?.skipped) {
    return `${label}未执行：${part.message || fallback}`;
  }

  return part?.success
    ? `${label}可用：${part.message || '模型可用'}`
    : `${label}不可用：${part?.message || '测试失败'}`;
}

function createModelTestFeedback({
  assistantModel,
  payload = {},
}) {
  const text = payload.test?.text || {};
  const vision = payload.test?.vision || {};
  const textMessage = formatTestPart(text, '文本', '本次未测试文本能力');
  const visionMessage = formatTestPart(vision, '视觉', '未测试视觉能力');
  const independenceNote = text.success && !vision.success
    ? '文本模型仍可用于写作、文献和文本翻译；视觉失败只影响图片页 PDF 翻译。'
    : '';

  return {
    assistantModel,
    test: payload.test || {},
    message: `测试完成。${textMessage}；${visionMessage}${independenceNote ? `。${independenceNote}` : ''}`,
  };
}

module.exports = {
  applyDefaultModelUpdate,
  applyModelConfigSave,
  createModelTestFeedback,
};
