import {
  deleteModelConfig,
  setDefaultModel,
  upsertModelOverride,
  upsertCustomModelConfig,
} from '../../lib/db';
import { getModelRegistry, normalizeModelConfigInput, resolveModelConfig } from '../../lib/services/model-registry';
import { callModel, callVisionModel } from '../../lib/services/model-client';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const registry = await getModelRegistry();
    return res.status(200).json(registry);
  }

  if (req.method === 'POST') {
    const action = req.query.action || 'upsert';

    try {
      if (action === 'default') {
        const { modelId } = req.body || {};
        const settings = await setDefaultModel(modelId);
        const registry = await getModelRegistry();
        return res.status(200).json({ success: true, settings, ...registry });
      }

      if (action === 'delete') {
        const { id } = req.body || {};
        await deleteModelConfig(id);
        const registry = await getModelRegistry();
        return res.status(200).json({ success: true, ...registry });
      }

      if (action === 'test') {
        const { modelId, capability = 'both' } = req.body || {};
        const config = await resolveModelConfig(modelId);
        const shouldTestText = capability === 'both' || capability === 'text';
        const shouldTestVision = capability === 'both' || capability === 'vision';

        let text = { success: false, skipped: false, message: '未测试文本能力' };
        if (shouldTestText) {
          try {
            const textResult = await callModel(
              [{ role: 'user', content: '请只返回“模型可用”。' }],
              '你是一个模型连通性测试器，只返回简短确认。',
              modelId,
            );
            text = {
              success: true,
              skipped: false,
              model: textResult.model,
              message: (textResult.text || '模型可用').slice(0, 80),
            };
          } catch (error) {
            text = {
              success: false,
              skipped: false,
              message: error.message || '文本模型测试失败',
            };
          }
        } else {
          text = { success: false, skipped: true, message: '本次未测试文本能力' };
        }

        let vision = { success: false, skipped: true, message: '未测试视觉能力' };
        if (!shouldTestVision) {
          vision = {
            success: false,
            skipped: true,
            message: '本次未测试视觉能力。',
          };
        } else if (!config.supportsVision) {
          vision = {
            success: false,
            skipped: true,
            message: '当前模型未启用视觉能力。',
          };
        } else if (!config.apiKey) {
          vision = {
            success: false,
            skipped: true,
            message: '当前模型支持视觉，但没有配置这个模型自己的 API Key，因此无法实际测试视觉调用。',
          };
        } else {
          try {
            const tinyImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OoQ0AAAgDMP7/lwRBAmfMVNS3evaSSkBAQEBAQEBAQEBAQEBAIB14Li+g4i1RcsAAAAAASUVORK5CYII=';
            const visionResult = await callVisionModel({
              provider: modelId,
              prompt: '请只返回“视觉模型可用”。',
              images: [tinyImage],
              strict: true,
            });
            vision = {
              success: true,
              skipped: false,
              model: visionResult.model,
              message: (visionResult.text || '视觉模型可用').slice(0, 80),
            };
          } catch (error) {
            vision = {
              success: false,
              skipped: false,
              message: error.message || '视觉模型测试失败',
            };
          }
        }

        return res.status(200).json({
          success: true,
          test: {
            text,
            vision,
          },
        });
      }

      if (action === 'override') {
        const { id, ...rest } = req.body || {};
        const prepared = normalizeModelConfigInput(rest);
        const saved = await upsertModelOverride(id, prepared.config);
        const registry = await getModelRegistry();
        return res.status(200).json({ success: true, model: saved, note: prepared.note, ...registry });
      }

      const prepared = normalizeModelConfigInput(req.body || {});
      const saved = await upsertCustomModelConfig(prepared.config);
      const registry = await getModelRegistry();
      return res.status(200).json({ success: true, model: saved, note: prepared.note, ...registry });
    } catch (error) {
      return res.status(400).json({ error: error.message || '模型配置失败' });
    }
  }

  return res.status(405).json({ error: '仅支持 GET / POST 请求' });
}
