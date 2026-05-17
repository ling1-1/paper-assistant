const { callModel, streamModel } = require('./services/model-client');

async function callAI(messages, systemPrompt, model = 'doubao') {
  const result = await callModel(messages, systemPrompt, model);
  return result.text;
}

async function callAIStream(messages, systemPrompt, model = 'doubao', onChunk) {
  return streamModel(messages, systemPrompt, model, onChunk);
}

module.exports = {
  callAI,
  callAIStream,
};
