/**
 * ultimate-mode/shared.js
 * 極致模式共用的 DOM 安全工具：文字正規化、selector 防護、可逆隱藏與詳細資料列辨識。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  if (!NS) return;

  NS.ultimate = NS.ultimate || {};
  const cfg = NS.config.selectors.ULTIMATE_MODE;
  const warned = new Set();
  const reconciliations = new Map();
  const keepReconciliations = new Map();

  function warnOnce(key, message, detail) {
    if (warned.has(key)) return;
    warned.add(key);
    NS.warn('極致模式：' + message, detail || '');
  }

  function clearWarning(key) {
    warned.delete(key);
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/[‐‑‒–—―]/g, '-')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s*:\s*$/, '')
      .trim()
      .toLocaleLowerCase('en-US');
  }

  function safeQueryAll(root, selectors) {
    if (!root || !root.querySelectorAll) return [];
    const list = Array.isArray(selectors) ? selectors : [selectors];
    const found = [];
    const seen = new Set();
    list.forEach(function (selector) {
      try {
        root.querySelectorAll(selector).forEach(function (node) {
          if (!seen.has(node)) {
            seen.add(node);
            found.push(node);
          }
        });
      } catch (error) {
        warnOnce('bad-selector:' + selector, '無效 selector，已略過：' + selector, error);
      }
    });
    return found;
  }

  function safeMatches(element, selectors) {
    if (!element || !element.matches) return false;
    const list = Array.isArray(selectors) ? selectors : [selectors];
    return list.some(function (selector) {
      try { return element.matches(selector); } catch (e) { return false; }
    });
  }

  function safeClosest(element, selectors, boundary) {
    if (!element) return null;
    let node = element;
    while (node && node !== boundary) {
      if (safeMatches(node, selectors)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function elementRect(element) {
    try { return element && element.getBoundingClientRect ? element.getBoundingClientRect() : null; } catch (e) { return null; }
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = elementRect(element);
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    try {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    } catch (e) {
      return true;
    }
  }

  function directText(element) {
    if (!element) return '';
    let out = '';
    const skip = cfg.TEXT_SUBTREE_SKIP_SELECTOR;

    function visit(node, isRoot) {
      if (!node) return;
      if (node.nodeType === 3) {
        out += ' ' + (node.nodeValue || '');
        return;
      }
      if (node.nodeType !== 1) return;
      if (!isRoot && safeMatches(node, skip)) return;
      if ((node.tagName || '').toLowerCase() === 'svg') return;
      Array.prototype.forEach.call(node.childNodes || [], function (child) { visit(child, false); });
    }

    visit(element, true);
    return out.replace(/\s+/g, ' ').trim();
  }

  function labelVariants(element) {
    if (!element || !element.getAttribute) return [];
    const values = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-label'),
      element.getAttribute('data-field-name'),
      directText(element),
    ];
    const seen = new Set();
    return values.map(normalizeText).filter(function (value) {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function normalizedLabels(labels) {
    return (labels || []).map(normalizeText).filter(Boolean);
  }

  function findByLabels(root, labels, options) {
    return safeQueryAll(root, cfg.TEXT_CANDIDATE_SELECTORS).filter(function (node) {
      if (isOwnUi(node) || !isVisible(node)) return false;
      const text = directText(node);
      if (text.length > cfg.MAX_LABEL_TEXT_LENGTH && !node.getAttribute('aria-label') && !node.getAttribute('title')) {
        return false;
      }
      return matchesLabel(node, labels, options);
    }).filter(function (node, index, all) {
      return !all.some(function (other) {
        return other !== node && node.contains(other) && matchesLabel(other, labels, options);
      });
    });
  }

  function lowestCommonAncestor(elements) {
    const nodes = (elements || []).filter(Boolean);
    if (!nodes.length) return null;
    let candidate = nodes[0];
    while (candidate) {
      if (nodes.every(function (node) { return candidate === node || candidate.contains(node); })) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function boundedOwner(element, boundary, options) {
    options = options || {};
    let node = element;
    let best = element;
    const maxHeight = options.maxHeight || 72;
    for (let depth = 0; node && node !== boundary && depth <= (options.maxDepth || 5); depth += 1) {
      const rect = elementRect(node);
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (
        rect &&
        rect.width >= (options.minWidth || 1) &&
        rect.height >= (options.minHeight || 12) &&
        rect.height <= maxHeight &&
        text.length <= (options.maxTextLength || 160)
      ) {
        best = node;
      } else if (rect && rect.height > maxHeight) {
        break;
      }
      node = node.parentElement;
    }
    return best;
  }

  function matchesLabel(element, labels, options) {
    const expected = normalizedLabels(labels);
    const variants = labelVariants(element);
    const allowCounter = options && options.allowTrailingCounter;
    return variants.some(function (actual) {
      return expected.some(function (label) {
        if (actual === label) return true;
        if (!allowCounter) return false;
        const suffix = actual.slice(label.length);
        return actual.indexOf(label) === 0 && /^\s*(?:[([{]?\s*\d+\s*(?:tickets?)?\s*[)\]}]?)?$/.test(suffix);
      });
    });
  }

  function matchedLabel(element, labels, options) {
    const expected = normalizedLabels(labels);
    const variants = labelVariants(element);
    const allowCounter = options && options.allowTrailingCounter;
    for (let i = 0; i < expected.length; i += 1) {
      const label = expected[i];
      const matches = variants.some(function (actual) {
        if (actual === label) return true;
        if (!allowCounter || actual.indexOf(label) !== 0) return false;
        return /^\s*(?:[([{]?\s*\d+\s*(?:tickets?)?\s*[)\]}]?)?$/.test(actual.slice(label.length));
      });
      if (matches) return label;
    }
    return '';
  }

  function isOwnUi(element) {
    if (!element || !element.closest) return false;
    return cfg.OWN_UI_ROOT_SELECTORS.some(function (selector) {
      try { return !!element.closest(selector); } catch (e) { return false; }
    });
  }

  function hide(element, section) {
    if (!element || !element.classList || isOwnUi(element)) return false;
    section = section || 'unknown';
    const stale = reconciliations.get(section);
    if (stale) stale.delete(element);
    if (
      element.classList.contains(cfg.HIDDEN_CLASS) &&
      element.getAttribute(cfg.OWNED_ATTR) === '1' &&
      element.getAttribute(cfg.SECTION_ATTR) === section
    ) return false;
    element.classList.add(cfg.HIDDEN_CLASS);
    element.setAttribute(cfg.OWNED_ATTR, '1');
    element.setAttribute(cfg.SECTION_ATTR, section);
    return true;
  }

  function restoreElement(element) {
    if (!element || !element.classList) return;
    element.classList.remove(cfg.HIDDEN_CLASS);
    element.removeAttribute(cfg.OWNED_ATTR);
    element.removeAttribute(cfg.SECTION_ATTR);
  }

  function restoreSection(section) {
    const selector = '[' + cfg.OWNED_ATTR + '="1"][' + cfg.SECTION_ATTR + '="' + section + '"]';
    safeQueryAll(document, selector).forEach(restoreElement);
  }

  function beginSection(section) {
    const selector = '[' + cfg.OWNED_ATTR + '="1"][' + cfg.SECTION_ATTR + '="' + section + '"]';
    const stale = new Set(safeQueryAll(document, selector));
    reconciliations.set(section, stale);
    return stale;
  }

  function finishSection(section) {
    const stale = reconciliations.get(section);
    reconciliations.delete(section);
    if (!stale) return;
    stale.forEach(restoreElement);
  }

  function reconcileSection(section, callback) {
    beginSection(section);
    try {
      return callback();
    } finally {
      finishSection(section);
    }
  }

  function beginKeepSection(section) {
    const selector = '[' + cfg.KEEP_ATTR + '="' + section + '"]';
    keepReconciliations.set(section, new Set(safeQueryAll(document, selector)));
  }

  function keep(element, section) {
    if (!element || !element.setAttribute) return false;
    const stale = keepReconciliations.get(section);
    if (stale) stale.delete(element);
    if (element.getAttribute(cfg.KEEP_ATTR) === section) return false;
    element.setAttribute(cfg.KEEP_ATTR, section);
    return true;
  }

  function finishKeepSection(section) {
    const stale = keepReconciliations.get(section);
    keepReconciliations.delete(section);
    if (!stale) return;
    stale.forEach(function (element) { element.removeAttribute(cfg.KEEP_ATTR); });
  }

  function restoreAll() {
    safeQueryAll(document, '[' + cfg.OWNED_ATTR + '="1"]').forEach(restoreElement);
    safeQueryAll(document, '[' + cfg.KEEP_ATTR + ']').forEach(function (element) {
      element.removeAttribute(cfg.KEEP_ATTR);
    });
    document.documentElement.removeAttribute('data-hpx-ultimate-bootstrap');
    document.documentElement.removeAttribute('data-hpx-ultimate-mode');
  }

  function countMatchedLabels(root, selectors, labels, options) {
    const matched = new Set();
    safeQueryAll(root, selectors).forEach(function (node) {
      const label = matchedLabel(node, labels, options);
      if (label) matched.add(label);
    });
    return matched.size;
  }

  function fieldRow(labelNode, section, detailsCfg) {
    const structural = safeClosest(labelNode, detailsCfg.ROW_SELECTORS, section);
    if (structural) return { key: structural, nodes: [structural] };

    if ((labelNode.tagName || '').toLowerCase() === 'dt') {
      const nodes = [labelNode];
      let sibling = labelNode.nextElementSibling;
      while (sibling && (sibling.tagName || '').toLowerCase() === 'dd') {
        nodes.push(sibling);
        sibling = sibling.nextElementSibling;
      }
      return { key: labelNode, nodes: nodes };
    }

    let node = labelNode.parentElement;
    for (let depth = 0; node && node !== section && depth < detailsCfg.MAX_ROW_DEPTH; depth += 1) {
      const text = (node.textContent || '').trim();
      const childCount = node.children ? node.children.length : 0;
      if (text.length <= 500 && childCount >= 2 && childCount <= 10) {
        return { key: node, nodes: [node] };
      }
      node = node.parentElement;
    }
    return null;
  }

  function discoverFieldRows(section) {
    const detailsCfg = cfg.DETAILS;
    const rows = new Map();
    safeQueryAll(section, detailsCfg.LABEL_SELECTORS).forEach(function (labelNode) {
      if (isOwnUi(labelNode)) return;
      const labels = labelVariants(labelNode).filter(function (value) { return value.length <= 80; });
      if (!labels.length) return;
      const row = fieldRow(labelNode, section, detailsCfg);
      if (!row) return;
      if (rows.has(row.key)) {
        const existing = rows.get(row.key);
        labels.forEach(function (label) {
          if (!existing.labels.includes(label)) existing.labels.push(label);
        });
        return;
      }
      rows.set(row.key, { labels: labels, nodes: row.nodes, labelNode: labelNode });
    });
    return Array.from(rows.values());
  }

  /**
   * Halo 目前的右側資訊卡使用普通 div，而不是 label / field-row class。
   * 以兩個以上白名單標籤推導共同 parent 下的重複 sibling；推導成功後，
   * parent 的每個直屬 child 就是一列。
   */
  function discoverSiblingFieldRows(section, sectionCfg) {
    const keepLabels = findByLabels(section, sectionCfg.KEEP_FIELDS);
    const detailsCfg = cfg.DETAILS;
    let best = null;

    keepLabels.forEach(function (labelNode) {
      let row = labelNode.parentElement;
      for (let depth = 0; row && row !== section && depth <= detailsCfg.MAX_ROW_DEPTH; depth += 1) {
        const parent = row.parentElement;
        if (!parent || parent === document.body) break;
        const mapped = new Map();
        keepLabels.forEach(function (otherLabel) {
          let owner = otherLabel;
          while (owner && owner.parentElement !== parent && owner !== section) owner = owner.parentElement;
          if (owner && owner !== otherLabel && owner.parentElement === parent) {
            const label = matchedLabel(otherLabel, sectionCfg.KEEP_FIELDS);
            if (label) mapped.set(owner, label);
          }
        });
        const childCount = parent.children ? parent.children.length : 0;
        if (
          mapped.size >= detailsCfg.MIN_SHARED_ROW_MATCHES &&
          childCount >= mapped.size &&
          childCount <= detailsCfg.MAX_SHARED_ROW_CHILDREN
        ) {
          const candidate = { parent: parent, mapped: mapped, score: mapped.size };
          if (
            !best || candidate.score > best.score ||
            (candidate.score === best.score && childCount < best.parent.children.length)
          ) best = candidate;
        }
        row = parent;
      }
    });

    if (!best) return [];
    return Array.prototype.map.call(best.parent.children, function (row) {
      const labels = [];
      findByLabels(row, sectionCfg.KEEP_FIELDS).forEach(function (labelNode) {
        const label = matchedLabel(labelNode, sectionCfg.KEEP_FIELDS);
        if (label && !labels.includes(label)) labels.push(label);
      });
      return { labels: labels, label: labels[0] || '', nodes: [row], inferred: true };
    });
  }

  function hasHeading(section, headings) {
    if (matchesLabel(section, headings, { allowTrailingCounter: true })) return true;
    if (safeQueryAll(section, cfg.DETAILS.HEADING_SELECTORS).some(function (node) {
      return matchesLabel(node, headings, { allowTrailingCounter: true });
    })) return true;
    return findByLabels(section, headings, { allowTrailingCounter: true }).length > 0;
  }

  function validateDetailSection(section, sectionCfg) {
    if (!section || isOwnUi(section) || !hasHeading(section, sectionCfg.HEADINGS)) return null;
    let rows = discoverFieldRows(section);
    const siblingRows = discoverSiblingFieldRows(section, sectionCfg);
    if (siblingRows.filter(function (row) { return row.label; }).length >= cfg.DETAILS.MIN_SHARED_ROW_MATCHES) {
      rows = siblingRows;
    }
    const keepSet = new Set(normalizedLabels(sectionCfg.KEEP_FIELDS));
    const keepMatches = new Set();
    rows.forEach(function (row) {
      row.label = row.labels.find(function (label) { return keepSet.has(label); }) || row.labels[0];
      if (keepSet.has(row.label)) keepMatches.add(row.label);
    });
    if (rows.length < cfg.DETAILS.MIN_FIELD_ROWS || keepMatches.size < 2) return null;
    return { section: section, rows: rows, keepSet: keepSet, score: keepMatches.size };
  }

  function findHaloDetailSection(sectionCfg) {
    const detailsCfg = cfg.DETAILS;
    const keepSet = new Set(normalizedLabels(sectionCfg.KEEP_FIELDS));
    let best = null;

    // New Ticket 儲存後 Halo 以 SPA 分批換頁，舊的 details-group 可能短暫和
    // 新區塊同時留在 DOM。不能只取第一個同名 heading；第一個若是隱藏／未完成
    // 的舊節點，會讓整輪白名單辨識直接失敗，右欄因而保持未精簡狀態。
    safeQueryAll(document, detailsCfg.HALO_HEADING_SELECTOR).forEach(function (heading) {
      if (!matchesLabel(heading, sectionCfg.HEADINGS, { allowTrailingCounter: true }) ||
          !isVisible(heading)) return;

      const section = safeClosest(heading, detailsCfg.HALO_GROUP_SELECTOR, document.body);
      if (!section || isOwnUi(section) || !isVisible(section)) return;
      let info = null;
      try { info = section.querySelector(detailsCfg.HALO_INFO_SELECTOR); } catch (e) { info = null; }
      if (!info) return;

      const keepMatches = new Set();
      let encounteredLabeledField = false;
      const rows = safeQueryAll(info, detailsCfg.HALO_FIELD_ROW_SELECTOR).map(function (row) {
        let labelNode = null;
        try { labelNode = row.querySelector(detailsCfg.HALO_FIELD_LABEL_SELECTOR); } catch (e) { labelNode = null; }
        const leadingUnlabeled = !labelNode && !encounteredLabeledField;
        if (labelNode) encounteredLabeledField = true;
        const label = labelNode ? matchedLabel(labelNode, sectionCfg.KEEP_FIELDS) : '';
        if (label) keepMatches.add(label);
        return {
          labels: labelNode ? labelVariants(labelNode) : [],
          label: label || (labelNode ? normalizeText(directText(labelNode)) : ''),
          nodes: [row],
          keep: !!label || leadingUnlabeled,
          halo: true,
        };
      });
      if (rows.length < detailsCfg.MIN_FIELD_ROWS || keepMatches.size < 2) return;

      const candidate = {
        section: section,
        rows: rows,
        keepSet: keepSet,
        score: keepMatches.size,
        halo: true,
      };
      if (!best || candidate.score > best.score ||
          (candidate.score === best.score && candidate.rows.length < best.rows.length)) {
        best = candidate;
      }
    });

    return best;
  }

  function findDetailSection(sectionCfg) {
    const halo = findHaloDetailSection(sectionCfg);
    if (halo) return halo;
    const candidates = safeQueryAll(document, sectionCfg.ROOT_SELECTORS);
    let best = null;
    candidates.forEach(function (candidate) {
      const valid = validateDetailSection(candidate, sectionCfg);
      if (valid && (!best || valid.score > best.score || valid.rows.length < best.rows.length)) best = valid;
    });
    if (best) return best;

    const headings = findByLabels(document, sectionCfg.HEADINGS, { allowTrailingCounter: true });
    headings.forEach(function (heading) {
      let node = heading.parentElement;
      for (let depth = 0; node && node !== document.body && depth < cfg.DETAILS.MAX_SECTION_DEPTH; depth += 1) {
        const valid = validateDetailSection(node, sectionCfg);
        if (valid) {
          if (!best || valid.rows.length < best.rows.length || valid.score > best.score) best = valid;
          break;
        }
        node = node.parentElement;
      }
    });
    return best;
  }

  function filterDetailSection(sectionCfg) {
    beginKeepSection(sectionCfg.SECTION);
    try {
      return reconcileSection(sectionCfg.SECTION, function () {
        const match = findDetailSection(sectionCfg);
        if (!match) {
          warnOnce('missing:' + sectionCfg.SECTION, '找不到可可靠判定的 ' + sectionCfg.HEADINGS[0] + ' 區塊，本輪跳過。');
          return { found: false, hidden: 0 };
        }

        clearWarning('missing:' + sectionCfg.SECTION);
        let hidden = 0;
        match.rows.forEach(function (row) {
          if (row.nodes.some(function (node) { return findByLabels(node, sectionCfg.HEADINGS).length > 0; })) return;
          if (row.keep || match.keepSet.has(row.label)) {
            row.nodes.forEach(function (node) { keep(node, sectionCfg.SECTION); });
            return;
          }
          row.nodes.forEach(function (node) {
            if (hide(node, sectionCfg.SECTION)) hidden += 1;
          });
        });
        return { found: true, hidden: hidden, rows: match.rows.length };
      });
    } finally {
      finishKeepSection(sectionCfg.SECTION);
    }
  }

  NS.ultimate.shared = {
    cfg: cfg,
    warnOnce: warnOnce,
    clearWarning: clearWarning,
    normalizeText: normalizeText,
    normalizedLabels: normalizedLabels,
    findByLabels: findByLabels,
    lowestCommonAncestor: lowestCommonAncestor,
    boundedOwner: boundedOwner,
    safeQueryAll: safeQueryAll,
    safeMatches: safeMatches,
    safeClosest: safeClosest,
    elementRect: elementRect,
    isVisible: isVisible,
    directText: directText,
    labelVariants: labelVariants,
    matchesLabel: matchesLabel,
    matchedLabel: matchedLabel,
    isOwnUi: isOwnUi,
    hide: hide,
    restoreElement: restoreElement,
    restoreSection: restoreSection,
    beginSection: beginSection,
    finishSection: finishSection,
    reconcileSection: reconcileSection,
    beginKeepSection: beginKeepSection,
    finishKeepSection: finishKeepSection,
    keep: keep,
    restoreAll: restoreAll,
    countMatchedLabels: countMatchedLabels,
    filterDetailSection: filterDetailSection,
    _internals: {
      discoverFieldRows: discoverFieldRows,
      discoverSiblingFieldRows: discoverSiblingFieldRows,
      findDetailSection: findDetailSection,
      findHaloDetailSection: findHaloDetailSection,
      validateDetailSection: validateDetailSection,
    },
  };
})();
