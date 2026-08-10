/**
 * html-fidelity.js
 * 富文字保真度比對。回答一個問題：「這段 HTML 走完一趟往返之後，掉了什麼？」
 *
 * 用途（PoC 階段）：
 *   讀取 Halo Note HTML → 寫回去 → 按 Halo 的 Save → 重新開啟 → 再讀一次
 *   把前後兩份 HTML 丟進 compare()，就知道圖片 / 表格 / 連結 / 清單 / 粗體有沒有遺失。
 *
 * 為什麼用字串掃描而不是 DOMParser：
 *  1. 同一份實作要能在瀏覽器（probe）與 Node（單元測試）跑，不想為測試引進 DOM 相依。
 *  2. 這是「比對用的量測工具」，不是安全邊界。
 *     ⚠ 真正要擋 XSS 的 sanitizer 必須用 DOM 解析，不可以沿用這裡的 regex 做法。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  /** 富文字特徵 → 對應的 HTML tag。掉了哪一項就代表哪一種格式沒保住。 */
  const FEATURE_TAGS = {
    image: ['img'],
    table: ['table'],
    tableRow: ['tr'],
    tableCell: ['td', 'th'],
    link: ['a'],
    bulletList: ['ul'],
    orderedList: ['ol'],
    listItem: ['li'],
    bold: ['b', 'strong'],
    italic: ['i', 'em'],
    underline: ['u'],
    strikethrough: ['s', 'strike', 'del'],
    heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    blockquote: ['blockquote'],
    preformatted: ['pre', 'code'],
    paragraph: ['p'],
    lineBreak: ['br'],
    div: ['div'],
    span: ['span'],
  };

  /** 這些特徵一旦數量減少就是實質資料遺失，必須讓 compare() 判定失敗。 */
  const CRITICAL_FEATURES = [
    'image',
    'table',
    'tableRow',
    'tableCell',
    'link',
    'bulletList',
    'orderedList',
    'listItem',
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'heading',
  ];

  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

  /** 掃出每個開始標籤：{ name, attrs }。結束標籤與註解不列入。 */
  function scanTags(html) {
    const source = String(html == null ? '' : html).replace(/<!--[\s\S]*?-->/g, '');
    const out = [];
    let match;
    TAG_RE.lastIndex = 0;
    while ((match = TAG_RE.exec(source)) !== null) {
      if (match[1] === '/') continue; // 結束標籤
      const attrs = {};
      let attr;
      ATTR_RE.lastIndex = 0;
      while ((attr = ATTR_RE.exec(match[3] || '')) !== null) {
        const value = attr[2] != null ? attr[2] : attr[3] != null ? attr[3] : attr[4] || '';
        attrs[attr[1].toLowerCase()] = value;
      }
      out.push({ name: match[2].toLowerCase(), attrs: attrs });
    }
    return out;
  }

  /** 去掉標籤後的可見文字，用來確認正文本身沒有被截斷。 */
  function plainText(html) {
    return String(html == null ? '' : html)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 清點一段 HTML 的富文字特徵。
   * @returns {{counts: Object, images: string[], links: string[], styled: number, textLength: number}}
   */
  function inventory(html) {
    const tags = scanTags(html);
    const counts = {};
    Object.keys(FEATURE_TAGS).forEach(function (feature) {
      counts[feature] = 0;
    });

    const images = [];
    const links = [];
    let styled = 0;

    tags.forEach(function (tag) {
      Object.keys(FEATURE_TAGS).forEach(function (feature) {
        if (FEATURE_TAGS[feature].indexOf(tag.name) !== -1) counts[feature] += 1;
      });
      if (tag.name === 'img' && tag.attrs.src) images.push(tag.attrs.src);
      if (tag.name === 'a' && tag.attrs.href) links.push(tag.attrs.href);
      // Froala / Halo 的顏色、對齊、字級都活在 inline style 上，掉了一樣算格式遺失。
      if (tag.attrs.style) styled += 1;
    });

    return {
      counts: counts,
      images: images,
      links: links,
      styled: styled,
      textLength: plainText(html).length,
    };
  }

  /** 結構指紋：開始標籤依序串起來。前後不同代表 DOM 結構被改寫過。 */
  function fingerprint(html) {
    return scanTags(html)
      .map(function (tag) {
        return tag.name;
      })
      .join('>');
  }

  /**
   * 比較往返前後兩份 HTML。
   * @returns {{ok: boolean, lost: Array, gained: Array, missingImages: string[],
   *            missingLinks: string[], styledDelta: number, textDelta: number,
   *            structureChanged: boolean, before: Object, after: Object}}
   */
  function compare(beforeHtml, afterHtml) {
    const before = inventory(beforeHtml);
    const after = inventory(afterHtml);

    const lost = [];
    const gained = [];
    Object.keys(before.counts).forEach(function (feature) {
      const b = before.counts[feature];
      const a = after.counts[feature];
      if (a < b) lost.push({ feature: feature, before: b, after: a });
      else if (a > b) gained.push({ feature: feature, before: b, after: a });
    });

    const afterImages = after.images.slice();
    const missingImages = before.images.filter(function (src) {
      const at = afterImages.indexOf(src);
      if (at === -1) return true;
      afterImages.splice(at, 1);
      return false;
    });

    const afterLinks = after.links.slice();
    const missingLinks = before.links.filter(function (href) {
      const at = afterLinks.indexOf(href);
      if (at === -1) return true;
      afterLinks.splice(at, 1);
      return false;
    });

    // 只有「關鍵特徵減少」或「圖片 / 連結目標消失」才算失敗。
    // 多出 <p>、<span> 之類的包裝是編輯器正常行為，不判定為遺失。
    const criticalLost = lost.filter(function (item) {
      return CRITICAL_FEATURES.indexOf(item.feature) !== -1;
    });

    return {
      ok: criticalLost.length === 0 && missingImages.length === 0 && missingLinks.length === 0,
      lost: lost,
      criticalLost: criticalLost,
      gained: gained,
      missingImages: missingImages,
      missingLinks: missingLinks,
      styledDelta: after.styled - before.styled,
      textDelta: after.textLength - before.textLength,
      structureChanged: fingerprint(beforeHtml) !== fingerprint(afterHtml),
      before: before,
      after: after,
    };
  }

  NS.core.htmlFidelity = {
    FEATURE_TAGS: FEATURE_TAGS,
    CRITICAL_FEATURES: CRITICAL_FEATURES,
    scanTags: scanTags,
    plainText: plainText,
    inventory: inventory,
    fingerprint: fingerprint,
    compare: compare,
  };
})();
