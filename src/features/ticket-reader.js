/**
 * ticket-reader.js
 *
 * 在 Ticket > Progress 上加一顆「閱讀視窗」按鈕，把完整活動歷程放到
 * 同源、可自由縮放的獨立視窗。視窗只讀，不會修改 HaloPSA 的任何資料。
 *
 * 為什麼使用同源 about:blank 視窗，而不是 chrome-extension:// 頁面：
 * Halo 的郵件圖片可能需要登入 Cookie；同源視窗能保留圖片載入能力。
 * 所有帶入的 HTML 仍會先 absolutize + sanitize，第三方連結也強制另開並
 * 加上 noopener，避免把 Halo 內容當成可信任程式碼。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  const BUTTON_ATTR = 'data-hpx-ticket-reader';
  const BUTTON_CLASS = 'hpx-ticket-reader-button';
  const ACTIVITY_SELECTOR = '.action-history-item';
  const POPUP_NAME = 'hpx-ticket-reader-window';
  const READER_STYLESHEET_PATH = 'src/styles/ticket-reader-window.css';
  const READER_STYLESHEET_URL = resolveReaderStylesheetUrl();

  let observer = null;
  let reconcileTimer = null;
  let readerWindow = null;
  let readerUi = null;
  let refreshSequence = 0;

  function text(el) {
    return String((el && el.innerText) || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  /**
   * 先把 extension URL 固定下來。使用者更新／重新載入擴充功能後，舊 Halo 分頁的
   * chrome.runtime 可能立即失效；若等到按「閱讀視窗」才呼叫 getURL，會在清空
   * about:blank 後拋錯，最後只留下全白視窗。
   */
  function resolveReaderStylesheetUrl() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
        return chrome.runtime.getURL(READER_STYLESHEET_PATH);
      }
    } catch (error) {
      // 開發預覽或 extension context 已失效時，改走目前 script 的相對路徑。
    }

    try {
      const script = document.currentScript;
      if (script && script.src) return new URL('../styles/ticket-reader-window.css', script.src).href;
    } catch (error) {
      // 沒有可用樣式時仍建立可閱讀的原生 HTML，不讓視窗全白。
    }
    return '';
  }

  function ticketRoot() {
    return document.querySelector('.details-form-holder.ticketdetails');
  }

  function progressPanel(root) {
    if (!root) return null;
    return (
      root.querySelector('[role="tabpanel"].react-tabs__tab-panel--selected ' + ACTIVITY_SELECTOR) &&
      root.querySelector('[role="tabpanel"].react-tabs__tab-panel--selected')
    ) || root.querySelector('[role="tabpanel"] ' + ACTIVITY_SELECTOR)?.closest('[role="tabpanel"]') || null;
  }

  function mountHost(root) {
    if (!root) return null;
    return root.querySelector(':scope > .tabControls .history-options.buttons-container') ||
      root.querySelector('.tabControls .history-options.buttons-container') ||
      root.querySelector(':scope > .tabControls');
  }

  function isTicketPage() {
    const path = String(window.location.pathname || '').toLowerCase();
    return /\/ticket\/?$/.test(path) || !!ticketRoot();
  }

  function ticketIdentity() {
    let id = '';
    try {
      id = new URL(window.location.href).searchParams.get('id') || '';
    } catch (e) {
      id = '';
    }
    const idHeading = Array.prototype.find.call(document.querySelectorAll('h1, h2'), function (heading) {
      return /\[ID:\s*\d+\]/i.test(text(heading));
    });
    if (!id && idHeading) {
      const match = text(idHeading).match(/\d+/);
      id = match ? String(Number(match[0])) : '';
    }

    const summaryNode = document.querySelector('.summary-header .noedit-value, .summary-header .read-value');
    const summary = text(summaryNode) || String(document.title || '').replace(/^Ticket\s+\d+[^-]*-\s*/i, '').trim();
    return {
      id: id,
      label: id ? 'Ticket ' + id : 'Ticket 閱讀視窗',
      summary: summary || '完整活動歷程',
      sourceUrl: window.location.href,
    };
  }

  function classifyActivity(label) {
    const value = String(label || '').toLowerCase();
    if (/email|mail|信件|郵件|寄信/.test(value)) return 'email';
    if (/note|備註|筆記|處理紀錄|處理記錄/.test(value)) return 'note';
    return 'status';
  }

  function safeContentHtml(item) {
    const sanitizer = NS.core.htmlSanitizer;
    const content = item.querySelector('.actioncontent');
    const frame = content && content.querySelector('iframe');
    let raw = '';
    let baseUrl = document.baseURI;

    if (frame) {
      try {
        const frameDoc = frame.contentDocument;
        if (frameDoc && frameDoc.body) {
          raw = frameDoc.body.innerHTML || '';
          if (frameDoc.baseURI && frameDoc.baseURI !== 'about:blank') baseUrl = frameDoc.baseURI;
        }
      } catch (e) {
        raw = '';
      }
    }

    if (!raw && content) {
      const clone = content.cloneNode(true);
      Array.prototype.slice.call(clone.querySelectorAll('iframe, script, style')).forEach(function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
      raw = clone.innerHTML || '';
      if (!text(clone)) raw = '';
    }

    if (!raw) return '';
    return sanitizer.sanitize(sanitizer.absolutizeUrls(raw, baseUrl || document.baseURI));
  }

  function collectActivity(item, index) {
    const when = text(item.querySelector('.when'));
    const actor = text(item.querySelector('.who'));
    const outcome = text(item.querySelector('.outcome')) || '活動更新';
    const duration = text(item.querySelector('.time'));
    const emailMeta = text(item.querySelector('.emailheader'));
    const status = text(item.querySelector('.status-avatar'));
    const header = text(item.querySelector('.history-header'));
    const html = safeContentHtml(item);

    return {
      id: item.getAttribute('data-id') || item.id || String(index + 1),
      index: index + 1,
      when: when,
      actor: actor,
      outcome: outcome,
      duration: duration,
      emailMeta: emailMeta,
      status: status,
      header: header,
      kind: classifyActivity(outcome + ' ' + header),
      html: html,
    };
  }

  function collectSnapshot() {
    const root = ticketRoot();
    const panel = progressPanel(root);
    const identity = ticketIdentity();
    const items = panel ? Array.prototype.slice.call(panel.querySelectorAll(ACTIVITY_SELECTOR)) : [];

    return {
      ticket: identity,
      capturedAt: new Date().toLocaleString('zh-TW', { hour12: false }),
      activities: items.map(collectActivity),
    };
  }

  /**
   * Halo 使用 infinite-scroll；點閱讀前短暫捲到底，直到活動數穩定，之後還原位置。
   * 最多等待約 6 秒，避免網路或 Halo 載入器異常時卡住。
   */
  async function loadCompleteHistory() {
    const panel = progressPanel(ticketRoot());
    if (!panel) return;
    const scroller = panel.querySelector('#tickethistoryscroll .infinite-scroll-component') ||
      panel.querySelector('.infinite-scroll-component');
    if (!scroller) return;

    const originalTop = scroller.scrollTop;
    let stableRounds = 0;
    let previousCount = panel.querySelectorAll(ACTIVITY_SELECTOR).length;
    let previousHeight = scroller.scrollHeight;

    for (let attempt = 0; attempt < 15 && stableRounds < 3; attempt += 1) {
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await wait(350);

      const count = panel.querySelectorAll(ACTIVITY_SELECTOR).length;
      const height = scroller.scrollHeight;
      if (count === previousCount && height === previousHeight) stableRounds += 1;
      else stableRounds = 0;
      previousCount = count;
      previousHeight = height;
    }

    scroller.scrollTop = Math.min(originalTop, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  function makeButton(doc, label, className) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = className || 'hpx-tr-btn';
    button.textContent = label;
    return button;
  }

  function ensurePopupDocument(popup) {
    let doc = popup && popup.document;
    if (!doc) throw new Error('Reader popup document is unavailable');
    if (!doc.documentElement || !doc.head || !doc.body) {
      doc.open();
      doc.write('<!doctype html><html><head></head><body></body></html>');
      doc.close();
      doc = popup.document;
    }
    if (!doc.documentElement || !doc.head || !doc.body) {
      throw new Error('Reader popup document is not ready');
    }
    return doc;
  }

  function makeReaderShell(popup) {
    const doc = ensurePopupDocument(popup);
    doc.title = 'Ticket 閱讀視窗';
    doc.documentElement.lang = 'zh-Hant';
    doc.documentElement.className = 'hpx-tr-document';

    // Match the active accent when creating the standalone reader.
    const appearance = window.getComputedStyle(document.documentElement);
    ['--hpx-accent', '--hpx-accent-ink'].forEach(function (property) {
      const value = appearance.getPropertyValue(property).trim();
      if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) doc.documentElement.style.setProperty(property, value);
    });

    const meta = doc.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width,initial-scale=1';

    const stylesheet = doc.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = READER_STYLESHEET_URL;

    const app = doc.createElement('div');
    app.className = 'hpx-tr-app';

    const header = doc.createElement('header');
    header.className = 'hpx-tr-header';
    header.id = 'hpx-tr-controls';

    const titleRow = doc.createElement('div');
    titleRow.className = 'hpx-tr-title-row';
    const titleWrap = doc.createElement('div');
    titleWrap.className = 'hpx-tr-title-wrap';
    const title = doc.createElement('h1');
    title.className = 'hpx-tr-title';
    const summary = doc.createElement('p');
    summary.className = 'hpx-tr-summary';
    titleWrap.append(title, summary);

    const primaryActions = doc.createElement('div');
    primaryActions.className = 'hpx-tr-primary-actions';
    const refresh = makeButton(doc, '重新同步', 'hpx-tr-btn hpx-tr-btn--primary');
    refresh.title = '重新讀取 HaloPSA 目前的活動歷程';
    const print = makeButton(doc, '列印');
    const close = makeButton(doc, '關閉', 'hpx-tr-btn hpx-tr-btn--quiet');
    primaryActions.append(refresh, print, close);
    titleRow.append(titleWrap, primaryActions);

    const toolbar = doc.createElement('div');
    toolbar.className = 'hpx-tr-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '閱讀與篩選工具');

    const searchWrap = doc.createElement('label');
    searchWrap.className = 'hpx-tr-search';
    const searchIcon = doc.createElement('span');
    searchIcon.textContent = '⌕';
    searchIcon.setAttribute('aria-hidden', 'true');
    const search = doc.createElement('input');
    search.type = 'search';
    search.placeholder = '搜尋活動內容、姓名或日期…';
    search.setAttribute('aria-label', '搜尋工單活動');
    searchWrap.append(searchIcon, search);

    const filter = doc.createElement('select');
    filter.className = 'hpx-tr-select';
    filter.setAttribute('aria-label', '活動類型');
    [
      ['all', '全部活動'],
      ['email', '郵件往來'],
      ['note', '處理 Note'],
      ['status', '狀態更新'],
    ].forEach(function (entry) {
      const option = doc.createElement('option');
      option.value = entry[0];
      option.textContent = entry[1];
      filter.appendChild(option);
    });

    const order = makeButton(doc, '新 → 舊');
    order.title = '切換活動顯示順序';
    const collapseAll = makeButton(doc, '全部收合');
    const zoomOut = makeButton(doc, 'A−', 'hpx-tr-btn hpx-tr-btn--square');
    zoomOut.title = '縮小文字';
    zoomOut.setAttribute('aria-label', '縮小文字');
    const zoomIn = makeButton(doc, 'A＋', 'hpx-tr-btn hpx-tr-btn--square');
    zoomIn.title = '放大文字';
    zoomIn.setAttribute('aria-label', '放大文字');
    const counter = doc.createElement('div');
    counter.className = 'hpx-tr-counter';
    counter.setAttribute('aria-live', 'polite');

    toolbar.append(searchWrap, filter, order, collapseAll, zoomOut, zoomIn, counter);
    header.append(titleRow, toolbar);

    const main = doc.createElement('main');
    main.className = 'hpx-tr-main';
    main.setAttribute('aria-label', '工單活動歷程');
    const loading = doc.createElement('div');
    loading.className = 'hpx-tr-loading';
    loading.textContent = '正在整理完整活動歷程…';
    main.appendChild(loading);

    const footer = doc.createElement('footer');
    footer.className = 'hpx-tr-footer';
    footer.textContent = '唯讀快照';

    const controlsToggle = makeButton(doc, '⌃', 'hpx-tr-controls-toggle');
    controlsToggle.setAttribute('aria-controls', header.id);
    controlsToggle.setAttribute('aria-expanded', 'true');
    controlsToggle.setAttribute('aria-label', '收合閱讀工具');
    controlsToggle.title = '收合閱讀工具';

    header.appendChild(controlsToggle);
    app.append(header, main, footer);

    // 所有節點建立完成後才一次替換文件；中途即使發生例外，也不會留下空白頁。
    doc.head.replaceChildren(meta);
    if (READER_STYLESHEET_URL) doc.head.appendChild(stylesheet);
    doc.body.className = 'hpx-tr-body';
    doc.body.replaceChildren(app);

    readerUi = {
      popup: popup,
      doc: doc,
      app: app,
      title: title,
      summary: summary,
      search: search,
      filter: filter,
      order: order,
      collapseAll: collapseAll,
      zoomOut: zoomOut,
      zoomIn: zoomIn,
      refresh: refresh,
      print: print,
      close: close,
      controlsToggle: controlsToggle,
      counter: counter,
      main: main,
      snapshot: null,
      reversed: false,
      fontSize: 16,
      allCollapsed: false,
      controlsExpanded: true,
    };

    function setControlsExpanded(expanded) {
      const isExpanded = expanded === true;
      readerUi.controlsExpanded = isExpanded;
      app.classList.toggle('hpx-tr-app--controls-collapsed', !isExpanded);
      controlsToggle.textContent = isExpanded ? '⌃' : '工具 ▾';
      controlsToggle.setAttribute('aria-expanded', String(isExpanded));
      controlsToggle.setAttribute('aria-label', isExpanded ? '收合閱讀工具' : '顯示閱讀工具');
      controlsToggle.title = isExpanded ? '收合閱讀工具' : '顯示閱讀工具';
    }

    function updateCards() {
      if (!readerUi || readerUi.doc !== doc) return;
      const query = readerUi.search.value.trim().toLocaleLowerCase('zh-TW');
      const kind = readerUi.filter.value;
      const cards = Array.prototype.slice.call(readerUi.main.querySelectorAll('.hpx-tr-card'));
      let visible = 0;
      cards.forEach(function (card) {
        const matchQuery = !query || String(card.getAttribute('data-search') || '').indexOf(query) !== -1;
        const matchKind = kind === 'all' || card.getAttribute('data-kind') === kind;
        card.hidden = !(matchQuery && matchKind);
        if (!card.hidden) visible += 1;
      });
      readerUi.counter.textContent = visible + ' / ' + cards.length + ' 筆';
      let emptyResults = main.querySelector('.hpx-tr-empty-results');
      if (!emptyResults && cards.length) {
        emptyResults = doc.createElement('div');
        emptyResults.className = 'hpx-tr-empty-results';
        emptyResults.setAttribute('role', 'status');
        emptyResults.textContent = '沒有符合條件的活動。請調整搜尋文字或活動類型。';
        main.insertBefore(emptyResults, main.querySelector('.hpx-tr-captured'));
      }
      if (emptyResults) emptyResults.hidden = visible > 0 || !cards.length;
    }

    search.addEventListener('input', updateCards);
    filter.addEventListener('change', updateCards);
    order.addEventListener('click', function () {
      readerUi.reversed = !readerUi.reversed;
      readerUi.order.textContent = readerUi.reversed ? '舊 → 新' : '新 → 舊';
      if (readerUi.snapshot) renderSnapshot(readerUi.snapshot);
    });
    collapseAll.addEventListener('click', function () {
      readerUi.allCollapsed = !readerUi.allCollapsed;
      Array.prototype.slice.call(main.querySelectorAll('.hpx-tr-card')).forEach(function (card) {
        card.classList.toggle('hpx-tr-card--collapsed', readerUi.allCollapsed);
        const toggle = card.querySelector('.hpx-tr-card-toggle');
        if (toggle) {
          toggle.textContent = readerUi.allCollapsed ? '展開內容' : '收合內容';
          toggle.setAttribute('aria-expanded', String(!readerUi.allCollapsed));
        }
      });
      collapseAll.textContent = readerUi.allCollapsed ? '全部展開' : '全部收合';
    });
    zoomOut.addEventListener('click', function () {
      readerUi.fontSize = Math.max(12, readerUi.fontSize - 1);
      doc.documentElement.style.setProperty('--hpx-tr-font-size', readerUi.fontSize + 'px');
    });
    zoomIn.addEventListener('click', function () {
      readerUi.fontSize = Math.min(24, readerUi.fontSize + 1);
      doc.documentElement.style.setProperty('--hpx-tr-font-size', readerUi.fontSize + 'px');
    });
    controlsToggle.addEventListener('click', function () {
      setControlsExpanded(!readerUi.controlsExpanded);
    });
    refresh.addEventListener('click', refreshReader);
    print.addEventListener('click', function () { popup.print(); });
    close.addEventListener('click', function () { popup.close(); });

    return readerUi;
  }

  function showReaderFailure(popup) {
    const doc = ensurePopupDocument(popup);
    doc.title = 'Ticket 閱讀視窗 · 載入失敗';
    doc.head.replaceChildren();
    doc.body.replaceChildren();
    doc.body.removeAttribute('class');
    doc.body.style.cssText = 'margin:0;padding:32px;background:#f4f6fb;color:#1d2433;font:16px/1.65 "Segoe UI","Microsoft JhengHei",sans-serif;';

    const panel = doc.createElement('main');
    panel.style.cssText = 'max-width:680px;margin:10vh auto;padding:28px;border:1px solid #fff;border-radius:22px;background:#ffffffeb;box-shadow:0 12px 40px #24386010;';
    const title = doc.createElement('h1');
    title.style.cssText = 'margin:0 0 10px;font-size:24px;';
    title.textContent = '閱讀視窗暫時無法載入';
    const message = doc.createElement('p');
    message.style.cssText = 'margin:0;color:#6e7788;';
    message.textContent = '請重新整理 HaloPSA 頁面後，再按一次「閱讀視窗」。';
    panel.append(title, message);
    doc.body.appendChild(panel);
  }

  function makeMeta(doc, className, value) {
    if (!value) return null;
    const node = doc.createElement('span');
    node.className = className;
    node.textContent = value;
    return node;
  }

  function renderActivity(activity, displayIndex) {
    const ui = readerUi;
    const doc = ui.doc;
    const card = doc.createElement('article');
    card.className = 'hpx-tr-card hpx-tr-card--' + activity.kind;
    card.setAttribute('data-kind', activity.kind);

    const header = doc.createElement('header');
    header.className = 'hpx-tr-card-header';
    const leading = doc.createElement('div');
    leading.className = 'hpx-tr-card-leading';
    const sequence = doc.createElement('span');
    sequence.className = 'hpx-tr-sequence';
    sequence.textContent = String(displayIndex + 1).padStart(2, '0');
    const heading = doc.createElement('div');
    heading.className = 'hpx-tr-card-heading';
    const outcome = doc.createElement('h2');
    outcome.id = 'hpx-tr-activity-heading-' + displayIndex;
    outcome.textContent = activity.outcome || '活動更新';
    card.setAttribute('aria-labelledby', outcome.id);
    const kind = doc.createElement('span');
    kind.className = 'hpx-tr-kind';
    kind.textContent = { email: '郵件', note: '紀錄', status: '狀態' }[activity.kind] || '活動';
    const line = doc.createElement('div');
    line.className = 'hpx-tr-meta-line';
    [
      makeMeta(doc, 'hpx-tr-actor', activity.actor),
      makeMeta(doc, 'hpx-tr-when', activity.when),
      makeMeta(doc, 'hpx-tr-duration', activity.duration),
      makeMeta(doc, 'hpx-tr-status', activity.status),
    ].filter(Boolean).forEach(function (node) { line.appendChild(node); });
    heading.append(outcome, kind, line);
    leading.append(sequence, heading);

    const toggle = makeButton(doc, '收合內容', 'hpx-tr-card-toggle');
    toggle.setAttribute('aria-expanded', 'true');
    header.append(leading, toggle);

    const content = doc.createElement('div');
    content.className = 'hpx-tr-card-content';
    content.id = 'hpx-tr-activity-content-' + displayIndex;
    toggle.setAttribute('aria-controls', content.id);
    if (activity.emailMeta) {
      const emailMeta = doc.createElement('div');
      emailMeta.className = 'hpx-tr-email-meta';
      emailMeta.textContent = activity.emailMeta;
      content.appendChild(emailMeta);
    }

    const body = doc.createElement('div');
    body.className = 'hpx-tr-content-body';
    if (activity.html) {
      body.innerHTML = activity.html;
      Array.prototype.slice.call(body.querySelectorAll('a')).forEach(function (anchor) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      });
      Array.prototype.slice.call(body.querySelectorAll('img')).forEach(function (image) {
        image.loading = 'lazy';
        image.addEventListener('error', function () {
          image.classList.add('hpx-tr-image--error');
          if (!image.alt) image.alt = '圖片無法載入';
        });
      });
    } else {
      body.classList.add('hpx-tr-content-body--empty');
      body.textContent = activity.kind === 'status' ? '此筆為狀態更新，沒有文字內容。' : '此筆活動沒有可讀取的內文。';
    }
    content.appendChild(body);
    card.append(header, content);

    const searchText = [activity.header, activity.emailMeta, body.textContent].join(' ').toLocaleLowerCase('zh-TW');
    card.setAttribute('data-search', searchText);
    if (ui.allCollapsed) card.classList.add('hpx-tr-card--collapsed');

    toggle.textContent = ui.allCollapsed ? '展開內容' : '收合內容';
    toggle.setAttribute('aria-expanded', String(!ui.allCollapsed));
    toggle.addEventListener('click', function () {
      const collapsed = card.classList.toggle('hpx-tr-card--collapsed');
      toggle.textContent = collapsed ? '展開內容' : '收合內容';
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
    return card;
  }

  function renderSnapshot(snapshot) {
    if (!readerUi || !readerUi.popup || readerUi.popup.closed) return;
    const ui = readerUi;
    ui.snapshot = snapshot;
    ui.doc.title = snapshot.ticket.label + ' · 閱讀視窗';
    ui.title.textContent = snapshot.ticket.label;
    ui.summary.textContent = snapshot.ticket.summary;
    ui.main.replaceChildren();

    const activities = snapshot.activities.slice();
    if (ui.reversed) activities.reverse();

    if (!activities.length) {
      const empty = ui.doc.createElement('div');
      empty.className = 'hpx-tr-empty';
      empty.textContent = '目前找不到可閱讀的活動內容。請確認仍停留在 Ticket 的 Progress 分頁後再按「重新同步」。';
      ui.main.appendChild(empty);
    } else {
      const fragment = ui.doc.createDocumentFragment();
      activities.forEach(function (activity, index) {
        fragment.appendChild(renderActivity(activity, index));
      });
      ui.main.appendChild(fragment);
    }

    const captured = ui.doc.createElement('div');
    captured.className = 'hpx-tr-captured';
    captured.textContent = '同步時間：' + snapshot.capturedAt;
    ui.main.appendChild(captured);

    ui.search.dispatchEvent(new ui.popup.Event('input'));
  }

  function showLoading(message) {
    if (!readerUi) return;
    const loading = readerUi.doc.createElement('div');
    loading.className = 'hpx-tr-loading';
    const spinner = readerUi.doc.createElement('span');
    spinner.className = 'hpx-tr-spinner';
    const label = readerUi.doc.createElement('span');
    label.textContent = message || '正在整理完整活動歷程…';
    loading.append(spinner, label);
    readerUi.main.replaceChildren(loading);
    readerUi.counter.textContent = '同步中';
  }

  async function refreshReader() {
    if (!readerWindow || readerWindow.closed || !readerUi) return;
    const sequence = ++refreshSequence;
    showLoading('正在載入完整活動歷程…');
    try {
      await loadCompleteHistory();
      if (sequence !== refreshSequence || !readerWindow || readerWindow.closed) return;
      renderSnapshot(collectSnapshot());
    } catch (error) {
      if (sequence !== refreshSequence || !readerUi) return;
      const message = readerUi.doc.createElement('div');
      message.className = 'hpx-tr-empty hpx-tr-empty--error';
      message.textContent = '活動內容整理失敗，請回到 HaloPSA 後再按一次「重新同步」。';
      readerUi.main.replaceChildren(message);
      NS.warn('Ticket 閱讀視窗同步失敗', error);
    }
  }

  function popupFeatures() {
    const screenInfo = window.screen || {};
    const availWidth = screenInfo.availWidth || 1440;
    const availHeight = screenInfo.availHeight || 900;
    const availLeft = typeof screenInfo.availLeft === 'number' ? screenInfo.availLeft : 0;
    const availTop = typeof screenInfo.availTop === 'number' ? screenInfo.availTop : 0;
    const width = Math.max(760, Math.min(1280, availWidth - 80));
    const height = Math.max(620, Math.min(980, availHeight - 70));
    const left = Math.round(availLeft + (availWidth - width) / 2);
    const top = Math.round(availTop + (availHeight - height) / 2);
    return [
      'popup=yes',
      'resizable=yes',
      'scrollbars=yes',
      'width=' + width,
      'height=' + height,
      'left=' + left,
      'top=' + top,
    ].join(',');
  }

  function openReader() {
    const root = ticketRoot();
    if (!root || !progressPanel(root)) {
      NS.ui.toast.show('請先切到 Ticket 的 Progress 分頁', { type: 'error' });
      return;
    }

    try {
      if (!readerWindow || readerWindow.closed) {
        readerWindow = window.open('about:blank', POPUP_NAME, popupFeatures());
        readerUi = null;
      }
      if (!readerWindow) {
        NS.ui.toast.show('瀏覽器阻擋了閱讀視窗，請允許此網站開啟彈出式視窗', {
          type: 'error',
          duration: 6000,
        });
        return;
      }

      if (!readerUi || readerUi.popup !== readerWindow || readerUi.doc !== readerWindow.document) {
        makeReaderShell(readerWindow);
      }
      readerWindow.focus();
      refreshReader();
    } catch (error) {
      readerUi = null;
      NS.warn('無法建立 Ticket 閱讀視窗', error);
      try {
        if (readerWindow && !readerWindow.closed) {
          showReaderFailure(readerWindow);
          readerWindow.focus();
        } else {
          readerWindow = null;
        }
      } catch (fallbackError) {
        readerWindow = null;
        NS.warn('無法顯示 Ticket 閱讀視窗錯誤畫面', fallbackError);
      }
      NS.ui.toast.show('閱讀視窗載入失敗，請重新整理 HaloPSA 後再試一次', { type: 'error' });
    }
  }

  function mount() {
    if (!isTicketPage()) return false;
    const root = ticketRoot();
    const host = mountHost(root);
    if (!host) return false;
    if (host.querySelector('[' + BUTTON_ATTR + ']')) return true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'solidbutton fabtn ' + BUTTON_CLASS;
    button.setAttribute(BUTTON_ATTR, '1');
    button.setAttribute('aria-label', '在獨立視窗閱讀完整工單內容');
    button.title = '在可調整大小的獨立視窗閱讀完整活動歷程';

    const icon = document.createElement('span');
    icon.className = 'hpx-ticket-reader-button__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '↗';
    const label = document.createElement('span');
    label.className = 'hpx-ticket-reader-button__label';
    label.textContent = '閱讀視窗';
    button.append(icon, label);
    button.addEventListener('click', openReader);
    host.appendChild(button);
    return true;
  }

  function reconcile() {
    window.clearTimeout(reconcileTimer);
    reconcileTimer = null;
    if (!isTicketPage()) {
      Array.prototype.slice.call(document.querySelectorAll('[' + BUTTON_ATTR + ']')).forEach(function (button) {
        if (button.parentNode) button.parentNode.removeChild(button);
      });
      return;
    }
    mount();
  }

  function scheduleReconcile() {
    if (reconcileTimer) return;
    reconcileTimer = window.setTimeout(reconcile, 120);
  }

  const TicketReader = {
    start: function () {
      if (observer) return;
      reconcile();
      observer = new MutationObserver(scheduleReconcile);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('popstate', scheduleReconcile);
      window.addEventListener('hashchange', scheduleReconcile);
    },
    open: openReader,
    reconcile: reconcile,
    debug: {
      collectSnapshot: collectSnapshot,
      loadCompleteHistory: loadCompleteHistory,
      mountHost: mountHost,
      makeReaderShell: makeReaderShell,
      renderSnapshot: renderSnapshot,
    },
  };

  NS.features.ticketReader = TicketReader;
})();
