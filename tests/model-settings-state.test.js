const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyDefaultModelUpdate,
  applyModelConfigSave,
  createModelTestFeedback,
} = require('../lib/services/model-settings-state');

test('applyModelConfigSave preserves the current model after saving another model', () => {
  const result = applyModelConfigSave({
    assistantModel: 'doubao',
    defaultModelId: 'doubao',
    formModelId: 'custom-vision',
    payload: {
      models: [{ id: 'custom-vision' }],
      defaultModel: 'doubao',
      note: '视觉模型已单独配置。',
    },
  });

  assert.equal(result.assistantModel, 'doubao');
  assert.equal(result.defaultModelId, 'doubao');
  assert.equal(result.message, '模型配置已保存，当前使用模型未改变。视觉模型已单独配置。');
});

test('applyDefaultModelUpdate does not silently switch the current session model', () => {
  const result = applyDefaultModelUpdate({
    assistantModel: 'doubao',
    modelId: 'qwen',
    payload: {
      models: [{ id: 'qwen' }],
      defaultModel: 'qwen',
    },
  });

  assert.equal(result.assistantModel, 'doubao');
  assert.equal(result.defaultModelId, 'qwen');
  assert.equal(result.message, '默认模型已更新，当前使用模型未改变。');
});

test('createModelTestFeedback summarizes text and vision without changing active model', () => {
  const result = createModelTestFeedback({
    assistantModel: 'doubao',
    payload: {
      test: {
        text: { success: true, message: '模型可用' },
        vision: { success: false, message: 'Upstream request failed' },
      },
    },
  });

  assert.equal(result.assistantModel, 'doubao');
  assert.match(result.message, /文本可用：模型可用/);
  assert.match(result.message, /视觉不可用：Upstream request failed/);
  assert.match(result.message, /视觉失败只影响图片页 PDF 翻译/);
});
