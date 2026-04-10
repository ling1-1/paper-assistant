import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from 'fontkit';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { normalizeParagraphs } from '../../lib/translationPipeline';

const CHINESE_FONT_PATH = '/Library/Fonts/Arial Unicode.ttf';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

function partitionParagraphs(paragraphs, totalGroups) {
  if (!paragraphs.length) {
    return Array.from({ length: totalGroups }, () => []);
  }

  const groups = Array.from({ length: totalGroups }, () => []);
  const totalChars = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  const targetChars = Math.max(Math.ceil(totalChars / totalGroups), 1);
  let groupIndex = 0;
  let currentChars = 0;

  for (const paragraph of paragraphs) {
    if (groupIndex < totalGroups - 1 && currentChars >= targetChars) {
      groupIndex += 1;
      currentChars = 0;
    }
    groups[groupIndex].push(paragraph);
    currentChars += paragraph.length;
  }

  return groups;
}

function wrapLine(font, text, fontSize, maxWidth) {
  if (!text) {
    return [''];
  }

  const lines = [];
  let current = '';

  for (const char of text) {
    const candidate = current + char;
    if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      lines.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function drawTranslationPage({ page, font, pageNumber, paragraphs, originalFilename }) {
  const { width, height } = page.getSize();
  const marginX = 48;
  const topY = height - 56;
  const contentWidth = width - marginX * 2;
  const bodyFontSize = 11;
  const lineHeight = 18;
  let cursorY = topY;

  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(0.985, 0.99, 1),
  });

  page.drawText('Paper Assistant 双语译文页', {
    x: marginX,
    y: cursorY,
    size: 18,
    font,
    color: rgb(0.08, 0.2, 0.5),
  });
  cursorY -= 26;

  page.drawText(`原文文件: ${originalFilename}`, {
    x: marginX,
    y: cursorY,
    size: 10,
    font,
    color: rgb(0.35, 0.4, 0.48),
  });
  cursorY -= 18;

  page.drawText(`对应原 PDF 第 ${pageNumber} 页`, {
    x: marginX,
    y: cursorY,
    size: 10,
    font,
    color: rgb(0.35, 0.4, 0.48),
  });
  cursorY -= 28;

  for (const paragraph of paragraphs) {
    const wrappedLines = wrapLine(font, paragraph, bodyFontSize, contentWidth);
    for (const line of wrappedLines) {
      if (cursorY < 52) {
        page.drawText('...... 当前页空间不足，请查看后续译文页。', {
          x: marginX,
          y: 36,
          size: 10,
          font,
          color: rgb(0.65, 0.1, 0.1),
        });
        return;
      }

      page.drawText(line, {
        x: marginX,
        y: cursorY,
        size: bodyFontSize,
        font,
        color: rgb(0.1, 0.12, 0.18),
      });
      cursorY -= lineHeight;
    }
    cursorY -= 10;
  }
}

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

    const pureBase64 = originalPdfBase64.startsWith('data:')
      ? originalPdfBase64.split(',')[1]
      : originalPdfBase64;
    const originalBytes = Buffer.from(pureBase64, 'base64');

    const originalPdf = await PDFDocument.load(originalBytes);
    const exportPdf = await PDFDocument.create();
    exportPdf.registerFontkit(fontkit);

    const fontBytes = await readFile(CHINESE_FONT_PATH);
    const bodyFont = await exportPdf.embedFont(fontBytes, { subset: true });

    const sourcePageIndices = originalPdf.getPages().map((_, index) => index);
    const copiedPages = await exportPdf.copyPages(originalPdf, sourcePageIndices);
    const paragraphGroups = partitionParagraphs(normalizeParagraphs(translatedText), copiedPages.length);

    copiedPages.forEach((copiedPage, index) => {
      exportPdf.addPage(copiedPage);
      const translationPage = exportPdf.addPage([copiedPage.getWidth(), copiedPage.getHeight()]);
      drawTranslationPage({
        page: translationPage,
        font: bodyFont,
        pageNumber: index + 1,
        paragraphs: paragraphGroups[index] || [],
        originalFilename,
      });
    });

    const pdfBytes = await exportPdf.save();
    const buffer = Buffer.from(pdfBytes);

    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const safeFilename = `${Date.now()}-${filename.replace('.pdf', '')}-bilingual.pdf`;
    const filepath = join(uploadDir, safeFilename);
    await writeFile(filepath, buffer);

    const downloadUrl = `data:application/pdf;base64,${buffer.toString('base64')}`;

    return res.status(200).json({
      success: true,
      filename: safeFilename,
      downloadUrl,
      filepath,
      totalPages: exportPdf.getPageCount(),
    });
  } catch (err) {
    console.error('[export-pdf-overlay]', err);
    return res.status(500).json({
      error: err.message,
      message: 'PDF 导出失败',
    });
  }
}
