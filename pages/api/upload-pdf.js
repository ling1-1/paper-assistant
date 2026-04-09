// pages/api/upload-pdf.js — PDF 上传与文本提取
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // 最大 10MB
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const { file, filename } = req.body;

    if (!file) {
      return res.status(400).json({ error: '未提供文件' });
    }

    // 解析 base64 文件
    const buffer = Buffer.from(file.split(',')[1], 'base64');

    // 确保上传目录存在
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // 保存文件
    const safeFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filepath = join(uploadDir, safeFilename);
    await writeFile(filepath, buffer);

    // 解析 PDF
    const pdfData = await pdfParse(buffer);
    const text = pdfData.text;
    const totalPages = pdfData.numpages;

    // 提取元数据
    const metadata = {
      info: pdfData.info || {},
      version: pdfData.version,
    };

    return res.status(200).json({
      success: true,
      filename: safeFilename,
      originalFilename: filename,
      text,
      totalPages,
      metadata,
      filepath,
    });
  } catch (err) {
    console.error('[upload-pdf]', err);
    return res.status(500).json({
      error: err.message,
      message: 'PDF 解析失败，请确保文件有效',
    });
  }
}
