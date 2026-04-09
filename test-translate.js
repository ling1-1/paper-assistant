#!/usr/bin/env node
// 测试翻译 API

const testText = `
Machine learning is a subset of artificial intelligence that focuses on developing 
algorithms and statistical models that enable computer systems to improve their 
performance on a specific task through experience. Instead of being explicitly 
programmed to perform a task, these systems learn patterns from data and make 
predictions or decisions based on that learning.
`;

async function testTranslate() {
  console.log('🧪 测试翻译 API...\n');
  console.log('📝 原文:\n', testText.trim(), '\n');

  try {
    const response = await fetch('http://localhost:3000/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        mode: 'translate',
        sourceLang: 'en',
        targetLang: 'zh',
        field: 'cs',
        stream: false,
        model: 'doubao',
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ 翻译结果:\n', data.translation, '\n');
    console.log('🎯 模式:', data.mode);
    console.log('🌐 方向:', data.sourceLang, '→', data.targetLang);
  } catch (err) {
    console.error('❌ 测试失败:', err.message);
    process.exit(1);
  }
}

testTranslate();
