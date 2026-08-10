'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

global.window = global;
global.window.__HPX = {
  config: {},
  core: {},
  features: {},
  services: {},
  halo: {},
  ui: {},
  log: function () {},
  warn: function () {},
};

// ── 最小 DOM 替身 ───────────────────────────────────────────
// 只提供 time-adjuster.js 實際會用到的部分，避免引入 jsdom 之類的相依套件
// （AGENTS.md：本專案不引入套件管理器）。

function HTMLInputElement() {}
let prototypeSetterCalls = 0;
Object.defineProperty(HTMLInputElement.prototype, 'value', {
  get: function () { return this._value == null ? '' : this._value; },
  set: function (next) {
    prototypeSetterCalls += 1;
    this._value = String(next);
  },
  configurable: true,
});
global.window.HTMLInputElement = HTMLInputElement;

class FakeEvent {
  constructor(type, options) {
    this.type = type;
    this.bubbles = !!(options && options.bubbles);
  }
}
global.Event = FakeEvent;
global.InputEvent = class extends FakeEvent {};
global.FocusEvent = class extends FakeEvent {};

global.MutationObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() {}
  disconnect() {}
};

global.document = {
  contains: function () { return true; },
  querySelectorAll: function () { return []; },
  createElement: function (tag) {
    return {
      tagName: String(tag).toUpperCase(),
      className: '',
      textContent: '',
      children: [],
      setAttribute: function () {},
      appendChild: function (child) { this.children.push(child); return child; },
      addEventListener: function () {},
      classList: { add: function () {}, remove: function () {} },
    };
  },
};

function makeInput(attrs, value) {
  const input = new HTMLInputElement();
  input.tagName = 'INPUT';
  input._value = value == null ? '' : String(value);
  input._attrs = attrs || {};
  input.disabled = false;
  input.readOnly = false;
  input.hidden = false;
  input.parentElement = null;
  input.events = [];
  input.getAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
  };
  input.closest = function () { return null; };
  input.dispatchEvent = function (event) { this.events.push(event.type); return true; };
  input.addEventListener = function () {};
  input.removeEventListener = function () {};
  return input;
}

require(path.join(__dirname, '..', 'src', 'config', 'time-adjuster-config.js'));
require(path.join(__dirname, '..', 'src', 'features', 'time-adjuster-core.js'));
require(path.join(__dirname, '..', 'src', 'features', 'time-adjuster.js'));

const core = window.__HPX.features.timeAdjusterCore;
const internals = window.__HPX.features.timeAdjuster._internals;

// ═══ 驗收項目 1-5：時間換算 ══════════════════════════════════

function clockOf(parts) {
  return core.toClock(core.toTotalSeconds(parts));
}

// 1. 00:19:40 + 15 分鐘 = 00:34:40（保留原本秒數）
let total = core.toTotalSeconds({ hours: '00', minutes: '19', seconds: '40' });
assert.equal(core.toClock(total), '00:19:40');
assert.equal(core.toClock(core.addMinutes(total, 15)), '00:34:40');

// 同一筆再按 -5 分應為 00:14:40（需求範例）
assert.equal(core.toClock(core.addMinutes(total, -5)), '00:14:40');

// 2. 00:50:00 + 15 分鐘 = 01:05:00（分鐘超過 59 自動進位到小時）
total = core.toTotalSeconds({ hours: '00', minutes: '50', seconds: '00' });
assert.equal(core.toClock(core.addMinutes(total, 15)), '01:05:00');

// 3. 01:00:00 - 5 分鐘 = 00:55:00（跨小時借位）
total = core.toTotalSeconds({ hours: '01', minutes: '00', seconds: '00' });
assert.equal(core.toClock(core.addMinutes(total, -5)), '00:55:00');

// 4. 00:03:00 - 5 分鐘 = 00:00:00（不可小於零）
total = core.toTotalSeconds({ hours: '00', minutes: '03', seconds: '00' });
assert.equal(core.toClock(core.addMinutes(total, -5)), '00:00:00');
// 帶秒數時同樣夾在 0，不可出現負值
total = core.toTotalSeconds({ hours: '00', minutes: '03', seconds: '40' });
assert.equal(core.toClock(core.addMinutes(total, -5)), '00:00:00');

// 5. 輸入 90 分鐘並套用 = 01:30:00（秒數歸零）
assert.equal(core.parseMinutesInput('90'), 90);
assert.equal(core.toClock(core.fromMinutes(90)), '01:30:00');
// 套用會覆蓋原本的秒數
assert.equal(core.toClock(core.fromMinutes(core.parseMinutesInput('90'))), '01:30:00');

// 歸零
assert.equal(core.toClock(core.reset()), '00:00:00');

// ── 進位與邊界 ──────────────────────────────────────────────
assert.equal(core.toClock(core.addMinutes(core.toTotalSeconds({ hours: 0, minutes: 59, seconds: 59 }), 1)), '01:00:59');
assert.equal(core.toClock(core.addMinutes(core.toTotalSeconds({ hours: 2, minutes: 0, seconds: 0 }), 60)), '03:00:00');
assert.equal(clockOf({ hours: '', minutes: '', seconds: '' }), '00:00:00', '空欄位視為 0');
assert.equal(clockOf({ hours: null, minutes: undefined, seconds: 'abc' }), '00:00:00', '非數字視為 0');
assert.equal(clockOf({ hours: '0', minutes: '90', seconds: '0' }), '01:30:00', '手動輸入 90 分應正確進位');
assert.equal(clockOf({ hours: '0', minutes: '0', seconds: '3700' }), '01:01:40', '秒數超過一小時也要進位');
// 不可寫入欄位放不下的值
assert.equal(core.toClock(core.addMinutes(core.maxSeconds(), 60)), '99:59:59');
assert.equal(core.clamp(-1), 0);

// ── 分鐘輸入驗證：無效輸入回傳 null，不可靜默寫 0 ────────────
assert.equal(core.parseMinutesInput(''), null);
assert.equal(core.parseMinutesInput('   '), null);
assert.equal(core.parseMinutesInput('abc'), null);
assert.equal(core.parseMinutesInput('-5'), null);
assert.equal(core.parseMinutesInput('1e3'), null);
assert.equal(core.parseMinutesInput('0'), 0);
assert.equal(core.parseMinutesInput('7.5'), 7.5);
assert.equal(core.toClock(core.fromMinutes(7.5)), '00:08:00', '小數分鐘四捨五入到分鐘');

// ── 顯示格式 ────────────────────────────────────────────────
assert.equal(core.formatSummary(core.toTotalSeconds({ hours: 1, minutes: 30, seconds: 0 })), '1 小時 30 分鐘');
assert.equal(core.formatSummary(core.toTotalSeconds({ hours: 0, minutes: 19, seconds: 40 })), '19 分鐘 40 秒');
assert.equal(core.formatSummary(core.toTotalSeconds({ hours: 2, minutes: 0, seconds: 0 })), '2 小時');
assert.equal(core.formatSummary(0), '0 分鐘');
assert.equal(core.formatSummary(core.toTotalSeconds({ hours: 0, minutes: 0, seconds: 45 })), '45 秒');

// ═══ 欄位辨識 ═══════════════════════════════════════════════

// 依 aria-label / placeholder / name 判斷單位
const hinted = [
  makeInput({ 'aria-label': 'Seconds' }, '40'),
  makeInput({ 'aria-label': 'Hours' }, '00'),
  makeInput({ 'aria-label': 'Minutes' }, '19'),
];
let assigned = internals.assignUnits(hinted);
assert.equal(assigned.hours, hinted[1], '應依提示文字而非順序判斷小時');
assert.equal(assigned.minutes, hinted[2]);
assert.equal(assigned.seconds, hinted[0]);

// 沒有提示時退回文件順序：時、分、秒
const plain = [makeInput({}, '01'), makeInput({}, '02'), makeInput({}, '03')];
assigned = internals.assignUnits(plain);
assert.equal(assigned.hours, plain[0]);
assert.equal(assigned.minutes, plain[1]);
assert.equal(assigned.seconds, plain[2]);

// 提示只對一半時不可半猜半信，一律退回順序
const partial = [makeInput({ name: 'hh' }, '01'), makeInput({}, '02'), makeInput({}, '03')];
assigned = internals.assignUnits(partial);
assert.equal(assigned.hours, partial[0]);
assert.equal(assigned.minutes, partial[1]);
assert.equal(assigned.seconds, partial[2]);

// isTimeInput：小欄位與提示欄位可用，被停用 / 唯讀 / 非文字型別不可用
assert.equal(internals.isTimeInput(makeInput({ maxlength: '2' }, '00')), true);
assert.equal(internals.isTimeInput(makeInput({ max: '59' }, '30')), true);
assert.equal(internals.isTimeInput(makeInput({ 'aria-label': 'Hours' }, '')), true);
const disabled = makeInput({ maxlength: '2' }, '00');
disabled.disabled = true;
assert.equal(internals.isTimeInput(disabled), false, '停用欄位不可被當成 Time Taken');
const readOnly = makeInput({ maxlength: '2' }, '00');
readOnly.readOnly = true;
assert.equal(internals.isTimeInput(readOnly), false);
assert.equal(internals.isTimeInput(makeInput({ type: 'checkbox' }, 'on')), false);
assert.equal(internals.isTimeInput(makeInput({ type: 'hidden' }, '1')), false);
// 我們自己的工具列輸入框必須被排除，避免自我遞迴偵測
const ownUi = makeInput({ maxlength: '2' }, '00');
ownUi.closest = function (selector) { return selector === '.hpx-tta' ? {} : null; };
assert.equal(internals.isTimeInput(ownUi), false, '擴充自己的輸入框不可被偵測為原生欄位');

// 標籤比對：只看節點「自己的」文字節點，不遞迴子樹
function makeLabel(ownTextValue, childElements) {
  const childNodes = [];
  if (ownTextValue != null) childNodes.push({ nodeType: 3, nodeValue: ownTextValue });
  (childElements || []).forEach(function (element) { childNodes.push(element); });
  return { childNodes: childNodes, closest: function () { return null; } };
}

assert.equal(internals.isLabelCandidate(makeLabel('Time Taken')), true);
assert.equal(internals.isLabelCandidate(makeLabel('  Time  Taken ')), true);
assert.equal(internals.isLabelCandidate(makeLabel('Time Taken *')), true);
assert.equal(internals.isLabelCandidate(makeLabel('花費時間')), true);
assert.equal(internals.isLabelCandidate(makeLabel('Total Time')), false);
assert.equal(internals.isLabelCandidate(makeLabel('')), false);

// 外層容器只有子元素、沒有自己的文字 → 不算標籤（避免整頁 div 都去序列化子樹）
const wrapper = makeLabel(null, [{ nodeType: 1, textContent: 'Time Taken' }]);
assert.equal(internals.isLabelCandidate(wrapper), false, '子樹文字不可被當成本節點的標籤文字');

// 元素節點的文字不會被計入本節點自己的文字
const mixed = makeLabel('Time Taken', [{ nodeType: 1, textContent: ' Job Code Outcome Charge Rate' }]);
assert.equal(internals.isLabelCandidate(mixed), true, '子元素文字不應把短標籤撐長而失效');

// pickTriplet：優先取同一層的三個兄弟欄位
const parentA = {};
const parentB = {};
const sibling1 = makeInput({ maxlength: '2' }, '01');
const sibling2 = makeInput({ maxlength: '2' }, '02');
const sibling3 = makeInput({ maxlength: '2' }, '03');
const stray = makeInput({ maxlength: '2' }, '99');
sibling1.parentElement = parentA;
sibling2.parentElement = parentA;
sibling3.parentElement = parentA;
stray.parentElement = parentB;
const triplet = internals.pickTriplet([stray, sibling1, sibling2, sibling3]);
assert.deepEqual(triplet, [sibling1, sibling2, sibling3], '應挑同一個父層的三個欄位，忽略其他數字欄位');

// 只有時、分兩格（部分動作型別的 Time Taken 沒有秒欄位）也必須支援
const pairParent = {};
const pairH = makeInput({ maxlength: '2' }, '00');
const pairM = makeInput({ maxlength: '2' }, '19');
pairH.parentElement = pairParent;
pairM.parentElement = pairParent;
const pair = internals.pickTriplet([pairH, pairM]);
assert.deepEqual(pair, [pairH, pairM], '兩格欄位必須被接受，不可整組略過');
assert.equal(internals.pickTriplet([pairH]), null, '只有一格時不可硬湊成一組');

const pairFields = internals.assignUnits(pair);
assert.equal(pairFields.hours, pairH);
assert.equal(pairFields.minutes, pairM);
assert.equal(pairFields.seconds, null, '沒有秒欄位時必須是 null，不可指向其他欄位');
assert.equal(internals.readTotalSeconds(pairFields), 19 * 60);
internals.writeTotalSeconds(pairFields, core.addMinutes(internals.readTotalSeconds(pairFields), 15));
assert.equal(pairH.value + ':' + pairM.value, '00:34', '兩格欄位也要正確進位與寫回');
internals.writeTotalSeconds(pairFields, core.addMinutes(internals.readTotalSeconds(pairFields), 30));
assert.equal(pairH.value + ':' + pairM.value, '01:04', '兩格欄位跨小時進位');

// ── 單一欄位形式（整格 00:19:40）────────────────────────────
const combined = makeInput({ type: 'text' }, '00:19:40');
assert.equal(internals.isCombinedTimeInput(combined), true);
assert.equal(internals.isCombinedTimeInput(makeInput({ type: 'text' }, '19')), false, '純數字不是組合欄位');
assert.equal(internals.isCombinedTimeInput(makeInput({ type: 'text' }, 'abc')), false);

const combinedFields = { combined: combined };
assert.equal(internals.readTotalSeconds(combinedFields), 19 * 60 + 40);
internals.writeTotalSeconds(combinedFields, core.addMinutes(internals.readTotalSeconds(combinedFields), 15));
assert.equal(combined.value, '00:34:40', '組合欄位加減分鐘同樣保留秒數');

// HH:MM 形式必須維持原本格式，不可擅自補上秒數
const shortCombined = makeInput({ type: 'text' }, '00:50');
assert.equal(internals.readTotalSeconds({ combined: shortCombined }), 50 * 60);
internals.writeTotalSeconds({ combined: shortCombined }, core.addMinutes(50 * 60, 15));
assert.equal(shortCombined.value, '01:05', 'HH:MM 欄位不可被改成 HH:MM:SS');

// 代表節點：三格用小時欄位，組合欄位用自己
assert.equal(internals.primaryField({ hours: pairH, minutes: pairM }), pairH);
assert.equal(internals.primaryField({ combined: combined }), combined);
assert.equal(internals.primaryField({}), null);
assert.deepEqual(internals.fieldList({ hours: pairH, minutes: pairM, seconds: null }), [pairH, pairM]);

// ═══ 工具列插入位置：緊鄰原生欄位那一列 ═════════════════════

function makeNode(parent) {
  const node = {
    parentElement: parent || null,
    contains: function (other) {
      let cursor = other;
      while (cursor) {
        if (cursor === this) return true;
        cursor = cursor.parentElement;
      }
      return false;
    },
  };
  return node;
}

// 三個欄位是同一列的兄弟節點 → 共同祖先就是那一列
const timeRow = makeNode(null);
const fieldH = makeNode(timeRow);
const fieldM = makeNode(timeRow);
const fieldS = makeNode(timeRow);
assert.equal(
  internals.commonAncestor([fieldH, fieldM, fieldS]),
  timeRow,
  '工具列應掛在 Time Taken 欄位所在的那一列，而不是整個 Action 區塊'
);

// 某個欄位被額外包了一層 → 共同祖先仍然是那一列，不會往上跑到整個表單
const formSection = makeNode(null);
const nestedRow = makeNode(formSection);
const fieldWrapper = makeNode(nestedRow);
const nestedH = makeNode(fieldWrapper);
const nestedM = makeNode(nestedRow);
const nestedS = makeNode(nestedRow);
assert.equal(internals.commonAncestor([nestedH, nestedM, nestedS]), nestedRow);
assert.notEqual(internals.commonAncestor([nestedH, nestedM, nestedS]), formSection);

// 兩格欄位（沒有秒）同樣要找到正確的那一列
assert.equal(internals.commonAncestor([fieldH, fieldM]), timeRow);
assert.equal(internals.commonAncestor([]), null);

// ── 工具列必須放在「完整時分秒欄位」之後，不可插進欄位之間 ──

function makeRowNode(parent, ownTextValue) {
  const node = makeNode(parent);
  node.childNodes = ownTextValue ? [{ nodeType: 3, nodeValue: ownTextValue }] : [];
  node.children = [];
  node.classList = { add: function () {}, contains: function () { return false; } };
  node.appendChild = function (child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  };
  node.insertAdjacentElement = function (position, element) {
    const row = this.parentElement;
    const at = row.children.indexOf(this);
    element.parentElement = row;
    row.children.splice(position === 'afterend' ? at + 1 : at, 0, element);
    return element;
  };
  return node;
}

function buildRow() {
  const section = makeRowNode(null);
  const row = makeRowNode(section);
  const h = makeRowNode(row);
  const m = makeRowNode(row);
  const s = makeRowNode(row);
  const trailing = makeRowNode(row); // 例如驗證訊息或其他欄位
  row.children.push(h, m, s, trailing);
  section.children.push(row);
  return { section: section, row: row, fields: { hours: h, minutes: m, seconds: s }, trailing: trailing };
}

// 欄位是同一層兄弟：工具列必須整組排在完整欄位「之後」，
// 絕不可插在分與秒之間把原生排列拆開。
const layout = buildRow();
const toolbarNode = makeRowNode(null);
internals.mountToolbar(makeRowNode(null), layout.fields, toolbarNode);

assert.equal(layout.row.children.indexOf(toolbarNode), -1, '工具列不可被插進欄位所在的那一列');
assert.deepEqual(
  layout.row.children,
  [layout.fields.hours, layout.fields.minutes, layout.fields.seconds, layout.trailing],
  '時：分：秒 的原生排列必須完全不動'
);
assert.equal(
  layout.row.children.indexOf(layout.fields.seconds) - layout.row.children.indexOf(layout.fields.minutes),
  1,
  '分與秒必須維持相鄰，否則秒數會掉到下一行'
);
assert.equal(toolbarNode.parentElement, layout.section, '工具列應掛在欄位列的外層');
assert.equal(
  layout.section.children.indexOf(toolbarNode),
  layout.section.children.indexOf(layout.row) + 1,
  '工具列應緊接在完整 Time Taken 欄位列的下方'
);

// 欄位被包在窄框裡時，工具列要掛在整個窄框之後（也就是完整欄位的下方），
// 而不是鑽進窄框裡插在欄位中間。
const nestedLayout = (function () {
  const row = makeRowNode(null);
  const box = makeRowNode(row);
  const h = makeRowNode(box);
  const m = makeRowNode(box);
  const s = makeRowNode(box);
  box.children.push(h, m, s);
  const trailing = makeRowNode(row);
  row.children.push(box, trailing);
  return { row: row, box: box, fields: { hours: h, minutes: m, seconds: s }, trailing: trailing };
})();
const nestedToolbar = makeRowNode(null);
internals.mountToolbar(makeRowNode(null), nestedLayout.fields, nestedToolbar);
assert.equal(nestedToolbar.parentElement, nestedLayout.row, '應掛在窄框外面');
assert.equal(nestedLayout.box.children.length, 3, '窄框內只能有原本的三個欄位，不可被插入工具列');
assert.equal(
  nestedLayout.row.children.indexOf(nestedToolbar),
  nestedLayout.row.children.indexOf(nestedLayout.box) + 1,
  '工具列緊接在完整欄位區塊之後'
);

// 窄框中間夾著 ":" 分隔符（常見的 time widget 結構）同樣不可被插入
const colonLayout = (function () {
  const row = makeRowNode(null);
  const box = makeRowNode(row);
  const h = makeRowNode(box);
  const c1 = makeRowNode(box, ':');
  const m = makeRowNode(box);
  const c2 = makeRowNode(box, ':');
  const s = makeRowNode(box);
  box.children.push(h, c1, m, c2, s);
  row.children.push(box);
  return { row: row, box: box, fields: { hours: h, minutes: m, seconds: s } };
})();
const colonToolbar = makeRowNode(null);
internals.mountToolbar(makeRowNode(null), colonLayout.fields, colonToolbar);
assert.equal(colonToolbar.parentElement, colonLayout.row, '工具列應在整個 time widget 之外');
assert.equal(colonLayout.box.children.length, 5, '時:分:秒 的內部結構必須完整保留');

// ── blockAnchor：父層是 flex row 時要往上走，否則只會被排到右邊 ──

// 取不到 getComputedStyle（測試環境）時保守當作 block，不往上走
assert.equal(internals.blockAnchor(nestedLayout.box), nestedLayout.box);

const originalGetComputedStyle = global.window.getComputedStyle;
const flexRowNodes = new Set();
global.window.getComputedStyle = function (node) {
  return flexRowNodes.has(node)
    ? { display: 'flex', flexDirection: 'row' }
    : { display: 'block', flexDirection: 'row' };
};

const outer = makeRowNode(null);
const flexRow = makeRowNode(outer);
const innerBox = makeRowNode(flexRow);
outer.children.push(flexRow);
flexRow.children.push(innerBox);
flexRowNodes.add(flexRow);
assert.equal(
  internals.blockAnchor(innerBox),
  flexRow,
  '父層是 flex row 時要往上走出去，插在它後面才會真的落到下一行'
);

// 父層是一般 block 就地插入即可
flexRowNodes.clear();
assert.equal(internals.blockAnchor(innerBox), innerBox);

global.window.getComputedStyle = originalGetComputedStyle;

// ═══ 寫回原生欄位（框架相容性）═══════════════════════════════

function makeFields(h, m, s) {
  return {
    hours: makeInput({ 'aria-label': 'Hours' }, h),
    minutes: makeInput({ 'aria-label': 'Minutes' }, m),
    seconds: makeInput({ 'aria-label': 'Seconds' }, s),
  };
}

// 讀取
let fields = makeFields('00', '19', '40');
assert.equal(internals.readTotalSeconds(fields), 19 * 60 + 40);

// 驗收 1 的完整往返：00:19:40 --(+15 分)--> 00:34:40，且真的寫回三個欄位
prototypeSetterCalls = 0;
let next = core.addMinutes(internals.readTotalSeconds(fields), 15);
internals.writeTotalSeconds(fields, next);
assert.equal(fields.hours.value, '00');
assert.equal(fields.minutes.value, '34');
assert.equal(fields.seconds.value, '40', '加減分鐘必須保留原本秒數');
assert.equal(internals.readTotalSeconds(fields), 34 * 60 + 40, '重新讀取原生欄位應得到新值');

// 必須透過原生 prototype setter 寫入（不是單純 element.value = x）
assert.equal(prototypeSetterCalls, 3, '三個欄位都必須經由原生 value setter 寫入');

// 事件順序：input → change → blur → focusout
assert.deepEqual(fields.hours.events, ['input', 'change', 'blur', 'focusout']);
assert.deepEqual(fields.minutes.events, ['input', 'change', 'blur', 'focusout']);
assert.deepEqual(fields.seconds.events, ['input', 'change', 'blur', 'focusout']);

// 驗收 2：00:50:00 + 15 分 = 01:05:00
fields = makeFields('00', '50', '00');
internals.writeTotalSeconds(fields, core.addMinutes(internals.readTotalSeconds(fields), 15));
assert.equal(fields.hours.value + ':' + fields.minutes.value + ':' + fields.seconds.value, '01:05:00');

// 驗收 3：01:00:00 - 5 分 = 00:55:00
fields = makeFields('01', '00', '00');
internals.writeTotalSeconds(fields, core.addMinutes(internals.readTotalSeconds(fields), -5));
assert.equal(fields.hours.value + ':' + fields.minutes.value + ':' + fields.seconds.value, '00:55:00');

// 驗收 4：00:03:00 - 5 分 = 00:00:00
fields = makeFields('00', '03', '00');
internals.writeTotalSeconds(fields, core.addMinutes(internals.readTotalSeconds(fields), -5));
assert.equal(fields.hours.value + ':' + fields.minutes.value + ':' + fields.seconds.value, '00:00:00');

// 驗收 5：輸入 90 分鐘套用 = 01:30:00（秒數被歸零）
fields = makeFields('00', '19', '40');
internals.writeTotalSeconds(fields, core.fromMinutes(core.parseMinutesInput('90')));
assert.equal(fields.hours.value + ':' + fields.minutes.value + ':' + fields.seconds.value, '01:30:00');

// 歸零
fields = makeFields('02', '30', '15');
internals.writeTotalSeconds(fields, core.reset());
assert.equal(fields.hours.value + ':' + fields.minutes.value + ':' + fields.seconds.value, '00:00:00');

// 使用者手動把欄位改成非正規值後，工具列讀到的仍是正確總時間
fields = makeFields('1', '5', '7');
assert.equal(core.toClock(internals.readTotalSeconds(fields)), '01:05:07', '未補零的欄位也要正確解析');

// 多個 Action 同時編輯：兩組欄位互不影響
const groupA = makeFields('00', '10', '00');
const groupB = makeFields('00', '20', '00');
internals.writeTotalSeconds(groupA, core.addMinutes(internals.readTotalSeconds(groupA), 30));
assert.equal(core.toClock(internals.readTotalSeconds(groupA)), '00:40:00');
assert.equal(core.toClock(internals.readTotalSeconds(groupB)), '00:20:00', '另一組欄位不可被影響');

console.log('time-adjuster.test.js ✓ 全部通過');
