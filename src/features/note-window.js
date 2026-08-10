/**
 * note-window.js
 * 獨立 Note 編輯視窗的 HaloPSA 這一側。
 *
 * 分工（刻意讓編輯視窗完全不認識 HaloPSA 的 DOM）：
 *   本檔        —— 唯一會讀寫 HaloPSA 編輯器的地方，負責取內容、衝突偵測、寫回。
 *   背景服務    —— 開視窗、保管 session、在兩端之間轉送訊息。
 *   編輯視窗    —— 只認識「一段 HTML」，不知道 Halo 長什麼樣子。
 *
 * ── 不變量（不可違反）──
 *  1. 只有收到 HPX_NOTE_APPLY_TO_EDITOR 才會寫回 HaloPSA。關閉視窗、取消、
 *     session 過期都不會動到原內容。
 *  2. 寫回前一定檢查目標元素還在 DOM 裡。絕不寫進已被 SPA 移除的 detached 節點 ——
 *     那會靜默吃掉使用者的編輯成果。
 *  3. 寫回前一定比對指紋。原內容在編輯期間被改過就擋下來，要求使用者明確決定。
 *  4. 永遠不會自動按 HaloPSA 的儲存。套用只把內容放進編輯器，存不存由使用者決定。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  // sessionId -> { editorEl, openFingerprint }
  const sessions = new Map();

  /**
   * 內容指紋（FNV-1a）。用來判斷「原內容在編輯期間有沒有被改過」。
   * 先收斂空白，避免編輯器重新序列化造成的無意義差異被當成衝突。
   */
  function fingerprint(html) {
    const value = String(html == null ? '' : html).replace(/\s+/g, ' ').trim();
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16) + ':' + value.length;
  }

  /** 建議的視窗位置：靠螢幕右側，讓 HaloPSA 仍看得到左半邊 */
  function suggestBounds() {
    const screen = window.screen || {};
    const availWidth = screen.availWidth || 1280;
    const availHeight = screen.availHeight || 800;
    const availLeft = typeof screen.availLeft === 'number' ? screen.availLeft : 0;
    const availTop = typeof screen.availTop === 'number' ? screen.availTop : 0;

    const width = Math.max(520, Math.min(820, Math.round(availWidth * 0.44)));
    const height = Math.max(520, Math.min(960, availHeight - 80));
    return {
      width: width,
      height: height,
      left: Math.round(availLeft + availWidth - width - 24),
      top: Math.round(availTop + 40),
    };
  }

  /** 從頁面標題猜一個給編輯視窗顯示的抬頭（純顯示用，猜錯無害） */
  function guessTitle() {
    const title = String(document.title || '').trim();
    const ticket = title.match(/\b\d{5,}\b/);
    if (ticket) return 'Ticket ' + ticket[0];
    return title.slice(0, 80) || 'HaloPSA Note';
  }

  const NoteWindow = {
    /**
     * 開啟獨立編輯視窗，把目前 Note 的 HTML 帶過去。
     * @param {Element} editorEl
     */
    open: function (editorEl) {
      if (!editorEl || !document.contains(editorEl)) {
        NS.ui.toast.show('找不到 Note 編輯器', { type: 'error' });
        return;
      }

      const adapter = NS.core.adapter;
      const sanitizer = NS.core.htmlSanitizer;

      const raw = adapter.getHtml(editorEl);
      // 先絕對化再清理：編輯視窗的 origin 是 chrome-extension://，
      // 相對路徑到那邊會解析到擴充功能自己身上。
      const absolute = sanitizer.absolutizeUrls(raw, document.baseURI);
      const clean = sanitizer.sanitize(absolute);

      chrome.runtime.sendMessage(
        {
          type: 'HPX_NOTE_OPEN',
          payload: {
            html: clean,
            title: guessTitle(),
            bounds: suggestBounds(),
          },
        },
        function (response) {
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            NS.ui.toast.show('無法開啟編輯視窗：' + lastErr.message, { type: 'error' });
            return;
          }
          if (!response || !response.ok) {
            const msg = (response && response.error) || '背景服務沒有回應';
            NS.ui.toast.show(msg, { type: 'error' });
            return;
          }

          sessions.set(response.sessionId, {
            editorEl: editorEl,
            openFingerprint: fingerprint(raw),
          });
          NS.log('已建立 Note 編輯 session', response.sessionId);
        }
      );
    },

    /**
     * 把編輯視窗的結果寫回 HaloPSA Note 編輯器。
     * @returns {{ok: boolean, conflict?: boolean, error?: string}}
     */
    applyToEditor: function (sessionId, html, force) {
      const session = sessions.get(sessionId);
      if (!session) {
        return {
          ok: false,
          error: '找不到這個編輯工作階段，HaloPSA 頁面可能已重新載入。請關閉編輯視窗後重新開啟。',
        };
      }

      const editorEl = session.editorEl;
      // 不變量 2：SPA 換過畫面之後，原本的元素可能已經被移除。
      if (!editorEl || !document.contains(editorEl)) {
        return {
          ok: false,
          error: '原本的 Note 編輯器已不在頁面上（可能已切換工單或關閉了 Action 視窗）。內容沒有被寫入任何地方，請重新開啟編輯視窗。',
        };
      }

      const adapter = NS.core.adapter;
      const currentHtml = adapter.getHtml(editorEl);

      // 不變量 3：偵測編輯期間的外部修改。
      if (!force && fingerprint(currentHtml) !== session.openFingerprint) {
        return {
          ok: false,
          conflict: true,
          error: 'HaloPSA 上的 Note 內容在你編輯期間被修改過。直接套用會覆蓋掉那些變更。',
        };
      }

      const clean = NS.core.htmlSanitizer.sanitize(html);
      adapter.setHtml(editorEl, clean);

      // 套用後更新指紋，讓使用者可以連續套用第二次而不誤判成衝突。
      session.openFingerprint = fingerprint(adapter.getHtml(editorEl));

      // 刻意不呼叫 scrollIntoView：它會捲動「所有」可捲動的祖先容器（含水平方向），
      // 在 HaloPSA 上會把工單頂端的 Action Bar 捲出可視範圍，看起來就像整排按鈕消失。
      // 這原本只是「幫使用者把游標帶回編輯器」的便利功能，不值得冒動到 Halo 版面的風險。

      NS.ui.toast.show('已套用到 HaloPSA Note —— 請按 Halo 自己的儲存鍵保存。', {
        type: 'success',
        duration: 5000,
      });
      return { ok: true };
    },

    /** session 結束（視窗關閉 / 取消）：只清狀態，絕不動 HaloPSA 內容 */
    endSession: function (sessionId) {
      if (sessions.delete(sessionId)) {
        NS.log('Note 編輯 session 已結束', sessionId);
      }
    },

    /** 編輯器被 SPA 移除時，連帶讓對應 session 失效 */
    forgetEditor: function (editorEl) {
      sessions.forEach(function (session, id) {
        if (session.editorEl === editorEl) sessions.delete(id);
      });
    },

    /**
     * 診斷用：把「套用」的各個副作用拆開單獨執行，用來定位是哪一步影響 HaloPSA 版面。
     * 手動在 Console 呼叫，正常流程不會用到。
     *
     *   const d = __HPX.features.noteWindow.debug;
     *   d.eventsOnly();  // 只派發 input/change/keyup，不改內容
     *   d.writeOnly();   // 原樣寫回現有內容（含事件），不捲動
     *   d.scrollOnly();  // 只做 scrollIntoView，不改內容
     *
     * 每一步之後看 Action Bar 還在不在，就知道兇手是哪一個。
     */
    debug: {
      /** 找出第一個被工具列標記過的編輯器 */
      target: function (editorEl) {
        if (editorEl) return editorEl;
        const el = document.querySelector('[data-hpx-enhanced="1"]');
        if (!el) throw new Error('找不到已標記的編輯器，請先開啟 Activity Note。');
        return el;
      },

      eventsOnly: function (editorEl) {
        const el = NoteWindow.debug.target(editorEl);
        NS.core.adapter.notify(el);
        // eslint-disable-next-line no-console
        console.log('[HPX] 已只派發同步事件（未改內容、未捲動）。檢查 Action Bar。');
      },

      writeOnly: function (editorEl) {
        const el = NoteWindow.debug.target(editorEl);
        const html = NS.core.adapter.getHtml(el);
        NS.core.adapter.setHtml(el, html);
        // eslint-disable-next-line no-console
        console.log('[HPX] 已原樣寫回 ' + html.length + ' 字元（含事件，未捲動）。檢查 Action Bar。');
      },

      scrollOnly: function (editorEl) {
        const el = NoteWindow.debug.target(editorEl);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // eslint-disable-next-line no-console
        console.log('[HPX] 已只執行 scrollIntoView（未改內容）。檢查 Action Bar。');
      },
    },

    /** 啟動：接收背景轉送過來的套用請求 */
    start: function () {
      chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        if (!message) return false;

        if (message.type === 'HPX_NOTE_APPLY_TO_EDITOR') {
          let result;
          try {
            result = NoteWindow.applyToEditor(
              message.sessionId,
              message.html,
              !!message.force
            );
          } catch (error) {
            NS.warn('套用回 HaloPSA 失敗', error);
            result = {
              ok: false,
              error: error && error.message ? error.message : '寫回 HaloPSA 時發生錯誤。',
            };
          }
          sendResponse(result);
          return false;
        }

        if (message.type === 'HPX_NOTE_SESSION_ENDED') {
          NoteWindow.endSession(message.sessionId);
          sendResponse({ ok: true });
          return false;
        }

        return false;
      });
    },
  };

  NS.features.noteWindow = NoteWindow;
})();
