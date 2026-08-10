/**
 * html-probe.js
 * 富文字往返 PoC 工具（開發者手動觸發，載入本身不做任何事）。
 *
 * 要證明的事：Halo Note 的 HTML 可以「讀出來 → 寫回去 → 按 Halo 的 Save → 重新載入」
 * 之後，圖片 / 表格 / 連結 / 清單 / 粗體都還在。這件事沒驗證過之前，
 * 不應該動手做獨立編輯視窗 —— 整個功能的前提就是這條往返成立。
 *
 * 在 HaloPSA 的 Activity Note 畫面開 Console，依序執行：
 *
 *   const p = __HPX.core.htmlProbe;
 *   await p.list();          // 1. 看偵測到哪些編輯器，挑一個 index
 *   await p.detect(0);       // 2. 問 MAIN world：這是哪套編輯器？有沒有官方寫入 API？
 *   p.snapshot(0);           // 3. 先備份原內容（隨時 p.restore(0) 還原）
 *   p.roundtrip(0);          // 4. 原內容讀出來原樣寫回去，檢查 DOM 層有沒有掉東西
 *   //    → 按 Halo 自己的 Save，重新整理頁面，重新開啟這筆 Note
 *   p.verify(0);             // 5. 與寫入時的內容比對，這才是「Halo 真的存下來了嗎」
 *
 * ⚠ 會修改 Note 內容，請在測試工單上做。
 * ⚠ baseline 暫存在該頁面的 sessionStorage（同源、關分頁即消失、不經過擴充功能儲存）。
 *   隨時可用 p.clear() 清掉。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const TARGET_ATTR = 'data-hpx-probe';
  const REQUEST_EVENT = 'hpx:editor:probe';
  const RESULT_EVENT = 'hpx:editor:probe-result';
  const BASELINE_KEY = '__hpx_probe_baseline';
  const BRIDGE_TIMEOUT_MS = 3000;

  // index → 原始 HTML 備份（只存在記憶體，重新整理就沒了）
  const snapshots = new Map();
  let requestSeq = 0;

  /** 用與 editor-detector 相同的規則列出候選編輯器 */
  function findEditors() {
    const sels = NS.config.selectors.EDITOR_SELECTORS;
    const seen = new Set();
    const found = [];
    sels.forEach(function (sel) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        return;
      }
      nodes.forEach(function (node) {
        if (seen.has(node)) return;
        seen.add(node);
        found.push(node);
      });
    });
    return found;
  }

  function editorAt(index) {
    const editors = findEditors();
    const el = editors[index];
    if (!el) {
      throw new Error('index ' + index + ' 沒有對應的編輯器，先執行 list() 確認。');
    }
    return el;
  }

  /** 向 MAIN world 的 editor-probe-bridge 發一次請求 */
  function askBridge(el, detail) {
    return new Promise(function (resolve) {
      requestSeq += 1;
      const requestId = 'probe-' + requestSeq;
      let settled = false;

      function onResult(event) {
        const data = event.detail || {};
        if (data.requestId !== requestId || settled) return;
        settled = true;
        clearTimeout(timer);
        document.removeEventListener(RESULT_EVENT, onResult);
        el.removeAttribute(TARGET_ATTR);
        resolve(data);
      }

      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        document.removeEventListener(RESULT_EVENT, onResult);
        el.removeAttribute(TARGET_ATTR);
        resolve({
          ok: false,
          error: 'MAIN world bridge 沒有回應（editor-probe-bridge.js 可能沒載入）。',
        });
      }, BRIDGE_TIMEOUT_MS);

      document.addEventListener(RESULT_EVENT, onResult);
      el.setAttribute(TARGET_ATTR, '1');
      document.dispatchEvent(
        new CustomEvent(REQUEST_EVENT, {
          detail: Object.assign({ requestId: requestId }, detail),
        })
      );
    });
  }

  function readBaselines() {
    try {
      return JSON.parse(window.sessionStorage.getItem(BASELINE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function writeBaseline(index, html, label) {
    const all = readBaselines();
    all[String(index)] = { html: html, label: label, at: new Date().toISOString() };
    try {
      window.sessionStorage.setItem(BASELINE_KEY, JSON.stringify(all));
    } catch (e) {
      NS.warn('baseline 無法寫入 sessionStorage（內容可能過大）', e);
    }
  }

  /** 把 compare() 結果印成人看得懂的報告 */
  function printReport(title, result) {
    /* eslint-disable no-console */
    console.group('[HPX PoC] ' + title + ' — ' + (result.ok ? '✅ 沒有遺失' : '❌ 有遺失'));

    const rows = {};
    Object.keys(result.before.counts).forEach(function (feature) {
      const b = result.before.counts[feature];
      const a = result.after.counts[feature];
      if (b === 0 && a === 0) return;
      rows[feature] = { 寫入前: b, 目前: a, 差異: a - b };
    });
    console.table(rows);

    console.log('inline style 元素：', result.before.styled, '→', result.after.styled);
    console.log('純文字長度：', result.before.textLength, '→', result.after.textLength);
    console.log('結構指紋是否改變：', result.structureChanged);

    if (result.criticalLost.length) {
      console.warn('遺失的關鍵格式：', result.criticalLost);
    }
    if (result.missingImages.length) {
      console.warn('消失的圖片 src：', result.missingImages);
    }
    if (result.missingLinks.length) {
      console.warn('消失的連結 href：', result.missingLinks);
    }
    if (result.gained.length) {
      console.log('（新增的包裝標籤，通常是編輯器正常行為）', result.gained);
    }
    console.groupEnd();
    /* eslint-enable no-console */
    return result;
  }

  /** 含各種富文字特徵的測試內容。圖片用 data: URL，順便測 Halo 後端會不會砍掉。 */
  function buildFixture() {
    const pixel =
      'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
    return [
      '<p>HPX-POC-START</p>',
      '<p><b>粗體</b> <i>斜體</i> <u>底線</u> <s>刪除線</s></p>',
      '<p><a href="https://example.com/hpx-poc">這是一個超連結</a></p>',
      '<ul><li>項目一</li><li>項目二</li></ul>',
      '<ol><li>編號一</li><li>編號二</li></ol>',
      '<table border="1"><tbody>',
      '<tr><th>欄位 A</th><th>欄位 B</th></tr>',
      '<tr><td>值 1</td><td colspan="1">值 2</td></tr>',
      '</tbody></table>',
      '<p><span style="color:#c00">紅色文字</span></p>',
      '<p><img src="' + pixel + '" alt="hpx-poc-img" width="1" height="1"></p>',
      '<p>HPX-POC-END</p>',
    ].join('');
  }

  const Probe = {
    /** 列出目前頁面偵測到的編輯器候選 */
    list: function () {
      const editors = findEditors();
      const rows = editors.map(function (el, i) {
        const html = NS.core.adapter.getHtml(el);
        const inv = NS.core.htmlFidelity.inventory(html);
        return {
          index: i,
          tag: el.tagName ? el.tagName.toLowerCase() : '',
          class: String(el.className || '').slice(0, 60),
          型態: NS.core.adapter.getKind(el),
          HTML長度: html.length,
          文字長度: inv.textLength,
          圖: inv.counts.image,
          表: inv.counts.table,
          連結: inv.counts.link,
          清單: inv.counts.listItem,
          粗體: inv.counts.bold,
        };
      });
      // eslint-disable-next-line no-console
      console.table(rows);
      return editors;
    },

    /** 問 MAIN world：這是哪一套編輯器？有沒有官方寫入 API（決定要不要 Plan B）？ */
    detect: function (index) {
      const el = editorAt(index || 0);
      return askBridge(el, { op: 'detect' }).then(function (data) {
        /* eslint-disable no-console */
        if (!data.ok) {
          console.error('[HPX PoC] 偵測失敗：', data.error);
          return data;
        }
        console.group('[HPX PoC] 編輯器偵測結果');
        console.log(JSON.stringify(data.detection, null, 2));
        const d = data.detection;
        const setters = [];
        if (d.froala.hasSetter) setters.push('froala.html.set');
        if (d.ckeditor5.hasSetter) setters.push('ckeditor5.setData');
        if (d.tinymce.hasSetter) setters.push('tinymce.setContent');
        if (d.angular.ngModelController) setters.push('angularjs.ngModel');
        console.log(
          setters.length
            ? '✅ 有可用的框架寫入 API（Plan B 可行）：' + setters.join(', ')
            : '⚠ 沒有偵測到框架寫入 API，只能靠 innerHTML + 事件派發。'
        );
        console.groupEnd();
        /* eslint-enable no-console */
        return data;
      });
    },

    /** 備份目前內容（寫入測試前務必先做） */
    snapshot: function (index) {
      const i = index || 0;
      const el = editorAt(i);
      const html = NS.core.adapter.getHtml(el);
      snapshots.set(i, html);
      // eslint-disable-next-line no-console
      console.log('[HPX PoC] 已備份 index ' + i + '，長度 ' + html.length + '。還原：restore(' + i + ')');
      return html;
    },

    /** 還原備份內容 */
    restore: function (index) {
      const i = index || 0;
      if (!snapshots.has(i)) throw new Error('index ' + i + ' 沒有備份，先執行 snapshot()。');
      NS.core.adapter.setHtml(editorAt(i), snapshots.get(i));
      // eslint-disable-next-line no-console
      console.log('[HPX PoC] 已還原 index ' + i + '。若要讓 Halo 存回原內容，記得按 Save。');
    },

    /**
     * 測試 1（DOM 層）：把現有內容原樣讀出、原樣寫回，看寫入路徑本身有沒有破壞格式。
     * 寫入後自動記錄 baseline，供 Save + 重新載入後用 verify() 比對。
     */
    roundtrip: function (index) {
      const i = index || 0;
      const el = editorAt(i);
      if (!snapshots.has(i)) this.snapshot(i);

      const before = NS.core.adapter.getHtml(el);
      NS.core.adapter.setHtml(el, before);
      const after = NS.core.adapter.getHtml(el);

      writeBaseline(i, after, 'roundtrip');
      const result = NS.core.htmlFidelity.compare(before, after);
      printReport('DOM 層往返（index ' + i + '）', result);
      // eslint-disable-next-line no-console
      console.log('👉 下一步：按 Halo 的 Save → 重新整理 → 重新開啟這筆 Note → 執行 verify(' + i + ')');
      return result;
    },

    /**
     * 測試 2：注入一份含表格 / 圖片 / 連結 / 清單 / 粗體的已知內容。
     * 適合在空白 Note 上驗證「Halo 後端會不會過濾掉某些標籤」。
     */
    fixture: function (index) {
      const i = index || 0;
      const el = editorAt(i);
      if (!snapshots.has(i)) this.snapshot(i);

      const html = buildFixture();
      NS.core.adapter.setHtml(el, html);
      const after = NS.core.adapter.getHtml(el);

      writeBaseline(i, after, 'fixture');
      const result = NS.core.htmlFidelity.compare(html, after);
      printReport('Fixture 寫入（index ' + i + '）', result);
      // eslint-disable-next-line no-console
      console.log('👉 下一步：按 Halo 的 Save → 重新整理 → 重新開啟這筆 Note → 執行 verify(' + i + ')');
      return result;
    },

    /**
     * 測試 3（Plan B）：改用編輯器自己的 API 寫入，比較哪條路徑能被 Halo 存下來。
     */
    frameworkWrite: function (index, html) {
      const i = index || 0;
      const el = editorAt(i);
      if (!snapshots.has(i)) this.snapshot(i);
      const payload = html == null ? buildFixture() : String(html);

      return askBridge(el, { op: 'write', html: payload }).then(function (data) {
        /* eslint-disable no-console */
        if (!data.ok) {
          console.error('[HPX PoC] 框架寫入失敗：', data.error);
          return data;
        }
        const after = NS.core.adapter.getHtml(el);
        writeBaseline(i, after, 'frameworkWrite:' + data.via);
        console.log('[HPX PoC] 已透過 ' + data.via + ' 寫入。');
        printReport('框架 API 寫入（index ' + i + '）', NS.core.htmlFidelity.compare(payload, after));
        console.log('👉 下一步：按 Halo 的 Save → 重新整理 → 重新開啟 → verify(' + i + ')');
        /* eslint-enable no-console */
        return data;
      });
    },

    /**
     * 關鍵測試：與寫入時記錄的 baseline 比對。
     * 這一步跨越了 Halo 的儲存與後端處理，回答的是「Halo 真的存下富文字了嗎」。
     */
    verify: function (index) {
      const i = index || 0;
      const baselines = readBaselines();
      const baseline = baselines[String(i)];
      if (!baseline) {
        throw new Error('index ' + i + ' 沒有 baseline，先執行 roundtrip() 或 fixture()。');
      }
      const current = NS.core.adapter.getHtml(editorAt(i));
      const result = NS.core.htmlFidelity.compare(baseline.html, current);
      printReport(
        '存檔往返驗證（index ' + i + '，baseline=' + baseline.label + ' @ ' + baseline.at + '）',
        result
      );
      return result;
    },

    /** 清除 baseline 暫存 */
    clear: function () {
      try {
        window.sessionStorage.removeItem(BASELINE_KEY);
      } catch (e) {
        /* 忽略 */
      }
      snapshots.clear();
      // eslint-disable-next-line no-console
      console.log('[HPX PoC] 已清除 baseline 與備份。');
    },
  };

  NS.core.htmlProbe = Probe;
})();
