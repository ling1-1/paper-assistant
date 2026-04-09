// pages/api/export-docx.js — 导出翻译结果为 Word 文档
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

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
      sourceLang = 'en',
      targetLang = 'zh',
      mode = 'translate',
    } = req.body;

    // 创建 Word 文档
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          // 标题
          new Paragraph({
            text: `📄 论文翻译`,
            heading: HeadingLevel.TITLE,
            spacing: { after: 400 },
          }),

          // 元信息
          new Paragraph({
            children: [
              new TextRun({
                text: `翻译模式：${mode === 'translate' ? '翻译' : mode === 'explain' ? '术语解释' : '润色优化'}\n`,
                bold: true,
              }),
              new TextRun({
                text: `语言方向：${sourceLang === 'en' ? '英文' : '中文'} → ${targetLang === 'en' ? '英文' : '中文'}\n`,
              }),
              new TextRun({
                text: `生成时间：${new Date().toLocaleString('zh-CN')}\n`,
                italics: true,
              }),
            ],
            spacing: { after: 400 },
          }),

          // 分隔线
          new Paragraph({
            border: {
              bottom: { color: 'auto', space: 1, value: 'single', size: 6 },
            },
            spacing: { after: 400 },
          }),

          // 原文
          new Paragraph({
            text: `📝 原文 (${sourceLang === 'en' ? 'English' : '中文'})`,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: originalText || '（无原文）',
                size: 24,
              }),
            ],
            spacing: { after: 400 },
          }),

          // 分隔线
          new Paragraph({
            border: {
              bottom: { color: 'auto', space: 1, value: 'single', size: 6 },
            },
            spacing: { after: 400 },
          }),

          // 译文
          new Paragraph({
            text: `🌐 译文 (${targetLang === 'en' ? 'English' : '中文'})`,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: translatedText || '（无译文）',
                size: 24,
              }),
            ],
            spacing: { after: 400 },
          }),

          // 页脚
          new Paragraph({
            text: '\n\n---',
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: '由 Paper Assistant 生成 | https://github.com/ling1-1/paper-assistant',
                italics: true,
                size: 18,
                color: '666666',
              }),
            ],
            alignment: 'center',
          }),
        ],
      }],
    });

    // 生成 buffer
    const buffer = await Packer.toBuffer(doc);
    const outputFilename = `${filename.replace('.pdf', '')}-translation.docx`;

    // 保存到 uploads 目录
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }
    const filepath = join(uploadDir, outputFilename);
    await writeFile(filepath, buffer);

    // 返回文件（base64）
    const base64 = buffer.toString('base64');
    const downloadUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64}`;

    return res.status(200).json({
      success: true,
      filename: outputFilename,
      downloadUrl,
      filepath,
    });
  } catch (err) {
    console.error('[export-docx]', err);
    return res.status(500).json({
      error: err.message,
      message: 'Word 导出失败',
    });
  }
}
