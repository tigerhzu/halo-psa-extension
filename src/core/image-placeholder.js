/**
 * image-placeholder.js
 * 獨立編輯視窗的圖片佔位機制（R2 方案 A）。
 *
 * ── 為什麼需要 ──
 * HaloPSA 的附件圖片是需要登入 session 的 URL。獨立編輯視窗的 origin 是
 * chrome-extension://，對 Halo 而言屬於跨站，SameSite cookie 不會送出，
 * 圖片一定載不出來 —— 直接放 <img> 只會看到一堆破圖。
 *
 * ── 做法 ──
 * 顯示時把每個 <img> 換成一個不可編輯的佔位標籤，**原始的 <img> HTML 原封不動
 * 存在佔位標籤的 data-hpx-img 屬性裡**；套用回 Halo 之前再還原回去。
 * 使用者看到的是佔位方塊，但寫回 Halo 的是原本那個 <img>，一個位元都沒動。
 *
 * 佔位標籤是原子單位（contenteditable="false"）：可以整塊選取、刪除、搬移，
 * 但不會被拆開。刪掉佔位標籤 = 刪掉那張圖，這是符合預期的行為。
 *
 * ── 安全性 ──
 * data-hpx-img 內容只有在「已經過 sanitize 的 HTML」上才會被寫入，
 * 還原之後也一定會再 sanitize 一次。html-sanitizer 一律剝除 data-hpx-* 屬性，
 * 所以 Halo 來的內容無法偽造佔位標記騙過還原流程。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  const ATTR = 'data-hpx-img';
  const CLASS = 'hpx-img-placeholder';

  /** 從 src 取一個看得懂的短名稱給使用者辨識 */
  function describe(el) {
    const alt = (el.getAttribute('alt') || '').trim();
    if (alt) return alt;

    const src = (el.getAttribute('src') || '').trim();
    if (!src) return '圖片';
    if (/^data:/i.test(src)) return '內嵌圖片';
    try {
      const path = new URL(src, 'https://placeholder.invalid/').pathname;
      const name = path.split('/').filter(Boolean).pop();
      return name ? decodeURIComponent(name) : '圖片';
    } catch (e) {
      return '圖片';
    }
  }

  function parse(html) {
    return new DOMParser().parseFromString('<body>' + String(html == null ? '' : html) + '</body>', 'text/html');
  }

  /**
   * 顯示用：<img> → 佔位標籤。
   * @param {string} html 已 sanitize 的 HTML
   * @returns {{html: string, count: number}}
   */
  function toPlaceholders(html) {
    const input = String(html == null ? '' : html);
    if (!input) return { html: '', count: 0 };

    let doc;
    try {
      doc = parse(input);
    } catch (e) {
      return { html: input, count: 0 };
    }
    if (!doc || !doc.body) return { html: input, count: 0 };

    const images = Array.prototype.slice.call(doc.body.querySelectorAll('img'));
    images.forEach(function (img) {
      const holder = doc.createElement('span');
      holder.className = CLASS;
      holder.setAttribute('contenteditable', 'false');
      // setAttribute / getAttribute 會自行處理跳脫，不需要額外編碼
      holder.setAttribute(ATTR, img.outerHTML);
      holder.textContent = '🖼 ' + describe(img) + '（原圖保留）';
      if (img.parentNode) img.parentNode.replaceChild(holder, img);
    });

    return { html: doc.body.innerHTML, count: images.length };
  }

  /**
   * 套用用：佔位標籤 → 原始 <img>。
   * 找不到 data-hpx-img 的殘留佔位標籤會被整個移除，不留可見文字。
   * @param {string} html
   * @returns {{html: string, count: number}}
   */
  function fromPlaceholders(html) {
    const input = String(html == null ? '' : html);
    if (!input) return { html: '', count: 0 };

    let doc;
    try {
      doc = parse(input);
    } catch (e) {
      return { html: input, count: 0 };
    }
    if (!doc || !doc.body) return { html: input, count: 0 };

    const holders = Array.prototype.slice.call(
      doc.body.querySelectorAll('[' + ATTR + '], .' + CLASS)
    );
    let restored = 0;

    holders.forEach(function (holder) {
      const original = holder.getAttribute(ATTR);
      if (!original) {
        // 使用者把佔位標籤編輯壞了：整塊移除，不要把提示文字寫回 Halo
        if (holder.parentNode) holder.parentNode.removeChild(holder);
        return;
      }
      const fragment = parse(original).body;
      const img = fragment.querySelector('img');
      if (img && holder.parentNode) {
        holder.parentNode.replaceChild(doc.importNode(img, true), holder);
        restored += 1;
      } else if (holder.parentNode) {
        holder.parentNode.removeChild(holder);
      }
    });

    return { html: doc.body.innerHTML, count: restored };
  }

  /** 計算一段 HTML 裡還有幾個佔位標籤（供套用前的檢查用） */
  function countPlaceholders(html) {
    try {
      return parse(html).body.querySelectorAll('[' + ATTR + ']').length;
    } catch (e) {
      return 0;
    }
  }

  NS.core.imagePlaceholder = {
    ATTR: ATTR,
    CLASS: CLASS,
    toPlaceholders: toPlaceholders,
    fromPlaceholders: fromPlaceholders,
    countPlaceholders: countPlaceholders,
  };
})();
