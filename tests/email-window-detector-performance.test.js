'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const root = process.env.HPX_TEST_ROOT || path.resolve(__dirname, '..');

test('email detection ignores unrelated rendering and preserves native CC lifecycle', function (t) {
  const browser = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome',
  ].find(candidate => candidate && fs.existsSync(candidate));
  if (!browser) { t.skip('Chrome or Edge is required for the real DOM regression.'); return; }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hpx-email-performance-'));
  const script = file => '<script src="' + pathToFileURL(path.join(root, file)).href + '"></script>';
  const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <app-root><div id="unrelated"></div><div class="hpx-sp-pet"><span id="pet"></span></div></app-root>
    ${script('src/core/namespace.js')}
    ${script('src/config/besties-config.js')}
    <script>
      const frames = new Map();
      const timers = new Map();
      let clock = 1000, nextId = 0, queries = 0, found = 0, removed = 0;
      Date.now = () => clock;
      window.requestAnimationFrame = fn => { const id = ++nextId; frames.set(id, fn); return id; };
      window.cancelAnimationFrame = id => frames.delete(id);
      window.setTimeout = (fn, ms) => { const id = ++nextId; timers.set(id, fn); return id; };
      window.clearTimeout = id => timers.delete(id);
      const nativeQuery = document.querySelector.bind(document);
      const nativeQueryAll = document.querySelectorAll.bind(document);
      document.querySelector = (...args) => { queries++; return nativeQuery(...args); };
      document.querySelectorAll = (...args) => { queries++; return nativeQueryAll(...args); };
      window.__HPX.config.selectors = { HALO_SIGNATURE_SELECTORS: ['app-root'] };
      window.__HPX.features.besties = { _findWindowContainer: cc => cc.closest('form') };
      const options = { onFound: () => found++, onRemoved: () => removed++ };
      const failures = [], checks = [];
      function check(name, value) { checks.push(name); if (!value) failures.push(name); }
      async function settle() {
        clock += 200;
        await Promise.resolve();
        for (let i = 0; i < 4; i++) {
          const pending = [...timers.values(), ...frames.values()];
          timers.clear(); frames.clear();
          pending.forEach(fn => fn());
          await Promise.resolve();
        }
      }
    </script>
    ${script('src/core/email-window-detector.js')}
    <script>
    (async function () {
      const detector = window.__HPX.core.emailWindowDetector;
      detector.start(options);
      check('no CC uses one document query', queries === 1);
      const unrelated = document.getElementById('unrelated');
      const pet = document.getElementById('pet');
      queries = 0;
      for (let i = 0; i < 250; i++) {
        unrelated.className = 'row-' + i;
        pet.style.transform = 'translateX(' + i + 'px)';
      }
      await settle();
      check('unrelated class and pet animation bursts do not scan', queries === 0);
      const own = document.createElement('div'); own.className = 'hpx-toolbar';
      document.body.appendChild(own); await settle();
      own.remove(); await settle();
      check('own toolbar add/remove does not scan', queries === 0);

      const action = document.createElement('section');
      action.innerHTML = '<div class="history-header"><span class="outcome oneline">Email User</span></div>' +
        '<form><div id="cc-row"><input name="emailcc" type="hidden"><input role="combobox" id="react-select-1"></div>' +
        '<div contenteditable="true" class="fr-element">Draft</div></form>';
      document.body.appendChild(action); await settle();
      check('late hidden CC plus visible companion mounts', found === 1 && removed === 0);
      queries = 0;
      for (let i = 0; i < 100; i++) unrelated.className = 'unrelated-active-email-' + i;
      const notification = document.createElement('div');
      notification.textContent = 'Unrelated notification';
      document.body.appendChild(notification);
      await settle();
      check('unrelated rendering with an active email also avoids scans', queries === 0);
      const ccRow = action.querySelector('#cc-row');
      const editor = action.querySelector('.fr-element');
      const title = action.querySelector('.outcome');
      queries = 0;
      editor.innerHTML = '<p><strong>Typing and pasted formatting</strong></p>';
      editor.style.color = 'red';
      await settle();
      check('editor typing and formatting do not scan email controls', queries === 0);
      ccRow.style.display = 'none'; await settle();
      check('hiding CC removes toolbar', found === 1 && removed === 1);
      ccRow.style.display = ''; await settle();
      check('showing an untracked CC remounts', found === 2 && removed === 1);
      title.firstChild.data = 'Activity Note'; await settle();
      check('title characterData obeys non-email exclusion', removed === 2);
      title.textContent = 'First Contact'; await settle();
      check('title childList restores supported email action', found === 3);
      action.classList.add('new-ticket-screen'); await settle();
      check('New Ticket stays excluded', removed === 3);
      action.classList.remove('new-ticket-screen'); await settle();
      check('removing New Ticket marker restores detection', found === 4);
      document.documentElement.classList.add('hpx-onboarding-open'); await settle();
      check('onboarding removes toolbar', removed === 4);
      document.documentElement.classList.remove('hpx-onboarding-open'); await settle();
      check('closing onboarding restores toolbar', found === 5);
      action.remove(); await settle();
      check('SPA removal cleans tracked toolbar', removed === 5);
      document.body.appendChild(action); await settle();
      check('SPA reused node remounts once', found === 6);

      detector.start(options); await settle();
      check('start is idempotent', found === 6);
      queries = 0;
      detector.rescan();
      title.textContent = 'Email User';
      await Promise.resolve();
      detector.stop();
      await settle();
      check('stop cleans mounted toolbar and pending callbacks', queries === 0 && removed === 6);
      detector.start(options); await settle();
      check('restart mounts once', found === 7);
      detector.stop();

      // One invalid tenant selector must not disable the remaining valid union.
      window.__HPX.config.besties.CC_FIELD_SELECTORS.unshift('[');
      detector.start(options); await settle();
      check('invalid-selector fallback still finds valid CC', found === 8);
      const header = action.querySelector('.history-header');
      header.className = 'ordinary-header'; await settle();
      check('removing the title signature removes the toolbar', removed === 8);
      header.className = 'history-header'; await settle();
      check('restoring the title signature restores the toolbar', found === 9);
      detector.stop();
      document.body.setAttribute('data-ok', String(!failures.length));
      const result = document.createElement('pre');
      result.id = 'test-result';
      result.textContent = JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures });
      document.body.appendChild(result);
    })().catch(error => { document.body.setAttribute('data-ok', 'false'); document.body.append(String(error.stack)); });
    </script></body></html>`;
  try {
    const file = path.join(temp, 'fixture.html');
    fs.writeFileSync(file, fixture);
    const run = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run',
      '--allow-file-access-from-files', '--user-data-dir=' + path.join(temp, 'profile'),
      '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(run.error, undefined, run.error && run.error.message);
    assert.equal(run.status, 0, run.stderr);
    const result = run.stdout.match(/<pre id="test-result">([^<]+)<\/pre>/);
    assert.ok(result, run.stdout);
    assert.deepEqual(JSON.parse(result[1]).failures, []);
    assert.equal(JSON.parse(result[1]).total, 22);
    assert.match(run.stdout, /data-ok="true"/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
