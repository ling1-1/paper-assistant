// pages/api/upload-pdf-advanced.js — PDF 上传与文本提取
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { extractPdfLayout } from '../../lib/pdfLayout';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

/**
 * 验证 PDF 文件头
 */
function isValidPdf(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const header = buffer.slice(0, 4).toString('ascii');
  return header === '%PDF';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  let filepath = null;

  try {
    const { file, filename } = req.body;

    if (!file) {
      return res.status(400).json({ error: '未提供文件' });
    }

    // 解析 base64 文件
    let buffer;
    try {
      const base64Data = file.includes(',') ? file.split(',')[1] : file;
      buffer = Buffer.from(base64Data, 'base64');
    } catch (decodeErr) {
      console.error('[upload-pdf-advanced] base64 decode error', decodeErr);
      return res.status(400).json({ 
        error: '文件编码错误',
        message: '无法解析文件内容，请确保文件有效'
      });
    }

    // 验证 PDF 文件头
    if (!isValidPdf(buffer)) {
      return res.status(400).json({ 
        error: '无效的 PDF 文件',
        message: '文件头不匹配 PDF 格式，请上传有效的 PDF 文件'
      });
    }

    // 检查文件大小
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (buffer.length > maxSize) {
      return res.status(400).json({ 
        error: '文件过大',
        message: `PDF 文件不能超过 ${maxSize / 1024 / 1024}MB`
      });
    }

    // 确保上传目录存在
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // 保存文件
    const safeFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    filepath = join(uploadDir, safeFilename);
    await writeFile(filepath, buffer);

    // 提取 PDF 内容
    let result;
    try {
      result = await extractPdfLayout(buffer);
    } catch (extractErr) {
      console.error('[upload-pdf-advanced] extraction error', extractErr);
      // 清理失败的文件
      if (filepath) {
        try { await unlink(filepath); } catch {}
      }
      throw new Error(`PDF 提取失败：${extractErr.message}`);
    }

    const text = result.text.replace(/\n{3,}/g, '\n\n');
    const totalPages = result.totalPages;

    // 提取元数据
    const metadata = {
      extractor: 'pdfjs-dist',
      fileSize: buffer.length,
      processedAt: new Date().toISOString(),
    };

    return res.status(200).json({
      success: true,
      filename: safeFilename,
      originalFilename: filename,
      text,
      totalPages,
      pages: result.pages,
      metadata,
      filepath,
    });
  } catch (err) {
    console.error('[upload-pdf-advanced]', err);
    // 清理失败的文件
    if (filepath) {
      try { await unlink(filepath); } catch {}
    }
    return res.status(500).json({
      error: err.message,
      message: 'PDF 解析失败，请确保文件有效',
    });
  }
}
