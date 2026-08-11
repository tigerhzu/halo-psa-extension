/**
 * runtime-purity.test.js
 *
 * 守住 runtime 與 dev tooling 的邊界：
 *   tools/prompt-eval 可以 require runtime 的 prompt 來源（tools → src）；
 *   runtime 永遠不得反向引用 tools/、tests/、.claude/（src → tools 一律禁止）。
 *
 * 這條界線靠人記得會失效，所以改成機器檢查：
 *  1. src/**\/*.js 的每個 require() / importScripts() 目標都必須落在 src/ 之內。
 *  2. manifest.json 引用的每個路徑都必須存在，且只能落在 src/、assets/ 或 pet/。
 *
 * 檢查的是「實際的載入呼叫」而不是字串比對，因此註解裡提到 tools/prompt-eval 不會誤判。
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** 遞迴列出目錄下所有指定副檔名的檔案。 */
function walk(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// ── 1. runtime 的載入呼叫不得離開 src/ ─────────────────────────────────────
const LOAD_CALL = /\b(?:require|importScripts)\(\s*(['"])([^'"]+)\1\s*\)/g;
const jsFiles = walk(SRC, '.js');

assert.ok(jsFiles.length > 0, '沒有掃到任何 src/ 的 JS 檔，測試本身有問題');

let checkedCalls = 0;
for (const file of jsFiles) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const source = fs.readFileSync(file, 'utf8');

  for (const match of source.matchAll(LOAD_CALL)) {
    const target = match[2];
    checkedCalls += 1;

    // 以 / 開頭 = 擴充功能根目錄（service worker 的 importScripts 寫法）
    const resolved = target.startsWith('/')
      ? path.resolve(ROOT, target.slice(1))
      : path.resolve(path.dirname(file), target);

    const relTarget = path.relative(SRC, resolved);
    assert.ok(
      !relTarget.startsWith('..') && !path.isAbsolute(relTarget),
      rel + ' 載入了 src/ 之外的檔案：' + target +
        '\n  runtime 不得依賴 dev tooling（tools/、tests/、.claude/）。'
    );
    assert.ok(fs.existsSync(resolved), rel + ' 載入的檔案不存在：' + target);
  }
}

// service worker 目前正是靠 importScripts 取得 prompt；掃不到任何載入呼叫代表規則失效了。
assert.ok(checkedCalls > 0, '沒有掃到任何 require/importScripts 呼叫，檢查規則可能已失效');

// ── 2. manifest.json 只能引用 src/、assets/ 與 pet/ ─────────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const manifestPaths = [
  manifest.background && manifest.background.service_worker,
  manifest.options_ui && manifest.options_ui.page,
  ...Object.values(manifest.icons || {}),
  ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  ...(manifest.action && manifest.action.default_icon ? Object.values(manifest.action.default_icon) : []),
  ...(manifest.web_accessible_resources || []).flatMap((w) => w.resources || []),
].filter(Boolean);

assert.ok(manifestPaths.length > 0, 'manifest.json 沒有解析到任何引用路徑');

for (const rel of manifestPaths) {
  assert.ok(
    rel.startsWith('src/') || rel.startsWith('assets/') || rel.startsWith('pet/'),
    'manifest.json 引用了 src/、assets/ 與 pet/ 之外的路徑：' + rel
  );
  if (rel.includes('*')) {
    const wildcardRoot = rel.slice(0, rel.indexOf('*'));
    assert.ok(
      fs.existsSync(path.join(ROOT, wildcardRoot)),
      'manifest.json 引用的 wildcard 根目錄不存在：' + rel
    );
  } else {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), 'manifest.json 引用的檔案不存在：' + rel);
  }
}

// ── 2.5 擴充功能 HTML 頁面引用的資源必須存在且落在 src/ ────────────────────
// editor.html / options.html 不在 manifest 的路徑清單裡（前者用 windows.create 開，
// 後者只登記自己），所以沒有任何東西會替它們把關 —— 改檔名或搬目錄時，
// 壞掉的只會是實機執行，這裡補上靜態檢查。
const HTML_REF = /<(?:script[^>]*\ssrc|link[^>]*\shref)\s*=\s*["']([^"']+)["']/gi;
const htmlFiles = walk(SRC, '.html');

assert.ok(htmlFiles.length > 0, '沒有掃到任何 src/ 的 HTML 檔，測試本身有問題');

let checkedRefs = 0;
for (const file of htmlFiles) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const source = fs.readFileSync(file, 'utf8');

  for (const match of source.matchAll(HTML_REF)) {
    const target = match[1];
    if (/^(https?:)?\/\//i.test(target) || target.startsWith('data:')) {
      assert.fail(rel + ' 引用了外部資源：' + target + '\n  擴充功能頁面只能引用套件內的檔案。');
    }
    checkedRefs += 1;

    const resolved = path.resolve(path.dirname(file), target);
    const relTarget = path.relative(SRC, resolved);
    assert.ok(
      !relTarget.startsWith('..') && !path.isAbsolute(relTarget),
      rel + ' 引用了 src/ 之外的檔案：' + target
    );
    assert.ok(fs.existsSync(resolved), rel + ' 引用的檔案不存在：' + target);
  }
}

assert.ok(checkedRefs > 0, '沒有掃到任何 HTML 資源引用，檢查規則可能已失效');

// ── 3. dev-only 目錄不得出現在 manifest ────────────────────────────────────
const manifestText = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');
for (const devDir of ['tools/', 'tests/', '.claude/']) {
  assert.ok(!manifestText.includes(devDir), 'manifest.json 不得引用 dev-only 目錄：' + devDir);
}

console.log(
  'runtime-purity.test.js ✓ 全部通過（檢查 ' + jsFiles.length + ' 個 src JS 檔、' +
    checkedCalls + ' 個載入呼叫、' + manifestPaths.length + ' 個 manifest 路徑、' +
    htmlFiles.length + ' 個 HTML 頁面的 ' + checkedRefs + ' 個資源引用）'
);
