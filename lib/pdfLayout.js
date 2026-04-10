import { pathToFileURL } from 'url';
import path from 'path';

const STANDARD_FONT_DATA_URL = `${pathToFileURL(
  path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/'),
).href}`;

function round(value) {
  return Math.round(value * 100) / 100;
}

function normalizeTextItems(items) {
  return items
    .filter((item) => item.str && item.str.trim())
    .map((item) => {
      const [, , , heightScale, x, y] = item.transform;
      return {
        text: item.str,
        x: round(x),
        y: round(y),
        width: round(item.width || 0),
        height: round(item.height || Math.abs(heightScale) || 0),
        fontSize: round(Math.abs(heightScale) || item.height || 0),
      };
    })
    .sort((a, b) => {
      if (Math.abs(b.y - a.y) > 4) {
        return b.y - a.y;
      }
      return a.x - b.x;
    });
}

function clusterLines(items) {
  const lines = [];

  for (const item of items) {
    const existing = lines.find((line) => Math.abs(line.y - item.y) <= Math.max(3, item.fontSize * 0.35));
    if (existing) {
      existing.items.push(item);
      existing.y = (existing.y + item.y) / 2;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines
    .map((line) => {
      const sortedItems = line.items.sort((a, b) => a.x - b.x);
      const text = sortedItems.map((item, index) => {
        const prev = sortedItems[index - 1];
        if (!prev) {
          return item.text;
        }
        const gap = item.x - (prev.x + prev.width);
        return `${gap > Math.max(6, item.fontSize * 0.35) ? ' ' : ''}${item.text}`;
      }).join('').trim();

      const x = Math.min(...sortedItems.map((item) => item.x));
      const right = Math.max(...sortedItems.map((item) => item.x + item.width));
      const height = Math.max(...sortedItems.map((item) => item.height));
      const fontSize = Math.max(...sortedItems.map((item) => item.fontSize));

      return {
        text,
        x: round(x),
        y: round(line.y),
        width: round(right - x),
        height: round(height),
        fontSize: round(fontSize),
      };
    })
    .filter((line) => line.text)
    .sort((a, b) => {
      if (Math.abs(b.y - a.y) > 4) {
        return b.y - a.y;
      }
      return a.x - b.x;
    });
}

function clusterBlocks(lines) {
  const blocks = [];

  for (const line of lines) {
    const previous = blocks[blocks.length - 1];
    if (!previous) {
      blocks.push({ lines: [line] });
      continue;
    }

    const prevLine = previous.lines[previous.lines.length - 1];
    const verticalGap = prevLine.y - line.y;
    const aligned = Math.abs(prevLine.x - line.x) < 24;
    const closeEnough = verticalGap < Math.max(prevLine.height, line.height) * 1.9 + 8;

    if (aligned && closeEnough) {
      previous.lines.push(line);
    } else {
      blocks.push({ lines: [line] });
    }
  }

  return blocks.map((block, index) => {
    const x = Math.min(...block.lines.map((line) => line.x));
    const right = Math.max(...block.lines.map((line) => line.x + line.width));
    const top = Math.max(...block.lines.map((line) => line.y));
    const bottom = Math.min(...block.lines.map((line) => line.y - line.height));

    return {
      id: `block-${index + 1}`,
      text: block.lines.map((line) => line.text).join('\n'),
      x: round(x),
      y: round(top),
      width: round(right - x),
      height: round(top - bottom),
      lines: block.lines,
    };
  });
}

export async function extractPdfLayout(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  // 确保 buffer 是 Uint8Array
  const uint8Data = buffer instanceof Buffer ? new Uint8Array(buffer) : buffer;
  
  const loadingTask = pdfjs.getDocument({
    data: uint8Data,
    disableWorker: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    useSystemFonts: true,
    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
    cMapPacked: true,
  });
  const doc = await loadingTask.promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const items = normalizeTextItems(textContent.items);
    const lines = clusterLines(items);
    const blocks = clusterBlocks(lines);

    pages.push({
      pageNumber,
      width: round(viewport.width),
      height: round(viewport.height),
      text: blocks.map((block) => block.text).join('\n\n'),
      blocks,
    });
  }

  return {
    totalPages: doc.numPages,
    text: pages.map((page) => page.text).join('\n\n'),
    pages,
  };
}
