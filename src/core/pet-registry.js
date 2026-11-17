/**
 * pet-registry.js
 *
 * 寵物來源：
 *  1. 內建的三隻舊版 8×9 Codex atlas；
 *  2. pet/<pet-id>/pet.json + spritesheet.webp 的 Codex Pets package（v1 / v2）；
 *  3. 舊有 assets/codex-pets/<pet-id>/ package（持續相容）。
 *
 * Chrome 122+ 的 foreground runtime API 可以列出 unpacked extension package；
 * content script 透過 src/pets/catalog.html 間接呼叫它，因此不需要手動維護清單。
 */
(function () {
  'use strict';

  const NS = window.__HPX || null;
  const PET_ROOT = 'assets/codex-pets';
  const CUSTOM_PET_ROOT = 'pet';
  const STANDARD_ANIMATIONS = ['waving', 'waiting', 'review', 'jumping', 'failed', 'running'];
  const DEFAULT_IDLE_ACTIONS = ['waving', 'waiting', 'review'];

  const BUILT_IN_PETS = [
    { id: 'soyo', name: 'Soyo', atlas: PET_ROOT + '/soyo.webp', atlasRows: 9, actions: ['waving', 'waiting'] },
    { id: 'sakiko', name: 'Sakiko', atlas: PET_ROOT + '/sakiko.webp', atlasRows: 9, actions: ['review', 'jumping'] },
    { id: 'rufus', name: 'Rufus', atlas: PET_ROOT + '/rufus.webp', atlasRows: 9, actions: ['running', 'failed'] },
    { id: 'claude-crab', name: 'Claude Crab', atlas: CUSTOM_PET_ROOT + '/claude-crab/spritesheet.webp', atlasRows: 9, actions: ['waving', 'waiting', 'review'] },
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

  /** 將 Codex Pets v1 / v2 的 pet.json 轉成 extension 內部格式。 */
  function normalizeManifest(manifest, folderName, assetRoot) {
    if (!manifest || typeof manifest !== 'object') return null;
    const spriteVersionNumber = manifest.spriteVersionNumber == null
      ? 1
      : Number(manifest.spriteVersionNumber);
    if (spriteVersionNumber !== 1 && spriteVersionNumber !== 2) return null;

    const folder = safeSegment(folderName);
    const id = normalizeId(manifest.id, folder);
    const name = String(manifest.displayName || manifest.name || id).trim().slice(0, 80);
    const spritesheetPath = safeRelativePath(manifest.spritesheetPath || 'spritesheet.webp');
    if (!folder || !id || !name || !spritesheetPath) return null;

    return {
      id: id,
      name: name,
      description: String(manifest.description || '').slice(0, 2000),
      atlas: (assetRoot || PET_ROOT) + '/' + folder + '/' + spritesheetPath,
      atlasRows: spriteVersionNumber === 2 ? 11 : 9,
      spriteVersionNumber: spriteVersionNumber,
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

  async function getDirectoryPath(root, segments) {
    let directory = root;
    for (const segment of segments) {
      directory = await getDirectory(directory, segment);
    }
    return directory;
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
    const imported = [];

    const packageRoots = [
      { segments: [CUSTOM_PET_ROOT], assetRoot: CUSTOM_PET_ROOT },
      { segments: ['assets', 'codex-pets'], assetRoot: PET_ROOT },
    ];
    for (const packageRoot of packageRoots) {
      try {
        const petsDirectory = await getDirectoryPath(root, packageRoot.segments);
        const entries = await readEntries(petsDirectory);
        const folders = entries.filter(function (entry) { return entry && entry.isDirectory; });
        for (const folder of folders) {
          try {
            const manifestFile = await getFile(folder, 'pet.json');
            const manifest = JSON.parse(await readText(manifestFile));
            const definition = normalizeManifest(manifest, folder.name, packageRoot.assetRoot);
            if (definition) imported.push(definition);
          } catch (e) {
            // Ignore incomplete pet folders and continue discovering the rest.
          }
        }
      } catch (e) {
        // A missing optional pet folder must not prevent built-in pets loading.
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
    (imported || []).forEach(function (definition) {
      if (!definition) return;
      const index = definitions.findIndex(function (item) { return item.id === definition.id; });
      if (index < 0) definitions.push(cloneDefinition(definition));
      else definitions[index] = cloneDefinition(definition);
    });
    return definitions;
  }

  // Backups embed only raster images, never remote URLs or executable content.
  function normalizePackages(packages) {
    if (!Array.isArray(packages) || packages.length > 100) throw new Error('Pet 備份清單格式不正確。');
    const ids = new Set();
    return packages.map(function (item) {
      const manifest = item && item.manifest;
      const id = manifest && normalizeId(manifest.id);
      const definition = id && normalizeManifest(manifest, id);
      const dataUrl = item && item.spritesheet;
      if (!definition || ids.has(id) || typeof dataUrl !== 'string' || dataUrl.length > 10 * 1024 * 1024) {
        throw new Error('Pet 備份內容不正確。');
      }
      const match = /^data:image\/(webp|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
      if (!match || match[2].length % 4 !== 0) throw new Error('Pet 圖集必須是 PNG 或 WebP 圖片。');
      const header = atob(match[2].slice(0, 32));
      if (match[1] === 'webp'
        ? header.slice(0, 4) !== 'RIFF' || header.slice(8, 12) !== 'WEBP'
        : header.slice(0, 8) !== '\x89PNG\r\n\x1a\n') throw new Error('Pet 圖集內容無效。');
      ids.add(id);
      return {
        manifest: {
          id: id, displayName: definition.name, description: definition.description,
          spriteVersionNumber: definition.spriteVersionNumber,
          spritesheetPath: 'spritesheet.' + match[1], idleAnimations: definition.actions,
        },
        spritesheet: dataUrl,
      };
    });
  }

  function packageDefinitions(packages) {
    return normalizePackages(packages).map(function (item) {
      const definition = normalizeManifest(item.manifest, item.manifest.id);
      definition.atlas = item.spritesheet;
      return definition;
    });
  }

  async function importFiles(manifestFile, spriteFile, folderName) {
    if (!manifestFile || !spriteFile) throw new Error('請選擇 pet.json 與對應的圖集檔。');
    if (manifestFile.size > 256 * 1024) throw new Error('pet.json 不可超過 256 KB。');
    if (spriteFile.size > 7 * 1024 * 1024) throw new Error('Pet 圖集不可超過 7 MB。');
    let manifest;
    try { manifest = JSON.parse(await manifestFile.text()); }
    catch (_) { throw new Error('pet.json 不是有效的 JSON。'); }
    const definition = manifest && normalizeManifest(manifest, folderName || manifest.id);
    if (!definition) throw new Error('pet.json 須包含有效的 id，並使用支援的 v1 或 v2 圖集設定。');
    manifest.id = definition.id;
    const expectedName = (manifest.spritesheetPath || 'spritesheet.webp').replace(/\\/g, '/').split('/').pop();
    if (spriteFile.name !== expectedName) throw new Error('請選擇 pet.json 指定的圖集：' + expectedName);
    const bytes = new Uint8Array(await spriteFile.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192));
    }
    const type = expectedName.toLowerCase().endsWith('.png') ? 'png' : 'webp';
    const pet = normalizePackages([{ manifest: manifest, spritesheet: 'data:image/' + type + ';base64,' + btoa(binary) }])[0];
    let bitmap;
    try { bitmap = await createImageBitmap(spriteFile); }
    catch (_) { throw new Error('無法解碼 Pet 圖集，請確認圖片未損毀。'); }
    const validGrid = bitmap.width > 0 && bitmap.height > 0 && bitmap.width % 8 === 0 && bitmap.height % definition.atlasRows === 0;
    bitmap.close();
    if (!validGrid) throw new Error('圖集尺寸須能整齊分成 8 × ' + definition.atlasRows + ' 個影格。');
    return pet;
  }

  async function importFolder(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) throw new Error('請選擇包含 pet.json 的 Pet 資料夾。');
    const byPath = new Map();
    let root = '';
    files.forEach(function (file) {
      const path = file.webkitRelativePath || '';
      const parts = path.split('/');
      if (parts.length < 2 || parts.some(function (part) { return !safeSegment(part); }) ||
        (root && root !== parts[0]) || byPath.has(path)) {
        throw new Error('請一次選擇一個完整的 Pet 資料夾。');
      }
      root = parts[0];
      byPath.set(path, file);
    });
    const manifestFile = byPath.get(root + '/pet.json');
    if (!manifestFile) throw new Error('所選資料夾內找不到 pet.json，請選擇該寵物的資料夾，而非上層資料夾。');
    if (manifestFile.size > 256 * 1024) throw new Error('pet.json 不可超過 256 KB。');
    let manifest;
    try { manifest = JSON.parse(await manifestFile.text()); }
    catch (_) { throw new Error('pet.json 不是有效的 JSON。'); }
    const spritePath = manifest && safeRelativePath(manifest.spritesheetPath || 'spritesheet.webp');
    if (!spritePath) throw new Error('pet.json 的 spritesheetPath 須指向資料夾內的 PNG 或 WebP 圖集。');
    const spriteFile = byPath.get(root + '/' + spritePath);
    if (!spriteFile) throw new Error('資料夾內缺少指定的 Pet 圖集：' + spritePath);
    return importFiles(manifestFile, spriteFile, root);
  }

  function readSavedPackages() {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get('hpx_settings', function (data) {
        const error = chrome.runtime.lastError;
        if (error) { reject(new Error(error.message)); return; }
        resolve(((data || {}).hpx_settings || {}).petPackages || []);
      });
    });
  }

  async function exportPackages(settings) {
    const canScan = typeof chrome.runtime.getPackageDirectoryEntry === 'function';
    const packaged = canScan ? await scanPackagePets() : [];
    const restored = packageDefinitions(settings.petPackages || []);
    const definitions = mergeDefinitions(packaged.concat(restored));
    const selected = settings.pet || 'claude-crab';
    if (!definitions.some(function (item) { return item.id === selected; })) {
      throw new Error('找不到目前 Pet（' + selected + '）的資料，請先還原寵物資料夾。');
    }
    const packages = [];
    // Other built-ins ship with the extension; preserve the selected pet and
    // every custom/restored pet without duplicating all bundled image assets.
    for (const definition of definitions.filter(function (item) { return item.id === selected || item.imported; })) {
      let dataUrl = definition.atlas;
      if (!dataUrl.startsWith('data:')) {
        const response = await fetch(chrome.runtime.getURL(definition.atlas));
        if (!response.ok) throw new Error('無法讀取 Pet 圖集：' + definition.name);
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192));
        }
        const type = definition.atlas.toLowerCase().endsWith('.png') ? 'png' : 'webp';
        dataUrl = 'data:image/' + type + ';base64,' + btoa(binary);
      }
      packages.push({
        manifest: {
          id: definition.id, displayName: definition.name, description: definition.description || '',
          spriteVersionNumber: definition.atlasRows === 11 ? 2 : 1,
          idleAnimations: definition.actions,
        },
        spritesheet: dataUrl,
      });
    }
    return normalizePackages(packages);
  }

  let scanPromise = null;

  const PetRegistry = {
    builtIns: function () { return BUILT_IN_PETS.map(cloneDefinition); },
    normalizeManifest: normalizeManifest,
    normalizePackages: normalizePackages,
    exportPackages: exportPackages,
    importFiles: importFiles,
    importFolder: importFolder,
    discoverPackage: scanPackagePets,
    discover: function () {
      if (scanPromise) return scanPromise;
      const canScanFromThisContext = typeof chrome !== 'undefined' && chrome.runtime &&
        typeof chrome.runtime.getPackageDirectoryEntry === 'function';
      const scan = canScanFromThisContext ? scanPackagePets() : discoverViaCatalogFrame();
      scanPromise = Promise.all([
        scan.catch(function () { return []; }),
        readSavedPackages().then(packageDefinitions).catch(function () { return []; }),
      ])
        .then(function (sources) { return mergeDefinitions(sources[0].concat(sources[1])); })
        .finally(function () { scanPromise = null; });
      return scanPromise;
    },
  };

  if (NS && NS.core) NS.core.petRegistry = PetRegistry;
  else window.HPX_PET_REGISTRY = PetRegistry;
})();
