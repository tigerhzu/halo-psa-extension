/** AI Provider identifiers and the shared mutual-exclusion rules. */
(function (root) {
  'use strict';

  const PROVIDERS = Object.freeze({
    ORNITH: 'ornith',
    AZURE: 'azure-deepseek',
  });
  const ORNITH_BASE_URL = 'https://ornith.example.invalid/v1';
  const ORNITH_MODEL = 'Ornith-1.5-35B-A3B';

  function clean(value) {
    return String(value || '').trim();
  }

  function resolveProvider(settings) {
    const source = settings || {};
    if (source.provider === PROVIDERS.ORNITH || source.provider === PROVIDERS.AZURE) {
      return source.provider;
    }
    // Preserve old Azure installations which stored credentials before provider existed.
    if (clean(source.azureApiKey) && !clean(source.ornithApiKey)) return PROVIDERS.AZURE;
    if (clean(source.ornithApiKey) && !clean(source.azureApiKey)) return PROVIDERS.ORNITH;
    return '';
  }

  function azureOutputBudget(settings, request) {
    // Only reduce the allowance when non-thinking mode was explicitly selected.
    // Service-default reasoning may consume this same budget before its answer.
    if (settings.azureThinkingMode !== 'disabled' || !request) return 4096;
    if (request.action === 'ping') return 32;
    if (!['improve_tone', 'professional', 'first_contact', 'translate'].includes(request.action) ||
        typeof request.text !== 'string') return 4096;
    const text = request.text.trim();
    // Conservative character-based allowance, including CJK, expansion and labels.
    // The source is never truncated. Long input keeps the previous 4096 cap.
    const estimate = Array.from(text).length * 3 + text.split(/\r?\n/).length * 24 + 256;
    return Math.min(4096, Math.max(768, Math.ceil(estimate / 256) * 256));
  }

  function azureRequestBody(settings, prompt, request) {
    const body = {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: azureOutputBudget(settings, request),
    };
    // Opt-in: deployment names are arbitrary and do not identify model capabilities.
    if (settings.azureThinkingMode === 'disabled') body.thinking = { type: 'disabled' };
    return body;
  }

  function validateExclusive(settings) {
    const source = settings || {};
    const provider = resolveProvider(source);
    const azureConfigured = !!clean(source.azureApiKey);
    const ornithConfigured = !!clean(source.ornithApiKey);

    if (azureConfigured && ornithConfigured) {
      throw new Error('Ornith 與 Azure OpenAI 不可同時保存 API Key；請先移除其中一組設定。');
    }
    if (azureConfigured && provider !== PROVIDERS.AZURE) {
      throw new Error('Azure OpenAI 已設定；請先移除 Azure 設定，才能改用 Ornith。');
    }
    if (ornithConfigured && provider !== PROVIDERS.ORNITH) {
      throw new Error('Ornith 已設定；請先移除 Ornith 設定，才能改用 Azure OpenAI。');
    }

    return {
      provider: provider,
      azureConfigured: azureConfigured,
      ornithConfigured: ornithConfigured,
    };
  }

  root.HPX_AI_SETTINGS = Object.freeze({
    PROVIDERS: PROVIDERS,
    ORNITH_BASE_URL: ORNITH_BASE_URL,
    ORNITH_MODEL: ORNITH_MODEL,
    resolveProvider: resolveProvider,
    azureRequestBody: azureRequestBody,
    azureOutputBudget: azureOutputBudget,
    validateExclusive: validateExclusive,
  });
})(typeof self !== 'undefined' ? self : this);
