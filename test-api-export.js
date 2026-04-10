#!/usr/bin/env node
/**
 * 测试中文 PDF 导出 API
 */

import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 测试数据
const testData = {
  originalText: `This is a test paper about AI programming.

AI tools can help developers write code faster and more efficiently.`,
  translatedText: `这是一篇关于 AI 编程的测试论文。

AI 工具可以帮助开发者更快、更高效地编写代码。`,
  filename: 'test-chinese-export',
  mode: 'bilingual',
};

async function test() {
  console.log('🧪 开始测试中文 PDF 导出 API...\n');

  try {
    // 调用 API
    const response = await fetch('http://localhost:3000/api/export-pdf-better', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      console.log('✅ PDF 生成成功!');
      console.log(`📄 文件名：${result.filename}`);
      console.log(`📁 路径：${result.filepath}`);
      console.log(`🔗 下载链接长度：${result.downloadUrl.length} chars\n`);

      // 保存 PDF 文件
      const base64Data = result.downloadUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const outputPath = join(__dirname, 'test-api-output.pdf');
      await writeFile(outputPath, buffer);
      console.log(`✅ PDF 已保存到：${outputPath}`);
      console.log(`📊 文件大小：${buffer.length} bytes`);
    } else {
      console.error('❌ API 调用失败:');
      console.error(result);
    }
  } catch (err) {
    console.error('❌ 测试失败:', err.message);
    console.error('\n注意：需要确保 Next.js 开发服务器正在运行 (npm run dev)');
  }
}

test();
