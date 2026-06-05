const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canTranslatePdfState,
  createPdfHistoryItem,
  getStorablePdfBase64,
} = require('../lib/services/pdf-history');

test('getStorablePdfBase64 keeps small PDFs for history reload', () => {
  assert.equal(
    getStorablePdfBase64('data:application/pdf;base64,JVBERi0xLjQ=', 100),
    'data:application/pdf;base64,JVBERi0xLjQ=',
  );
});

test('getStorablePdfBase64 drops large PDFs to avoid localStorage quota failures', () => {
  assert.equal(getStorablePdfBase64('x'.repeat(101), 100), '');
});

test('createPdfHistoryItem stores restorable PDF content when available', () => {
  const entry = createPdfHistoryItem({
    item: {
      filename: 'paper.pdf',
      pdfBase64: 'data:application/pdf;base64,abc',
      originalText: 'body',
    },
    defaults: {
      id: 'fixed',
      now: '2026-06-01T00:00:00.000Z',
      field: 'chemistry',
    },
  });

  assert.equal(entry.id, 'fixed');
  assert.equal(entry.field, 'chemistry');
  assert.equal(entry.pdfBase64, 'data:application/pdf;base64,abc');
  assert.equal(entry.originalText, 'body');
});

test('canTranslatePdfState allows text-only restored history entries', () => {
  assert.equal(canTranslatePdfState({ pdfBase64: '', pdfText: 'extracted text' }), true);
  assert.equal(canTranslatePdfState({ pdfBase64: 'data:application/pdf;base64,abc', pdfText: '' }), true);
  assert.equal(canTranslatePdfState({ pdfBase64: '', pdfText: '' }), false);
});
