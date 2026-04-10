// pages/api/export-pdf.js — PDF 覆盖导出（保留原排版）
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import fontkit from '@pdf-lib/fontkit';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

/**
 * 检测文本是否包含中文
 */
function hasChinese(text) {
  return /[\u4e00-\u9fa5]/.test(text);
}

/**
 * 将长文本分割成适合 PDF 页面的小块
 */
function splitTextForPages(text, charsPerPage = 400) {
  const paragraphs = text.split(/\n\n+/);
  const pages = [];
  let currentPage = '';

  for (const paragraph of paragraphs) {
    if (currentPage.length + paragraph.length + 2 <= charsPerPage) {
      currentPage += (currentPage ? '\n\n' : '') + paragraph;
    } else {
      if (currentPage) {
        pages.push(currentPage);
      }
      // 如果单个段落超长，需要进一步分割
      if (paragraph.length > charsPerPage) {
        // 按句子分割（中文句号、英文句号、换行）
        const sentences = paragraph.split(/([.!?。！？\n])/).filter(s => s.trim());
        let currentSentence = '';
        for (const sentence of sentences) {
          if (currentSentence.length + sentence.length <= charsPerPage) {
            currentSentence += sentence;
          } else {
            if (currentSentence) {
              pages.push(currentSentence);
            }
            currentSentence = sentence;
          }
        }
        if (currentSentence) {
          currentPage = currentSentence;
        }
      } else {
        currentPage = paragraph;
      }
    }
  }

  if (currentPage) {
    pages.push(currentPage);
  }

  return pages.length ? pages : [''];
}

/**
 * 在 PDF 页面上绘制翻译文本（支持中文）
 */
async function drawTranslationText(page, text, font, startY = 160) {
  const { height, width } = page.getSize();
  const fontSize = 10;
  const lineHeight = 14;
  const margin = 40;
  const maxTextWidth = width - margin * 2;

  // 绘制浅蓝色背景
  page.drawRectangle({
    x: margin - 10,
    y: startY - 10,
    width: width - margin * 2 + 20,
    height: height - startY + 20,
    color: rgb(0.93, 0.95, 1.0),
    opacity: 0.7,
  });

  // 添加标注
  page.drawText('[翻译]', {
    x: width - 80,
    y: startY + 5,
    size: 9,
    color: rgb(0.5, 0.5, 0.5),
    font,
  });

  // 分割文本为行
  const lines = text.split('\n');
  let y = startY - 5;
  const bottomMargin = 40;

  for (const line of lines) {
    if (y < bottomMargin) {
      break; // 超出页面底部
    }

    // 处理长行自动换行（中英文混合）
    let currentX = margin;
    let currentLine = '';
    
    for (const char of line) {
      const testLine = currentLine + char;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
      
      if (testWidth <= maxTextWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          page.drawText(currentLine, {
            x: margin,
            y,
            size: fontSize,
            color: rgb(0.1, 0.1, 0.4),
            font,
          });
          y -= lineHeight;
          currentLine = char;
        } else {
          // 单个字符就超长（罕见情况）
          page.drawText(char, {
            x: margin,
            y,
            size: fontSize,
            color: rgb(0.1, 0.1, 0.4),
            font,
          });
          y -= lineHeight;
          currentLine = '';
        }
      }
    }
    
    if (currentLine) {
      page.drawText(currentLine, {
        x: margin,
        y,
        size: fontSize,
        color: rgb(0.1, 0.1, 0.4),
        font,
      });
      y -= lineHeight;
    }
    
    y -= 3; // 段落间距
  }
}

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
      pdfBase64 = '',
    } = req.body;

    if (!translatedText) {
      return res.status(400).json({ error: '没有可导出的翻译内容' });
    }

    let pdfDoc;

    // 如果有原始 PDF，加载它
    if (pdfBase64) {
      const pdfBuffer = Buffer.from(pdfBase64.split(',')[1], 'base64');
      pdfDoc = await PDFDocument.load(pdfBuffer);
    } else {
      // 创建新 PDF
      pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([595, 842]); // A4 尺寸
    }

    // 注册 fontkit 以支持自定义字体
    pdfDoc.registerFontkit(fontkit);

    // 检测是否需要中文字体
    const needsChineseFont = hasChinese(translatedText);
    
    let font;
    let boldFont;
    
    if (needsChineseFont) {
      // 尝试使用系统字体（macOS）
      const systemFontPaths = [
        '/System/Library/Fonts/STHeiti Light.ttc',
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
      ];
      
      let loadedFont = null;
      for (const fontPath of systemFontPaths) {
        try {
          if (existsSync(fontPath)) {
            const fontBytes = await readFile(fontPath);
            loadedFont = await pdfDoc.embedFont(fontBytes, { subset: true });
            console.log('[export-pdf] 使用中文字体:', fontPath);
            break;
          }
        } catch (err) {
          console.warn('[export-pdf] 字体加载失败:', fontPath, err.message);
        }
      }
      
      if (loadedFont) {
        font = loadedFont;
        boldFont = loadedFont; // 中文字体通常没有粗体变体
      } else {
        // 回退到标准字体（仅支持英文）
        console.warn('[export-pdf] 未找到中文字体，使用标准字体回退');
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      }
    } else {
      // 纯英文，使用标准字体
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    // 分割翻译文本
    const textPages = splitTextForPages(translatedText, 400);

    // 如果有原始 PDF，在每页添加翻译
    if (pdfBase64) {
      const pages = pdfDoc.getPages();
      const minPages = Math.max(pages.length, textPages.length);

      for (let i = 0; i < minPages; i += 1) {
        const page = pages[i] || pdfDoc.addPage([595, 842]);
        const textPage = textPages[i] || '';
        
        if (textPage) {
          drawTranslationText(page, textPage, font);
        }
      }

      // 如果翻译文本页数多于原 PDF，添加新页面
      for (let i = pages.length; i < textPages.length; i += 1) {
        const newPage = pdfDoc.addPage([595, 842]);
        
        // 绘制背景
        newPage.drawRectangle({
          x: 0,
          y: 0,
          width: 595,
          height: 842,
          color: rgb(0.98, 0.98, 0.98),
        });
        
        // 添加标题
        newPage.drawText(`翻译内容 - 第 ${i + 1} 页`, {
          x: 40,
          y: 800,
          size: 14,
          color: rgb(0.2, 0.2, 0.6),
          font: boldFont,
        });
        
        drawTranslationText(newPage, textPages[i], font, 760);
      }
    } else {
      // 无原始 PDF，创建纯翻译文档
      for (let i = 0; i < textPages.length; i += 1) {
        const page = pdfDoc.addPage([595, 842]);
        
        // 页眉
        page.drawText(`📄 论文翻译 - 第 ${i + 1}/${textPages.length} 页`, {
          x: 40,
          y: 790,
          size: 12,
          color: rgb(0.2, 0.2, 0.6),
          font: boldFont,
        });
        
        page.drawLine({
          start: { x: 40, y: 775 },
          end: { x: 555, y: 775 },
          color: rgb(0.7, 0.7, 0.8),
          thickness: 1,
        });
        
        drawTranslationText(page, textPages[i], font, 750);
      }
    }

    // 保存 PDF
    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);

    // 生成文件名
    const safeFilename = filename.replace('.pdf', '').replace(/[^a-zA-Z0-9.-]/g, '_');
    const outputFilename = `${safeFilename}-translated.pdf`;

    // 保存到 uploads 目录
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }
    const filepath = join(uploadDir, outputFilename);
    await writeFile(filepath, buffer);

    // 返回 base64
    const base64 = buffer.toString('base64');
    const downloadUrl = `data:application/pdf;base64,${base64}`;

    return res.status(200).json({
      success: true,
      filename: outputFilename,
      downloadUrl,
      filepath,
      pages: textPages.length,
    });
  } catch (err) {
    console.error('[export-pdf]', err);
    return res.status(500).json({
      error: err.message,
      message: 'PDF 导出失败',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
}
