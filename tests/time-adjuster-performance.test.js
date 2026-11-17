'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const TEMP = path.join(ROOT, 'temp');
const BROWSER = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

function browserTest(t, fixture, generated = false) {
  if (!BROWSER) {
    t.skip('Chrome or Edge is required for the Time Taken browser regression.');
    return null;
  }
  fs.mkdirSync(TEMP, { recursive: true });
  const work = fs.mkdtempSync(path.join(TEMP, 'time-adjuster-test-'));
  try {
    let file = fixture;
    if (generated) {
      file = path.join(work, 'fixture.html');
      fs.writeFileSync(file, fixture);
    }
    const run = childProcess.spawnSync(BROWSER, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--allow-file-access-from-files', '--disable-background-timer-throttling',
      '--user-data-dir=' + path.join(work, 'profile'),
      '--virtual-time-budget=20000', '--dump-dom', pathToFileURL(file).href,
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(run.error, undefined, run.error && run.error.message);
    assert.equal(run.status, 0, run.stderr || 'Headless browser failed.');
    const match = /<pre id="result">([\s\S]*?)<\/pre>/.exec(run.stdout);
    assert.ok(match, 'Browser fixture must expose its result');
    const resultText = match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.ok(resultText.startsWith('{'), 'Browser fixture did not finish: ' + resultText);
    const result = JSON.parse(resultText);
    assert.equal(result.ok, true, JSON.stringify(result.checks.filter((check) => !check.ok)));
    assert.equal(result.passed, result.total);
    return result;
  } finally {
    const resolved = path.resolve(work);
    assert.ok(resolved.startsWith(path.resolve(TEMP) + path.sep), 'Cleanup must stay inside workspace temp');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

test('Time Taken browser regression preserves native fields, partial rerenders, manual drafts and teardown', (t) => {
  // Virtual time can exhaust its budget before Chromium delivers a compositor
  // frame. This fixture uses rAF only to settle layout; timed frame callbacks
  // keep it deterministic while getBoundingClientRect still reads real layout.
  const fixture = fs.readFileSync(path.join(__dirname, 'time-adjuster-browser-test.html'), 'utf8')
    .replace('<head>', '<head><base href="' + pathToFileURL(__dirname + path.sep).href + '">')
    .replace('</head>', '<script>window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);</script></head>');
  const result = browserTest(t, fixture, true);
  if (result) {
    assert.ok(result.total > 300, 'Run the complete existing layout and interaction fixture');
    t.diagnostic(result.passed + ' browser checks passed');
  }
});

test('Time Taken discovery scans the document once and tracks inserted or renamed labels incrementally', (t) => {
  const sources = [
    'src/core/namespace.js', 'src/config/time-adjuster-config.js',
    'src/features/time-adjuster-core.js', 'src/features/time-adjuster.js',
  ].map((file) => '<script src="' + pathToFileURL(path.join(ROOT, file)).href + '"></script>').join('\n');
  const fixture = `<!doctype html><meta charset="utf-8"><body>
    <section class="halo-action"><form id="action"><div><label>Unrelated field</label><input aria-label="Time" value="00:19:40"></div></form></section>
    <section id="activity"></section><pre id="result">Running</pre>
    ${sources}
    <script>
    (async function () {
      const checks = [];
      const check = (name, ok) => checks.push({name, ok: !!ok});
      const NS = window.__HPX;
      NS.config.selectors = {HALO_SIGNATURE_SELECTORS: ['.halo-action']};
      const settle = () => new Promise(resolve => setTimeout(resolve, NS.config.timeAdjuster.SCAN_DEBOUNCE_MS * 2 + 30));
      const all = Document.prototype.querySelectorAll;
      let fullLabelScans = 0;
      Document.prototype.querySelectorAll = function (selector) {
        if (selector.startsWith('label, span, div,')) fullLabelScans++;
        return all.call(this, selector);
      };
      try {
        NS.features.timeAdjuster.start();
        check('one initial document label scan', fullLabelScans === 1);
        check('unrelated label mounts no helper', !document.querySelector('.hpx-tta'));
        document.querySelector('#action label').firstChild.nodeValue = 'Time Taken';
        await settle();
        const helper = document.querySelector('#action .hpx-tta');
        check('characterData edit discovers newly matching label', !!helper && NS.features.timeAdjuster._groups.size === 1);
        if (helper) helper.querySelector('.hpx-tta-input').value = '42';
        for (let batch = 0; batch < 4; batch++) {
          const fragment = document.createDocumentFragment();
          for (let row = 0; row < 250; row++) {
            const item = document.createElement('div');
            item.innerHTML = '<span>Ticket activity ' + batch + '-' + row + '</span>';
            fragment.appendChild(item);
          }
          document.getElementById('activity').appendChild(fragment);
          await settle();
        }
        check('1000 unrelated rows do not repeat whole-document label discovery', fullLabelScans === 1);
        check('native churn preserves helper identity and manual draft', helper === document.querySelector('#action .hpx-tta') && helper.querySelector('.hpx-tta-input').value === '42');
        const lateAction = document.createElement('form');
        lateAction.innerHTML = '<div><label>Time Taken</label><input aria-label="Time" value="00:10:00"></div>';
        document.querySelector('.halo-action').appendChild(lateAction);
        await settle();
        check('newly inserted action mounts one helper', lateAction.querySelectorAll('.hpx-tta').length === 1 && NS.features.timeAdjuster._groups.size === 2);
        check('new action discovery stays incremental', fullLabelScans === 1);
        lateAction.remove();
        await settle();
        check('removed action controller is released', NS.features.timeAdjuster._groups.size === 1);
        for (const attribute of ['aria-label', 'title']) {
          const attributeAction = document.createElement('form');
          attributeAction.innerHTML = '<div><label>Unrelated field</label><input aria-label="Time" value="00:10:00"></div>';
          document.querySelector('.halo-action').appendChild(attributeAction);
          // Let insertion discovery finish before changing the attribute: this
          // must exercise attribute invalidation, not a still-dirty added root.
          await settle();
          check(attribute + ': existing unmatched label mounts no helper', !attributeAction.querySelector('.hpx-tta') && NS.features.timeAdjuster._groups.size === 1);
          attributeAction.querySelector('label').setAttribute(attribute, 'Time Taken');
          await settle();
          check(attribute + ': newly matching attribute discovers existing label', attributeAction.querySelectorAll('.hpx-tta').length === 1 && NS.features.timeAdjuster._groups.size === 2 && fullLabelScans === 1);
          attributeAction.remove();
          await settle();
          check(attribute + ': removing action releases its controller', NS.features.timeAdjuster._groups.size === 1);
        }
        NS.features.timeAdjuster.rescan();
        await settle();
        check('explicit reconciliation does not repeat full discovery', fullLabelScans === 1);
        NS.features.timeAdjuster.stop();
        check('stop removes controllers and helpers', NS.features.timeAdjuster._groups.size === 0 && !document.querySelector('.hpx-tta'));
        NS.features.timeAdjuster.start();
        check('restart refreshes labels exactly once', fullLabelScans === 2 && NS.features.timeAdjuster._groups.size === 1);
      } catch (error) {
        check('unexpected exception: ' + error.stack, false);
      } finally {
        NS.features.timeAdjuster.stop();
        Document.prototype.querySelectorAll = all;
      }
      const result = {ok: checks.every(c => c.ok), passed: checks.filter(c => c.ok).length, total: checks.length, checks};
      document.getElementById('result').textContent = JSON.stringify(result);
      document.body.dataset.ok = String(result.ok);
    })();
    </script>`;
  const result = browserTest(t, fixture, true);
  if (result) assert.equal(result.total, 17);
});
