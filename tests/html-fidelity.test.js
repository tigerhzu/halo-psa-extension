/**
 * html-fidelity.test.js
 *
 * 守住富文字往返 PoC 的量測工具本身是對的 —— 如果 compare() 會漏報，
 * 之後在實機跑出來的「沒有遺失」就沒有意義。
 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

global.window = global;
global.window.__HPX = { core: {}, warn: function () {} };

require(path.join(__dirname, '..', 'src', 'core', 'html-fidelity.js'));

const fidelity = window.__HPX.core.htmlFidelity;

const RICH =
  '<p>開頭</p>' +
  '<p><b>粗體</b> <i>斜體</i> <u>底線</u></p>' +
  '<p><a href="https://example.com/a">連結</a></p>' +
  '<ul><li>一</li><li>二</li></ul>' +
  '<ol><li>甲</li></ol>' +
  '<table border="1"><tbody><tr><th>H</th></tr><tr><td>D</td></tr></tbody></table>' +
  '<p><span style="color:#c00">紅</span></p>' +
  '<p><img src="https://halo.example.com/att/1.png" alt="a"></p>';

// ── inventory：各項富文字特徵都要數得出來 ──────────────────────────────────
const inv = fidelity.inventory(RICH);
assert.equal(inv.counts.image, 1);
assert.equal(inv.counts.table, 1);
assert.equal(inv.counts.tableRow, 2);
assert.equal(inv.counts.tableCell, 2);
assert.equal(inv.counts.link, 1);
assert.equal(inv.counts.bulletList, 1);
assert.equal(inv.counts.orderedList, 1);
assert.equal(inv.counts.listItem, 3);
assert.equal(inv.counts.bold, 1);
assert.equal(inv.counts.italic, 1);
assert.equal(inv.counts.underline, 1);
assert.equal(inv.styled, 1);
assert.deepEqual(inv.images, ['https://halo.example.com/att/1.png']);
assert.deepEqual(inv.links, ['https://example.com/a']);

// 屬性值不可被當成標籤誤數（'<' 出現在屬性字串裡時最容易出錯）
const tricky = fidelity.inventory('<p title="a < b">x</p><img src=\'u.png\'>');
assert.equal(tricky.counts.image, 1);
assert.deepEqual(tricky.images, ['u.png']);

// 註解不列入
assert.equal(fidelity.inventory('<!-- <img src="x"> --><p>y</p>').counts.image, 0);

// ── plainText ─────────────────────────────────────────────────────────────
assert.equal(fidelity.plainText('<p>abc</p><p>&nbsp;def</p>'), 'abc def');

// ── 完全相同：判定通過 ────────────────────────────────────────────────────
const same = fidelity.compare(RICH, RICH);
assert.equal(same.ok, true);
assert.equal(same.criticalLost.length, 0);
assert.equal(same.structureChanged, false);

// ── 現況回歸：innerText 降級會被抓出來 ────────────────────────────────────
// 這正是目前 editor-adapter.setText() 的行為，必須判定失敗。
const flattened = '<div>開頭</div><div>粗體 斜體 底線</div><div>連結</div><div>一</div>';
const lostAll = fidelity.compare(RICH, flattened);
assert.equal(lostAll.ok, false);
const lostFeatures = lostAll.criticalLost.map((x) => x.feature);
for (const feature of ['image', 'table', 'link', 'bold', 'italic', 'underline', 'listItem']) {
  assert.ok(lostFeatures.includes(feature), '應偵測到遺失：' + feature);
}
assert.deepEqual(lostAll.missingImages, ['https://halo.example.com/att/1.png']);
assert.deepEqual(lostAll.missingLinks, ['https://example.com/a']);

// ── 只掉圖片：仍要判定失敗 ────────────────────────────────────────────────
const noImage = RICH.replace('<p><img src="https://halo.example.com/att/1.png" alt="a"></p>', '<p></p>');
const imgGone = fidelity.compare(RICH, noImage);
assert.equal(imgGone.ok, false);
assert.deepEqual(imgGone.missingImages, ['https://halo.example.com/att/1.png']);
assert.equal(imgGone.criticalLost.length, 1);
assert.equal(imgGone.criticalLost[0].feature, 'image');

// ── 圖片被改寫成別的 URL（相對路徑沒還原）：也要抓到 ──────────────────────
const rewritten = RICH.replace('https://halo.example.com/att/1.png', '/att/1.png');
assert.equal(fidelity.compare(RICH, rewritten).ok, false);

// ── 編輯器加了包裝標籤：不可誤判為遺失 ────────────────────────────────────
const wrapped = '<div class="fr-wrap">' + RICH + '</div><p><br></p>';
const wrappedResult = fidelity.compare(RICH, wrapped);
assert.equal(wrappedResult.ok, true, '多出 div / p 包裝不算格式遺失');
assert.ok(wrappedResult.gained.length > 0);
assert.equal(wrappedResult.structureChanged, true);

// ── 表格被拆掉一列：要抓到 ────────────────────────────────────────────────
const lessRow = RICH.replace('<tr><td>D</td></tr>', '');
const rowGone = fidelity.compare(RICH, lessRow);
assert.equal(rowGone.ok, false);
assert.ok(rowGone.criticalLost.some((x) => x.feature === 'tableRow'));

// ── fingerprint ───────────────────────────────────────────────────────────
assert.equal(fidelity.fingerprint('<p><b>x</b></p>'), 'p>b');
assert.notEqual(fidelity.fingerprint('<p><b>x</b></p>'), fidelity.fingerprint('<p><i>x</i></p>'));

// ── 空值不可炸 ────────────────────────────────────────────────────────────
assert.equal(fidelity.compare('', '').ok, true);
assert.equal(fidelity.inventory(null).textLength, 0);
assert.equal(fidelity.inventory(undefined).counts.image, 0);

console.log('html-fidelity.test.js ✓ 全部通過');
