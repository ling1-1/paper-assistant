const test = require('node:test');
const assert = require('node:assert/strict');

const nextConfig = require('../next.config');

test('native canvas package is externalized for Next API runtime', () => {
  const config = { externals: [] };
  const result = nextConfig.webpack(config, { isServer: true });

  assert.equal(result.externals.some((entry) => entry['@napi-rs/canvas'] === 'commonjs @napi-rs/canvas'), true);
});
