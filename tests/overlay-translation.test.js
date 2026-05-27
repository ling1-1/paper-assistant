const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseOverlayOcrResponse,
  translateOverlayPages,
} = require('../lib/services/overlay-translation');

test('parseOverlayOcrResponse normalizes visual OCR JSON blocks', () => {
  const page = parseOverlayOcrResponse(`\`\`\`json
{
  "blocks": [
    { "bbox": [10, 20, 200, 40], "text": "Paper title", "type": "title", "confidence": 0.91 },
    { "bbox": { "x": 12, "y": 80, "width": 300, "height": 60 }, "text": "H2O", "type": "formula" }
  ]
}
\`\`\``, { pageNumber: 2, width: 600, height: 800 });

  assert.equal(page.pageNumber, 2);
  assert.equal(page.width, 600);
  assert.equal(page.height, 800);
  assert.equal(page.blocks.length, 2);
  assert.deepEqual(page.blocks[0].bbox, { x: 10, y: 20, width: 200, height: 40 });
  assert.equal(page.blocks[0].id, 'p2-b1');
  assert.equal(page.blocks[1].type, 'formula');
});

test('parseOverlayOcrResponse rejects non-json model output', () => {
  assert.throws(
    () => parseOverlayOcrResponse('这里是解释，不是 JSON', { pageNumber: 1, width: 100, height: 100 }),
    /结构化 OCR 失败/,
  );
});

test('parseOverlayOcrResponse repairs common loose JSON from vision models', () => {
  const loose = "{blocks:[{id:'a',bbox:{x:10,y:20,width:120,height:40},text:'Title',type:'title',confidence:.9,}],}";
  const page = parseOverlayOcrResponse(loose, { pageNumber: 1, width: 600, height: 800 });

  assert.equal(page.blocks.length, 1);
  assert.equal(page.blocks[0].id, 'a');
  assert.equal(page.blocks[0].bbox.x, 10);
  assert.equal(page.blocks[0].type, 'title');
});

test('parseOverlayOcrResponse repairs bbox coordinates with missing y key', () => {
  const malformed = '{"blocks":[{"bbox":{"x":11,"133","width":483,"height":43},"text":"Title","type":"title"}]}';
  const page = parseOverlayOcrResponse(malformed, { pageNumber: 1, width: 600, height: 800 });

  assert.deepEqual(page.blocks[0].bbox, { x: 11, y: 133, width: 483, height: 43 });
});

test('parseOverlayOcrResponse salvages complete blocks from truncated JSON', () => {
  const truncated = '{"blocks":[{"bbox":{"x":11,"y":20,"width":100,"height":30},"text":"First","type":"paragraph"},{"bbox":{"x":11,"y":60,"width":100,"height":30},"text":"Second';
  const page = parseOverlayOcrResponse(truncated, { pageNumber: 1, width: 600, height: 800 });

  assert.equal(page.blocks.length, 1);
  assert.equal(page.blocks[0].text, 'First');
});

test('translateOverlayPages preserves formula and reference blocks', async () => {
  const result = await translateOverlayPages({
    pages: [{
      pageNumber: 1,
      width: 600,
      height: 800,
      imageUrl: 'data:image/jpeg;base64,abc',
      blocks: [
        { id: 'p1-b1', type: 'paragraph', text: 'hello', bbox: { x: 10, y: 10, width: 200, height: 40 } },
        { id: 'p1-b2', type: 'formula', text: 'H2O -> H2', bbox: { x: 10, y: 60, width: 200, height: 40 } },
        { id: 'p1-b3', type: 'reference', text: 'Smith, J. Chem. 2020.', bbox: { x: 10, y: 110, width: 200, height: 40 } },
      ],
    }],
    translatePageBlocks: async () => ({
      text: '{"blocks":[{"id":"p1-b1","translatedText":"你好"}]}',
      model: 'mock-model',
    }),
  });

  const blocks = result.pages[0].blocks;
  assert.equal(blocks[0].translatedText, '你好');
  assert.equal(blocks[1].translatedText, 'H₂O -> H₂');
  assert.equal(blocks[2].translatedText, 'Smith, J. Chem. 2020.');
  assert.equal(result.meta.blockCount, 3);
  assert.equal(result.meta.model, 'mock-model');
});

test('translateOverlayPages preserves compact paper metadata blocks', async () => {
  const result = await translateOverlayPages({
    pages: [{
      pageNumber: 1,
      width: 600,
      height: 800,
      imageUrl: 'data:image/jpeg;base64,abc',
      blocks: [
        { id: 'p1-b1', type: 'title', text: 'Syntheses and Characterization', bbox: { x: 10, y: 10, width: 500, height: 40 } },
        { id: 'p1-b2', type: 'paragraph', text: 'JOHN W. MCDONALD, G. DELBERT FRIESEN, LAURENCE D. ROSENHEIN and WILLIAM E. NEWTON', bbox: { x: 10, y: 60, width: 500, height: 30 } },
        { id: 'p1-b3', type: 'paragraph', text: 'Received November 26, 1982', bbox: { x: 10, y: 96, width: 260, height: 24 } },
      ],
    }],
    translatePageBlocks: async () => ({
      text: '{"blocks":[{"id":"p1-b1","translatedText":"合成与表征"},{"id":"p1-b2","translatedText":"约翰等人"},{"id":"p1-b3","translatedText":"收到日期"}]}',
      model: 'mock-model',
    }),
  });

  const blocks = result.pages[0].blocks;
  assert.equal(blocks[0].translatedText, '合成与表征');
  assert.equal(blocks[1].translatedText, blocks[1].text);
  assert.equal(blocks[1].preserveOriginal, true);
  assert.equal(blocks[2].translatedText, blocks[2].text);
});
