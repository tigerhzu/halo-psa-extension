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

test('image masks preserve images without exposing their URLs to AI', function (t) {
  const browser = installedBrowser();
  if (!browser) {
    t.skip('Chrome or Edge is required for the browser DOM regression test.');
    return;
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hpx-image-mask-'));
  try {
    const fixtureUrl = pathToFileURL(path.join(__dirname, 'image-placeholder-browser-test.html')).href;
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
    assert.match(run.stdout, /"passed":18,"total":18/);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('AI validator treats image mask tokens as protected values', function () {
  const validator = require('../src/ai/output-validator.js');
  const input = '前段\nHPXIMG-0001\n後段';
  assert.deepEqual(validator.protectedValues(input), ['HPXIMG-0001']);
  assert.equal(validator.validate('improve_tone', input, '您好，\n前段\n後段\n謝謝。').ok, false);
});

test('inline Halo AI flow masks before request and restores before reliable HTML write', function () {
  const source = fs.readFileSync(path.join(ROOT, 'src/features/ai-rewrite.js'), 'utf8');
  assert.match(source, /maskForAi\(safeSourceHtml\)/);
  assert.match(source, /text:\s*text/);
  assert.match(source, /toDisplayText\(result\.text, imageMask\.masks\)/);
  assert.match(source, /restoreAiMasks\(html, imageMask\.masks\)/);
  assert.match(source, /setHtmlReliable\(editorEl, clean\)/);
});

test('separate editor preserves masked images for full and selected AI scopes', function () {
  const source = fs.readFileSync(path.join(ROOT, 'src/editor-window/editor.js'), 'utf8');
  assert.match(source, /sel\.range\.cloneContents\(\)/);
  assert.match(source, /imageMaskedScope\(restoredSelection\.html, sel\.text\)/);
  assert.match(source, /imageMaskedScope\(modelHtml\(\), fullText\)/);
  assert.match(source, /restoreAiMasks\(html, scope\.imageMasks\)/);
  assert.match(source, /toPlaceholders\(safeHtml\)/);
  assert.match(source, /圖片會自動遮罩並保留/);
});
