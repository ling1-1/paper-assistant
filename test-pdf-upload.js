#!/usr/bin/env node
// 测试 PDF 上传 API

const fs = require('fs');
const path = require('path');

async function testPdfUpload() {
  const testPdfPath = path.join(__dirname, 'uploads/test-paper.pdf');
  
  if (!fs.existsSync(testPdfPath)) {
    console.error('❌ 测试 PDF 文件不存在:', testPdfPath);
    process.exit(1);
  }

  console.log('🧪 测试 PDF 上传 API...\n');
  
  try {
    // 读取 PDF 文件为 base64
    const pdfBuffer = fs.readFileSync(testPdfPath);
    const base64 = pdfBuffer.toString('base64');
    const dataUrl = `data:application/pdf;base64,${base64}`;

    const response = await fetch('http://localhost:3000/api/upload-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: dataUrl,
        filename: 'test-paper.pdf',
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || result.message || 'PDF 上传失败');
    }

    console.log('✅ PDF 上传成功!\n');
    console.log('📄 文件名:', result.originalFilename);
    console.log('📊 页数:', result.totalPages);
    console.log('✏️ 字符数:', result.text?.length || 0);
    console.log('\n📝 提取文本预览:');
    console.log(result.text?.substring(0, 200) + '...');
  } catch (err) {
    console.error('❌ 测试失败:', err.message);
    process.exit(1);
  }
}

testPdfUpload();
