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
  const downloads = [];
  const context = {
    console,
    Promise,
    Blob,
    atob,
    btoa,
    createImageBitmap: async function () { return { width: 1536, height: 1872, close() {} }; },
    fetch: async function (url) {
      const bytes = fs.readFileSync(path.join(ROOT, url));
      return { ok: true, arrayBuffer: async function () { return bytes; } };
    },
    setTimeout: function (callback) { callback(); },
    FileReader: class {
      readAsText(file) { this.result = file.text; this.onload(); }
    },
    chrome: {
      runtime: { getURL: function (asset) { return asset; } },
      storage: { local: {
        get: function (key, callback) { callback({ [key]: structuredClone(stored) }); },
        set: function (payload, callback) {
          stored = structuredClone(payload.hpx_settings);
          writes.push(stored);
          callback();
        },
      } },
    },
    els: {
      backupStatus: {},
    },
    enqueueStorageWrite: function (task) { return task(); },
    setStatus: function (node, text, kind) { statuses.push({ text, kind }); },
  };
  context.window = context;
  context.location = { reload: function () {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/ai/provider-settings.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/pet-registry.js'), 'utf8'), context);
  vm.runInContext(optionsSource.slice(0, optionsSource.indexOf('const $ =')), context);
  [
    'normalizeTeamList', 'normalizeImportedSettings', 'mergeImportedSettings',
    'readStoredSettings', 'replaceStoredSettings', 'importSettingsFromFile', 'exportSettings',
  ].forEach(function (name) { vm.runInContext(functionSource(name), context); });
  context.liveSettingsSnapshot = context.readStoredSettings;
  context.downloadSettingsJson = function (payload) { downloads.push(JSON.parse(JSON.stringify(payload))); };
  return {
    async import(payload) {
      const text = JSON.stringify(payload);
      context.importSettingsFromFile({ size: Buffer.byteLength(text), text });
      await new Promise(setImmediate);
      return { stored, writes, statuses };
    },
    async export(includeApiKeys) {
      await context.exportSettings(includeApiKeys);
      return { downloads, statuses };
    },
    context,
    statuses,
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
  assert.equal(result.stored.accent, '#ff7a1a');
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

test('import replaces backup wallpaper with the shared orange glass preset', async function () {
  const importer = createImporter({ provider: 'ornith', ornithApiKey: 'local-key', wash: 'none' });
  const result = await importer.import(backup({ provider: 'ornith', wash: 'aurora', washIntensity: 80, opacity: 70 }, false));
  assert.equal(result.writes.length, 1);
  assert.equal(result.stored.theme, 'cute-ios');
  assert.equal(result.stored.accent, '#ff7a1a');
  assert.equal(result.stored.wash, 'ocean');
  assert.equal(result.stored.washIntensity, 42);
  assert.equal(result.stored.opacity, 55);
  assert.equal(result.stored.ornithApiKey, 'local-key');
});

test('all backup formats reset appearance while restoring Pet and functional settings', async function () {
  const appearance = { theme: 'cute-ios', accent: '#ff7a1a', opacity: 55, wash: 'ocean', washIntensity: 42 };
  for (const backupAppearance of [
    { theme: 'default', accent: '#176b5b', opacity: 100, wash: 'sakura', washIntensity: 90 },
    { theme: null, accent: 'bad', opacity: -1, wash: null, washIntensity: 'invalid' },
    {},
  ]) {
    const settings = Object.assign({
      provider: 'ornith', ornithApiKey: 'backup-key', pet: 'my-pet', petHidden: true,
      petPosition: { right: 80, bottom: 90 }, petPackages: [customPet()],
      ultimateMode: true, ultimateTeams: ['Op Team B'],
      shortcutLinks: [{ name: 'Wiki', url: 'https://example.com/wiki' }],
      contactGroups: [{ name: 'Support', members: [] }],
    }, backupAppearance);
    for (const payload of [settings, backup(settings, true), backup(settings, false),
      { ...backup(settings, true), version: 2 }, { ...backup(settings, false), version: 2 }]) {
      const initial = { provider: 'ornith', ornithApiKey: 'local-key', theme: 'default', accent: '#000000', opacity: 100, wash: 'none', washIntensity: 0 };
      const result = await createImporter(initial).import(payload);
      assert.equal(result.writes.length, 1);
      for (const field of Object.keys(appearance)) assert.equal(result.stored[field], appearance[field], field);
      for (const field of ['pet', 'petHidden', 'petPosition', 'ultimateMode', 'ultimateTeams', 'shortcutLinks', 'contactGroups']) {
        assert.deepEqual(result.stored[field], settings[field], field);
      }
      assert.equal(result.stored.petPackages[0].spritesheet, settings.petPackages[0].spritesheet);
      assert.equal(result.stored.ornithApiKey, payload.includeApiKeys === false ? 'local-key' : 'backup-key');
    }
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

test('both export modes include default pet assets and preserve the API key policy', async function () {
  for (const includeApiKeys of [true, false]) {
    const result = await createImporter({ provider: 'ornith', ornithApiKey: 'secret', apiKey: 'legacy' }).export(includeApiKeys);
    assert.equal(result.statuses.at(-1).kind, 'ok');
    const payload = result.downloads[0];
    assert.equal(payload.version, 2);
    assert.equal(payload.settings.pet, 'claude-crab');
    assert.deepEqual(payload.settings.petPosition, { right: 16, bottom: 16 });
    assert.equal(payload.settings.petHidden, false);
    const pet = payload.settings.petPackages[0];
    assert.equal(pet.manifest.displayName, 'Claude Crab');
    assert.deepEqual(Buffer.from(pet.spritesheet.split(',')[1], 'base64'), fs.readFileSync(path.join(ROOT, 'pet/claude-crab/spritesheet.webp')));
    assert.equal(payload.settings.ornithApiKey, includeApiKeys ? 'secret' : undefined);
    assert.equal(payload.settings.apiKey, includeApiKeys ? 'legacy' : undefined);
  }
});

function customPet() {
  return {
    manifest: { id: 'my-pet', displayName: '我的 Pet', description: '自訂工作夥伴', spriteVersionNumber: 2, idleAnimations: ['jumping', 'review'] },
    spritesheet: 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, 'pet/claude-crab/spritesheet.webp')).toString('base64'),
  };
}

test('custom v2 pets round-trip with metadata, image, position, visibility and quick links', async function () {
  const settings = {
    pet: 'my-pet', petHidden: true, petPosition: { right: 123, bottom: 45 },
    shortcutLinks: [{ name: '知識庫', url: 'https://example.com/wiki' }], petPackages: [customPet()],
  };
  const exported = await createImporter(settings).export(false);
  const payload = exported.downloads[0];
  const destination = createImporter({});
  const imported = await destination.import(payload);
  assert.equal(imported.statuses.at(-1).kind, 'ok');
  for (const field of ['pet', 'petHidden', 'petPosition', 'shortcutLinks']) assert.deepEqual(imported.stored[field], settings[field]);
  const pets = await destination.context.HPX_PET_REGISTRY.discover();
  const restored = pets.find(function (pet) { return pet.id === 'my-pet'; });
  assert.equal(restored.name, '我的 Pet');
  assert.equal(restored.description, '自訂工作夥伴');
  assert.equal(restored.atlasRows, 11);
  assert.equal(restored.atlas, settings.petPackages[0].spritesheet);
  assert.deepEqual(Array.from(restored.actions), ['jumping', 'review']);
  const reexported = await destination.export(false);
  assert.deepEqual(reexported.downloads[0].settings.petPackages, payload.settings.petPackages);
});

test('legacy imports retain restored pet assets', async function () {
  const initial = { petPackages: [customPet()] };
  const result = await createImporter(initial).import(backup({ pet: 'my-pet' }, false));
  assert.deepEqual(result.stored.petPackages, initial.petPackages);
});

test('invalid pet assets reject the entire import before any write', async function () {
  for (const mutate of [
    function (pet) { pet.spritesheet = 'https://example.com/pet.webp'; },
    function (pet) { pet.spritesheet = 'data:image/svg+xml;base64,PHN2Zy8+'; },
    function (pet) { pet.spritesheet = 'data:image/webp;base64,YmFk'; },
    function (pet) { pet.manifest.spriteVersionNumber = 3; },
    function (pet) { pet.manifest.id = '../oops'; },
  ]) {
    const pet = customPet();
    mutate(pet);
    const result = await createImporter({ pet: 'soyo' }).import(backup({ petPackages: [pet] }, false));
    assert.equal(result.writes.length, 0);
    assert.equal(result.statuses.at(-1).kind, 'err');
    assert.equal(result.stored.pet, 'soyo');
  }
});

test('storage read and missing pet asset failures do not download incomplete backups', async function () {
  for (const failure of ['storage', 'image', 'missing-pet']) {
    const exporter = createImporter({ pet: failure === 'missing-pet' ? 'unavailable' : 'claude-crab' });
    if (failure === 'storage') exporter.context.chrome.runtime.lastError = { message: 'read failed' };
    if (failure === 'image') exporter.context.fetch = async function () { return { ok: false }; };
    const result = await exporter.export(false);
    assert.equal(result.downloads.length, 0);
    assert.equal(result.statuses.at(-1).kind, 'err');
  }
});

test('pet backups larger than the old 5 MB limit import; files over 10 MB do not write', async function () {
  const packages = Array.from({ length: 5 }, function (_, index) {
    const pet = customPet();
    pet.manifest.id = 'my-pet-' + index;
    return pet;
  });
  const payload = backup({ petPackages: packages }, false);
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) > 5 * 1024 * 1024);
  const result = await createImporter({}).import(payload);
  assert.equal(result.writes.length, 1);
  assert.equal(result.stored.petPackages.length, 5);
  const oversized = createImporter({});
  oversized.context.importSettingsFromFile({ size: 11 * 1024 * 1024, text: JSON.stringify(payload) });
  assert.deepEqual(await oversized.context.readStoredSettings(), {});
});

test('package directory discovery exports unselected custom pets and their manifest descriptions', async function () {
  const exporter = createImporter({ pet: 'soyo' });
  const manifest = { id: 'folder-pet', displayName: 'Folder Pet', description: 'Packaged description', spriteVersionNumber: 2 };
  const folder = {
    name: 'folder-pet', isDirectory: true,
    getFile(name, options, resolve) { resolve({ file(callback) { callback({ text: JSON.stringify(manifest) }); } }); },
  };
  const directory = {
    createReader() {
      let sent = false;
      return { readEntries(callback) { const batch = sent ? [] : [folder]; sent = true; callback(batch); } };
    },
  };
  exporter.context.chrome.runtime.getPackageDirectoryEntry = async function () {
    return { getDirectory(name, options, resolve, reject) { if (name === 'pet') resolve(directory); else reject(new Error('missing')); } };
  };
  const originalFetch = exporter.context.fetch;
  exporter.context.fetch = function (url) { return originalFetch(url === 'pet/folder-pet/spritesheet.webp' ? 'pet/claude-crab/spritesheet.webp' : url); };
  const result = await exporter.export(false);
  assert.equal(result.statuses.at(-1).kind, 'ok');
  const packages = result.downloads[0].settings.petPackages;
  assert.deepEqual(packages.map(function (item) { return item.manifest.id; }), ['soyo', 'folder-pet']);
  assert.equal(packages[1].manifest.description, manifest.description);
  assert.equal(packages[1].manifest.spriteVersionNumber, 2);
});

test('storage quota errors report failed imports without claiming success or replacing settings', async function () {
  const importer = createImporter({ pet: 'soyo' });
  importer.context.chrome.storage.local.set = function (_, callback) {
    importer.context.chrome.runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
    callback();
    delete importer.context.chrome.runtime.lastError;
  };
  const result = await importer.import(backup({ pet: 'my-pet', petPackages: [customPet()] }, false));
  assert.equal(result.writes.length, 0);
  assert.equal(result.stored.pet, 'soyo');
  assert.equal(result.statuses.at(-1).kind, 'err');
  assert.match(result.statuses.at(-1).text, /QUOTA_BYTES/);
});

test('exports above the import size limit fail before creating a download', function () {
  const exporter = createImporter({});
  vm.runInContext(functionSource('downloadSettingsJson'), exporter.context);
  assert.throws(function () { exporter.context.downloadSettingsJson({ data: 'x'.repeat(10 * 1024 * 1024) }, false); }, /超過 10 MB/);
});

test('options page no longer exposes the Pet import page', function () {
  const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
  assert.doesNotMatch(html, /href="#pets"|id="pets"|id="petFolder"/);
  assert.doesNotMatch(optionsSource, /importPetFromFolder|petImportForm/);
});
