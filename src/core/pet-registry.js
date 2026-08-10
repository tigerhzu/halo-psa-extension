/**
 * pet-registry.js
 *
 * 寵物來源：
 *  1. 內建的三隻舊版 8×9 Codex atlas；
 *  2. assets/codex-pets/<pet-id>/pet.json + spritesheet.webp 的 Codex Pets v2 package。
 *
 * Chrome 122+ 的 foreground runtime API 可以列出 unpacked extension package；
 * content script 透過 src/pets/catalog.html 間接呼叫它，因此不需要手動維護清單。
 */
(function () {
  'use strict';

  const NS = window.__HPX || null;
  const PET_ROOT = 'assets/codex-pets';
  const STANDARD_ANIMATIONS = ['waving', 'waiting', 'review', 'jumping', 'failed', 'running'];
  const DEFAULT_IDLE_ACTIONS = ['waving', 'waiting', 'review'];

  const BUILT_IN_PETS = [
    { id: 'soyo', name: 'Soyo', atlas: PET_ROOT + '/soyo.webp', atlasRows: 9, actions: ['waving', 'waiting'] },
    { id: 'sakiko', name: 'Sakiko', atlas: PET_ROOT + '/sakiko.webp', atlasRows: 9, actions: ['review', 'jumping'] },
    { id: 'rufus', name: 'Rufus', atlas: PET_ROOT + '/rufus.webp', atlasRows: 9, actions: ['running', 'failed'] },
  ];

  function cloneDefinition(definition) {
    return Object.assign({}, definition, {
      actions: Array.isArray(definition.actions) ? definition.actions.slice() : DEFAULT_IDLE_ACTIONS.slice(),
    });
  }

  function safeSegment(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text || text === '.' || text === '..') return '';
    if (/[\\/\u0000-\u001f]/.test(text)) return '';
    return text;
  }

  function safeRelativePath(value) {
    const normalized = String(value == null ? '' : value).trim().replace(/\\/g, '/');
    if (!normalized || normalized.charAt(0) === '/') return '';
    const parts = normalized.split('/');
    if (parts.some(function (part) { return !safeSegment(part); })) return '';
    const ext = parts[parts.length - 1].toLowerCase();
    if (ext.slice(-5) !== '.webp' && ext.slice(-4) !== '.png') return '';
    return parts.join('/');
  }

  function normalizeId(value, fallback) {
    const id = String(value || fallback || '').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) ? id : '';
  }

  function normalizeActions(value) {
    if (!Array.isArray(value)) return DEFAULT_IDLE_ACTIONS.slice();
    const actions = value.filter(function (name, index, list) {
      return STANDARD_ANIMATIONS.indexOf(name) !== -1 && list.indexOf(name) === index;
    });
    return actions.length ? actions : DEFAULT_IDLE_ACTIONS.slice();
  }

  /** 將 Codex Pets v2 的 pet.json 轉成 extension 內部格式。 */
  function normalizeManifest(manifest, folderName) {
    if (!manifest || typeof manifest !== 'object') return null;
    if (Number(manifest.spriteVersionNumber) !== 2) return null;

    const folder = safeSegment(folderName);
    const id = normalizeId(manifest.id, folder);
    const name = String(manifest.displayName || manifest.name || id).trim().slice(0, 80);
    const spritesheetPath = safeRelativePath(manifest.spritesheetPath || 'spritesheet.webp');
    if (!folder || !id || !name || !spritesheetPath) return null;

    return {
      id: id,
      name: name,
      atlas: PET_ROOT + '/' + folder + '/' + spritesheetPath,
      atlasRows: 11,
      spriteVersionNumber: 2,
      actions: normalizeActions(manifest.idleAnimations),
      imported: true,
    };
  }

  function readEntries(directory) {
    return new Promise(function (resolve, reject) {
      if (!directory || typeof directory.createReader !== 'function') {
        resolve([]);
        return;
      }
      const reader = directory.createReader();
      const entries = [];

      function readBatch() {
        reader.readEntries(function (batch) {
          if (!batch || !batch.length) {
            resolve(entries);
            return;
          }
          entries.push.apply(entries, batch);
          readBatch();
        }, reject);
      }

      readBatch();
    });
  }

  function getDirectory(parent, name) {
    return new Promise(function (resolve, reject) {
      if (!parent || typeof parent.getDirectory !== 'function') {
        reject(new Error('directory API unavailable'));
        return;
      }
      parent.getDirectory(name, {}, resolve, reject);
    });
  }

  function getFile(parent, name) {
    return new Promise(function (resolve, reject) {
      if (!parent || typeof parent.getFile !== 'function') {
        reject(new Error('file API unavailable'));
        return;
      }
      parent.getFile(name, {}, resolve, reject);
    });
  }

  function readText(fileEntry) {
    return new Promise(function (resolve, reject) {
      fileEntry.file(function (file) {
        const reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = reject;
        reader.readAsText(file);
      }, reject);
    });
  }

  function packageDirectory() {
    const runtime = typeof chrome !== 'undefined' && chrome.runtime;
    if (!runtime || typeof runtime.getPackageDirectoryEntry !== 'function') {
      return Promise.reject(new Error('package directory API unavailable'));
    }

    try {
      const result = runtime.getPackageDirectoryEntry();
      if (result && typeof result.then === 'function') return result;
    } catch (e) {
      // Older Chromium only exposes the callback form; try it below.
    }

    return new Promise(function (resolve, reject) {
      try {
        runtime.getPackageDirectoryEntry(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function scanPackagePets() {
    const root = await packageDirectory();
    const petsDirectory = await getDirectory(root, 'assets').then(function (assets) {
      return getDirectory(assets, 'codex-pets');
    });
    const entries = await readEntries(petsDirectory);
    const folders = entries.filter(function (entry) { return entry && entry.isDirectory; });
    const imported = [];

    for (const folder of folders) {
      try {
        const manifestFile = await getFile(folder, 'pet.json');
        const manifest = JSON.parse(await readText(manifestFile));
        const definition = normalizeManifest(manifest, folder.name);
        if (definition) imported.push(definition);
      } catch (e) {
        // Ignore non-package folders and incomplete downloads; built-ins remain available.
      }
    }

    return imported;
  }

  function discoverViaCatalogFrame() {
    return new Promise(function (resolve) {
      if (typeof document === 'undefined' || !document.documentElement ||
        typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
        resolve([]);
        return;
      }

      const requestId = 'pet-catalog-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      const frame = document.createElement('iframe');
      let settled = false;

      function finish(pets) {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        resolve(Array.isArray(pets) ? pets : []);
      }

      function onMessage(event) {
        const data = event && event.data;
        if (!data || data.type !== 'HPX_PET_CATALOG_RESULT' || data.requestId !== requestId) return;
        if (event.source !== frame.contentWindow) return;
        finish(data.pets);
      }

      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none;';
      window.addEventListener('message', onMessage);
      frame.src = chrome.runtime.getURL('src/pets/catalog.html') + '?request=' + encodeURIComponent(requestId);
      document.documentElement.appendChild(frame);
      window.setTimeout(function () { finish([]); }, 2500);
    });
  }

  function mergeDefinitions(imported) {
    const definitions = BUILT_IN_PETS.map(cloneDefinition);
    const ids = new Set(definitions.map(function (definition) { return definition.id; }));
    (imported || []).forEach(function (definition) {
      if (!definition || ids.has(definition.id)) return;
      ids.add(definition.id);
      definitions.push(cloneDefinition(definition));
    });
    return definitions;
  }

  let scanPromise = null;

  const PetRegistry = {
    builtIns: function () { return BUILT_IN_PETS.map(cloneDefinition); },
    normalizeManifest: normalizeManifest,
    discoverPackage: scanPackagePets,
    discover: function () {
      if (scanPromise) return scanPromise;
      const canScanFromThisContext = typeof chrome !== 'undefined' && chrome.runtime &&
        typeof chrome.runtime.getPackageDirectoryEntry === 'function';
      const scan = canScanFromThisContext ? scanPackagePets() : discoverViaCatalogFrame();
      scanPromise = scan
        .then(mergeDefinitions)
        .catch(function () { return mergeDefinitions([]); })
        .finally(function () { scanPromise = null; });
      return scanPromise;
    },
  };

  if (NS && NS.core) NS.core.petRegistry = PetRegistry;
  else window.HPX_PET_REGISTRY = PetRegistry;
})();
