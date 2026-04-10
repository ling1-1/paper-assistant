// 测试中文 PDF 导出 - CommonJS 版本 v2
const pdfMake = require('pdfmake/build/pdfmake.js');
const fontkit = require('fontkit');
const fs = require('fs');
const path = require('path');

// 配置 fontkit
pdfMake.fontkit = fontkit;

// 读取字体文件
const fontPath = '/System/Library/Fonts/STHeiti Light.ttc';
console.log('正在读取字体文件:', fontPath);
const fontData = fs.readFileSync(fontPath);
console.log('字体文件大小:', fontData.length, 'bytes');

// 创建自定义 vfs - 使用 base64 编码
const vfs_fonts = {
  'STHeiti-Light.ttf': fontData.toString('base64'),
};

// 设置 vfs
pdfMake.vfs = vfs_fonts;

// 设置字体映射
pdfMake.fonts = {
  STHeiti: {
    normal: 'STHeiti-Light.ttf',
    bold: 'STHeiti-Light.ttf',
    italics: 'STHeiti-Light.ttf',
    bolditalics: 'STHeiti-Light.ttf',
  },
};

console.log('VFS 中的字体:', Object.keys(pdfMake.vfs));
console.log('字体配置:', pdfMake.fonts);

// 测试文档
const docDefinition = {
  content: [
    { text: '中文 PDF 测试', style: 'header' },
    { text: '\n这是一段中文测试文本。', style: 'content' },
    { text: 'Paper Assistant - 论文翻译工具', style: 'content' },
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

console.log('开始生成 PDF...');

// 生成 PDF
const pdfDoc = pdfMake.createPdf(docDefinition);

// 保存文件
pdfDoc.getBuffer((buffer) => {
  const filepath = path.join(__dirname, 'test-chinese-output.pdf');
  fs.writeFileSync(filepath, buffer);
  console.log(`✅ PDF 已生成：${filepath}`);
  console.log(`📄 文件大小：${buffer.length} bytes`);
  
  if (fs.existsSync(filepath)) {
    console.log('✅ 文件存在，可以打开查看');
  } else {
    console.error('❌ 文件生成失败');
  }
});
