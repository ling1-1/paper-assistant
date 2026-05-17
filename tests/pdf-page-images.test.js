const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodePdfBase64ToPdfjsData,
  loadCanvasModule,
  WASM_URL,
} = require('../lib/services/pdf-page-images');

test('decodePdfBase64ToPdfjsData returns Uint8Array that is not a Buffer', () => {
  const data = decodePdfBase64ToPdfjsData('data:application/pdf;base64,JVBERi0xLjQ=');

  assert.equal(data instanceof Uint8Array, true);
  assert.equal(Buffer.isBuffer(data), false);
  assert.equal(Buffer.from(data).toString('ascii'), '%PDF-1.4');
});

test('canvas renderer dependency is directly available to API runtime', () => {
  const canvas = loadCanvasModule();

  assert.equal(typeof canvas.createCanvas, 'function');
  assert.doesNotThrow(() => require.resolve('@napi-rs/canvas'));
});

test('pdfjs wasm assets are configured for scanned PDF decoding', () => {
  assert.match(WASM_URL, /pdfjs-dist\/wasm\/$/);
});
