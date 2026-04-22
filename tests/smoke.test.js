import test from 'node:test';
import assert from 'node:assert/strict';

import askrVitePlugin, { askr } from '../src/index.js';

test('exports the askr vite plugin factory', () => {
  assert.equal(typeof askrVitePlugin, 'function');
  assert.equal(askr, askrVitePlugin);
});
