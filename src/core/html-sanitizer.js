/**
 * html-sanitizer.js
 * 白名單 HTML 清理器。content script 與獨立編輯視窗共用同一份實作。
 *
 * ── 為什麼一定要有這層 ──
 * 獨立編輯視窗是 chrome-extension:// 的**特權頁面**，那裡拿得到 chrome.storage
 *（裡面有 Azure / Ornith / HaloPSA 的 API Key）。把 HaloPSA 頁面來的 HTML 直接灌進去，
 * 等於讓工單內容有機會在特權 context 執行。MV3 的預設 CSP 會擋掉 inline script，
 * 但那是最後一道防線，不是唯一一道 —— 這裡用白名單把不該進來的東西擋在門外。
 *
 * ── 邊界 ──
 *  - 用 DOMParser 真正解析 HTML，不是字串比對。
 *   （html-fidelity.js 的 regex 掃描只用於「量測掉了什麼」，不可拿來當安全邊界。）
 *  - DOMParser 建立的是 detached document：不會執行 script，也不會載入外部資源。
 *  - 一律剝除 data-hpx-* 屬性。編輯視窗的圖片佔位機制會用到這個前綴，
 *    如果放行，惡意工單就能偽造佔位標記讓還原流程把任意 HTML 放回去。
 *
 * 進出兩個方向都要呼叫：Halo → 編輯視窗要清一次，編輯視窗 → Halo 也要再清一次。
 * 「另一端已經清過了」不是跳過的理由。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  /** 允許保留的標籤。不在名單內、也不在 DROP_WITH_CONTENT 的標籤會被「拆殼」（保留子節點）。 */
  const ALLOWED_TAGS = [
    'p', 'div', 'span', 'br', 'hr',
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark',
    'sub', 'sup', 'small', 'big', 'font',
    'a', 'img',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
    'abbr', 'cite', 'q', 'time', 'address', 'figure', 'figcaption',
  ];

  /** 這些標籤連同內容整個移除（拆殼會把腳本內文變成可見文字，更糟）。 */
  const DROP_WITH_CONTENT = [
    'script', 'style', 'iframe', 'object', 'embed', 'applet', 'noscript', 'template',
    'form', 'input', 'textarea', 'select', 'option', 'button', 'label', 'fieldset',
    'link', 'meta', 'base', 'title', 'head',
    'svg', 'math', 'canvas', 'audio', 'video', 'source', 'track',
    'frame', 'frameset', 'marquee', 'dialog', 'slot', 'portal',
  ];

  /** 所有標籤都可保留的屬性 */
  const GLOBAL_ATTRS = ['title', 'dir', 'lang', 'align', 'style', 'class'];

  /** 特定標籤額外允許的屬性 */
  const TAG_ATTRS = {
    a: ['href', 'target', 'rel', 'name'],
    img: ['src', 'alt', 'width', 'height'],
    table: ['border', 'cellpadding', 'cellspacing', 'width', 'summary', 'bgcolor'],
    td: ['colspan', 'rowspan', 'width', 'height', 'valign', 'bgcolor', 'scope', 'headers', 'nowrap'],
    th: ['colspan', 'rowspan', 'width', 'height', 'valign', 'bgcolor', 'scope', 'headers', 'nowrap'],
    col: ['span', 'width'],
    colgroup: ['span', 'width'],
    ol: ['start', 'type', 'reversed'],
    ul: ['type'],
    li: ['type', 'value'],
    font: ['color', 'face', 'size'],
    blockquote: ['cite'],
    q: ['cite'],
    time: ['datetime'],
  };

  /** 會載入 / 導向資源的屬性，值必須另外過 URL 檢查 */
  const URL_ATTRS = ['href', 'src', 'cite'];

  /**
   * 允許保留的 CSS 屬性（白名單）。
   * 刻意不含 position / z-index / top / left / transform 等版面脫離用的屬性。
   */
  const ALLOWED_STYLE_PROPS = [
    'color', 'background-color',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'text-align', 'text-decoration', 'text-decoration-line', 'text-indent', 'text-transform',
    'vertical-align', 'line-height', 'letter-spacing', 'word-spacing', 'white-space',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-color', 'border-style', 'border-width', 'border-collapse', 'border-spacing',
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
    'list-style', 'list-style-type', 'list-style-position',
    'direction', 'display', 'float', 'clear', 'caption-side',
  ];

  /** CSS 值裡出現這些片段一律丟棄該宣告 */
  const CSS_VALUE_BLOCKLIST = /url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|@import/i;

  /** 允許以 data: 形式內嵌的圖片型別（不含 svg+xml —— 那可以夾帶腳本） */
  const SAFE_DATA_IMAGE = /^data:image\/(png|gif|jpeg|jpg|webp|bmp)\s*;/i;

  const ALLOWED_TAG_SET = new Set(ALLOWED_TAGS);
  const DROP_SET = new Set(DROP_WITH_CONTENT);
  const GLOBAL_ATTR_SET = new Set(GLOBAL_ATTRS);
  const URL_ATTR_SET = new Set(URL_ATTRS);
  const STYLE_PROP_SET = new Set(ALLOWED_STYLE_PROPS);

  /**
   * URL 是否安全。
   * 會先剝掉可以騙過字首比對的雜訊：前後空白、控制字元、HTML 實體殘留。
   * @param {string} value
   * @param {boolean} [allowDataImage] img src 才允許 data:image
   */
  function isSafeUrl(value, allowDataImage) {
    const raw = String(value == null ? '' : value);
    // 控制字元與空白（含 tab / newline）：瀏覽器解析 URL 時會忽略它們，
    // 所以 "java<TAB>script:alert(1)" 能騙過單純的字首比對，必須先剝掉再判斷。
    const cleaned = raw.replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
    if (!cleaned) return false;

    if (allowDataImage && SAFE_DATA_IMAGE.test(cleaned)) return true;

    // 任何形式的 data: / javascript: / vbscript: / blob: / filesystem: 都擋掉
    if (/^(javascript|vbscript|data|blob|filesystem|about|chrome|chrome-extension|moz-extension|file|view-source):/.test(cleaned)) {
      return false;
    }
    // 有 scheme 的話只放行這幾種
    const scheme = cleaned.match(/^([a-z][a-z0-9+.-]*):/);
    if (scheme) return ['http', 'https', 'mailto', 'tel', 'cid'].indexOf(scheme[1]) !== -1;

    // 沒有 scheme = 相對路徑 / 錨點，放行
    return true;
  }

  /**
   * 過濾單一 CSS 宣告是否可保留。
   * @param {string} prop  已正規化的小寫屬性名
   * @param {string} value
   */
  function isSafeStyleDeclaration(prop, value) {
    const name = String(prop || '').trim().toLowerCase();
    if (!STYLE_PROP_SET.has(name)) return false;
    const val = String(value == null ? '' : value);
    if (!val.trim()) return false;
    if (CSS_VALUE_BLOCKLIST.test(val)) return false;
    return true;
  }

  /** 重建只含安全宣告的 style 字串；沒有任何宣告存活時回傳 '' */
  function filterStyle(el) {
    const style = el.style;
    if (!style || typeof style.length !== 'number') return '';
    const kept = [];
    for (let i = 0; i < style.length; i += 1) {
      const prop = styleItem(style, i);
      if (!prop) continue;
      const value = style.getPropertyValue(prop);
      if (isSafeStyleDeclaration(prop, value)) {
        kept.push(prop + ': ' + value);
      }
    }
    return kept.join('; ');
  }

  /** style.item(i) 在部分環境需要保護性呼叫 */
  function styleItem(style, i) {
    try {
      return style.item(i);
    } catch (e) {
      return '';
    }
  }

  /** 清掉單一元素的屬性 */
  function cleanAttributes(el) {
    const tag = el.tagName.toLowerCase();
    const extra = TAG_ATTRS[tag] || [];
    const allowed = new Set(GLOBAL_ATTR_SET);
    extra.forEach(function (name) {
      allowed.add(name);
    });

    // 先算好 style，因為移除屬性的過程會動到 el.style
    const safeStyle = allowed.has('style') ? filterStyle(el) : '';

    Array.prototype.slice.call(el.attributes).forEach(function (attr) {
      const name = attr.name.toLowerCase();

      // on* 事件處理器、data-hpx-* 內部標記：一律移除
      if (name.indexOf('on') === 0 || name.indexOf('data-hpx-') === 0) {
        el.removeAttribute(attr.name);
        return;
      }
      if (!allowed.has(name)) {
        el.removeAttribute(attr.name);
        return;
      }
      if (URL_ATTR_SET.has(name) && !isSafeUrl(attr.value, tag === 'img' && name === 'src')) {
        el.removeAttribute(attr.name);
      }
    });

    if (safeStyle) el.setAttribute('style', safeStyle);
    else el.removeAttribute('style');

    // target="_blank" 一定要配 rel，避免開啟的分頁拿到 window.opener
    if (tag === 'a' && el.getAttribute('target')) {
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }

  /** 用子節點取代自己（拆殼），保留內容但丟掉未知標籤 */
  function unwrap(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  /**
   * 清理 HTML。
   * @param {string} html
   * @returns {string} 只含白名單標籤與屬性的 HTML
   */
  function sanitize(html) {
    const input = String(html == null ? '' : html);
    if (!input) return '';

    let doc;
    try {
      doc = new DOMParser().parseFromString('<body>' + input + '</body>', 'text/html');
    } catch (e) {
      NS.warn('HTML 解析失敗，回傳空字串', e);
      return '';
    }
    if (!doc || !doc.body) return '';

    // 由深到淺處理：先蒐集再處理，避免邊走邊改樹造成漏網
    const all = Array.prototype.slice.call(doc.body.querySelectorAll('*'));
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const el = all[i];
      const tag = el.tagName ? el.tagName.toLowerCase() : '';

      if (DROP_SET.has(tag)) {
        if (el.parentNode) el.parentNode.removeChild(el);
        continue;
      }
      if (!ALLOWED_TAG_SET.has(tag)) {
        unwrap(el);
        continue;
      }
      cleanAttributes(el);
    }

    // 註解可能夾帶條件式註解類的東西，一併清掉
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT, null);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });

    return doc.body.innerHTML;
  }

  /**
   * 把相對 URL 轉成絕對（以 HaloPSA 頁面為基準）。
   * 獨立視窗的 origin 是 chrome-extension://，相對路徑在那裡會解析錯誤，
   * 所以「送出去之前」必須絕對化。同源絕對網址寫回 Halo 一樣有效。
   * @param {string} html
   * @param {string} baseUrl  來源頁面的 document.baseURI
   */
  function absolutizeUrls(html, baseUrl) {
    const input = String(html == null ? '' : html);
    if (!input || !baseUrl) return input;

    let doc;
    try {
      doc = new DOMParser().parseFromString('<body>' + input + '</body>', 'text/html');
    } catch (e) {
      return input;
    }
    if (!doc || !doc.body) return input;

    doc.body.querySelectorAll('[src], [href]').forEach(function (el) {
      ['src', 'href'].forEach(function (name) {
        const value = el.getAttribute(name);
        if (!value) return;
        // data: 與已經是絕對網址的不動
        if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.charAt(0) === '#') return;
        try {
          el.setAttribute(name, new URL(value, baseUrl).href);
        } catch (e) {
          /* 無法解析就維持原樣，留給 sanitize 判斷 */
        }
      });
    });

    return doc.body.innerHTML;
  }

  NS.core.htmlSanitizer = {
    ALLOWED_TAGS: ALLOWED_TAGS,
    DROP_WITH_CONTENT: DROP_WITH_CONTENT,
    ALLOWED_STYLE_PROPS: ALLOWED_STYLE_PROPS,
    isSafeUrl: isSafeUrl,
    isSafeStyleDeclaration: isSafeStyleDeclaration,
    sanitize: sanitize,
    absolutizeUrls: absolutizeUrls,
  };
})();
