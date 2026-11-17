'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = process.env.HPX_TEST_ROOT || path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function fakeRoot() {
  const attrs = {};
  const vars = {};
  return {
    attrs,
    vars,
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return name in attrs ? attrs[name] : null; },
    hasAttribute(name) { return name in attrs; },
    removeAttribute(name) { delete attrs[name]; },
    style: { setProperty(name, value) { vars[name] = String(value); } },
  };
}

// The wallpaper state the page ends up with, whichever script wrote it.
function wallpaperState(rootEl) {
  return {
    wash: rootEl.attrs['data-hpxg-wash'],
    strength: rootEl.vars['--hpxg-wash'],
    surface: rootEl.vars['--hpxg-surface'],
  };
}

function loadTheme() {
  const rootEl = fakeRoot();
  const window = { localStorage: { getItem: () => null } };
  const document = {
    documentElement: rootEl,
    // Reports a standalone extension page, so applyAppearance skips Halo sidebar discovery.
    querySelector: () => ({}),
  };
  const context = vm.createContext({ window, document, console });
  vm.runInContext(read('src/core/namespace.js'), context);
  vm.runInContext(read('src/ui/theme.js'), context);
  return { theme: window.__HPX.ui.theme, rootEl };
}

function runBootstrap(settings) {
  const rootEl = fakeRoot();
  const window = {
    location: { href: 'https://example.halopsa.com/tickets' },
    sessionStorage: { getItem: () => null },
    setTimeout() {},
  };
  const document = {
    documentElement: rootEl,
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({}),
    querySelectorAll: () => [],
  };
  const chrome = { storage: { local: { get(key, callback) { callback({ [key]: settings }); } } } };
  vm.runInNewContext(read('src/ultimate-mode/bootstrap.js'), { window, document, chrome, URL });
  return rootEl;
}

test('every wallpaper preset in theme.js has its colours in glass.css, and nothing extra', () => {
  const { theme } = loadTheme();
  // Array.from: theme.WASHES lives in the VM realm, and deepEqual compares prototypes.
  const listed = Array.from(theme.WASHES, wash => wash.id).filter(id => id !== 'none').sort();
  const css = read('src/styles/glass.css');
  const defined = Array.from(css.matchAll(/^\[data-hpxg-wash="([a-z]+)"\]\s*\{([^}]*)\}/gm));
  assert.deepEqual(defined.map(match => match[1]).sort(), listed);
  for (const match of defined) {
    for (const colour of ['--w1', '--w2', '--w3', '--w4']) {
      assert.ok(match[2].includes(colour + ':'), match[1] + ' defines ' + colour);
    }
  }
  assert.equal(theme.WASHES[0].id, 'none', 'the off switch comes first in the picker');
  assert.ok(theme.WASHES.every(wash => wash.name), 'every preset has a label');
});

test('wallpaper settings are clamped to the supported ranges', () => {
  const { theme } = loadTheme();
  assert.deepEqual({ ...theme.normalizeWallpaper({}) }, { wash: 'ocean', washIntensity: 42, opacity: 55 });
  assert.deepEqual({ ...theme.normalizeWallpaper(null) }, { wash: 'ocean', washIntensity: 42, opacity: 55 });
  assert.deepEqual(
    { ...theme.normalizeWallpaper({ wash: 'aurora', washIntensity: 80, opacity: 70 }) },
    { wash: 'aurora', washIntensity: 80, opacity: 70 }
  );
  // Out-of-range numbers clamp; the panel never goes below the minimum opacity.
  assert.deepEqual(
    { ...theme.normalizeWallpaper({ wash: 'nope', washIntensity: 250, opacity: 10 }) },
    { wash: 'ocean', washIntensity: 100, opacity: theme.MIN_SURFACE_OPACITY }
  );
  // Non-numbers fall back to defaults instead of coercing (null would become 0).
  assert.deepEqual(
    { ...theme.normalizeWallpaper({ wash: 'dusk', washIntensity: '80', opacity: null }) },
    { wash: 'dusk', washIntensity: 42, opacity: 55 }
  );
});

test('applyAppearance writes the wallpaper state and keepWallpaper leaves a first-frame state alone', () => {
  const { theme, rootEl } = loadTheme();
  theme.applyAppearance({ theme: 'cute-ios', accent: '#15487e', wash: 'ocean', washIntensity: 40, opacity: 80 });
  assert.deepEqual(wallpaperState(rootEl), { wash: 'ocean', strength: '0.40', surface: '0.80' });
  assert.equal(rootEl.attrs['data-hpx-theme'], 'cute-ios');

  theme.applyAppearance({ theme: 'cute-ios', accent: '#15487e', opacity: 100 }, { keepWallpaper: true });
  assert.deepEqual(wallpaperState(rootEl), { wash: 'ocean', strength: '0.40', surface: '0.80' });

  theme.applyAppearance({ theme: 'cute-ios', accent: '#15487e', opacity: 100 });
  assert.deepEqual(wallpaperState(rootEl), { wash: 'ocean', strength: '0.42', surface: '1.00' });
});

test('the first-frame bootstrap and theme.js agree on the wallpaper state', () => {
  const cases = [
    {},
    { wash: 'none', washIntensity: 0, opacity: 100 },
    { wash: 'aurora', washIntensity: 80, opacity: 70 },
    { wash: 'ocean', washIntensity: 250, opacity: 10 },
    { wash: 'dusk', washIntensity: '80', opacity: null },
    { wash: 'sakura', washIntensity: 33.6, opacity: 54.4 },
    { wash: 'accent', washIntensity: 0, opacity: 55 },
  ];
  for (const settings of cases) {
    const { theme, rootEl } = loadTheme();
    theme.applyAppearance(Object.assign({ theme: 'cute-ios', accent: '#15487e' }, settings));
    assert.deepEqual(wallpaperState(runBootstrap(settings)), wallpaperState(rootEl), JSON.stringify(settings));
  }
});

test('bootstrap only passes well-formed preset ids through to the page', () => {
  // An id the stylesheet does not define paints nothing; theme.js then corrects it.
  assert.equal(wallpaperState(runBootstrap({ wash: 'retired' })).wash, 'retired');
  assert.equal(wallpaperState(runBootstrap({ wash: '"><x' })).wash, 'ocean');
  assert.equal(wallpaperState(runBootstrap({ wash: 42 })).wash, 'ocean');
});


test('new installations paint the shared orange ocean preset from the first frame', () => {
  const { theme, rootEl } = loadTheme();
  theme.applyAppearance({});
  const firstFrame = runBootstrap({});
  for (const root of [firstFrame, rootEl]) {
    assert.equal(root.attrs['data-hpx-theme'], 'cute-ios');
    assert.equal(root.vars['--hpx-accent'], '#ff7a1a');
    assert.deepEqual(wallpaperState(root), { wash: 'ocean', strength: '0.42', surface: '0.55' });
  }
});
