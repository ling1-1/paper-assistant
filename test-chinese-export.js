#!/usr/bin/env node
// 测试 PDF 导出中文效果

const PdfPrinter = require('pdfmake');
const fs = require('fs');
const path = require('path');

// 使用默认字体（不支持中文）
const printer = new PdfPrinter({});

async function testChinesePdfExport() {
  console.log('🧪 测试 PDF 导出中文效果...\n');
  
  const docDefinition = {
    content: [
      {
        text: '📚 论文翻译测试',
        style: 'header',
        alignment: 'center',
      },
      {
        text: '\n测试时间：' + new Date().toLocaleString('zh-CN'),
        style: 'meta',
      },
      {
        text: '\n────────────────────────────────────────\n',
        style: 'separator',
      },
      {
        text: '📝 原文',
        style: 'sectionTitle',
        margin: [0, 15, 0, 5],
      },
      {
        text: 'This is a test paper about machine learning and artificial intelligence. The quick brown fox jumps over the lazy dog.',
        style: 'originalText',
      },
      {
        text: '🌐 译文',
        style: 'sectionTitle',
        margin: [0, 15, 0, 5],
      },
      {
        text: '这是一篇关于机器学习和人工智能的测试论文。快速棕狐跳过懒狗。中文测试：火山方舟 API、PDF 导出、双语对照。',
        style: 'translatedText',
      },
      {
        text: '\n\n────────────────────────────────────────\n由 Paper Assistant 生成',
        style: 'footer',
        alignment: 'center',
      },
    ],
    styles: {
      header: {
        fontSize: 24,
        bold: true,
        color: '#2563eb',
        alignment: 'center',
      },
      meta: {
        fontSize: 10,
        color: '#6b7280',
        italics: true,
      },
      separator: {
        fontSize: 8,
        color: '#d1d5db',
        margin: [0, 10, 0, 10],
      },
      sectionTitle: {
        fontSize: 14,
        bold: true,
        color: '#059669',
      },
      originalText: {
        fontSize: 10,
        font: 'Helvetica',
        color: '#1f2937',
        lineHeight: 1.5,
      },
      translatedText: {
        fontSize: 10,
        font: 'Helvetica',
        color: '#1f2937',
        lineHeight: 1.5,
      },
      footer: {
        fontSize: 8,
        color: '#9ca3af',
        italics: true,
      },
    },
    pageMargins: [40, 60, 40, 60],
    pageSize: 'A4',
  };

  try {
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    const chunks = [];
    pdfDoc.on('data', (chunk) => chunks.push(chunk));
    const buffer = await new Promise((resolve, reject) => {
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.end();
    });

    const outputPath = path.join(__dirname, 'test-chinese-export.pdf');
    fs.writeFileSync(outputPath, buffer);
    
    console.log('✅ PDF 生成成功！');
    console.log(`📄 文件位置：${outputPath}`);
    console.log(`📊 文件大小：${(buffer.length / 1024).toFixed(2)} KB\n`);
    
    console.log('⚠️  注意：当前使用 Helvetica 字体，中文可能显示为方框');
    console.log('💡 解决方案：需要添加中文字体（如 STHeiti）到 pdfmake 的 vfs_fonts 中\n');
    
  } catch (err) {
    console.error('❌ PDF 生成失败:', err.message);
    process.exit(1);
  }
}

testChinesePdfExport();
