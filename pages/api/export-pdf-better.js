// pages/api/export-pdf-better.js — PDF 导出（支持中文）
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

pdfMake.vfs = pdfFonts.pdfMake.vfs;

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
      originalText,
      translatedText,
      filename = 'translation',
      mode = 'bilingual', // bilingual | translated_only
    } = req.body;

    if (!translatedText) {
      return res.status(400).json({ error: '未提供翻译文本' });
    }

    // 分割文本为段落
    const originalParagraphs = originalText ? originalText.split('\n\n') : [];
    const translatedParagraphs = translatedText.split('\n\n');

    // 构建 PDF 内容
    const content = [];

    // 标题
    content.push({
      text: '📚 论文翻译',
      style: 'header',
      margin: [0, 0, 0, 20],
    });

    // 元信息
    content.push({
      text: `翻译时间：${new Date().toLocaleString('zh-CN')}\n模式：${mode === 'bilingual' ? '双语对照' : '仅译文'}`,
      style: 'meta',
      margin: [0, 0, 0, 20],
    });

    // 分隔线
    content.push({
      text: '────────────────────────────────────────',
      style: 'separator',
    });

    if (mode === 'bilingual' && originalText) {
      // 双语对照模式
      const maxLength = Math.max(originalParagraphs.length, translatedParagraphs.length);
      
      for (let i = 0; i < maxLength; i++) {
        const orig = originalParagraphs[i] || '';
        const trans = translatedParagraphs[i] || '';
        
        if (orig.trim()) {
          content.push({
            text: '📝 原文',
            style: 'sectionTitle',
            margin: [0, 15, 0, 5],
          });
          content.push({
            text: orig,
            style: 'originalText',
            margin: [0, 0, 0, 10],
          });
        }
        
        if (trans.trim()) {
          content.push({
            text: '🌐 译文',
            style: 'sectionTitle',
            margin: [0, 15, 0, 5],
          });
          content.push({
            text: trans,
            style: 'translatedText',
            margin: [0, 0, 0, 10],
          });
        }
        
        // 分隔段落
        if (i < maxLength - 1) {
          content.push({
            text: '────────────────────────────────────────',
            style: 'paragraphSeparator',
            margin: [0, 10, 0, 10],
          });
        }
      }
    } else {
      // 仅译文模式
      content.push({
        text: '🌐 译文',
        style: 'sectionTitle',
        margin: [0, 15, 0, 10],
      });
      
      translatedParagraphs.forEach((para, i) => {
        if (para.trim()) {
          content.push({
            text: para,
            style: 'translatedText',
            margin: [0, 0, 0, 10],
          });
        }
      });
    }

    // 页脚
    content.push({
      text: '\n\n────────────────────────────────────────\n由 Paper Assistant 生成 | https://github.com/ling1-1/paper-assistant',
      style: 'footer',
      alignment: 'center',
      margin: [0, 30, 0, 0],
    });

    // 创建 PDF 文档定义
    const docDefinition = {
      content: content,
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
        paragraphSeparator: {
          fontSize: 6,
          color: '#e5e7eb',
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

    // 生成 PDF
    const pdfDoc = pdfMake.createPdf(docDefinition);
    
    // 获取 PDF buffer
    const buffer = await new Promise((resolve, reject) => {
      pdfDoc.getBuffer((buffer) => {
        resolve(buffer);
      });
    });

    // 确保上传目录存在
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // 保存文件
    const safeFilename = `${Date.now()}-${filename.replace('.pdf', '')}-translated.pdf`;
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
    });
  } catch (err) {
    console.error('[export-pdf-better]', err);
    return res.status(500).json({
      error: err.message,
      message: 'PDF 导出失败',
    });
  }
}
