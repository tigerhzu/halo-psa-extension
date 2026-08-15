'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = function (file) { return fs.readFileSync(path.join(root, file), 'utf8'); };
const manifest = JSON.parse(read('manifest.json'));
const scripts = manifest.content_scripts.flatMap(function (entry) { return entry.js || []; });
const css = manifest.content_scripts.flatMap(function (entry) { return entry.css || []; });

assert.ok(scripts.includes('src/onboarding/index.js'), 'manifest 必須載入首次登入提示模組');
assert.ok(css.includes('src/styles/onboarding.css'), 'manifest 必須載入首次登入提示樣式');
assert.ok(scripts.indexOf('src/onboarding/index.js') < scripts.indexOf('src/content.js'), '精靈模組必須在 content.js 前載入');
assert.ok(fs.existsSync(path.join(root, 'src/onboarding/onboarding.html')), '首次登入提示必須有獨立頁面');
assert.ok(fs.existsSync(path.join(root, 'src/onboarding/page.js')), '獨立頁面必須有啟動腳本');

const onboarding = read('src/onboarding/index.js');
assert.match(read('src/ui/theme.js'), /const DEFAULT_THEME = 'cute-ios'/, '登入預設主題必須是 Cute');
assert.match(read('src/ui/theme.js'), /const DEFAULT_ACCENT = '#1a8987'/, '登入預設 Accent 必須使用目前 Cute 色');
assert.match(read('src/ui/settings-panel.js'), /accent: '#1a8987'/, '浮動面板預設 Accent 必須與登入預設一致');
assert.match(read('src/options/options.js'), /accent: '#1a8987'/, '設定頁預設 Accent 必須與登入預設一致');
assert.match(read('src/background/service-worker.js'), /ultimateMode: false/, '登入預設必須關閉簡單模式');
assert.match(onboarding, /onboardingVersion/, '精靈必須有版本旗標，避免每次載入重複顯示');
assert.match(onboarding, /Object\.assign\(\{\}, previous, patch\)/, '精靈寫入必須合併既有設定');
assert.match(onboarding, /ultimateTeams/, '精靈必須儲存 Team 白名單');
assert.match(onboarding, /defaultCcRecipients/, '精靈必須儲存預設 CC');
assert.match(onboarding, /永遠 CC 收件人/, '精靈必須使用新的永遠 CC 名稱');
assert.match(onboarding, /首次登入提示/, '精靈標題必須使用首次登入提示');
assert.match(onboarding, /HPX_OPEN_ONBOARDING/, 'Halo 內嵌精靈必須請求背景頁開啟獨立頁面');
assert.match(onboarding, /sourceUrl: window\.location\.href/, '精靈必須傳遞 HaloPSA 來源網址供返回主頁使用');
assert.match(onboarding, /回到 HaloPSA 主頁/, '完成頁必須提供返回 HaloPSA 按鈕');
assert.match(onboarding, /HPX_OPEN_HALOPSA_HOME/, '返回按鈕必須使用背景頁路由');
assert.match(onboarding, /略過這一步/, '三個步驟必須可以略過');
assert.doesNotMatch(onboarding, /console\.(?:log|info).*apiKey/i, 'API Key 不可輸出到 console');

const onboardingPage = read('src/onboarding/onboarding.html');
assert.match(onboardingPage, /\.\.\/styles\/onboarding\.css/, '獨立頁面必須載入精靈樣式');
assert.match(read('src/onboarding/page.js'), /page: true/, '獨立頁面必須以 page 模式啟動精靈');
assert.match(read('src/background/service-worker.js'), /HPX_OPEN_ONBOARDING/, '背景服務必須提供獨立精靈分頁');
assert.match(read('src/background/service-worker.js'), /HPX_OPEN_HALOPSA_HOME/, '背景服務必須處理返回 HaloPSA');
assert.match(read('src/background/service-worker.js'), /https:\/\/freedom\.halopsa\.com\//, '返回主頁必須有固定 HaloPSA 預設網址');
assert.match(read('src/background/service-worker.js'), /createHome\(DEFAULT_HALO_HOME\)/, '找不到來源分頁時必須開啟預設 HaloPSA 主頁');
assert.match(read('src/styles/onboarding.css'), /hpx-onboarding-complete-actions/, '完成頁按鈕必須有並排容器');
assert.match(read('src/styles/onboarding.css'), /translateY\(-8vh\)/, '內嵌精靈必須向上調整位置');
assert.match(read('src/styles/onboarding.css'), /align-items: start/, '獨立精靈頁面必須從較高位置開始顯示');
assert.match(read('src/styles/onboarding.css'), /hpx-onboarding-open \.hpx-besties-toolbar/, '內嵌精靈必須隱藏摯友工具列');
assert.match(read('src/core/email-window-detector.js'), /isOnboardingOpen/, '內嵌精靈開啟時必須停用摯友工具列偵測');

const settingsPanel = read('src/ui/settings-panel.js');
const optionsHtml = read('src/options/options.html');
const optionsJs = read('src/options/options.js');
assert.doesNotMatch(optionsHtml, /<button\b[^>]*>[^<]*(?:儲存|Save Settings)[^<]*<\/button>/i, '完整設定頁不可保留手動儲存按鈕');
assert.match(optionsJs, /scheduleSettingsPersist/, 'API 與外觀欄位必須使用即時套用');
assert.match(optionsJs, /scheduleTeamsPersist/, 'Team 清單變更必須使用即時套用');
assert.match(optionsJs, /scheduleGroupsPersist/, '自訂 CC 名單變更必須使用即時套用');
assert.match(optionsJs, /scheduleDefaultCcPersist/, '永遠 CC 變更必須使用即時套用');
assert.match(settingsPanel, /label\.textContent = '簡單模式'/, '浮動面板必須顯示簡單模式');
assert.doesNotMatch(settingsPanel, /hpx-sp-ultimate-description/, '浮動面板不可顯示簡單模式說明內文');
assert.match(settingsPanel, /hpx-sp-shortcut-edit/, 'Quick Link 必須有編輯筆按鈕');
assert.match(settingsPanel, /shortcutWrap\.draggable = true/, 'Quick Link 卡片必須可以拖曳排序');
assert.match(settingsPanel, /links\.splice\(sourceIndex, 1\)/, 'Quick Link 拖曳後必須更新清單順序');
assert.doesNotMatch(settingsPanel, /hpx-sp-shortcut-icon/, 'Quick Link 卡片不可保留前方箭頭圖示');
assert.doesNotMatch(settingsPanel, /管理常用頁面；點選卡片即可開啟。/, 'Quick Link 不可顯示多餘介紹文字');
assert.doesNotMatch(settingsPanel, /可使用 \/tickets 等站內路徑/, 'Quick Link 不可顯示多餘使用說明');
assert.match(settingsPanel, /row\.hidden = !editing/, '完成的 Quick Link 編輯列必須可隱藏');
assert.match(settingsPanel, /remove\.textContent = '刪除'/, 'Quick Link 刪除按鈕必須使用清楚文字');
assert.doesNotMatch(settingsPanel, /if \(complete && editing\)/, 'Quick Link 編輯時不可因輸入第一個字而自動收起');
assert.match(settingsPanel, /picker\.type = 'color'/, '浮動設定面板必須提供原生調色盤');
assert.match(settingsPanel, /normalizeAccent/, '浮動設定面板必須驗證自訂色碼');
assert.doesNotMatch(settingsPanel, /Save Settings/, '浮動設定面板不可再要求手動儲存');
assert.doesNotMatch(settingsPanel, /settingsBtn\.textContent = '設定'/, '浮動面板不可再顯示完整設定按鈕');
assert.match(settingsPanel, /makeSidebarControl\('settings', 'settings'/, '完整設定必須移至左側控制區');
assert.match(settingsPanel, /persistSettings\(\{ theme: draft\.theme \}\)/, '主題變更必須立即保存');
assert.match(settingsPanel, /persistSettings\(\{ accent: draft\.accent \}\)/, 'Accent 變更必須立即保存');
assert.match(settingsPanel, /persistSettings\(\{ pet: draft\.pet \}\)/, '寵物變更必須立即保存');
assert.match(settingsPanel, /persistSettings\(\{ pet: draft\.pet \}\)[\s\S]*closeSidebarPopover\(\)/, '選擇寵物後必須立即關閉寵物選單');
assert.match(read('src/styles/settings-panel.css'), /max-height: min\(70vh, calc\(100vh - 16px\)\)/, 'Quick Links 編輯面板必須限制在視窗高度內');
assert.match(settingsPanel, /keepPanelInsideViewport/, 'Quick Links 面板必須依實際視窗邊界重新夾住');
assert.match(settingsPanel, /keepShortcutEditorVisible/, 'Quick Links 編輯欄位取得焦點時必須自動捲入可視範圍');
assert.match(settingsPanel, /visualViewport\.addEventListener\('resize'/, '視窗可視區變更時必須重新定位 Quick Links');
assert.match(settingsPanel, /NS\.features\.ultimateMode\.setEnabled\(draft\.ultimateMode\)/, '簡單模式切換必須即時呼叫可逆恢復流程');
assert.doesNotMatch(settingsPanel, /status\.textContent/, '簡單模式無說明文字時不可殘留未定義 status 參照');
assert.match(settingsPanel, /document\.addEventListener\('pointerdown', outsideClickHandler, true\)/, '點擊面板外必須可關閉');
assert.match(settingsPanel, /panelEl\.contains\(target\)/, '面板內點擊不可誤關閉');
assert.match(optionsHtml, /<h2>簡單模式<\/h2>/, '設定頁必須顯示簡單模式');
assert.match(optionsHtml, /<h2>首次登入提示<\/h2>/, '設定頁必須獨立顯示首次登入提示');
assert.match(optionsHtml, /開啟首次登入提示/, '設定頁必須提供重新開啟首次登入提示按鈕');
assert.match(optionsHtml, /id="accentCustom" type="color"/, '設定頁必須提供自訂調色盤');
assert.match(optionsHtml, /拖曳左側手柄/, '簡單模式 Team 清單必須提示可拖曳排序');
assert.match(optionsJs, /row\.draggable = true/, '簡單模式 Team 清單必須支援拖曳排序');
assert.match(optionsJs, /team-drag-handle/, '簡單模式 Team 清單必須提供拖曳手柄');
assert.match(optionsJs, /moveTeamRow/, '簡單模式 Team 清單必須提供上下調整功能');
assert.match(read('src/options/options.js'), /accentCustom/, '設定頁必須保存自訂 Accent');
assert.match(read('src/ui/theme.js'), /function normalizeAccent/, '主題套用必須驗證 Accent 色碼');
assert.doesNotMatch(optionsHtml, /極致模式 Ultimate Mode/, '設定頁不可再顯示 Ultimate Mode 舊名稱');
assert.match(optionsHtml, /<h2>永遠 CC 收件人<\/h2>/, '設定頁必須顯示永遠 CC 收件人');
assert.match(optionsHtml, /<h2>自訂cc收件人<\/h2>/, '設定頁必須顯示自訂 cc 收件人');

const selectorSource = read('src/config/selectors.js');
assert.match(selectorSource, /id: 'op-team-a'.*teams: \['Op Team A'\]/, 'Op Team A 必須是獨立選項');
assert.match(selectorSource, /id: 'op-team-b'.*teams: \['Op Team B'\]/, 'Op Team B 必須是獨立選項');
assert.match(selectorSource, /id: 'op-team-c'.*teams: \['Op Team C'\]/, 'Op Team C 必須是獨立選項');
assert.match(selectorSource, /id: 'other-support'.*teams: \['Other Support'\]/, 'Other Support 必須列入簡單模式選項');
assert.match(selectorSource, /id: 'secop-team-a'.*teams: \['SecOp Team A'\]/, 'SecOp Team A 必須列入簡單模式選項');
assert.match(selectorSource, /id: 'technical-solutions-division'.*teams: \['Technical Solutions Division'\]/, 'Technical Solutions Division 必須列入簡單模式選項');
assert.match(read('src/options/options.js'), /TEAM_CATALOG_VERSION_FIELD/, '設定頁必須遷移舊版 Team catalog');
assert.match(read('src/ultimate-mode/index.js'), /mergeTeamCatalog/, '執行中的簡單模式必須補齊舊版 Team catalog');
assert.doesNotMatch(selectorSource, /id: 'operations'/, 'A/B/C 不可再綁成單一 operations 選項');

const style = { id: '', textContent: '' };
const attributes = new Map();
const sandbox = {
  window: { setTimeout: function () {}, __HPXUltimateBootstrap: null },
  document: {
    head: { appendChild: function () {} },
    documentElement: {
      appendChild: function () {},
      setAttribute: function (key, value) { attributes.set(key, value); },
      getAttribute: function (key) { return attributes.get(key) || null; },
      removeAttribute: function (key) { attributes.delete(key); },
    },
    getElementById: function () { return style.id ? style : null; },
    createElement: function () { return style; },
  },
  chrome: {
    storage: { local: { get: function (_key, callback) { callback({ hpx_settings: { ultimateMode: true, ultimateTeams: ['Project Manager', 'RD'] } }); } } },
  },
  Set: Set,
};
sandbox.window.window = sandbox.window;
vm.runInNewContext(read('src/ultimate-mode/bootstrap.js'), sandbox, { filename: 'bootstrap.js' });
assert.equal(attributes.get('data-hpx-ultimate-mode'), 'on');
assert.match(style.textContent, /Project Manager/);
assert.match(style.textContent, /RD/);
assert.doesNotMatch(style.textContent, /Op Team A/);

console.log('onboarding.test.js ✓ 全部通過');
