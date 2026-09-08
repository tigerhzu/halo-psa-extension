/** Provider-independent AI output safety checks. Never logs or returns source text. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof importScripts === 'function') root.HPX_AI_OUTPUT = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const PROFESSIONAL_LINE = /^- 【(?:使用者回報|異常|資訊|設定|處理動作|確認結果|已完成|待確認|注意|負責單位)】\s*\S/;

  function cleanMatch(value) {
    return String(value || '').replace(/[),.;，。；）】]+$/, '');
  }

  function protectedValues(text) {
    const source = String(text || '');
    const patterns = [
      /https?:\/\/[^\s<>"']+/gi,
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/g,
      /\b\d{4}年\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/g,
      /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
      /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
      /`[^`\r\n]+`/g,
      /\B--?[A-Za-z][\w-]*(?:=[^\s`,;，。]+)?/g,
      /\b[A-Z][A-Z0-9]{1,15}-[A-Z0-9][A-Z0-9-]*\b/g,
      /\bv?\d+(?:\.\d+){1,4}\b/gi,
    ];
    const found = new Set();
    patterns.forEach(function (pattern) {
      const matches = source.match(pattern) || [];
      matches.forEach(function (value) {
        const normalized = value.startsWith('`') && value.endsWith('`') ? value.slice(1, -1) : value;
        found.add(cleanMatch(normalized));
      });
    });
    const accountPattern = /(?:帳號|account(?:\s+id)?|user(?:name)?)\s*(?:為|是)?\s*(?:[:：=]\s*)?([A-Za-z0-9_.@\\/-]+)/gi;
    let account;
    while ((account = accountPattern.exec(source))) found.add(cleanMatch(account[1]));
    const labeledValue = /(?:版本|version|\bID)\s*[:：=]?\s*([A-Za-z0-9_.-]+)/gi;
    let labeled;
    while ((labeled = labeledValue.exec(source))) found.add(cleanMatch(labeled[1]));
    const command = /(?:指令|command)\s*[:：=]\s*([^\r\n]+)/gi;
    let commandMatch;
    while ((commandMatch = command.exec(source))) found.add(cleanMatch(commandMatch[1].trim()));
    return Array.from(found).filter(Boolean);
  }

  function jsonKind(text) {
    const value = String(text || '').trim();
    if (!/^[{[]/.test(value)) return false;
    try {
      JSON.parse(value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function hasBalancedHtml(text) {
    const value = String(text || '');
    const tagPattern = /<\/?([A-Za-z][\w:-]*)(?:\s[^<>]*?)?\s*\/?>/g;
    const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const stack = [];
    let match;
    while ((match = tagPattern.exec(value))) {
      const raw = match[0];
      const name = match[1].toLowerCase();
      if (raw.startsWith('</')) {
        if (stack.pop() !== name) return false;
      } else if (!raw.endsWith('/>') && !voidTags.has(name)) {
        stack.push(name);
      }
    }
    return stack.length === 0;
  }

  function formatError(action, input, output) {
    const trimmed = String(output || '').trim();
    if (action === 'professional') {
      const lines = trimmed.split(/\r?\n/).filter(function (line) { return line.trim(); });
      if (!lines.length || !lines.every(function (line) { return PROFESSIONAL_LINE.test(line); })) {
        return 'AI 回傳的工單條列格式不合法，結果未套用';
      }
    }
    if (action === 'improve_tone' || action === 'first_contact') {
      if (!/^您好(?:\s*[^，\r\n]+)?，/.test(trimmed) || !/謝謝。\s*$/.test(trimmed)) {
        return 'AI 回傳的客戶回覆格式不完整，結果未套用';
      }
    }
    if (action === 'translate' && jsonKind(input)) {
      try {
        JSON.parse(trimmed);
      } catch (error) {
        return 'AI 回傳的 JSON 無法解析，結果未套用';
      }
    }
    if (action === 'translate' && /<[A-Za-z][^>]*>/.test(String(input || '')) && !hasBalancedHtml(trimmed)) {
      return 'AI 回傳的 HTML 標籤不完整，結果未套用';
    }
    const fences = trimmed.match(/```/g) || [];
    if (fences.length % 2 !== 0) return 'AI 回傳的 Markdown 程式碼區塊不完整，結果未套用';
    const withoutFencedBlocks = trimmed.replace(/```[\s\S]*?```/g, '');
    const inlineTicks = withoutFencedBlocks.match(/`/g) || [];
    if (inlineTicks.length % 2 !== 0) return 'AI 回傳的 Markdown 行內程式碼不完整，結果未套用';
    const linkStarts = withoutFencedBlocks.match(/!?\[[^\]\r\n]*\]\(/g) || [];
    const completeLinks = withoutFencedBlocks.match(/!?\[[^\]\r\n]*\]\([^\s)]+(?:\s+"[^"]*")?\)/g) || [];
    if (linkStarts.length !== completeLinks.length) return 'AI 回傳的 Markdown 連結不完整，結果未套用';
    return '';
  }

  function validate(action, input, output) {
    const missingCount = protectedValues(input).filter(function (value) {
      return !String(output || '').includes(value);
    }).length;
    if (missingCount) {
      return {
        ok: false,
        missingCount: missingCount,
        error: 'AI 回傳內容遺失或改寫了 ' + missingCount + ' 個重要技術值，結果未套用',
      };
    }
    const error = formatError(action, input, output);
    return { ok: !error, missingCount: 0, error: error };
  }

  function assertValid(action, input, output) {
    const result = validate(action, input, output);
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  return {
    protectedValues: protectedValues,
    validate: validate,
    assertValid: assertValid,
  };
});
