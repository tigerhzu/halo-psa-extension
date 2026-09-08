'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('detail panels stay visible until JavaScript explicitly filters their rows', function () {
  const css = fs.readFileSync(path.join(ROOT, 'src/ultimate-mode/ultimate.css'), 'utf8');

  assert.match(css, /\.halo-ultimate-hidden\s*\{\s*display:\s*none\s*!important;/);
  assert.equal(css.includes(':not([data-hpx-ultimate-keep="ticket-info"])'), false);
  assert.equal(css.includes(':not([data-hpx-ultimate-keep="user-info"])'), false);
});
