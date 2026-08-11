'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const writes = [];
const toasts = [];

global.window = global;
global.window.__HPX = {
  config: {},
  core: {
    adapter: {
      getText: function () {
        return 'existing content';
      },
      insertText: function (editor, text) {
        writes.push({ editor: editor, text: text });
        return Promise.resolve({ ok: true, via: 'test' });
      },
    },
  },
  features: {},
  ui: {
    toast: {
      show: function (message, options) {
        toasts.push({ message: message, options: options });
      },
    },
  },
  warn: function () {},
};

const root = path.join(__dirname, '..', 'src');
require(path.join(root, 'config', 'template-data.js'));
require(path.join(root, 'features', 'templates.js'));

const templates = window.__HPX.features.templates;
assert.equal(templates.list().length, 4, 'Four quick templates must be present.');

(async function () {
  for (const template of templates.list()) {
    const inserted = await templates.insert(template.id, { id: template.id });
    assert.equal(inserted, true);
    assert.equal(writes.at(-1).text, '\n' + template.content);
    assert.equal(toasts.at(-1).options.type, 'success');
  }

  const before = writes.length;
  assert.equal(await templates.insert('missing', {}), undefined);
  assert.equal(writes.length, before, 'Unknown templates must not write to an editor.');

  console.log('templates.test.js: 18 assertions passed');
})();
