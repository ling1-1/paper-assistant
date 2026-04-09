// pages/api/export-pdf-overlay.js — PDF 覆盖导出（保留原排版）
import { PDFDocument, rgb } from 'pdf-lib';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const {
      originalPdfBase64,
      translatedText,
      filename = 'translation',
      originalFilename = 'original.pdf',
    } = req.body;

    if (!originalPdfBase64) {
      return res.status(400).json({ error: '未提供原始 PDF' });
    }

    if (!translatedText) {
      return res.status(400).json({ error: '未提供翻译文本' });
    }

    // 解析原始 PDF（处理 base64 或纯 base64 数据）
    let pdfBuffer;
    if (originalPdfBase64.startsWith('data:')) {
      pdfBuffer = Buffer.from(originalPdfBase64.split(',')[1], 'base64');
    } else {
      pdfBuffer = Buffer.from(originalPdfBase64, 'base64');
    }
    const uint8Array = new Uint8Array(pdfBuffer);

    // 使用 pdf-lib 加载 PDF
    const pdfDoc = await PDFDocument.load(uint8Array);
    const pages = pdfDoc.getPages();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // 简单策略：在每页底部添加翻译文本
    // TODO: 更智能的方案是按段落位置覆盖
    
    // 将翻译文本按页分割（简单按长度分割）
    const charsPerPage = 500; // 每页约 500 字符
    const textPages = [];
    for (let i = 0; i < translatedText.length; i += charsPerPage) {
      textPages.push(translatedText.slice(i, i + charsPerPage));
    }

    // 在每页添加翻译文本
    for (let i = 0; i < Math.min(textPages.length, pages.length); i++) {
      const page = pages[i];
      const { height } = page.getSize();
      const text = textPages[i];
      
      // 在页面底部添加半透明背景
      const lines = text.split('\n').filter(line => line.trim());
      const lineHeight = 12;
      const startY = height - 150; // 从页面 150px 处开始
      
      // 绘制背景
      page.drawRectangle({
        x: 50,
        y: startY - lines.length * lineHeight - 20,
        width: 500,
        height: lines.length * lineHeight + 40,
        color: rgb(0.95, 0.95, 1.0), // 浅蓝色背景
        opacity: 0.8,
      });

      // 添加翻译文本
      let y = startY;
      lines.forEach((line) => {
        if (line.trim()) {
          page.drawText(line, {
            x: 60,
            y,
            size: 10,
            font,
            color: rgb(0, 0, 0.5), // 深蓝色文字
            maxWidth: 480,
          });
          y -= lineHeight;
        }
      });

      // 添加标注
      page.drawText('[翻译]', {
        x: 500,
        y: startY,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    // 如果翻译文本超过原 PDF 页数，添加新页面
    for (let i = pages.length; i < textPages.length; i++) {
      const newPage = pdfDoc.addPage([595, 842]); // A4 尺寸
      const { height } = newPage.getSize();
      const text = textPages[i];
      
      // 绘制背景
      const lines = text.split('\n').filter(line => line.trim());
      const lineHeight = 12;
      const startY = height - 100;
      
      newPage.drawRectangle({
        x: 50,
        y: startY - lines.length * lineHeight - 20,
        width: 500,
        height: lines.length * lineHeight + 40,
        color: rgb(0.95, 0.95, 1.0),
        opacity: 0.8,
      });

      // 添加翻译文本
      let y = startY;
      lines.forEach((line) => {
        if (line.trim()) {
          newPage.drawText(line, {
            x: 60,
            y,
            size: 10,
            font,
            color: rgb(0, 0, 0.5),
            maxWidth: 480,
          });
          y -= lineHeight;
        }
      });
    }

    // 保存 PDF
    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);

    // 确保上传目录存在
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // 保存文件
    const safeFilename = `${Date.now()}-${filename.replace('.pdf', '')}-overlay.pdf`;
    const filepath = join(uploadDir, safeFilename);
    await writeFile(filepath, buffer);

    // 返回 base64
    const base64 = buffer.toString('base64');
    const downloadUrl = `data:application/pdf;base64,${base64}`;

    return res.status(200).json({
      success: true,
      filename: safeFilename,
      downloadUrl,
      filepath,
      totalPages: pdfDoc.getPageCount(),
    });
  } catch (err) {
    console.error('[export-pdf-overlay]', err);
    return res.status(500).json({
      error: err.message,
      message: 'PDF 导出失败',
    });
  }
}
