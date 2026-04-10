// pages/api/export-pdf-better.js — PDF 导出（支持中文 - Python + reportlab）
import { exec } from 'child_process';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
      mode = 'bilingual',
    } = req.body;

    if (!translatedText) {
      return res.status(400).json({ error: '未提供翻译文本' });
    }

    // 确保上传目录存在
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // 生成安全的文件名
    const safeFilename = `${Date.now()}-${filename.replace('.pdf', '')}-translated.pdf`;
    const outputPath = join(uploadDir, safeFilename);
    const scriptPath = join(process.cwd(), 'generate_pdf.py');

    // 调用 Python 脚本生成 PDF
    const originalJson = JSON.stringify(originalText || '');
    const translatedJson = JSON.stringify(translatedText);
    
    const command = `python3 "${scriptPath}" "${outputPath}" "${originalJson}" "${translatedJson}" "${filename}"`;
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 60000, // 60 秒超时
        maxBuffer: 10 * 1024 * 1024, // 10MB 缓冲区
      });

      if (stderr) {
        console.error('[PDF 生成] stderr:', stderr);
      }

      if (!stdout.startsWith('SUCCESS:')) {
        throw new Error(`PDF 生成失败：${stdout || '未知错误'}`);
      }

      console.log('[PDF 生成] 成功:', stdout);
    } catch (err) {
      console.error('[PDF 生成] 执行失败:', err.message);
      throw new Error(`PDF 生成失败：${err.message}`);
    }

    // 验证文件生成
    if (!existsSync(outputPath)) {
      throw new Error('PDF 文件生成失败：文件不存在');
    }

    // 读取文件
    const fileBuffer = await readFile(outputPath);

    // 返回 base64
    const base64 = fileBuffer.toString('base64');
    const downloadUrl = `data:application/pdf;base64,${base64}`;

    return res.status(200).json({
      success: true,
      filename: safeFilename,
      downloadUrl,
      filepath: outputPath,
    });
  } catch (err) {
    console.error('[export-pdf-better]', err);
    return res.status(500).json({
      error: err.message,
      message: 'PDF 导出失败',
    });
  }
}
