/** ultimate-mode.test.js — 極致模式的可逆性、白名單與 runtime wiring 靜態守門。 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = function (relative) { return fs.readFileSync(path.join(ROOT, relative), 'utf8'); };

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(text) {
    this.nodeType = 1;
    this.tagName = 'BUTTON';
    this.attributes = {};
    this.classList = new FakeClassList();
    this.childNodes = text ? [{ nodeType: 3, nodeValue: text }] : [];
    this.children = [];
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  matches() { return false; }
  closest() { return null; }
  querySelectorAll() { return []; }
}

const tracked = [];
const documentElement = new FakeElement();
const document = {
  documentElement,
  querySelectorAll(selector) {
    if (!selector.includes('data-hpx-ultimate-hidden') && !selector.includes('data-hpx-ultimate-keep')) return [];
    const sectionMatch = selector.match(/data-hpx-ultimate-section="([^"]+)"/);
    const keepMatch = selector.match(/data-hpx-ultimate-keep="([^"]+)"/);
    return tracked.filter(function (element) {
      const hiddenMatches = !selector.includes('data-hpx-ultimate-hidden') || (
        element.getAttribute('data-hpx-ultimate-hidden') === '1' &&
        (!sectionMatch || element.getAttribute('data-hpx-ultimate-section') === sectionMatch[1])
      );
      const keepMatches = !selector.includes('data-hpx-ultimate-keep') || (
        element.getAttribute('data-hpx-ultimate-keep') !== null &&
        (!keepMatch || element.getAttribute('data-hpx-ultimate-keep') === keepMatch[1])
      );
      return hiddenMatches && keepMatches;
    });
  },
};

const NS = { config: {}, ultimate: {}, warn: function () {}, log: function () {} };
const context = vm.createContext({
  window: { __HPX: NS },
  document,
  console,
  Set,
  Map,
  String,
  Array,
});
vm.runInContext(read('src/config/selectors.js'), context, { filename: 'selectors.js' });
vm.runInContext(read('src/ultimate-mode/shared.js'), context, { filename: 'shared.js' });

const shared = NS.ultimate.shared;
const cfg = NS.config.selectors.ULTIMATE_MODE;

assert.equal(shared.normalizeText('  Re–Assign : '), 're-assign');
assert.equal(shared.normalizeText('End\u00a0User   Details'), 'end user details');

const team = new FakeElement('Op Team C (17)');
assert.equal(shared.matchesLabel(team, cfg.SIDEBAR.KEEP_ITEMS, { allowTrailingCounter: true }), true);
assert.equal(shared.matchesLabel(team, cfg.SIDEBAR.KEEP_ITEMS), false);
const teamTickets = new FakeElement('Op Team C 8 Tickets');
assert.equal(shared.matchesLabel(teamTickets, cfg.SIDEBAR.KEEP_ITEMS, { allowTrailingCounter: true }), true);
const excludedTeam = new FakeElement('Op Team A');
assert.equal(shared.matchesLabel(excludedTeam, cfg.SIDEBAR.KEEP_ITEMS), true);
const countedHeading = new FakeElement('Ticket information2');
assert.equal(shared.matchesLabel(countedHeading, cfg.TICKET_INFO.HEADINGS, { allowTrailingCounter: true }), true);
assert.equal(shared.normalizeText('dateCreated'), 'date created');

const haloNode = new FakeElement('Projects');
tracked.push(haloNode);
assert.equal(shared.hide(haloNode, 'sidebar'), true);
assert.equal(haloNode.classList.contains(cfg.HIDDEN_CLASS), true);
assert.equal(haloNode.getAttribute(cfg.OWNED_ATTR), '1');

shared.restoreSection('ticket-actions');
assert.equal(haloNode.classList.contains(cfg.HIDDEN_CLASS), true, '其他區塊不可解除 Sidebar 標記');
shared.restoreSection('sidebar');
assert.equal(haloNode.classList.contains(cfg.HIDDEN_CLASS), false);
assert.equal(haloNode.getAttribute(cfg.OWNED_ATTR), null);

shared.hide(haloNode, 'sidebar');
shared.beginSection('sidebar');
assert.equal(shared.hide(haloNode, 'sidebar'), false, 'reconcile 不可重複改動已隱藏節點');
shared.finishSection('sidebar');
assert.equal(haloNode.classList.contains(cfg.HIDDEN_CLASS), true, '仍命中的節點必須保持隱藏');
shared.beginSection('sidebar');
shared.finishSection('sidebar');
assert.equal(haloNode.classList.contains(cfg.HIDDEN_CLASS), false, 'reconcile 必須恢復已失效節點');

shared.beginKeepSection('ticket-info');
assert.equal(shared.keep(haloNode, 'ticket-info'), true);
shared.finishKeepSection('ticket-info');
assert.equal(haloNode.getAttribute(cfg.KEEP_ATTR), 'ticket-info', '白名單節點應在掃描間保留');
shared.beginKeepSection('ticket-info');
shared.finishKeepSection('ticket-info');
assert.equal(haloNode.getAttribute(cfg.KEEP_ATTR), null, '失效白名單標記必須移除');

shared.hide(haloNode, 'sidebar');
documentElement.setAttribute('data-hpx-ultimate-mode', 'on');
shared.restoreAll();
assert.equal(haloNode.classList.contains(cfg.HIDDEN_CLASS), false, 'OFF 必須恢復所有 owned 節點');
assert.equal(documentElement.getAttribute('data-hpx-ultimate-mode'), null);

assert.deepEqual(
  Array.from(cfg.SIDEBAR.KEEP_ITEMS),
  [
    'Op Team A', 'Op Team B', 'Op Team C', 'Other Support',
    'Project Manager', 'SecOp Team A', 'Technical Solutions Division',
    'RD', 'Thailand Team', 'Sales&Admin', 'Timesheets',
  ]
);
assert.deepEqual(
  Array.from(cfg.SIDEBAR.TEAM_ITEMS),
  [
    'Op Team A', 'Op Team B', 'Op Team C', 'Other Support',
    'Project Manager', 'SecOp Team A', 'Technical Solutions Division',
    'RD', 'Thailand Team', 'Sales&Admin',
  ]
);
assert.equal(cfg.TEAM_CATALOG_VERSION_FIELD, 'ultimateTeamsCatalogVersion');
assert.equal(cfg.TEAM_CATALOG_VERSION, 2);
assert.equal(cfg.SIDEBAR.MIN_SIGNATURE_MATCHES, 3, 'Team tree 與 icon rail 必須可分開判定');
assert.equal(cfg.SIDEBAR.HALO_NAV_MENU_SELECTOR, '#app-nav-menu .app-nav-menu-sidebar');
assert.equal(cfg.SIDEBAR.PENDING_TEAM_KEY, 'hpx_ultimate_pending_team');
assert.ok(cfg.SCAN_DEBOUNCE_MS <= 50, 'Mutation 回應必須接近即時');
assert.ok(cfg.MAX_MUTATION_WAIT_MS <= 300, '連續 mutation 不可延遲 UI 太久');
assert.ok(cfg.NEW_TICKET_ROOT_SELECTORS.includes('.new-ticket-screen'), 'New Ticket 判斷必須有穩定根節點');
assert.ok(cfg.HEADER.ROOT_SELECTORS.includes('header'), '頁首候選必須優先使用語意 header');
assert.equal(cfg.HEADER.KEEP_LABELS.includes('New Ticket'), true, '簡單模式不可隱藏 New Ticket');
assert.equal(cfg.TICKET_UTILITIES.SECTION, 'ticket-utilities');
assert.ok(cfg.TICKET_UTILITIES.ROOT_SELECTORS.includes('.details_page_title'), 'Ticket utility 必須鎖定詳情頁根節點');
assert.ok(cfg.TICKET_UTILITIES.MIN_SIGNATURE_MATCHES >= 3, 'Ticket utility 必須有多控制項 fail-safe 簽章');
assert.ok(cfg.TEXT_CANDIDATE_SELECTORS.includes('div'), 'Halo 實際可見標籤使用普通 div，必須納入精確文字候選');
assert.ok(cfg.TICKET_ACTIONS.KEEP_PRIMARY.includes('Activity Note') === false);
assert.ok(cfg.TICKET_ACTIONS.KEEP_PRIMARY.includes('More options'));
assert.ok(cfg.TICKET_ACTIONS.KEEP_PRIMARY.includes('Awaiting Customer Reply'));
assert.ok(cfg.TICKET_ACTIONS.KEEP_PRIMARY.includes('Resolve Ticket'));
assert.ok(cfg.TICKET_ACTIONS.KEEP_PRIMARY.includes('Resolved Ticket'));
assert.deepEqual(
  Array.from(cfg.TICKET_ACTIONS.KEEP_MORE),
  ['Email User', 'Activity Note', 'Final Check with Customer/Sales']
);

const ultimateFiles = fs.readdirSync(path.join(ROOT, 'src', 'ultimate-mode'))
  .filter(function (name) { return name.endsWith('.js'); });
for (const name of ultimateFiles) {
  const source = read(path.join('src', 'ultimate-mode', name));
  assert.ok(!/\.remove\s*\(\s*\)/.test(source), name + ' 不得 remove Halo DOM');
  assert.ok(!/:nth-child|:nth-of-type/.test(source), name + ' 不得使用位置型 selector');
}

const manifest = JSON.parse(read('manifest.json'));
const content = manifest.content_scripts.find(function (entry) {
  return entry.js && entry.js.includes('src/content.js');
});
const bootstrap = manifest.content_scripts.find(function (entry) {
  return entry.js && entry.js.includes('src/ultimate-mode/bootstrap.js');
});
const sharedIndex = content.js.indexOf('src/ultimate-mode/shared.js');
const headerIndex = content.js.indexOf('src/ultimate-mode/header.js');
const shortcutsIndex = content.js.indexOf('src/ultimate-mode/team-shortcuts.js');
const utilitiesIndex = content.js.indexOf('src/ultimate-mode/ticket-utilities.js');
const indexIndex = content.js.indexOf('src/ultimate-mode/index.js');
const entryIndex = content.js.indexOf('src/content.js');
assert.ok(sharedIndex !== -1 && headerIndex > sharedIndex && utilitiesIndex > headerIndex && utilitiesIndex < indexIndex && indexIndex < entryIndex, '極致模式 manifest 載入順序錯誤');
assert.ok(shortcutsIndex > sharedIndex && shortcutsIndex < indexIndex, 'Team shortcuts manifest 載入順序錯誤');
assert.equal(bootstrap.run_at, 'document_start', '極致模式防閃爍必須在 document_start 執行');
assert.ok(bootstrap.css.includes('src/ultimate-mode/ultimate.css'), 'document_start 未注入 ultimate.css');
assert.equal(content.css.includes('src/ultimate-mode/ultimate.css'), false, 'ultimate.css 不可重複注入');
assert.match(read('src/ultimate-mode/bootstrap.js'), /8000/, 'document_start guard 必須有 fail-open timeout');
assert.match(read('src/ultimate-mode/index.js'), /removeAttribute\('data-hpx-ultimate-bootstrap'\)/, '主模組必須確認 bootstrap guard');
assert.match(read('src/ultimate-mode/ultimate.css'), /\.halo-ultimate-hidden\s*{[^}]*display:\s*none\s*!important/s);
assert.doesNotMatch(
  read('src/ultimate-mode/team-shortcuts.js'),
  /set\(\s*['"]selid['"]\s*,\s*['"](?:13|14|15)['"]\s*\)/,
  'Team ID 不可硬編碼'
);
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /row\.click\(\)/, 'Team shortcut 必須沿用 Halo 原生 row click');
assert.doesNotMatch(read('src/ultimate-mode/team-shortcuts.js'), /\b(?:fetch|XMLHttpRequest)\b/, 'Team shortcut 不得自行呼叫 API');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /chrome\.runtime\.getURL\(assetPath\)/, 'Team 快捷按鈕必須使用 Extension 內建圖片 logo');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /createTimesheetsLogo/, 'Timesheets logo 未建立');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /createTeamLogo/, 'Team logo 未建立');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /letter\.toLowerCase\(\)/, 'Team A/B/C 必須使用各自單字母 logo');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /assets\/ultimate-mode\/team-a\.webp/);
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /assets\/ultimate-mode\/team-b\.webp/);
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /assets\/ultimate-mode\/team-c\.webp/);
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /assets\/ultimate-mode\/timesheets\.webp/);
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /const branded = brandCurrentTimesheets\(\)/, 'Timesheets logo 必須跨頁維持');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /function isTeamNavigationRoute\(\)/, 'Team 快捷列必須集中判斷可保留的頁面路由');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /return isTimesheetsRoute\(\) \|\| isTicketsRoute\(\)/, 'Team 快捷列必須在 Timesheets 與 Tickets 路由保留');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /if \(!isTeamNavigationRoute\(\)\)\s*{\s*removeShortcuts\(\)/s, '離開 Team 導覽頁時才可移除 Team 快捷列');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /return cfg\.TEAM_ITEMS\.filter/, 'Timesheets 快捷列必須跟隨設定 Team 清單');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /new Set\(\)/, '快捷列 Team 清單必須去除重複項目');
assert.doesNotMatch(read('src/ultimate-mode/team-shortcuts.js'), /https?:\/\/(?!www\.w3\.org\/2000\/svg)/, 'Logo 不可依賴外部圖片');
assert.match(read('src/ultimate-mode/team-shortcuts.js'), /classList\.remove\('hpx-ultimate-timesheets-branded'\)/, 'OFF 必須恢復 Halo 原本 Timesheets logo');
assert.match(read('src/ultimate-mode/ticket-actions.js'), /if \(control === haloMore\) return;/, 'More listbox 必須以已驗證結構保留');
assert.match(read('src/ultimate-mode/ultimate.css'), /title="Resolve Ticket"/, 'Final Check 後的 Resolve Ticket 必須在第一幀保留');
assert.ok(
  manifest.web_accessible_resources.some(function (entry) {
    return entry.resources && entry.resources.includes('assets/ultimate-mode/*');
  }),
  '自訂 Sidebar logo 必須可由 Halo 頁面載入'
);
assert.match(read('src/ultimate-mode/index.js'), /teamShortcuts\.restore\(\)/, 'OFF 必須移除 Team shortcuts');
assert.match(read('src/ultimate-mode/index.js'), /safeApply\('Header', NS\.ultimate\.header\)/, '簡單模式必須以獨立模組處理頁首');
assert.match(read('src/ultimate-mode/header.js'), /New Ticket/, '頁首簽章必須確認 New Ticket');
assert.match(read('src/ultimate-mode/header.js'), /MIN_ICON_SIGNATURE/, '頁首隱藏前必須有多控制項 fail-safe 簽章');
assert.match(read('src/ultimate-mode/index.js'), /ticketUtilities/, 'Ticket 詳情頁 utility 必須獨立套用');
assert.match(read('src/ultimate-mode/ticket-utilities.js'), /ticket-utilities/, 'Ticket utility 必須使用獨立 section');
assert.match(read('src/ui/toolbar.js'), /hpx-new-ticket-hidden/, 'New Ticket 必須隱藏 Extension 自己的工具列');
assert.match(read('src/ui/toolbar.js'), /newticket/, 'New Ticket 工具列必須以 route / structural 判斷');
assert.match(read('src/ui/toolbar.js'), /Navigation API|window\.navigation/, 'SPA 導覽後必須同步既有工具列可見性');
assert.match(read('src/styles/toolbar.css'), /hpx-toolbar\.hpx-new-ticket-hidden/, 'New Ticket 工具列隱藏必須可逆且只影響 Extension UI');
assert.doesNotMatch(read('src/ultimate-mode/observer.js'), /attributes:\s*true/, 'Observer 不可監聽高頻屬性變化');
assert.match(read('src/ultimate-mode/sidebar.js'), /reconcileSection\(section/, 'Sidebar 必須增量 reconcile');
assert.match(read('src/ultimate-mode/observer.js'), /window\.navigation\.addEventListener\('navigate'/, 'SPA 導覽必須即時通知 observer');
assert.match(read('src/ultimate-mode/bootstrap.js'), /#halo-tree li:has/, 'Sidebar 必須由 bootstrap 產生第一幀 CSS guard');
assert.match(read('src/ultimate-mode/bootstrap.js'), /ultimateTeams/, '第一幀 CSS guard 必須讀取動態 Team 白名單');
assert.match(read('src/ultimate-mode/index.js'), /applyTeamSettings/, 'Ultimate Mode 必須即時套用 Team 設定');
assert.match(read('src/ultimate-mode/index.js'), /function syncSettings\(settings(?:,\s*rebuildShortcuts)?\)/, '設定變更必須集中走同一條同步路徑');
assert.match(read('src/ultimate-mode/index.js'), /safeApply\('Team Shortcuts', NS\.ultimate\.teamShortcuts\)/, 'Team 清單變更必須立即重建快捷列');
{
  const indexSource = read('src/ultimate-mode/index.js');
  assert.ok(
    indexSource.indexOf('chrome.storage.onChanged.addListener') < indexSource.lastIndexOf('readSetting();'),
    'storage listener 必須先於初始讀取註冊，避免初始化競態'
  );
}
assert.match(read('src/ultimate-mode/sidebar.js'), /params\.get\('selparentid'\)/, '進入特定 Team 時必須依 Halo 路由只顯示作用中 Team');
assert.match(read('src/ultimate-mode/sidebar.js'), /return \[parentMatch\]/, 'A/B/C 必須能各自獨立顯示');
assert.match(read('src/ultimate-mode/bootstrap.js'), /hpx_ultimate_pending_team/, 'Team shortcut 導頁時必須在第一幀只保留目標 Team');
assert.match(read('src/ultimate-mode/sidebar.js'), /expandActiveTeam/, '作用中 Team 必須自動展開');
assert.match(read('src/ultimate-mode/sidebar.js'), /data-hpx-expand-requested/, '自動展開不可因 MutationObserver 重複觸發');
assert.match(read('src/ultimate-mode/ultimate.css'), /data-hpx-ultimate-keep="ticket-info"/, 'Ticket Information 必須先隱藏再揭露白名單');

console.log('ultimate-mode.test.js ✓ 全部通過');
