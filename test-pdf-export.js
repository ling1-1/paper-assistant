// test-pdf-export.js — PDF 导出功能测试脚本
const fs = require('fs');
const path = require('path');

const TEST_PDF_PATH = path.join(__dirname, 'uploads', 'test-paper.pdf');

/**
 * 生成测试 PDF 文件（如果不存在）
 */
function createTestPdf() {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
  
  return (async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    // 绘制测试内容
    page.drawText('Test Paper - Abstract', {
      x: 50,
      y: 750,
      size: 18,
      font,
      color: rgb(0, 0, 0.8),
    });
    
    page.drawText('This is a test PDF document for translation.', {
      x: 50,
      y: 700,
      size: 12,
      font,
    });
    
    page.drawText('Machine learning is a subset of artificial intelligence.', {
      x: 50,
      y: 670,
      size: 12,
      font,
    });
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(TEST_PDF_PATH, pdfBytes);
    console.log('✅ 测试 PDF 已创建:', TEST_PDF_PATH);
    return Buffer.from(pdfBytes);
  })();
}

/**
 * 测试 PDF 导出 API
 */
async function testPdfExport() {
  console.log('\n🧪 开始测试 PDF 导出功能...\n');
  
  // 确保测试 PDF 存在
  if (!fs.existsSync(TEST_PDF_PATH)) {
    console.log('📄 创建测试 PDF...');
    await createTestPdf();
  }
  
  // 读取测试 PDF
  const pdfBuffer = fs.readFileSync(TEST_PDF_PATH);
  const pdfBase64 = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  
  // 测试数据
  const testData = {
    originalText: 'This is a test paper about machine learning.',
    translatedText: '这是一篇关于机器学习的测试论文。\n\n机器学习是人工智能的一个子集。\n\n它使用算法来从数据中学习模式。\n\n深度学习是机器学习的一个重要分支。',
    filename: 'test-paper.pdf',
    sourceLang: 'en',
    targetLang: 'zh',
    mode: 'translate',
    pdfBase64,
  };
  
  console.log('📤 调用 /api/export-pdf...');
  
  try {
    const response = await fetch('http://localhost:3000/api/export-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData),
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('❌ 导出失败:', result.error || result.message);
      process.exit(1);
    }
    
    console.log('✅ 导出成功!');
    console.log('   文件名:', result.filename);
    console.log('   页数:', result.pages);
    console.log('   路径:', result.filepath);
    
    // 验证文件存在
    if (result.filepath && fs.existsSync(result.filepath)) {
      const stats = fs.statSync(result.filepath);
      console.log('   大小:', (stats.size / 1024).toFixed(2), 'KB');
      console.log('\n✅ 所有测试通过!');
    } else {
      console.warn('⚠️  文件未保存到磁盘（可能只返回了 base64）');
    }
    
  } catch (err) {
    console.error('❌ 测试失败:', err.message);
    console.error('   请确保服务正在运行：npm run dev');
    process.exit(1);
  }
}

// 运行测试
testPdfExport().catch(err => {
  console.error('❌ 意外错误:', err);
  process.exit(1);
});
