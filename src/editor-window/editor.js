/**
 * editor.js
 * 獨立 Note 編輯視窗的邏輯。
 *
 * 這個頁面對 HaloPSA 一無所知 —— 它只做三件事：
 *   1. 跟背景服務要一段 HTML，放進大型 contenteditable。
 *   2. 讓使用者編輯，並提供 AI / 快速範本。
 *   3. 按「套用」時把 HTML 交回去，由 content script 寫回 HaloPSA。
 *
 * ── 富文字保護（V1 規則）──
 * AI 動作本質上是 plain-text in / plain-text out，直接套用在整篇富文字上
 * 一定會把表格、圖片、連結打回純文字。所以預設行為是**只處理選取範圍**：
 * 取代選取的文字節點，選取範圍以外的 HTML 一個位元都不動。
 * 沒有選取且內容含格式時，會擋下來要求使用者明確確認（destructive fallback）。
 *
 * ── 圖片 ──
 * 顯示時是佔位方塊，原始 <img> HTML 存在 data-hpx-img，套用時原樣還原。
 * 詳見 src/core/image-placeholder.js。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session') || '';

  const titleEl = document.getElementById('hpx-ew-title');
  const noticeEl = document.getElementById('hpx-ew-notice');
  const formatToolbarEl = document.getElementById('hpx-ew-format-toolbar');
  const toolbarEl = document.getElementById('hpx-ew-toolbar');
  const editorEl = document.getElementById('hpx-ew-editor');
  const statusEl = document.getElementById('hpx-ew-status');
  const applyBtn = document.getElementById('hpx-ew-apply');
  const cancelBtn = document.getElementById('hpx-ew-cancel');
  const layoutEl = document.querySelector('.hpx-ew');

  let initialFingerprint = '';
  let savedRange = null;
  let busy = false;
  let sourceMode = false;
  let sourceToggleBtn = null;
  let formatMenuDocumentBound = false;
  let selectedImageTarget = null;
  let imageResizeHandle = null;
  let imageResizeState = null;

  // ── 基礎工具 ────────────────────────────────────────────────────────────

  function sendBg(type, payload) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: type, payload: payload || {} }, function (response) {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          resolve({ ok: false, error: lastErr.message || '背景服務無回應' });
          return;
        }
        resolve(response || { ok: false, error: '背景服務無回應' });
      });
    });
  }

  function showNotice(message, kind) {
    noticeEl.textContent = message;
    noticeEl.className = 'hpx-ew__notice hpx-ew__notice--' + (kind || 'info');
  }

  function hideNotice() {
    noticeEl.className = 'hpx-ew__notice hpx-ew__notice--hidden';
  }

  function setStatus(message, isBusy) {
    statusEl.textContent = message || '';
    statusEl.className = 'hpx-ew__status' + (isBusy ? ' hpx-ew__status--busy' : '');
  }

  function setBusy(value, message) {
    busy = value;
    applyBtn.disabled = value;
    [formatToolbarEl, toolbarEl].forEach(function (toolbar) {
      if (!toolbar) return;
      Array.prototype.forEach.call(toolbar.querySelectorAll('button'), function (btn) {
        btn.disabled = value;
      });
    });
    if (formatToolbarEl) formatToolbarEl.setAttribute('aria-disabled', String(value));
    setStatus(value ? message || '處理中…' : '', value);
  }

  function fingerprint(text) {
    const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16) + ':' + value.length;
  }

  /** 目前編輯內容還原成「要寫回 Halo 的樣子」（佔位還原成真 <img>） */
  function modelHtml() {
    return NS.core.imagePlaceholder.fromPlaceholders(editorEl.innerHTML).html;
  }

  /** 自訂確認對話框。回傳 Promise<boolean>。 */
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      const overlay = document.createElement('div');
      overlay.className = 'hpx-ew-confirm';

      const box = document.createElement('div');
      box.className = 'hpx-ew-confirm__box';

      const title = document.createElement('div');
      title.className = 'hpx-ew-confirm__title';
      title.textContent = opts.title;

      const body = document.createElement('div');
      body.className = 'hpx-ew-confirm__body';
      body.textContent = opts.message;

      const actions = document.createElement('div');
      actions.className = 'hpx-ew-confirm__actions';

      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'hpx-btn hpx-btn--secondary';
      no.textContent = opts.cancelLabel || '取消';

      const yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'hpx-btn ' + (opts.danger ? 'hpx-btn--danger' : 'hpx-btn--primary');
      yes.textContent = opts.confirmLabel || '確定';

      actions.appendChild(no);
      actions.appendChild(yes);
      box.appendChild(title);
      box.appendChild(body);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      no.focus();

      function done(value) {
        document.removeEventListener('keydown', onKey);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape') done(false);
      }
      no.addEventListener('click', function () {
        done(false);
      });
      yes.addEventListener('click', function () {
        done(true);
      });
      document.addEventListener('keydown', onKey);
    });
  }

  // ── 選取範圍追蹤 ────────────────────────────────────────────────────────
  // 點工具列按鈕會讓編輯區失焦，所以要在選取變動當下就記住 Range。

  document.addEventListener('selectionchange', function () {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (editorEl.contains(range.commonAncestorContainer)) {
      savedRange = range.cloneRange();
    }
  });

  /** 目前有效的非空選取；沒有則回傳 null */
  function activeSelection() {
    if (!savedRange || savedRange.collapsed) return null;
    if (!editorEl.contains(savedRange.commonAncestorContainer)) return null;
    const text = savedRange.toString();
    if (!text.trim()) return null;
    return { range: savedRange, text: text };
  }

  /** 把工具列點擊前保存的游標 / 選取範圍放回編輯器。 */
  function restoreSavedSelection() {
    if (!savedRange || !editorEl.contains(savedRange.commonAncestorContainer)) return false;
    const selection = document.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(savedRange);
    return true;
  }

  /** 讓自訂 DOM 插入也進入 contenteditable 的輸入流程。 */
  function dispatchEditorInput() {
    let event;
    try {
      event = new InputEvent('input', { bubbles: true, inputType: 'insertText' });
    } catch (error) {
      event = new Event('input', { bubbles: true });
    }
    editorEl.dispatchEvent(event);
  }

  /** 執行瀏覽器原生 contenteditable 命令；Chrome 的編輯視窗支援這組命令。 */
  function runEditorCommand(command, value) {
    if (busy || sourceMode) return false;
    editorEl.focus();
    restoreSavedSelection();

    let ok = false;
    try {
      ok = document.execCommand(command, false, value == null ? null : value);
    } catch (error) {
      ok = false;
    }
    if (!ok) {
      showNotice('這個瀏覽器目前無法執行「' + command + '」。', 'error');
      return false;
    }
    dispatchEditorInput();
    return true;
  }

  /** 以目前游標位置插入由本程式建立的安全 HTML。 */
  function insertHtmlAtSelection(html) {
    if (busy || sourceMode) return false;
    editorEl.focus();
    restoreSavedSelection();

    let ok = false;
    try {
      ok = document.execCommand('insertHTML', false, String(html));
    } catch (error) {
      ok = false;
    }
    if (!ok) {
      const selection = document.getSelection();
      const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || !editorEl.contains(range.commonAncestorContainer)) return false;
      const holder = document.createElement('template');
      holder.innerHTML = String(html);
      range.deleteContents();
      range.insertNode(holder.content.cloneNode(true));
    }
    dispatchEditorInput();
    return true;
  }

  function insertTextAtSelection(text) {
    if (runEditorCommand('insertText', String(text))) return true;

    const selection = document.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editorEl.contains(range.commonAncestorContainer)) return false;
    range.deleteContents();
    range.insertNode(document.createTextNode(String(text)));
    dispatchEditorInput();
    return true;
  }

  function closestElement(node, tagName) {
    let current = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current && current !== editorEl) {
      if (current.tagName && current.tagName.toLowerCase() === tagName) return current;
      current = current.parentElement;
    }
    return null;
  }

  function selectionAnchor() {
    if (!savedRange) return null;
    return closestElement(savedRange.startContainer, 'a');
  }

  function normalizeUrl(value) {
    const url = String(value == null ? '' : value).trim();
    if (!url) return '';
    if (/^(https?:|mailto:|tel:|cid:|data:image\/)/i.test(url)) return url;
    return 'https://' + url;
  }

  /** 內容裡有沒有會被純文字處理破壞的東西 */
  function hasRichContent() {
    const fidelity = NS.core.htmlFidelity;
    const inv = fidelity.inventory(modelHtml());
    const rich = fidelity.CRITICAL_FEATURES.some(function (feature) {
      return (inv.counts[feature] || 0) > 0;
    });
    return rich || inv.styled > 0;
  }

  // ── 文字 → 節點 ────────────────────────────────────────────────────────

  /** 取代選取範圍用：換行以 <br> 呈現，不破壞所在的區塊結構 */
  function inlineFragment(text) {
    const frag = document.createDocumentFragment();
    String(text).split('\n').forEach(function (line, i) {
      if (i > 0) frag.appendChild(document.createElement('br'));
      if (line) frag.appendChild(document.createTextNode(line));
    });
    return frag;
  }

  /** 整篇取代用：逐行包 <div>，與 editor-adapter 的行為一致 */
  function blockFragment(text) {
    const frag = document.createDocumentFragment();
    String(text).split('\n').forEach(function (line) {
      const div = document.createElement('div');
      if (line) div.textContent = line;
      else div.appendChild(document.createElement('br'));
      frag.appendChild(div);
    });
    return frag;
  }

  // ── 文字類動作（AI）共用流程 ─────────────────────────────────────────────

  /**
   * 決定這次要處理的範圍。
   * @returns {Promise<{mode: 'selection'|'full', range: Range|null, text: string}|null>}
   */
  async function resolveScope(actionLabel) {
    const sel = activeSelection();
    if (sel) {
      return { mode: 'selection', range: sel.range, text: sel.text };
    }

    const fullText = editorEl.innerText;
    if (!fullText.trim()) {
      showNotice('編輯器內沒有文字可以處理。', 'error');
      return null;
    }

    // 沒有選取 + 內容含格式 = 會造成資料破壞，必須明確確認。
    if (hasRichContent()) {
      const proceed = await confirmDialog({
        title: '這會讓格式全部消失',
        message:
          '你沒有選取任何文字，「' +
          actionLabel +
          '」會處理整篇內容。\n\n' +
          '整篇處理的結果是純文字，目前內容裡的表格、圖片、連結、粗體與顏色都會被移除。\n\n' +
          '建議做法：先選取要處理的那一段文字，再按一次這個按鈕 —— 未選取的部分會完整保留。',
        confirmLabel: '仍要整篇轉成純文字',
        cancelLabel: '返回選取文字',
        danger: true,
      });
      if (!proceed) return null;
    }

    return { mode: 'full', range: null, text: fullText };
  }

  /** 把處理結果放回編輯區 */
  function applyResult(scope, text) {
    if (scope.mode === 'selection') {
      // 等待期間使用者可能改過 DOM，套用前重新確認 Range 仍然有效。
      if (!editorEl.contains(scope.range.commonAncestorContainer)) {
        showNotice('選取範圍在處理期間失效了，結果沒有套用。請重新選取後再試一次。', 'error');
        return;
      }
      scope.range.deleteContents();
      scope.range.insertNode(inlineFragment(text));
      savedRange = null;
    } else {
      editorEl.replaceChildren(blockFragment(text));
    }
    editorEl.focus();
  }

  /** 套用由本程式產生且已清理過的安全 HTML（目前用於工單語意標籤上色）。 */
  function applyHtmlResult(scope, html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');

    if (scope.mode === 'selection') {
      if (!editorEl.contains(scope.range.commonAncestorContainer)) {
        showNotice('選取範圍在處理期間失效了，結果沒有套用。請重新選取後再試一次。', 'error');
        return;
      }
      scope.range.deleteContents();
      scope.range.insertNode(template.content.cloneNode(true));
      savedRange = null;
    } else {
      editorEl.replaceChildren(template.content.cloneNode(true));
    }
    dispatchEditorInput();
    editorEl.focus();
  }

  /** 共用：跑一個文字處理動作 → 預覽 → 套用 */
  async function runTextAction(opts) {
    if (busy) return;
    hideNotice();

    const scope = await resolveScope(opts.label);
    if (!scope) return;

    setBusy(true, opts.loading);
    let result;
    try {
      result = await opts.process(scope.text);
    } catch (error) {
      setBusy(false);
      showNotice('處理失敗：' + (error && error.message ? error.message : String(error)), 'error');
      return;
    }
    setBusy(false);

    const scopeNote =
      scope.mode === 'selection'
        ? '只會取代你選取的那一段文字，其餘內容（含表格 / 圖片 / 連結）不受影響。'
        : '⚠ 這會取代整篇內容，且結果為純文字。';

    const finalText = await NS.ui.previewModal.open({
      title: opts.title,
      original: scope.text,
      result: result.text,
      note: (result.note ? result.note + ' ' : '') + scopeNote,
    });

    if (finalText == null) return;
    if (typeof opts.toHtml === 'function') {
      const safeHtml = NS.core.htmlSanitizer.sanitize(opts.toHtml(finalText));
      applyHtmlResult(scope, safeHtml);
    } else {
      applyResult(scope, finalText);
    }
    NS.ui.toast.show('已套用到編輯視窗（尚未寫回 HaloPSA）', { type: 'success' });
  }

  // ── 各動作 ──────────────────────────────────────────────────────────────

  function runAi(key) {
    const def = NS.config.aiActions[key];
    if (!def) return;

    return runTextAction({
      label: def.title,
      title: 'AI 潤稿：' + def.title,
      loading: def.loading,
      toHtml:
        key === 'professional' && NS.features.ticketRichFormat
          ? NS.features.ticketRichFormat.toHtml
          : null,
      process: function (text) {
        return NS.ai.adapter
          .request({ action: def.action || key, text: text, targetLang: def.targetLang })
          .then(function (res) {
            let note;
            if (res.stub) {
              note = '⚠ 測試模式 / 尚未設定 API Key —— 這是示意文字，未呼叫真實 AI。';
            } else if (res.provider === 'azure-deepseek') {
              note = 'Azure OpenAI（' + (res.deployment || '目前部署') + '）產生。';
            } else {
              note = 'Gemini（' + (res.model || '') + '）產生。';
            }
            return { text: res.text, note: note };
          });
      },
    });
  }

  /** 範本是「插入」不是「取代」，不會破壞既有格式，所以沒有選取範圍的限制 */
  function insertTemplate(id) {
    const tpl = NS.config.templates.find(function (t) {
      return t.id === id;
    });
    if (!tpl) return;

    const existing = editorEl.innerText;
    const content = (existing && existing.trim().length ? '\n' : '') + tpl.content;

    if (savedRange && editorEl.contains(savedRange.commonAncestorContainer)) {
      savedRange.deleteContents();
      savedRange.insertNode(inlineFragment(content));
      savedRange.collapse(false);
    } else {
      editorEl.appendChild(blockFragment(content));
    }
    editorEl.focus();
    NS.ui.toast.show('已插入範本：' + tpl.label, { type: 'success' });
  }

  // ── 工具列 ──────────────────────────────────────────────────────────────

  function makeButton(label, title, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hpx-tb-btn' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    if (title) btn.title = title;
    // 按下時不要奪走編輯區的選取範圍
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      onClick();
    });
    return btn;
  }

  function makeGroup(labelText) {
    const group = document.createElement('div');
    group.className = 'hpx-tb-group';
    if (labelText) {
      const lbl = document.createElement('span');
      lbl.className = 'hpx-tb-group-label';
      lbl.textContent = labelText;
      group.appendChild(lbl);
    }
    return group;
  }

  // ── 富文字工具列 ───────────────────────────────────────────────────────

  function makeFormatButton(label, title, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hpx-ew-format-btn' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    btn.title = title || label;
    btn.setAttribute('aria-label', title || label);
    btn.addEventListener('mousedown', function (event) {
      // 保住 contenteditable 的選取範圍，讓按鈕不會把游標變成工具列上的焦點。
      event.preventDefault();
    });
    btn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return btn;
  }

  function closeFormatMenus() {
    if (!formatToolbarEl) return;
    Array.prototype.forEach.call(
      formatToolbarEl.querySelectorAll('.hpx-ew-format-menu--open'),
      function (menu) {
        menu.classList.remove('hpx-ew-format-menu--open');
        const toggle = menu.parentElement && menu.parentElement.querySelector('.hpx-ew-format-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    );
  }

  function makeFormatMenu(label, title, items, wide) {
    const wrap = document.createElement('div');
    wrap.className = 'hpx-ew-format-menu-wrap';

    const toggle = makeFormatButton(label, title, function () {
      const menu = wrap.querySelector('.hpx-ew-format-menu');
      const open = menu.classList.contains('hpx-ew-format-menu--open');
      closeFormatMenus();
      menu.classList.toggle('hpx-ew-format-menu--open', !open);
      toggle.setAttribute('aria-expanded', String(!open));
    }, 'hpx-ew-format-toggle');
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'hpx-ew-format-menu' + (wide ? ' hpx-ew-format-menu--wide' : '');
    menu.setAttribute('role', 'menu');

    items.forEach(function (item) {
      if (item.separator) {
        const separator = document.createElement('div');
        separator.className = 'hpx-ew-format-menu__separator';
        menu.appendChild(separator);
        return;
      }
      const button = makeFormatButton(item.label, item.title || item.label, function () {
        closeFormatMenus();
        item.action();
      }, 'hpx-ew-format-menu__item');
      button.setAttribute('role', 'menuitem');
      menu.appendChild(button);
    });

    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    return wrap;
  }

  function applyBlockFormat(tagName) {
    if (busy || sourceMode) return;
    editorEl.focus();
    restoreSavedSelection();
    let ok = false;
    try {
      ok = document.execCommand('formatBlock', false, '<' + tagName + '>');
      if (!ok) ok = document.execCommand('formatBlock', false, tagName);
    } catch (error) {
      ok = false;
    }
    if (!ok) {
      showNotice('這個瀏覽器目前無法套用段落格式。', 'error');
      return;
    }
    dispatchEditorInput();
  }

  function insertLink() {
    if (busy || sourceMode) return;

    const existing = selectionAnchor();
    const currentUrl = existing ? existing.getAttribute('href') || '' : '';
    const entered = window.prompt('請輸入連結網址', currentUrl || 'https://');
    if (entered == null) return;

    const rawUrl = entered.trim();
    if (!rawUrl) {
      if (existing) runEditorCommand('unlink');
      return;
    }

    const url = normalizeUrl(rawUrl);
    if (!NS.core.htmlSanitizer.isSafeUrl(url, false)) {
      showNotice('這個連結網址不安全，請使用 http、https、mailto 或 tel 連結。', 'error');
      return;
    }

    if (existing) {
      existing.setAttribute('href', url);
      dispatchEditorInput();
      return;
    }

    if (activeSelection()) {
      runEditorCommand('createLink', url);
      return;
    }

    const text = window.prompt('請輸入連結文字', url);
    if (text == null || !text.trim()) return;
    const anchor = document.createElement('a');
    anchor.setAttribute('href', url);
    anchor.textContent = text.trim();
    insertHtmlAtSelection(anchor.outerHTML);
  }

  function insertImage() {
    if (busy || sourceMode) return;

    const entered = window.prompt('請輸入圖片網址（目前支援 http、https 或安全的 data:image）', 'https://');
    if (entered == null || !entered.trim()) return;

    const url = normalizeUrl(entered.trim());
    if (!NS.core.htmlSanitizer.isSafeUrl(url, true)) {
      showNotice('這個圖片網址不安全，請使用 http、https 或安全的圖片 data URL。', 'error');
      return;
    }

    const image = document.createElement('img');
    image.setAttribute('src', url);
    image.setAttribute('alt', '插入的圖片');
    image.setAttribute('style', 'max-width: 100%; height: auto;');
    insertHtmlAtSelection(image.outerHTML);
  }

  function isImageTarget(node) {
    return !!(
      node &&
      node.nodeType === Node.ELEMENT_NODE &&
      (node.tagName.toLowerCase() === 'img' || node.hasAttribute(NS.core.imagePlaceholder.ATTR))
    );
  }

  function selectImageTarget(target) {
    if (selectedImageTarget && selectedImageTarget !== target) {
      selectedImageTarget.classList.remove('hpx-ew__image-selected');
    }
    selectedImageTarget = target;
    if (selectedImageTarget) selectedImageTarget.classList.add('hpx-ew__image-selected');
    updateImageResizeHandle();
  }

  function removeImageResizeHandle() {
    if (imageResizeHandle && imageResizeHandle.parentNode) {
      imageResizeHandle.parentNode.removeChild(imageResizeHandle);
    }
    imageResizeHandle = null;
  }

  function updateImageResizeHandle() {
    if (
      !selectedImageTarget ||
      !editorEl.contains(selectedImageTarget) ||
      selectedImageTarget.tagName.toLowerCase() !== 'img'
    ) {
      removeImageResizeHandle();
      return;
    }

    const rect = selectedImageTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      removeImageResizeHandle();
      return;
    }
    if (!imageResizeHandle) {
      imageResizeHandle = document.createElement('button');
      imageResizeHandle.type = 'button';
      imageResizeHandle.className = 'hpx-ew-image-resize-handle';
      imageResizeHandle.title = '拖曳調整圖片大小';
      imageResizeHandle.setAttribute('aria-label', '拖曳調整圖片大小');
      imageResizeHandle.addEventListener('pointerdown', beginImageResize);
      document.body.appendChild(imageResizeHandle);
    }
    imageResizeHandle.style.left = Math.round(rect.right - 8) + 'px';
    imageResizeHandle.style.top = Math.round(rect.bottom - 8) + 'px';
  }

  function beginImageResize(event) {
    const image = selectedImageTarget;
    if (!image || image.tagName.toLowerCase() !== 'img') return;
    event.preventDefault();
    imageResizeState = {
      image: image,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: image.getBoundingClientRect().width,
      minWidth: 16,
      maxWidth: Math.max(16, editorEl.getBoundingClientRect().width - 32),
    };
    if (imageResizeHandle && imageResizeHandle.setPointerCapture) {
      imageResizeHandle.setPointerCapture(event.pointerId);
    }
    document.addEventListener('pointermove', moveImageResize);
    document.addEventListener('pointerup', endImageResize);
    document.addEventListener('pointercancel', endImageResize);
  }

  function moveImageResize(event) {
    if (!imageResizeState || event.pointerId !== imageResizeState.pointerId) return;
    const width = Math.max(
      imageResizeState.minWidth,
      Math.min(imageResizeState.maxWidth, imageResizeState.startWidth + event.clientX - imageResizeState.startX)
    );
    applyImageWidth(imageResizeState.image, Math.round(width) + 'px');
    updateImageResizeHandle();
  }

  function endImageResize(event) {
    if (!imageResizeState || event.pointerId !== imageResizeState.pointerId) return;
    document.removeEventListener('pointermove', moveImageResize);
    document.removeEventListener('pointerup', endImageResize);
    document.removeEventListener('pointercancel', endImageResize);
    imageResizeState = null;
    dispatchEditorInput();
    setStatus('圖片大小已調整，可繼續拖曳微調。');
    updateImageResizeHandle();
  }

  function normalizeImageWidth(value) {
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    if (raw === 'auto') return 'auto';
    const percent = raw.match(/^(\d{1,3}(?:\.\d+)?)%$/);
    if (percent) {
      const number = Number(percent[1]);
      return number > 0 && number <= 100 ? number + '%' : '';
    }
    const pixels = raw.match(/^(\d{1,4}(?:\.\d+)?)(?:px)?$/);
    if (pixels) {
      const number = Number(pixels[1]);
      return number >= 16 && number <= 5000 ? Math.round(number) + 'px' : '';
    }
    return '';
  }

  function applyImageWidth(image, width) {
    image.style.maxWidth = '100%';
    image.style.height = 'auto';
    if (width === 'auto') {
      image.style.removeProperty('width');
      image.removeAttribute('width');
      return;
    }
    image.style.width = width;
    if (/px$/.test(width)) image.setAttribute('width', String(parseInt(width, 10)));
    else image.removeAttribute('width');
  }

  function resizeSelectedImage() {
    if (busy || sourceMode) return;
    if (!selectedImageTarget || !editorEl.contains(selectedImageTarget)) {
      showNotice('請先點選要調整的圖片，再按「圖片大小」。', 'info');
      return;
    }

    const entered = window.prompt('輸入圖片寬度：例如 50%、320px，或 auto 還原原始大小。', '50%');
    if (entered == null) return;
    const width = normalizeImageWidth(entered);
    if (!width) {
      showNotice('圖片寬度請填 1–100% 或 16–5000px，也可填 auto。', 'error');
      return;
    }

    if (selectedImageTarget.tagName.toLowerCase() === 'img') {
      applyImageWidth(selectedImageTarget, width);
    } else {
      const original = selectedImageTarget.getAttribute(NS.core.imagePlaceholder.ATTR);
      const doc = new DOMParser().parseFromString('<body>' + String(original || '') + '</body>', 'text/html');
      const image = doc.body.querySelector('img');
      if (!image) {
        showNotice('找不到圖片資料，無法調整大小。', 'error');
        return;
      }
      applyImageWidth(image, width);
      selectedImageTarget.setAttribute(NS.core.imagePlaceholder.ATTR, image.outerHTML);
    }

    dispatchEditorInput();
    setStatus('圖片大小已調整為 ' + width + '。');
    updateImageResizeHandle();
  }

  function insertTable() {
    if (busy || sourceMode) return;

    const entered = window.prompt('請輸入表格大小，例如 3x3（最多 20x20）', '3x3');
    if (entered == null) return;
    const match = entered.trim().match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
    if (!match) {
      showNotice('表格大小格式不正確，請使用例如 3x3。', 'error');
      return;
    }

    const rows = Math.max(1, Math.min(20, Number(match[1])));
    const columns = Math.max(1, Math.min(20, Number(match[2])));
    let html = '<table border="1"><tbody>';
    for (let row = 0; row < rows; row += 1) {
      html += '<tr>';
      for (let column = 0; column < columns; column += 1) {
        html += '<td><br></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    insertHtmlAtSelection(html);
  }

  function toggleFullscreen() {
    if (!layoutEl) return;
    const full = layoutEl.classList.toggle('hpx-ew--fullscreen');
    const button = formatToolbarEl && formatToolbarEl.querySelector('[data-hpx-fullscreen]');
    if (button) {
      button.setAttribute('aria-pressed', String(full));
      button.title = full ? '離開全螢幕編輯' : '全螢幕編輯';
      button.setAttribute('aria-label', button.title);
    }
    editorEl.focus();
  }

  /** 切換 <> 原始碼檢視；離開時仍用同一層 sanitizer 清理。 */
  function toggleSourceMode(force) {
    const next = typeof force === 'boolean' ? force : !sourceMode;
    if (next === sourceMode) return true;

    if (next) {
      editorEl.textContent = modelHtml();
      editorEl.contentEditable = 'false';
      editorEl.classList.add('hpx-ew__editor--source');
      sourceMode = true;
      savedRange = null;
    } else {
      const clean = NS.core.htmlSanitizer.sanitize(editorEl.textContent || '');
      editorEl.contentEditable = 'true';
      editorEl.classList.remove('hpx-ew__editor--source');
      editorEl.innerHTML = clean;
      sourceMode = false;
      dispatchEditorInput();
      editorEl.focus();
    }

    if (sourceToggleBtn) {
      sourceToggleBtn.textContent = sourceMode ? '視覺' : '<>';
      sourceToggleBtn.title = sourceMode ? '返回視覺編輯' : '檢視／編輯 HTML 原始碼';
      sourceToggleBtn.setAttribute('aria-label', sourceToggleBtn.title);
      sourceToggleBtn.setAttribute('aria-pressed', String(sourceMode));
      sourceToggleBtn.classList.toggle('hpx-ew-format-btn--active', sourceMode);
    }
    return true;
  }

  function makeSpecialCharacterMenu() {
    const chars = ['©', '®', '™', '•', '→', '←', '↑', '↓', '≥', '≤', '±', '×', '÷', '✓', '…', '°', '∞', '—', '–', '「', '」', '【', '】', '（', '）'];
    const menuWrap = document.createElement('div');
    menuWrap.className = 'hpx-ew-format-menu-wrap';

    const toggle = makeFormatButton('Ω', '插入特殊符號', function () {
      const menu = menuWrap.querySelector('.hpx-ew-format-menu');
      const open = menu.classList.contains('hpx-ew-format-menu--open');
      closeFormatMenus();
      menu.classList.toggle('hpx-ew-format-menu--open', !open);
      toggle.setAttribute('aria-expanded', String(!open));
    }, 'hpx-ew-format-toggle hpx-ew-format-btn--icon');
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'hpx-ew-format-menu hpx-ew-format-menu--wide';
    menu.setAttribute('role', 'menu');
    const grid = document.createElement('div');
    grid.className = 'hpx-ew-format-char-grid';
    chars.forEach(function (character) {
      const button = makeFormatButton(character, '插入 ' + character, function () {
        closeFormatMenus();
        insertTextAtSelection(character);
      }, 'hpx-ew-format-menu__item');
      button.setAttribute('role', 'menuitem');
      grid.appendChild(button);
    });
    menu.appendChild(grid);
    menuWrap.appendChild(toggle);
    menuWrap.appendChild(menu);
    return menuWrap;
  }

  function buildRichToolbar() {
    if (!formatToolbarEl) return;
    formatToolbarEl.replaceChildren();

    const textGroup = document.createElement('div');
    textGroup.className = 'hpx-ew-format-group';
    const fullscreen = makeFormatButton('⛶', '全螢幕編輯', toggleFullscreen, 'hpx-ew-format-btn--icon');
    fullscreen.setAttribute('data-hpx-fullscreen', '1');
    fullscreen.setAttribute('aria-pressed', 'false');
    textGroup.appendChild(fullscreen);
    textGroup.appendChild(
      makeFormatMenu('A!', '文字格式與段落樣式', [
        { label: '一般段落', action: function () { applyBlockFormat('p'); } },
        { label: '標題 1', action: function () { applyBlockFormat('h1'); } },
        { label: '標題 2', action: function () { applyBlockFormat('h2'); } },
        { label: '標題 3', action: function () { applyBlockFormat('h3'); } },
        { label: '預格式文字', action: function () { applyBlockFormat('pre'); } },
        { separator: true },
        { label: '粗體', action: function () { runEditorCommand('bold'); } },
        { label: '斜體', action: function () { runEditorCommand('italic'); } },
        { label: '底線', action: function () { runEditorCommand('underline'); } },
        { label: '刪除線', action: function () { runEditorCommand('strikeThrough'); } },
        { label: '上標', action: function () { runEditorCommand('superscript'); } },
        { label: '下標', action: function () { runEditorCommand('subscript'); } },
        { separator: true },
        { label: '字級 1', action: function () { runEditorCommand('fontSize', '1'); } },
        { label: '字級 3', action: function () { runEditorCommand('fontSize', '3'); } },
        { label: '字級 5', action: function () { runEditorCommand('fontSize', '5'); } },
        { label: '清除文字格式', action: function () { runEditorCommand('removeFormat'); } },
      ], true)
    );
    textGroup.appendChild(
      makeFormatMenu('☰', '段落對齊', [
        { label: '靠左對齊', action: function () { runEditorCommand('justifyLeft'); } },
        { label: '置中對齊', action: function () { runEditorCommand('justifyCenter'); } },
        { label: '靠右對齊', action: function () { runEditorCommand('justifyRight'); } },
        { label: '左右對齊', action: function () { runEditorCommand('justifyFull'); } },
      ])
    );
    textGroup.appendChild(makeFormatButton('1.', '編號清單', function () { runEditorCommand('insertOrderedList'); }, 'hpx-ew-format-btn--icon'));
    textGroup.appendChild(makeFormatButton('•', '項目清單', function () { runEditorCommand('insertUnorderedList'); }, 'hpx-ew-format-btn--icon'));
    textGroup.appendChild(makeFormatButton('❝', '引用段落', function () { applyBlockFormat('blockquote'); }, 'hpx-ew-format-btn--icon'));
    formatToolbarEl.appendChild(textGroup);

    const richGroup = document.createElement('div');
    richGroup.className = 'hpx-ew-format-group';
    richGroup.appendChild(makeFormatButton('↔', '調整選取圖片的大小', resizeSelectedImage, 'hpx-ew-format-btn--icon'));
    richGroup.appendChild(makeFormatButton('🔗', '插入或編輯連結', insertLink, 'hpx-ew-format-btn--icon'));
    richGroup.appendChild(makeFormatButton('▧', '插入圖片（網址）', insertImage, 'hpx-ew-format-btn--icon'));
    richGroup.appendChild(makeFormatButton('▦', '插入表格', insertTable, 'hpx-ew-format-btn--icon'));
    richGroup.appendChild(makeFormatButton('―', '插入水平線', function () { runEditorCommand('insertHorizontalRule'); }, 'hpx-ew-format-btn--icon'));
    richGroup.appendChild(makeFormatButton('A̸', '清除文字格式', function () { runEditorCommand('removeFormat'); }, 'hpx-ew-format-btn--icon'));
    formatToolbarEl.appendChild(richGroup);

    const miscGroup = document.createElement('div');
    miscGroup.className = 'hpx-ew-format-group';
    miscGroup.appendChild(makeFormatButton('↶', '復原', function () { runEditorCommand('undo'); }, 'hpx-ew-format-btn--icon'));
    miscGroup.appendChild(makeFormatButton('↷', '重做', function () { runEditorCommand('redo'); }, 'hpx-ew-format-btn--icon'));
    miscGroup.appendChild(
      makeFormatMenu('⋯', '更多編輯功能', [
        { label: '減少縮排', action: function () { runEditorCommand('outdent'); } },
        { label: '增加縮排', action: function () { runEditorCommand('indent'); } },
        { label: '選取全部內容', action: function () { runEditorCommand('selectAll'); } },
        { label: '插入換行', action: function () { runEditorCommand('insertLineBreak'); } },
      ])
    );
    miscGroup.appendChild(makeSpecialCharacterMenu());
    sourceToggleBtn = makeFormatButton('<>', '檢視／編輯 HTML 原始碼', function () { toggleSourceMode(); }, 'hpx-ew-format-btn--icon hpx-ew-format-btn--source');
    sourceToggleBtn.setAttribute('aria-pressed', 'false');
    miscGroup.appendChild(sourceToggleBtn);
    formatToolbarEl.appendChild(miscGroup);

    if (!formatMenuDocumentBound) {
      document.addEventListener('click', function () {
        closeFormatMenus();
      });
      formatMenuDocumentBound = true;
    }
  }

  function buildToolbar() {
    const aiGroup = makeGroup('AI');
    Object.keys(NS.config.aiActions).forEach(function (key) {
      const def = NS.config.aiActions[key];
      aiGroup.appendChild(
        makeButton(def.label, def.title, function () {
          runAi(key);
        }, 'hpx-tb-btn--ai')
      );
    });
    toolbarEl.appendChild(aiGroup);

    const tplGroup = makeGroup('');
    const wrap = document.createElement('div');
    wrap.className = 'hpx-tb-dropdown';
    const menu = document.createElement('div');
    menu.className = 'hpx-tb-dropdown-menu';
    const toggle = makeButton('快速範本 ▾', '插入常用範本', function () {
      menu.classList.toggle('hpx-tb-dropdown-menu--open');
    }, 'hpx-tb-btn--template');

    NS.config.templates.forEach(function (tpl) {
      const item = makeButton(tpl.label, tpl.content, function () {
        insertTemplate(tpl.id);
        menu.classList.remove('hpx-tb-dropdown-menu--open');
      });
      item.classList.add('hpx-tb-dropdown-item');
      menu.appendChild(item);
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) menu.classList.remove('hpx-tb-dropdown-menu--open');
    });

    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    tplGroup.appendChild(wrap);
    toolbarEl.appendChild(tplGroup);
  }

  editorEl.addEventListener('click', function (event) {
    const target = event.target;
    const imageTarget = target && target.closest ? target.closest('img, [data-hpx-img]') : null;
    if (imageTarget && editorEl.contains(imageTarget) && isImageTarget(imageTarget)) {
      selectImageTarget(imageTarget);
      setStatus('已選取圖片，可按「圖片大小」調整。');
      return;
    }
    if (selectedImageTarget) {
      selectedImageTarget.classList.remove('hpx-ew__image-selected');
      selectedImageTarget = null;
      removeImageResizeHandle();
    }
  });

  editorEl.addEventListener('scroll', updateImageResizeHandle);
  window.addEventListener('resize', updateImageResizeHandle);

  // ── 套用 / 取消 ─────────────────────────────────────────────────────────

  async function doApply(force) {
    // 原始碼模式也可以直接按套用；先轉回安全的視覺 HTML 再走既有寫回流程。
    if (sourceMode) toggleSourceMode(false);
    setBusy(true, '正在寫回 HaloPSA…');

    const restored = NS.core.imagePlaceholder.fromPlaceholders(editorEl.innerHTML);
    // 送出前再清一次。另一端也會再清一次 —— 兩邊都清不是多餘，是刻意的。
    const clean = NS.core.htmlSanitizer.sanitize(restored.html);

    const res = await sendBg('HPX_NOTE_APPLY', {
      sessionId: sessionId,
      html: clean,
      force: !!force,
    });
    setBusy(false);

    if (res.ok) {
      setStatus('已寫回 HaloPSA，正在關閉…');
      await sendBg('HPX_NOTE_CLOSE', { sessionId: sessionId });
      window.close();
      return;
    }

    if (res.conflict) {
      const overwrite = await confirmDialog({
        title: 'HaloPSA 上的內容已被修改',
        message:
          (res.error || '原內容在編輯期間被改過。') +
          '\n\n' +
          '強制覆蓋會用這個視窗的內容取代 HaloPSA 目前的 Note，那些變更將會遺失。\n\n' +
          '若不確定，請先取消，回到 HaloPSA 確認目前內容之後再決定。',
        confirmLabel: '強制覆蓋',
        cancelLabel: '取消，我先去確認',
        danger: true,
      });
      if (overwrite) await doApply(true);
      else showNotice('已取消套用，HaloPSA 的內容沒有被改動。', 'info');
      return;
    }

    showNotice(res.error || '套用失敗，HaloPSA 的內容沒有被改動。', 'error');
  }

  async function doCancel() {
    const currentHtml = sourceMode ? editorEl.textContent || '' : modelHtml();
    const dirty = fingerprint(currentHtml) !== initialFingerprint;
    if (dirty) {
      const discard = await confirmDialog({
        title: '要放棄這些修改嗎？',
        message:
          '你在這個視窗做的修改還沒有套用回 HaloPSA。\n\n' +
          '關閉視窗不會改動 HaloPSA 上的原內容，但這裡的編輯會直接消失。',
        confirmLabel: '放棄並關閉',
        cancelLabel: '繼續編輯',
        danger: true,
      });
      if (!discard) return;
    }
    await sendBg('HPX_NOTE_CLOSE', { sessionId: sessionId });
    window.close();
  }

  applyBtn.addEventListener('click', function () {
    doApply(false);
  });
  cancelBtn.addEventListener('click', doCancel);

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === 's')) {
      e.preventDefault();
      if (!busy) doApply(false);
    }
  });

  // ── 啟動 ────────────────────────────────────────────────────────────────

  async function boot() {
    // 獨立視窗不會經過 HaloPSA content script，需自行同步目前主題與 Accent。
    if (NS.ui.theme && typeof NS.ui.theme.start === 'function') NS.ui.theme.start();

    if (!sessionId) {
      showNotice('缺少編輯工作階段參數，這個視窗無法使用。請關閉後從 HaloPSA 重新開啟。', 'error');
      applyBtn.disabled = true;
      return;
    }

    const res = await sendBg('HPX_NOTE_SESSION_GET', { sessionId: sessionId });
    if (!res.ok) {
      showNotice(res.error || '無法載入 Note 內容。', 'error');
      applyBtn.disabled = true;
      return;
    }

    titleEl.textContent = res.title || 'Note 編輯器';
    document.title = (res.title || 'Note') + ' — Note 編輯器';

    // 進來的內容再清一次（content script 已經清過；這裡不信任任何上游）
    const clean = NS.core.htmlSanitizer.sanitize(res.html || '');
    const placed = NS.core.imagePlaceholder.toPlaceholders(clean);
    editorEl.innerHTML = placed.html;

    initialFingerprint = fingerprint(modelHtml());
    buildToolbar();

    if (placed.count > 0) {
      showNotice(
        '這篇 Note 有 ' +
          placed.count +
          ' 張圖片。HaloPSA 的圖片需要登入權限，在獨立視窗無法顯示，因此以佔位方塊呈現 —— ' +
          '原始圖片會完整保留，套用時原樣寫回。刪掉佔位方塊等於刪掉那張圖。',
        'info'
      );
    }

    buildRichToolbar();
    editorEl.focus();
    setStatus('');
  }

  boot();
})();
