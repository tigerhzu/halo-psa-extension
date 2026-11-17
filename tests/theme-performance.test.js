'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = process.env.HPX_TEST_ROOT || path.resolve(__dirname, '..');

test('sidebar theme bounds layout work to navigation and ignores unrelated render bursts', t => {
  const browser = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(file => fs.existsSync(file));
  if (!browser) return t.skip('Chrome or Edge is required for native DOM/layout regression coverage.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hpx-theme-performance-'));
  const script = file => '<script src="' + pathToFileURL(path.join(root, file)).href + '"></script>';
  try {
    fs.writeFileSync(path.join(temporary, 'fixture.html'), `<!doctype html><html><head><style>
      body { margin:0; }
      #app-nav-menu { position:fixed; left:0; top:0; width:80px; height:100vh; }
      #halo-tree { position:fixed; left:80px; top:0; width:270px; height:100vh; }
      .tree-panel { position:absolute; inset:0; }
      #tickets { margin-left:400px; }
      aside { position:fixed; left:0; top:0; width:250px; height:100vh; }
      [hidden] { display:none !important; }
    </style></head><body><nav id="app-nav-menu"></nav><div id="halo-tree"><div class="tree-panel" hidden></div></div><main id="tickets"></main><pre id="result">Running</pre>
    <script>
      const tickets = document.getElementById('tickets');
      tickets.innerHTML = '<div class="list-panel icon-column">Ticket content</div>'.repeat(2500);
      const reads = { total:0, unrelated:0, broadQueries:0 };
      const getRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function() {
        reads.total++;
        if (tickets.contains(this)) reads.unrelated++;
        return getRect.call(this);
      };
      const queryAll = document.querySelectorAll.bind(document);
      document.querySelectorAll = function(selector) {
        if (selector.includes('[class*="nav"')) reads.broadQueries++;
        return queryAll(selector);
      };
      // Deterministic frame delivery while retaining real Chromium layout and MutationObserver.
      window.requestAnimationFrame = callback => setTimeout(callback, 0);
      window.chrome = { storage: { local: { get(key, callback) {
        callback({ [key]: { theme:'cute-ios', accent:'#ff7a1a', opacity:55, ultimateMode:false } });
      }, set() {} }, onChanged: { addListener() {} } } };
    </script>${script('src/core/namespace.js')}${script('src/config/selectors.js')}${script('src/ui/theme.js')}
    <script>
      (async function() {
        const checks = [];
        const check = (name, ok, detail) => checks.push({ name, ok:!!ok, detail });
        const settle = () => new Promise(resolve => setTimeout(resolve, 450));
        const theme = window.__HPX.ui.theme;
        theme.start();
        check('startup does not synchronously discover sidebar geometry', reads.total === 0, reads.total);
        await settle();
        check('standard navigation is themed', document.getElementById('halo-tree').classList.contains('hpx-theme-sidebar') && document.getElementById('app-nav-menu').classList.contains('hpx-theme-sidebar'));
        check('ticket nodes never participate in geometry discovery', reads.unrelated === 0, reads.unrelated);
        check('standard Halo avoids broad document discovery', reads.broadQueries === 0, reads.broadQueries);
        let baseline = reads.total;
        await settle();
        check('theme markers do not trigger a continuing geometry loop', reads.total === baseline, reads.total - baseline);
        for (let i = 0; i < 80; i++) {
          tickets.firstChild.textContent = 'Loading ' + i;
          const row = document.createElement('div'); row.className = 'list-panel'; tickets.appendChild(row);
        }
        await settle();
        check('unrelated ticket render burst causes no sidebar geometry reads', reads.total === baseline, reads.total - baseline);
        const panel = document.querySelector('.tree-panel');
        panel.hidden = false;
        await settle();
        check('attribute-only sidebar panel opening still rescans', reads.total > baseline);
        const replacement = document.getElementById('halo-tree').cloneNode(true);
        replacement.className = '';
        document.getElementById('halo-tree').replaceWith(replacement);
        await settle();
        check('SPA root replacement receives theme markers', replacement.classList.contains('hpx-theme-sidebar'));
        baseline = reads.total;
        replacement.querySelector('.tree-panel').hidden = true;
        await settle();
        check('replacement root attribute observer is rebound', reads.total > baseline);
        document.getElementById('halo-tree').remove(); document.getElementById('app-nav-menu').remove();
        const fallback = document.createElement('aside'); document.body.appendChild(fallback);
        await settle();
        check('unknown navigation retains compatibility discovery', fallback.classList.contains('hpx-theme-sidebar') && reads.broadQueries > 0);
        theme.apply('default');
        check('native theme removes sidebar markers', !document.querySelector('.hpx-theme-sidebar'));
        baseline = reads.total;
        fallback.appendChild(document.createElement('div'));
        await settle();
        check('native theme has no ongoing sidebar geometry scans', reads.total === baseline);
        const result = { ok:checks.every(item => item.ok), checks, reads };
        document.getElementById('result').textContent = JSON.stringify(result);
        document.body.dataset.ok = String(result.ok);
      })().catch(error => { document.getElementById('result').textContent = String(error.stack || error); document.body.dataset.ok = 'false'; });
    </script></body></html>`);
    const run = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', '--allow-file-access-from-files',
      '--user-data-dir=' + path.join(temporary, 'profile'), '--virtual-time-budget=10000',
      '--dump-dom', pathToFileURL(path.join(temporary, 'fixture.html')).href,
    ], { encoding:'utf8', timeout:30000, maxBuffer:5 * 1024 * 1024 });
    assert.equal(run.error, undefined, run.error && run.error.message);
    assert.equal(run.status, 0, run.stderr);
    const result = (run.stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/) || [])[1];
    assert.equal(/data-ok="true"/.test(run.stdout), true, result || run.stderr);
  } finally {
    fs.rmSync(temporary, { recursive:true, force:true });
  }
});
