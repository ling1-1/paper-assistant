// pages/api/upload-pdf-advanced.js — PDF 上传与文本提取（PDF.js 增强版）
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfjsLib = require('pdfjs-dist');

// 设置 worker
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.mjs');

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

    // 使用 PDF.js 加载文档
    const loadingTask = pdfjsLib.getDocument(uint8Array);
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    // 逐页提取文本，保留段落结构
    const pages = [];
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // 提取文本项及其位置信息
      const items = textContent.items.map(item => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      }));

      // 按 Y 坐标分组（同一行的文本）
      const rows = [];
      const yThreshold = 5; // 同一行的 Y 坐标容差
      
      items.forEach(item => {
        if (!item.str.trim()) return;
        
        // 查找是否已有相近 Y 坐标的行
        let foundRow = rows.find(row => Math.abs(row.y - item.y) < yThreshold);
        
        if (foundRow) {
          foundRow.items.push(item);
        } else {
          rows.push({ y: item.y, items: [item] });
        }
      });

      // 按 Y 坐标降序排序（从上到下）
      rows.sort((a, b) => b.y - a.y);

      // 每行内按 X 坐标排序（从左到右），然后拼接
      const pageText = rows.map(row => {
        row.items.sort((a, b) => a.x - b.x);
        return row.items.map(item => item.str).join(' ');
      }).join('\n');

      pages.push(pageText);
    }

    // 合并所有页面，用分页符分隔
    const text = pages.join('\n\n--- 分页 ---\n\n');

    // 清理多余空行
    const cleanedText = text.replace(/\n{3,}/g, '\n\n');

    return res.status(200).json({
      success: true,
      filename: safeFilename,
      originalFilename: filename,
      text: cleanedText,
      totalPages,
      metadata: {
        info: pdf._pdfInfo?.info || {},
      },
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
