'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const optionsSource = fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8');

// Exercise the production import path independently of the settings page's DOM.
function functionSource(name) {
  const start = optionsSource.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Production function exists: ' + name);
  const end = optionsSource.indexOf('\nfunction ', start + 1);
  return optionsSource.slice(start, end < 0 ? optionsSource.length : end);
}

function createImporter(initialSettings) {
  let stored = structuredClone(initialSettings);
  const writes = [];
  const statuses = [];
  const context = {
    console,
    Promise,
    setTimeout: function (callback) { callback(); },
    FileReader: class {
      readAsText(file) { this.result = file.text; this.onload(); }
    },
    chrome: {
      runtime: {},
      storage: { local: {
        get: function (key, callback) { callback({ [key]: structuredClone(stored) }); },
        set: function (payload, callback) {
          stored = structuredClone(payload.hpx_settings);
          writes.push(stored);
          callback();
        },
      } },
    },
    els: { backupStatus: {} },
    enqueueStorageWrite: function (task) { return task(); },
    setStatus: function (node, text, kind) { statuses.push({ text, kind }); },
  };
  context.window = context;
  context.location = { reload: function () {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/ai/provider-settings.js'), 'utf8'), context);
  vm.runInContext(optionsSource.slice(0, optionsSource.indexOf('const $ =')), context);
  [
    'normalizeTeamList', 'normalizeImportedSettings', 'mergeImportedSettings',
    'readStoredSettings', 'replaceStoredSettings', 'importSettingsFromFile',
  ].forEach(function (name) { vm.runInContext(functionSource(name), context); });
  return {
    async import(payload) {
      context.importSettingsFromFile({ size: 100, text: JSON.stringify(payload) });
      await new Promise(setImmediate);
      return { stored, writes, statuses };
    },
  };
}

function backup(settings, includeApiKeys) {
  return { format: 'halo-psa-extension-settings', version: 1, includeApiKeys, settings };
}

test('no-secret import preserves the local provider and all local key fields while restoring preferences', async function () {
  const importer = createImporter({ provider: 'azure-deepseek', azureApiKey: 'local-azure', ornithApiKey: '', apiKey: 'legacy-key', accent: '#000000' });
  const result = await importer.import(backup({ provider: 'azure-deepseek', azureEndpoint: 'https://saved.openai.azure.com', azureDeployment: 'saved-model', accent: '#176b5b' }, false));
  assert.equal(result.writes.length, 1);
  assert.equal(result.stored.provider, 'azure-deepseek');
  assert.equal(result.stored.azureApiKey, 'local-azure');
  assert.equal(result.stored.ornithApiKey, '');
  assert.equal(result.stored.apiKey, 'legacy-key');
  assert.equal(result.stored.accent, '#176b5b');
  assert.equal(result.statuses.at(-1).kind, 'ok');
});

test('no-secret import selecting the other provider fails before changing local settings', async function () {
  const initial = { provider: 'azure-deepseek', azureApiKey: 'local-azure', ornithApiKey: '', accent: '#325d83' };
  const importer = createImporter(initial);
  const result = await importer.import(backup({ provider: 'ornith', accent: '#176b5b' }, false));
  assert.equal(result.writes.length, 0);
  assert.deepEqual(result.stored, initial);
  assert.equal(result.statuses.at(-1).kind, 'err');
  assert.match(result.statuses.at(-1).text, /Azure OpenAI 已設定/);
});

test('no-secret flag ignores supplied credentials and infers an omitted provider from the local key', async function () {
  const importer = createImporter({ ornithApiKey: 'local-ornith', azureApiKey: '' });
  const result = await importer.import(backup({ azureApiKey: 'foreign-azure', ornithApiKey: 'foreign-ornith', apiKey: 'foreign-legacy' }, false));
  assert.equal(result.writes.length, 1);
  assert.equal(result.stored.provider, 'ornith');
  assert.equal(result.stored.ornithApiKey, 'local-ornith');
  assert.equal(result.stored.azureApiKey, '');
  assert.equal(result.stored.apiKey, '');
});

test('complete backup still replaces credentials and may explicitly switch provider', async function () {
  const importer = createImporter({ provider: 'azure-deepseek', azureApiKey: 'old-azure' });
  const result = await importer.import(backup({ provider: 'ornith', ornithApiKey: 'restored-ornith' }, true));
  assert.equal(result.writes.length, 1);
  assert.equal(result.stored.provider, 'ornith');
  assert.equal(result.stored.ornithApiKey, 'restored-ornith');
  assert.equal(result.stored.azureApiKey, '');
});

test('only an explicit false envelope flag preserves keys; legacy raw imports keep replacement semantics', async function () {
  for (const payload of [
    backup({ provider: 'ornith', ornithApiKey: 'restored-key' }, undefined),
    backup({ provider: 'ornith', ornithApiKey: 'restored-key' }, 'false'),
    { provider: 'ornith', ornithApiKey: 'restored-key', includeApiKeys: false },
  ]) {
    const result = await createImporter({ provider: 'ornith', ornithApiKey: 'local-key' }).import(payload);
    assert.equal(result.writes.length, 1);
    assert.equal(result.stored.ornithApiKey, 'restored-key');
  }
});

test('complete backups with both providers configured are rejected without any write', async function () {
  const initial = { provider: 'ornith', ornithApiKey: 'local-key' };
  const result = await createImporter(initial).import(backup({ provider: 'ornith', ornithApiKey: 'first-key', azureApiKey: 'second-key' }, true));
  assert.equal(result.writes.length, 0);
  assert.deepEqual(result.stored, initial);
  assert.equal(result.statuses.at(-1).kind, 'err');
  assert.match(result.statuses.at(-1).text, /不可同時保存/);
});
