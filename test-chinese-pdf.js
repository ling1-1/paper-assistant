// 测试中文 PDF 导出
import pdfMake from 'pdfmake/build/pdfmake.js';
import * as fontkit from 'fontkit';
import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 配置 fontkit 和中文字体
pdfMake.fontkit = fontkit.default || fontkit;
pdfMake.fonts = {
  'STHeiti': {
    normal: '/System/Library/Fonts/STHeiti Light.ttc',
    bold: '/System/Library/Fonts/STHeiti Medium.ttc',
  },
};

// 测试文档
const docDefinition = {
  content: [
    { text: '中文 PDF 测试', style: 'header' },
    { text: '\n这是一段中文测试文本。', style: 'content' },
    { text: 'Paper Assistant - 论文翻译工具', style: 'content' },
    { text: '\n英文测试：The quick brown fox jumps over the lazy dog.', style: 'content' },
    { text: '\n混合测试：AI 编程 + 效率工具 = 生产力提升', style: 'content' },
  ],
  styles: {
    header: {
      fontSize: 18,
      bold: true,
      font: 'STHeiti',
      margin: [0, 0, 0, 10],
    },
    content: {
      fontSize: 12,
      font: 'STHeiti',
      lineHeight: 1.5,
    },
  },
};

// 生成 PDF
const pdfDoc = pdfMake.createPdf(docDefinition);

// 保存文件
pdfDoc.getBuffer(async (buffer) => {
  const filepath = join(__dirname, 'test-chinese-output.pdf');
  await writeFile(filepath, buffer);
  console.log(`✅ PDF 已生成：${filepath}`);
  console.log(`📄 文件大小：${buffer.length} bytes`);
  
  // 验证文件是否存在
  if (existsSync(filepath)) {
    console.log('✅ 文件存在，可以打开查看');
  } else {
    console.error('❌ 文件生成失败');
  }
});
