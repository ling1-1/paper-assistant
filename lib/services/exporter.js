const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { normalizeParagraphs } = require('../translationPipeline');
const { normalizeAcademicText } = require('./academic-text-format');

function buildDownloadUrl(mimeType, buffer) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function exportDocx({
  originalText = '',
  translatedText = '',
  filename = 'translation',
  sourceLang = 'en',
  targetLang = 'zh',
}) {
  const originalParagraphs = normalizeParagraphs(normalizeAcademicText(originalText));
  const translatedParagraphs = normalizeParagraphs(normalizeAcademicText(translatedText));
  const totalParagraphs = Math.max(originalParagraphs.length, translatedParagraphs.length);
  const children = [
    new Paragraph({
      text: 'Paper Assistant Translation',
      heading: HeadingLevel.TITLE,
      spacing: { after: 360 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `方向：${sourceLang === 'en' ? '英文' : '中文'} -> ${targetLang === 'en' ? '英文' : '中文'}`,
          color: '475569',
        }),
      ],
      spacing: { after: 320 },
    }),
  ];

  for (let index = 0; index < totalParagraphs; index += 1) {
    if (originalParagraphs[index]) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `Original ${index + 1}`, bold: true, color: '2563eb' })],
        spacing: { before: 180, after: 80 },
      }));
      children.push(new Paragraph({
        children: [new TextRun({ text: originalParagraphs[index] })],
        spacing: { after: 160 },
      }));
    }

    if (translatedParagraphs[index]) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `Translation ${index + 1}`, bold: true, color: '059669' })],
        spacing: { before: 80, after: 80 },
      }));
      children.push(new Paragraph({
        children: [new TextRun({ text: translatedParagraphs[index] })],
        spacing: { after: 220 },
      }));
    }
  }

  const document = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(document);
  return {
    filename: `${filename.replace(/\.pdf$/i, '')}-translation.docx`,
    downloadUrl: buildDownloadUrl(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer,
    ),
  };
}

async function tryEmbedFont(pdfDoc, fontBytes) {
  try {
    return await pdfDoc.embedFont(fontBytes, { subset: true });
  } catch {
    // Several CJK fonts are TrueType collections. pdf-lib/fontkit can embed
    // them when subsetting is disabled, which is preferable to failing export.
    return await pdfDoc.embedFont(fontBytes, { subset: false });
  }
}

async function loadFont(pdfDoc, translatedText) {
  pdfDoc.registerFontkit(fontkit);
  const containsChinese = /[\u4e00-\u9fa5]/.test(translatedText);

  if (!containsChinese) {
    return await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

  const fontPaths = [
    process.env.PDF_CJK_FONT_PATH,
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
    '/usr/share/fonts/truetype/arphic/ukai.ttc',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  ];
  const fs = require('fs');

  for (const fontPath of fontPaths.filter(Boolean)) {
    try {
      if (fs.existsSync(fontPath)) {
        const fontBytes = fs.readFileSync(fontPath);
        return await tryEmbedFont(pdfDoc, fontBytes);
      }
    } catch {
    }
  }

  throw new Error('当前运行环境缺少可用的中文 PDF 字体');
}

function splitPdfText(text, charsPerPage = 500) {
  const paragraphs = normalizeParagraphs(normalizeAcademicText(text));
  const pages = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > charsPerPage) {
      pages.push(current);
      current = paragraph;
      continue;
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  if (current) {
    pages.push(current);
  }

  return pages.length ? pages : [''];
}

function normalizeExportText(text = '') {
  return normalizeAcademicText(text)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .trim();
}

function wrapText(text, font, fontSize, maxWidth) {
  const lines = [];
  let line = '';

  for (const char of String(text)) {
    const next = line + char;
    if (line && font.widthOfTextAtSize(next, fontSize) > maxWidth) {
      lines.push(line);
      line = char;
      continue;
    }
    line = next;
  }

  if (line) lines.push(line);
  return lines;
}

function createTranslationPage(pdfDoc) {
  const page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(0.985, 0.975, 0.95),
  });
  return page;
}

function drawTranslationDocument(pdfDoc, text, font) {
  const margin = 54;
  const fontSize = 11;
  const lineHeight = 18;
  const paragraphGap = 10;
  const titleSize = 16;
  const maxWidth = 595 - margin * 2;
  let page = createTranslationPage(pdfDoc);
  let y = 842 - 64;

  page.drawText('译文', {
    x: margin,
    y,
    size: titleSize,
    font,
    color: rgb(0.08, 0.12, 0.2),
  });
  y -= 34;

  for (const paragraph of normalizeParagraphs(normalizeExportText(text))) {
    const isSection = /^(摘要|引言|实验|方法|结果|讨论|结论|致谢|参考文献|references|abstract|introduction|experimental)$/i.test(paragraph);
    const currentSize = isSection ? 12.5 : fontSize;
    const currentLineHeight = isSection ? 21 : lineHeight;
    const lines = wrapText(paragraph, font, currentSize, maxWidth);

    if (y - lines.length * currentLineHeight < 48) {
      page = createTranslationPage(pdfDoc);
      y = 842 - 64;
    }

    for (const line of lines) {
      if (y < 48) {
        page = createTranslationPage(pdfDoc);
        y = 842 - 64;
      }
      page.drawText(line, {
        x: margin,
        y,
        size: currentSize,
        font,
        color: rgb(0.08, 0.12, 0.2),
      });
      y -= currentLineHeight;
    }
    y -= paragraphGap;
  }
}

async function exportPdf({
  translatedText = '',
  filename = 'translation',
}) {
  const pdfDoc = await PDFDocument.create();

  const font = await loadFont(pdfDoc, translatedText);
  drawTranslationDocument(pdfDoc, translatedText, font);

  const buffer = Buffer.from(await pdfDoc.save());
  return {
    filename: `${filename.replace(/\.pdf$/i, '')}-translation.pdf`,
    downloadUrl: buildDownloadUrl('application/pdf', buffer),
    pages: pdfDoc.getPageCount(),
  };
}

async function exportTranslation(options) {
  if (!options.translatedText?.trim()) {
    throw new Error('没有可导出的翻译内容');
  }

  if (options.format === 'pdf') {
    return exportPdf(options);
  }

  return exportDocx(options);
}

module.exports = {
  exportTranslation,
};
