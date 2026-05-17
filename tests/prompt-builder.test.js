const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAssistantIntentPrompt,
  buildPdfVisionBatchPrompt,
  buildPdfVisionPrompt,
} = require('../lib/services/prompt-builder');

test('assistant intent prompt includes selected intent and context flags', () => {
  const prompt = buildAssistantIntentPrompt({
    mode: 'general',
    intent: 'outline',
    contextFlags: {
      withLiterature: true,
      isDraftingTask: true,
    },
  });

  assert.match(prompt, /结构设计|章节框架/);
  assert.match(prompt, /文献上下文/);
  assert.match(prompt, /写作任务/);
});

test('pdf vision prompt includes page and translation direction', () => {
  const prompt = buildPdfVisionPrompt({
    sourceLang: 'en',
    targetLang: 'zh',
    field: 'computer',
    pageNumber: 2,
    totalPages: 5,
  });

  assert.match(prompt, /2\/5/);
  assert.match(prompt, /计算机科学/);
  assert.match(prompt, /英文/);
  assert.match(prompt, /中文/);
});

test('pdf vision batch prompt describes page range and avoids garbage transcription', () => {
  const prompt = buildPdfVisionBatchPrompt({
    sourceLang: 'en',
    targetLang: 'zh',
    field: 'chemistry',
    pages: [{ pageNumber: 1 }, { pageNumber: 2 }, { pageNumber: 3 }],
    totalPages: 6,
  });

  assert.match(prompt, /1-3\/6/);
  assert.match(prompt, /化学化工/);
  assert.match(prompt, /不要逐字复写乱码/);
  assert.match(prompt, /参考文献/);
});
