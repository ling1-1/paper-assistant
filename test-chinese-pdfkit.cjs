// 测试中文 PDF 导出 - 使用 PDFKit + Noto Sans SC
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// 创建 PDF 文档
const doc = new PDFDocument({
  size: 'A4',
  margins: {
    top: 50,
    bottom: 50,
    left: 50,
    right: 50,
  },
});

// 注册中文字体 (Noto Sans SC)
const fontPath = '/tmp/NotoSansSC-Regular.ttf';
console.log('正在注册中文字体:', fontPath);
console.log('字体文件存在:', fs.existsSync(fontPath));

doc.registerFont('NotoSansSC', fontPath);

// 设置字体和大小
doc.font('NotoSansSC', 18);

// 添加标题
doc.text('中文 PDF 测试', { align: 'center' });

// 添加内容
doc.moveDown();
doc.font('NotoSansSC', 12);
doc.text('这是一段中文测试文本。');
doc.moveDown(0.5);
doc.text('Paper Assistant - 论文翻译工具');
doc.moveDown(0.5);
doc.text('英文测试：The quick brown fox jumps over the lazy dog.');
doc.moveDown(0.5);
doc.text('混合测试：AI 编程 + 效率工具 = 生产力提升');

// 保存文件
const filepath = path.join(__dirname, 'test-chinese-output-noto.pdf');
const stream = fs.createWriteStream(filepath);
doc.pipe(stream);

doc.end();

stream.on('finish', () => {
  console.log(`✅ PDF 已生成：${filepath}`);
  
  if (fs.existsSync(filepath)) {
    const stats = fs.statSync(filepath);
    console.log(`📄 文件大小：${stats.size} bytes`);
    console.log('✅ 文件存在，可以打开查看');
  } else {
    console.error('❌ 文件生成失败');
  }
});
