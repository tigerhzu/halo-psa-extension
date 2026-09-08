'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

function installedBrowser() {
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(function (candidate) {
    return fs.existsSync(candidate);
  });
}

test('ticket reader collects the full Progress history and sanitizes iframe HTML', function (t) {
  const browser = installedBrowser();
  if (!browser) {
    t.skip('Chrome or Edge is required for the browser DOM regression test.');
    return;
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hpx-ticket-reader-'));
  try {
    const fixtureUrl = pathToFileURL(path.join(__dirname, 'ticket-reader-browser-test.html')).href;
    const run = childProcess.spawnSync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--allow-file-access-from-files',
        '--user-data-dir=' + profile,
        '--dump-dom',
        fixtureUrl,
      ],
      { encoding: 'utf8', timeout: 30000 }
    );

    assert.equal(run.error, undefined, run.error && run.error.message);
    assert.equal(run.status, 0, run.stderr || 'Headless browser failed.');
    assert.match(run.stdout, /data-ok="true"/);
    assert.match(run.stdout, /"passed":17,"total":17/);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('ticket reader is wired into the extension and its popup stylesheet is accessible', function () {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts[2].js;
  const styles = manifest.content_scripts[2].css;
  const accessible = manifest.web_accessible_resources.flatMap(function (entry) { return entry.resources; });
  const content = fs.readFileSync(path.join(ROOT, 'src/content.js'), 'utf8');

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(scripts.includes('src/features/ticket-reader.js'));
  assert.ok(styles.includes('src/styles/ticket-reader.css'));
  assert.ok(accessible.includes('src/styles/ticket-reader-window.css'));
  assert.match(content, /NS\.features\.ticketReader\.start\(\)/);
});

test('reader window includes the promised usability and safety controls', function () {
  const source = fs.readFileSync(path.join(ROOT, 'src/features/ticket-reader.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/ticket-reader-window.css'), 'utf8');

  ['重新同步', '搜尋活動內容', '全部活動', '全部收合', '放大文字', '列印', '唯讀快照'].forEach(function (label) {
    assert.ok(source.includes(label), 'Missing reader control: ' + label);
  });
  assert.doesNotMatch(source, /唯讀模式\s*·\s*TICKET READER/);
  assert.match(source, /sanitizer\.sanitize\(sanitizer\.absolutizeUrls/);
  assert.match(source, /rel\s*=\s*'noopener noreferrer'/);
  assert.match(source, /resizable=yes/);
  assert.match(css, /@media print/);
  assert.match(css, /max-width:\s*100%\s*!important/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /\.hpx-tr-header\s*\{[^}]*position:\s*sticky;[^}]*display:\s*grid;/s);
  assert.match(css, /\.hpx-tr-title-row\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s);
  assert.match(css, /\.hpx-tr-toolbar\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(css, /\.hpx-tr-main\s*\{[^}]*width:\s*min\(1080px,\s*calc\(100% - 80px\)\)/s);
  assert.match(css, /@media \(max-width:\s*650px\)[\s\S]*\.hpx-tr-title-row\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(source, /app\.className\s*=\s*'hpx-tr-app'/);
  assert.match(source, /controlsExpanded:\s*true/);
  assert.match(source, /controlsToggle\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(source, /controlsToggle\.addEventListener\('click'/);
  assert.match(source, /顯示閱讀工具/);
  assert.match(source, /收合閱讀工具/);
  assert.match(source, /controlsToggle\.textContent\s*=\s*isExpanded \? '⌃' : '工具 ▾'/);
  assert.match(source, /header\.appendChild\(controlsToggle\)/);
  assert.match(source, /const READER_STYLESHEET_URL\s*=\s*resolveReaderStylesheetUrl\(\)/);
  assert.match(source, /stylesheet\.href\s*=\s*READER_STYLESHEET_URL/);
  assert.doesNotMatch(source, /stylesheet\.href\s*=\s*chrome\.runtime\.getURL/);
  assert.match(source, /所有節點建立完成後才一次替換文件/);
  assert.match(source, /showReaderFailure\(readerWindow\)/);
  assert.match(css, /\.hpx-tr-app--controls-collapsed \.hpx-tr-header\s*\{[^}]*display:\s*flex;[^}]*height:\s*34px;/s);
  assert.match(css, /\.hpx-tr-app--controls-collapsed \.hpx-tr-title-row,[\s\S]*?\.hpx-tr-app--controls-collapsed \.hpx-tr-toolbar\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /\.hpx-tr-controls-toggle\s*\{[^}]*position:\s*absolute;[^}]*top:\s*\d+px;[^}]*right:\s*clamp\([^;]+\);/s);
  assert.match(css, /\.hpx-tr-app--controls-collapsed \.hpx-tr-controls-toggle\s*\{[^}]*position:\s*static;[^}]*width:\s*92px;[^}]*height:\s*26px;/s);
  assert.match(css, /\.hpx-tr-app--controls-collapsed \.hpx-tr-main\s*\{[^}]*min\(1200px,/s);
  assert.match(css, /\.hpx-tr-card-toggle:focus-visible/);
  assert.match(source, /card\.setAttribute\('aria-labelledby', outcome\.id\)/);
  assert.match(source, /toggle\.setAttribute\('aria-controls', content\.id\)/);
  assert.match(source, /toggle\.setAttribute\('aria-expanded', String\(!readerUi\.allCollapsed\)\)/);
  assert.match(source, /沒有符合條件的活動/);
});
