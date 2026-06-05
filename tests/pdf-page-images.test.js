const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodePdfBase64ToPdfjsData,
  getRenderPageNumbers,
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

test('getRenderPageNumbers supports partial local preview rendering', () => {
  assert.deepEqual(getRenderPageNumbers(6, 2, true), [1, 2]);
  assert.throws(() => getRenderPageNumbers(6, 2, false), /超过图片视觉翻译上限 2 页/);
});

test('getRenderPageNumbers supports all pages when page limit is disabled', () => {
  assert.deepEqual(getRenderPageNumbers(5, null, false), [1, 2, 3, 4, 5]);
  assert.deepEqual(getRenderPageNumbers(5, 'all', false), [1, 2, 3, 4, 5]);
});

test('getRenderPageNumbers supports explicit sparse page lists', () => {
  assert.deepEqual(getRenderPageNumbers(10, { pageNumbers: [1, 3, 10] }), [1, 3, 10]);
  assert.deepEqual(getRenderPageNumbers(10, { pageNumbers: [0, 2, 2, 99, 4] }), [2, 4]);
});
