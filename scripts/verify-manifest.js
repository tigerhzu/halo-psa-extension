'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
const resources = [
  manifest.background.service_worker,
  manifest.options_ui.page,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(entry => [...(entry.js || []), ...(entry.css || [])]),
  ...manifest.web_accessible_resources.flatMap(entry => entry.resources),
];
for (const resource of resources) {
  assert.ok(!path.isAbsolute(resource) && !resource.split('/').includes('..'), 'Unsafe manifest resource: ' + resource);
  const candidate = path.join(root, resource.replace(/\/\*$/, ''));
  assert.ok(fs.existsSync(candidate), 'Missing manifest resource: ' + resource);
}
const scripts = manifest.content_scripts.find(entry => (entry.js || []).includes('src/content.js')).js;
assert.equal(scripts[0], 'src/core/namespace.js');
assert.equal(scripts[scripts.length - 1], 'src/content.js');
assert.equal(manifest.content_scripts.filter(entry => entry.world === 'MAIN').length, 1);
assert.ok(!manifest.permissions.includes('<all_urls>'));
assert.ok(!manifest.host_permissions.includes('<all_urls>'));
console.log('Manifest verified: ' + resources.length + ' resource references; namespace/entry order and MAIN bridge group are valid.');
