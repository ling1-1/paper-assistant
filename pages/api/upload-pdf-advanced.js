// pages/api/upload-pdf-advanced.js — PDF 上传与文本提取
// 使用 pdf-parse（与 upload-pdf.js 相同，待后续增强）
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

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
    const { file, filename } = req.body;

    if (!file) {
      return res.status(400).json({ error: '未提供文件' });
    }

    // 解析 base64 文件
    const buffer = Buffer.from(file.split(',')[1], 'base64');
    const uint8Array = new Uint8Array(buffer);

    // 确保上传目录存在
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // 保存文件
    const safeFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filepath = join(uploadDir, safeFilename);
    await writeFile(filepath, buffer);

    // 解析 PDF（pdf-parse v2 API）
    const parser = new PDFParse(uint8Array);
    const result = await parser.getText();
    
    // 优化文本：保留段落结构
    let text = result.text;
    
    // 清理多余空行，但保留段落分隔
    text = text.replace(/\n{3,}/g, '\n\n');
    
    const totalPages = result.pageCount;

    // 提取元数据
    const metadata = {
      info: result.info || {},
      version: result.version,
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
    console.error('[upload-pdf-advanced]', err);
    return res.status(500).json({
      error: err.message,
      message: 'PDF 解析失败，请确保文件有效',
    });
  }
}
