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
  const AI_MASK_ATTR = 'data-hpx-ai-image-mask';
  const AI_TOKEN_PREFIX = 'HPXIMG-';

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

  /**
   * 把 HTML 轉成適合送給 AI 的純文字，同時保留區塊換行。
   * 這裡不用 textContent，否則相鄰的 div / p 會黏成同一行。
   */
  function textFromHtml(root) {
    const blocks = {
      address: true,
      blockquote: true,
      caption: true,
      dd: true,
      div: true,
      dl: true,
      dt: true,
      figcaption: true,
      figure: true,
      h1: true,
      h2: true,
      h3: true,
      h4: true,
      h5: true,
      h6: true,
      hr: true,
      li: true,
      ol: true,
      p: true,
      pre: true,
      table: true,
      tbody: true,
      td: true,
      tfoot: true,
      th: true,
      thead: true,
      tr: true,
      ul: true,
    };
    const output = [];

    function boundary() {
      if (output.length && output[output.length - 1] !== '\n') output.push('\n');
    }

    function visit(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        output.push(node.nodeValue || '');
        return;
      }
      if (node.nodeType !== 1) return;

      const tag = node.tagName.toLowerCase();
      if (tag === 'br') {
        output.push('\n');
        return;
      }

      if (blocks[tag]) boundary();
      Array.prototype.forEach.call(node.childNodes, visit);
      if (blocks[tag]) boundary();
    }

    Array.prototype.forEach.call(root.childNodes, visit);
    return output
      .join('')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function nextAiToken(input, start) {
    let index = start;
    let token = AI_TOKEN_PREFIX + String(index).padStart(4, '0');
    while (input.indexOf(token) !== -1) {
      index += 1;
      token = AI_TOKEN_PREFIX + String(index).padStart(4, '0');
    }
    return { token: token, next: index + 1 };
  }

  /**
   * AI 處理前：把每張圖片換成受 output-validator 保護的工單代號。
   * 原始圖片 HTML 只保存在回傳的 masks 陣列，不會送給 AI。
   * @param {string} html 已 sanitize 的 HTML
   * @returns {{html: string, text: string, masks: Array, count: number}}
   */
  function maskForAi(html) {
    const input = String(html == null ? '' : html);
    if (!input) return { html: '', text: '', masks: [], count: 0 };

    let doc;
    try {
      doc = parse(input);
    } catch (e) {
      return { html: input, text: '', masks: [], count: 0 };
    }
    if (!doc || !doc.body) return { html: input, text: '', masks: [], count: 0 };

    const images = Array.prototype.slice.call(doc.body.querySelectorAll('img'));
    const masks = [];
    let nextIndex = 1;

    images.forEach(function (img, imageIndex) {
      const generated = nextAiToken(input, nextIndex);
      nextIndex = generated.next;
      const holder = doc.createElement('span');
      holder.setAttribute(AI_MASK_ATTR, generated.token);
      // 前後換行讓獨立圖片不會黏在相鄰句子上；AI 仍只看到不含網址的代號。
      holder.textContent = '\n' + generated.token + '\n';
      masks.push({
        token: generated.token,
        displayToken: '〔圖片 ' + (imageIndex + 1) + '：原圖保留〕',
        html: img.outerHTML,
      });
      if (img.parentNode) img.parentNode.replaceChild(holder, img);
    });

    return {
      html: doc.body.innerHTML,
      text: textFromHtml(doc.body),
      masks: masks,
      count: masks.length,
    };
  }

  /** 預覽視窗顯示友善提示，不把內部遮罩代號暴露給使用者。 */
  function toDisplayText(text, masks) {
    let output = String(text == null ? '' : text);
    (masks || []).forEach(function (mask) {
      output = output.split(mask.token).join(mask.displayToken);
    });
    return output;
  }

  /** 與 editor-adapter 相同語意：純文字逐行轉成安全的 div。 */
  function plainTextToHtml(text) {
    const doc = parse('');
    String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .forEach(function (line) {
        const div = doc.createElement('div');
        if (line) div.textContent = line;
        else div.appendChild(doc.createElement('br'));
        doc.body.appendChild(div);
      });
    return doc.body.innerHTML;
  }

  function textNodes(root) {
    const found = [];
    function visit(node) {
      if (node.nodeType === 3) {
        found.push(node);
        return;
      }
      Array.prototype.forEach.call(node.childNodes || [], visit);
    }
    visit(root);
    return found;
  }

  function firstAliasHit(root, aliases) {
    const nodes = textNodes(root);
    let best = null;
    nodes.forEach(function (node) {
      aliases.forEach(function (alias) {
        const at = (node.nodeValue || '').indexOf(alias);
        if (at === -1) return;
        if (!best || best.nodeIndex > nodes.indexOf(node) || (best.node === node && at < best.at)) {
          best = { node: node, nodeIndex: nodes.indexOf(node), alias: alias, at: at };
        }
      });
    });
    return best;
  }

  function removeAliases(root, aliases) {
    textNodes(root).forEach(function (node) {
      let value = node.nodeValue || '';
      aliases.forEach(function (alias) {
        value = value.split(alias).join('');
      });
      node.nodeValue = value;
    });
  }

  /**
   * AI 完成後：把遮罩代號還原成原始圖片。
   * 若模型或使用者刪掉代號，會把圖片補到文末，確保不會無聲遺失。
   * 重複代號只還原第一個，其餘移除，避免複製圖片。
   */
  function restoreAiMasks(html, masks) {
    const input = String(html == null ? '' : html);
    const list = Array.isArray(masks) ? masks : [];
    if (!list.length) return { html: input, count: 0, appended: 0, duplicates: 0 };

    let doc;
    try {
      doc = parse(input);
    } catch (e) {
      return { html: input, count: 0, appended: 0, duplicates: 0 };
    }

    let restored = 0;
    let appended = 0;
    let duplicates = 0;

    list.forEach(function (mask) {
      const aliases = [mask.token, mask.displayToken].filter(Boolean);
      const hit = firstAliasHit(doc.body, aliases);
      const imageDoc = parse(mask.html || '');
      const image = imageDoc.body.querySelector('img');
      if (!image) {
        removeAliases(doc.body, aliases);
        return;
      }

      if (hit) {
        const value = hit.node.nodeValue || '';
        const fragment = doc.createDocumentFragment();
        const before = value.slice(0, hit.at);
        const after = value.slice(hit.at + hit.alias.length);
        if (before) fragment.appendChild(doc.createTextNode(before));
        fragment.appendChild(doc.importNode(image, true));
        if (after) fragment.appendChild(doc.createTextNode(after));
        if (hit.node.parentNode) hit.node.parentNode.replaceChild(fragment, hit.node);
        restored += 1;

        const beforeCleanup = textFromHtml(doc.body);
        removeAliases(doc.body, aliases);
        const afterCleanup = textFromHtml(doc.body);
        if (beforeCleanup !== afterCleanup) duplicates += 1;
      } else {
        const line = doc.createElement('div');
        line.appendChild(doc.importNode(image, true));
        doc.body.appendChild(line);
        restored += 1;
        appended += 1;
      }
    });

    return {
      html: doc.body.innerHTML,
      count: restored,
      appended: appended,
      duplicates: duplicates,
    };
  }

  NS.core.imagePlaceholder = {
    ATTR: ATTR,
    CLASS: CLASS,
    toPlaceholders: toPlaceholders,
    fromPlaceholders: fromPlaceholders,
    countPlaceholders: countPlaceholders,
    maskForAi: maskForAi,
    toDisplayText: toDisplayText,
    plainTextToHtml: plainTextToHtml,
    restoreAiMasks: restoreAiMasks,
  };
})();
