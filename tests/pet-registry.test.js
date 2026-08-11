'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src/core/pet-registry.js'), 'utf8');
const sandbox = {
  window: { __HPX: { core: {} } },
  console,
  Promise,
  Set,
};
vm.runInNewContext(source, sandbox, { filename: 'pet-registry.js' });

const registry = sandbox.window.__HPX.core.petRegistry;
assert.equal(JSON.stringify(registry.builtIns().map((pet) => pet.id)), JSON.stringify(['soyo', 'sakiko', 'rufus', 'claude-crab']));
assert.equal(registry.builtIns()[0].atlasRows, 9);
assert.equal(registry.builtIns()[3].atlas, 'pet/claude-crab/spritesheet.webp');

const imported = registry.normalizeManifest({
  id: 'moon-cat',
  displayName: 'Moon Cat',
  spriteVersionNumber: 2,
  spritesheetPath: 'spritesheet.webp',
}, 'moon-cat');
assert.equal(JSON.stringify(imported), JSON.stringify({
  id: 'moon-cat',
  name: 'Moon Cat',
  atlas: 'assets/codex-pets/moon-cat/spritesheet.webp',
  atlasRows: 11,
  spriteVersionNumber: 2,
  actions: ['waving', 'waiting', 'review'],
  imported: true,
}));

const legacyImported = registry.normalizeManifest({
  id: 'pixel-crab',
  displayName: 'Pixel Crab',
  spritesheetPath: 'spritesheet.webp',
}, 'pixel-crab', 'pet');
assert.equal(JSON.stringify(legacyImported), JSON.stringify({
  id: 'pixel-crab',
  name: 'Pixel Crab',
  atlas: 'pet/pixel-crab/spritesheet.webp',
  atlasRows: 9,
  spriteVersionNumber: 1,
  actions: ['waving', 'waiting', 'review'],
  imported: true,
}));

assert.equal(registry.normalizeManifest({
  id: 'bad',
  displayName: 'Bad',
  spriteVersionNumber: 3,
  spritesheetPath: 'spritesheet.webp',
}, 'bad'), null);
assert.equal(registry.normalizeManifest({
  id: 'bad-path',
  displayName: 'Bad Path',
  spriteVersionNumber: 2,
  spritesheetPath: '../spritesheet.webp',
}, 'bad-path'), null);

console.log('pet-registry.test.js ✓ built-ins and Codex Pets v1/v2 manifest validation passed');
