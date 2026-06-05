const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTextLayerOverlayPages,
  normalizeOverlayPageLimit,
} = require('../lib/services/pdf-overlay-ocr');

test('normalizeOverlayPageLimit supports first page and all pages', () => {
  assert.equal(normalizeOverlayPageLimit('all'), null);
  assert.equal(normalizeOverlayPageLimit(0), null);
  assert.equal(normalizeOverlayPageLimit(1), 1);
  assert.equal(normalizeOverlayPageLimit('bad'), 3);
});

test('createTextLayerOverlayPages maps PDF text blocks to rendered image coordinates', () => {
  const result = createTextLayerOverlayPages({
    renderedPages: [{
      pageNumber: 1,
      width: 1200,
      height: 1600,
      imageUrl: 'data:image/jpeg;base64,abc',
    }],
    layoutPages: [{
      pageNumber: 1,
      width: 600,
      height: 800,
      blocks: [{
        id: 'block-1',
        text: 'Left column paragraph',
        x: 50,
        y: 700,
        width: 220,
        height: 30,
        lines: [
          { text: 'Left column paragraph', x: 50, y: 700, width: 220, height: 12, fontSize: 10 },
          { text: 'Second line', x: 50, y: 684, width: 110, height: 12, fontSize: 10 },
        ],
      }],
    }],
  });

  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].blocks.length, 1);
  assert.equal(result.pages[0].blocks[0].text, 'Left column paragraph\nSecond line');
  assert.deepEqual(result.pages[0].blocks[0].bbox, {
    x: 100,
    y: 176,
    width: 440,
    height: 66.08,
  });
  assert.equal(result.meta.engine, 'text-layer');
});

test('createTextLayerOverlayPages splits oversized PDF text blocks into readable overlay groups', () => {
  const lines = Array.from({ length: 7 }, (_, index) => ({
    text: `paragraph line ${index + 1}`,
    x: 50,
    y: 700 - index * 14,
    width: 220,
    height: 10,
    fontSize: 10,
  }));

  const result = createTextLayerOverlayPages({
    renderedPages: [{
      pageNumber: 1,
      width: 1200,
      height: 1600,
      imageUrl: 'data:image/jpeg;base64,abc',
    }],
    layoutPages: [{
      pageNumber: 1,
      width: 600,
      height: 800,
      blocks: [{
        id: 'block-1',
        text: lines.map((line) => line.text).join('\n'),
        x: 50,
        y: 700,
        width: 220,
        height: 94,
        lines,
      }],
    }],
  });

  assert.equal(result.pages[0].blocks.length, 2);
  assert.equal(result.pages[0].blocks[0].text.split('\n').length, 5);
  assert.equal(result.pages[0].blocks[1].text.split('\n').length, 2);
});

test('createTextLayerOverlayPages keeps chemistry prose translatable instead of reference or formula', () => {
  const result = createTextLayerOverlayPages({
    renderedPages: [{
      pageNumber: 1,
      width: 1200,
      height: 1600,
      imageUrl: 'data:image/jpeg;base64,abc',
    }],
    layoutPages: [{
      pageNumber: 1,
      width: 600,
      height: 800,
      blocks: [{
        id: 'block-1',
        text: 'The chemistry of these anions (M = Mo, W) is discussed in this section.',
        x: 50,
        y: 500,
        width: 260,
        height: 12,
        lines: [
          { text: 'The chemistry of these anions (M = Mo, W) is discussed in this section.', x: 50, y: 500, width: 260, height: 12, fontSize: 10 },
        ],
      }],
    }],
  });

  assert.equal(result.pages[0].blocks[0].type, 'paragraph');
});

test('createTextLayerOverlayPages keeps paper metadata out of translatable title blocks', () => {
  const result = createTextLayerOverlayPages({
    renderedPages: [{
      pageNumber: 1,
      width: 1200,
      height: 1600,
      imageUrl: 'data:image/jpeg;base64,abc',
    }],
    layoutPages: [{
      pageNumber: 1,
      width: 600,
      height: 800,
      blocks: [{
        id: 'block-1',
        text: 'Received November 26, 1982',
        x: 50,
        y: 700,
        width: 160,
        height: 10,
        lines: [
          { text: 'Received November 26, 1982', x: 50, y: 700, width: 160, height: 10, fontSize: 10 },
        ],
      }, {
        id: 'block-2',
        text: 'JOHN W. MCDONALD, G. DELBERT FRIESEN and WILLIAM E. NEWTON',
        x: 50,
        y: 680,
        width: 360,
        height: 10,
        lines: [
          { text: 'JOHN W. MCDONALD, G. DELBERT FRIESEN and WILLIAM E. NEWTON', x: 50, y: 680, width: 360, height: 10, fontSize: 10 },
        ],
      }],
    }],
  });

  assert.deepEqual(result.pages[0].blocks.map((block) => block.type), ['other', 'other']);
});
