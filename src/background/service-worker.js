/**
 * service-worker.js（MV3 背景服務）
 *
 * 為什麼 AI 呼叫放在這裡，而不是 content script？
 *  1. CORS：content script 的 fetch 會套用「所在頁面」的 CORS 規則，呼叫 AI API 會被擋；
 *     背景服務有 host_permissions，可直接跨域呼叫。
 *  2. 安全：API Key 只在背景使用，不會出現在 HaloPSA 頁面環境。
 *
 * Prompt 文字不在本檔：唯一來源是 src/ai/prompt-templates.js，dev 端的評測工具
 * （tools/prompt-eval/runner.js）共用同一份，避免出貨行為與評測行為漂移。
 * 修改 prompt 前請依 .claude/skills/prompt-eval 建立 baseline。
 *
 * 職責：
 *  - 接收 content script（ai-adapter.js）送來的 HPX_AI_REQUEST 訊息
 *  - 從 chrome.storage 讀取設定（provider / API Keys / 模型）
 *  - 依 provider 路由到 Azure OpenAI（DeepSeek）或公司地端 Ornith
 *  - 未設定金鑰時，回退為 Stub 假資料（流程仍可跑）
 *  - 點擊工具列圖示 → 開啟設定頁
 */

'use strict';

// ── 共用 Prompt 來源（與 tools/prompt-eval/runner.js 同一份）──
// classic service worker 可用 importScripts 同步載入；路徑以 / 開頭代表擴充功能根目錄。
importScripts('/src/ai/provider-settings.js', '/src/ai/prompt-templates.js', '/src/ai/output-validator.js');
const buildPrompt = self.HPX_PROMPTS.buildPrompt;
const buildOrnithRequest = self.HPX_PROMPTS.buildOrnithRequest;
const AI_SETTINGS = self.HPX_AI_SETTINGS;
const AI_OUTPUT = self.HPX_AI_OUTPUT;

// ── 設定儲存 key（與 options.js 須一致）──
const SETTINGS_KEY = 'hpx_settings';
const ONBOARDING_PAGE = 'src/onboarding/onboarding.html';
const DEFAULT_HALO_HOME = 'https://halopsa.com/';
const LAST_HALO_ORIGIN_KEY = 'hpx_last_halo_origin';
const LAST_HALO_TAB_KEY = 'hpx_last_halo_tab_id';
let onboardingTabId = null;
let onboardingOpening = false;
let onboardingSourceTabId = null;
let onboardingSourceOrigin = '';
const DEFAULT_APPEARANCE = {
  theme: 'cute-ios',
  accent: '#0c2d55',
  ultimateMode: false,
};
const DEFAULTS = {
  provider: '',
  ornithBaseUrl: AI_SETTINGS.ORNITH_BASE_URL,
  ornithModel: AI_SETTINGS.ORNITH_MODEL,
  ornithApiKey: '',
  azureEndpoint: '',
  azureDeployment: '',
  azureApiKey: '',
};

// 清理已下線功能的舊設定，並把已不存在的主題選項遷移到 Cute。
const REMOVED_SETTINGS = ['casteSystem', 'timesheetReport', 'haloApiBaseUrl', 'haloApiKey', 'haloTicketUrlTemplate', 'customSkin', 'useStub'];

function haloOriginFromUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:') return '';
    if (!/(?:^|\.)halo(?:psa|itsm|crm|servicedesk)\.com$/i.test(parsed.hostname)) return '';
    return parsed.origin;
  } catch (error) {
    return '';
  }
}

function rememberHaloSource(sender, sourceUrl) {
  const tab = sender && sender.tab;
  const origin = haloOriginFromUrl(sourceUrl || (tab && tab.url));
  if (!origin) {
    onboardingSourceTabId = null;
    chrome.storage.local.remove(LAST_HALO_TAB_KEY, function () { void chrome.runtime.lastError; });
    return;
  }
  onboardingSourceOrigin = origin;
  onboardingSourceTabId = tab && typeof tab.id === 'number' ? tab.id : null;
  const patch = { [LAST_HALO_ORIGIN_KEY]: origin };
  if (onboardingSourceTabId === null) chrome.storage.local.remove(LAST_HALO_TAB_KEY, function () { void chrome.runtime.lastError; });
  else patch[LAST_HALO_TAB_KEY] = onboardingSourceTabId;
  chrome.storage.local.set(patch, function () { void chrome.runtime.lastError; });
}

function openOnboardingPage(done, sender, sourceUrl) {
  rememberHaloSource(sender, sourceUrl);
  const url = chrome.runtime.getURL(ONBOARDING_PAGE);
  const complete = typeof done === 'function' ? done : function () {};
  if (onboardingOpening) {
    complete({ ok: true, pending: true });
    return;
  }
  if (onboardingTabId !== null) {
    chrome.tabs.update(onboardingTabId, { active: true }, function () {
      if (chrome.runtime.lastError) {
        onboardingTabId = null;
        openOnboardingPage(complete, sender, sourceUrl);
        return;
      }
      complete({ ok: true, reused: true });
    });
    return;
  }
  onboardingOpening = true;
  const createOptions = { url: url, active: true };
  if (typeof onboardingSourceTabId === 'number') createOptions.openerTabId = onboardingSourceTabId;
  chrome.tabs.create(createOptions, function (tab) {
    const lastError = chrome.runtime.lastError;
    onboardingOpening = false;
    if (lastError || !tab || typeof tab.id !== 'number') {
      onboardingTabId = null;
      complete({ ok: false, error: lastError ? lastError.message : '無法開啟首次登入提示' });
      return;
    }
    onboardingTabId = tab && typeof tab.id === 'number' ? tab.id : null;
    complete({ ok: true, created: true });
  });
}

chrome.tabs.onRemoved.addListener(function (tabId) {
  if (tabId === onboardingTabId) onboardingTabId = null;
  if (tabId === onboardingSourceTabId) onboardingSourceTabId = null;
});

function openHaloHomePage(done, sender) {
  const complete = typeof done === 'function' ? done : function () {};
  const currentTab = sender && sender.tab;
  const currentTabId = currentTab && typeof currentTab.id === 'number' ? currentTab.id : null;
  const openerTabId = currentTab && typeof currentTab.openerTabId === 'number' ? currentTab.openerTabId : null;

  function closeOnboarding(response) {
    complete(response);
    if (currentTabId === null) {
      return;
    }
    chrome.tabs.remove(currentTabId, function () {
      void chrome.runtime.lastError;
    });
  }

  function createHome(origin) {
    const url = String(origin || DEFAULT_HALO_HOME).replace(/\/+$/, '') + '/';
    chrome.tabs.create({ url: url, active: true }, function (tab) {
      const lastError = chrome.runtime.lastError;
      if (lastError || !tab || typeof tab.id !== 'number') {
        complete({ ok: false, error: lastError ? lastError.message : '無法開啟 HaloPSA 主頁' });
        return;
      }
      closeOnboarding({ ok: true, created: true });
    });
  }

  function navigate(origin, storedTabId) {
    if (!origin) {
      createHome(DEFAULT_HALO_HOME);
      return;
    }
    const targetTabId = typeof onboardingSourceTabId === 'number'
      ? onboardingSourceTabId
      : (typeof storedTabId === 'number' ? storedTabId : openerTabId);
    if (typeof targetTabId !== 'number' || targetTabId === currentTabId) {
      createHome(origin);
      return;
    }
    chrome.tabs.update(targetTabId, { url: origin + '/', active: true }, function () {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        onboardingSourceTabId = null;
        createHome(origin);
        return;
      }
      onboardingSourceTabId = targetTabId;
      closeOnboarding({ ok: true, reused: true });
    });
  }

  chrome.storage.local.get([LAST_HALO_ORIGIN_KEY, LAST_HALO_TAB_KEY], function (data) {
    const storedOrigin = haloOriginFromUrl(data && data[LAST_HALO_ORIGIN_KEY]);
    if (!onboardingSourceOrigin && storedOrigin) onboardingSourceOrigin = storedOrigin;
    const storedTabId = data && typeof data[LAST_HALO_TAB_KEY] === 'number' ? data[LAST_HALO_TAB_KEY] : null;
    const knownOrigin = onboardingSourceOrigin || storedOrigin;
    navigate(knownOrigin, knownOrigin ? storedTabId : null);
  });
}

function purgeRemovedSettings() {
  chrome.storage.local.get(SETTINGS_KEY, function (data) {
    const current = data && data[SETTINGS_KEY];
    const next = Object.assign({}, current && typeof current === 'object' ? current : {});
    let changed = !current || typeof current !== 'object';
    REMOVED_SETTINGS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key];
        changed = true;
      }
    });
    if (next.theme !== 'default' && next.theme !== 'cute-ios') {
      next.theme = DEFAULT_APPEARANCE.theme;
      changed = true;
    }

    if (!Object.prototype.hasOwnProperty.call(next, 'accent') || !/^#[0-9a-f]{6}$/i.test(String(next.accent || ''))) {
      next.accent = DEFAULT_APPEARANCE.accent;
      changed = true;
    }

    if (typeof next.ultimateMode !== 'boolean') {
      next.ultimateMode = DEFAULT_APPEARANCE.ultimateMode;
      changed = true;
    }

    if (changed) chrome.storage.local.set({ [SETTINGS_KEY]: next });
  });
}

purgeRemovedSettings();

// ── Azure OpenAI 常數 ──
const AZURE_API_VERSION = '2024-12-01-preview';
const ORNITH_REQUEST_TIMEOUT_MS = 120000;
const SUPPORTED_AI_ACTIONS = new Set(['improve_tone', 'professional', 'first_contact', 'translate']);

function usageMetrics(data, elapsedMs, content) {
  const usage = (data && data.usage) || {};
  const completionDetails = usage.completion_tokens_details || usage.output_tokens_details || {};
  const promptTokens = Number(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens) || 0;
  const completionValue = usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens;
  const completionTokens = completionValue == null || !Number.isFinite(Number(completionValue)) || Number(completionValue) < 0 ? null : Number(completionValue);
  const reasoningValue = completionDetails.reasoning_tokens != null
    ? completionDetails.reasoning_tokens
    : usage.reasoning_tokens;
  const reasoningTokens = reasoningValue == null ? null : (Number(reasoningValue) || 0);
  const effectiveOutputTokens = content ? Math.max(0, completionTokens - (reasoningTokens || 0)) : 0;
  return {
    promptTokens: promptTokens,
    completionTokens: completionTokens,
    reasoningTokens: reasoningTokens,
    elapsedMs: elapsedMs,
    effectiveOutputTokensPerSecond: completionTokens == null ? null : elapsedMs > 0
      ? Number((effectiveOutputTokens / (elapsedMs / 1000)).toFixed(2))
      : 0,
  };
}

function recordAiPerformance(provider, action, data, elapsedMs, content, status) {
  const choice = data && data.choices && data.choices[0];
  const metrics = usageMetrics(data, elapsedMs, content);
  // 僅記錄數值與固定識別欄位；不得加入 prompt、回覆、API Key 或工單資料。
  console.info('[HPX][AI_PERF]', {
    provider: provider,
    action: action || 'unknown',
    promptVersion: self.HPX_PROMPTS.PROMPT_VERSION,
    promptTokens: metrics.promptTokens,
    completionTokens: metrics.completionTokens,
    reasoningTokens: metrics.reasoningTokens,
    finishReason: (choice && choice.finish_reason) || (status >= 400 ? 'http_' + status : 'unknown'),
    elapsedMs: metrics.elapsedMs,
    effectiveOutputTokensPerSecond: metrics.effectiveOutputTokensPerSecond,
  });
  return metrics;
}

function responseContent(providerLabel, data, elapsedMs, action, status, metrics) {
  const choice = data && data.choices && data.choices[0];
  const message = (choice && choice.message) || {};
  const out = String(message.content || '').trim();
  const performance = recordAiPerformance(providerLabel, action, data, elapsedMs, out, status);
  if (metrics) Object.assign(metrics, performance);
  if (!choice) throw new Error(providerLabel + ' 沒有回傳 choices');
  if (choice.finish_reason === 'length') {
    throw new Error(providerLabel + ' 回應達到輸出長度上限，截斷結果未套用；請縮短內容後重試');
  }
  if (!out && String(message.reasoning_content || '').trim()) {
    throw new Error(providerLabel + ' 只有 reasoning_content、沒有正式 content，結果未套用');
  }
  if (!out) throw new Error(providerLabel + ' 回傳空內容');
  return out;
}

// ── Stub 後援（未設定金鑰）──
function buildStub(action, text, targetLang) {
  const labelMap = {
    improve_tone: '回覆客戶',
    professional: '工單分析',
    first_contact: 'First Contact',
    translate: targetLang === 'en' ? '翻譯成英文' : '翻譯成中文',
  };
  return (
    '【示意：' +
    (labelMap[action] || action) +
    '】\n（尚未設定 API Key，未呼叫真實 AI）\n\n' +
    String(text || '').trim()
  );
}

// ── 讀取設定 ──
function getSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(SETTINGS_KEY, function (data) {
      const s = (data && data[SETTINGS_KEY]) || {};
      resolve({
        provider: AI_SETTINGS.resolveProvider(s),
        ornithBaseUrl: (s.ornithBaseUrl || DEFAULTS.ornithBaseUrl).trim(),
        ornithModel: (s.ornithModel || DEFAULTS.ornithModel).trim(),
        ornithApiKey: s.ornithApiKey || DEFAULTS.ornithApiKey,
        azureEndpoint: (s.azureEndpoint || DEFAULTS.azureEndpoint).trim(),
        azureDeployment: (s.azureDeployment || DEFAULTS.azureDeployment).trim(),
        azureApiKey: s.azureApiKey || DEFAULTS.azureApiKey,
      });
    });
  });
}

function normalizeAzureEndpoint(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (e) {
    throw new Error('Azure Endpoint 格式不正確，請填入 https://<resource>.openai.azure.com');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname.toLowerCase().endsWith('.openai.azure.com') ||
    (url.pathname && url.pathname !== '/') ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error('Azure Endpoint 必須是 https://<resource>.openai.azure.com，不要包含 API 路徑或參數');
  }
  return url.origin;
}

function validateAzureSettings(settings) {
  const endpoint = normalizeAzureEndpoint(settings.azureEndpoint);
  const deployment = String(settings.azureDeployment || '').trim();
  if (!deployment) throw new Error('尚未設定 Azure Deployment Name');
  if (deployment.length > 128) throw new Error('Azure Deployment Name 長度不正確');
  return { endpoint: endpoint, deployment: deployment };
}

// ── 呼叫 Azure OpenAI ──
async function callAzureDeepSeek(settings, prompt, action, metrics) {
  const azure = validateAzureSettings(settings);
  const url =
    azure.endpoint +
    '/openai/deployments/' +
    encodeURIComponent(azure.deployment) +
    '/chat/completions?api-version=' +
    AZURE_API_VERSION;

  const startedAt = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': settings.azureApiKey,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 4096,
    }),
  });

  const data = await resp.json().catch(function () {
    return null;
  });

  if (!resp.ok) {
    recordAiPerformance('azure-deepseek', action, data, Date.now() - startedAt, '', resp.status);
    const msg =
      (data && data.error && data.error.message) ||
      ('Azure OpenAI 回應 HTTP ' + resp.status);
    throw new Error(msg);
  }

  return responseContent('azure-deepseek', data, Date.now() - startedAt, action, resp.status, metrics);
}

function validateOrnithSettings(settings) {
  let url;
  try {
    url = new URL(String(settings.ornithBaseUrl || '').trim());
  } catch (error) {
    throw new Error('Ornith Base URL 格式不正確，請填入 ' + AI_SETTINGS.ORNITH_BASE_URL);
  }
  if (
    url.protocol !== 'https:' ||
    url.pathname.replace(/\/+$/, '') !== '/v1' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error('Ornith Base URL 必須是 HTTPS 網址，路徑為 /v1，且不可包含帳密、參數或片段。');
  }
  const allowedHosts = chrome.runtime.getManifest().host_permissions || [];
  if (!allowedHosts.includes(url.origin + '/*')) {
    throw new Error('此 Ornith 主機尚未授權。請先執行 scripts/Configure-Ornith.ps1 設定該 HTTPS 主機，重新載入擴充功能後再試。');
  }
  const model = String(settings.ornithModel || '').trim();
  if (!model) throw new Error('尚未設定 Ornith Model');
  if (model.length > 128) throw new Error('Ornith Model 長度不正確');
  return { baseUrl: url.origin + '/v1', model: model };
}

// ── 呼叫 OpenAI-compatible Ornith API ──
async function callOrnith(settings, request, action, metrics) {
  const ornith = validateOrnithSettings(settings);
  const url = ornith.baseUrl + '/chat/completions';
  const startedAt = Date.now();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(function () { controller.abort(); }, ORNITH_REQUEST_TIMEOUT_MS) : null;
  let resp;
  let data;
  try {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + settings.ornithApiKey,
      },
      body: JSON.stringify(Object.assign({ model: ornith.model }, request.body)),
    };
    if (controller) options.signal = controller.signal;
    resp = await fetch(url, options);
    data = await resp.json().catch(function () { return null; });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Ornith 請求超過 ' + ORNITH_REQUEST_TIMEOUT_MS / 1000 + ' 秒，已中止且不會改呼叫 Azure');
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (!resp.ok) {
    recordAiPerformance('ornith', action, data, Date.now() - startedAt, '', resp.status);
    const providerError = (data && data.error) || {};
    const msg = String(providerError.message || '');
    const compatibilityDetail = msg + ' ' + JSON.stringify(providerError);
    if (
      (resp.status === 400 || resp.status === 422) &&
      /chat_template_kwargs|enable_thinking/i.test(compatibilityDetail)
    ) {
      throw new Error(
        'Ornith Gateway 不支援必要的 chat_template_kwargs.enable_thinking=false；' +
        '為避免自動恢復無限制推理，本次請求已停止，且不會改呼叫 Azure'
      );
    }
    throw new Error('Ornith API 回應 HTTP ' + resp.status + '，未改呼叫 Azure');
  }

  return responseContent('ornith', data, Date.now() - startedAt, action, resp.status, metrics);
}

// ── 依 provider 取得有效 API Key ──
function getActiveKey(settings) {
  if (settings.provider === AI_SETTINGS.PROVIDERS.ORNITH) return settings.ornithApiKey;
  if (settings.provider === AI_SETTINGS.PROVIDERS.AZURE) return settings.azureApiKey;
  return '';
}

// ── 測試連線（設定頁「測試連線」按鈕用）──
async function handleAiPing() {
  const settings = await getSettings();
  const state = AI_SETTINGS.validateExclusive(settings);
  if (!state.provider) return { ok: false, error: '請先選擇 AI Provider' };
  const activeKey = getActiveKey(settings);
  if (!activeKey) {
    return { ok: false, error: '尚未設定 API Key' };
  }

  if (settings.provider === AI_SETTINGS.PROVIDERS.AZURE) {
    const out = await callAzureDeepSeek(settings, '請只回覆兩個字：OK', 'ping');
    return { ok: true, provider: 'azure-deepseek', deployment: settings.azureDeployment, sample: out };
  }

  const out = await callOrnith(settings, buildOrnithRequest('ping', ''), 'ping');
  return { ok: true, provider: 'ornith', model: settings.ornithModel, sample: out };
}

// ── 處理一次 AI 請求 ──
async function handleAiRequest(payload) {
  const metrics = {};
  const action = payload.action;
  const text = payload.text;
  const targetLang = payload.targetLang;
  if (!SUPPORTED_AI_ACTIONS.has(action)) throw new Error('不支援的 AI 功能');
  const settings = await getSettings();
  AI_SETTINGS.validateExclusive(settings);

  const activeKey = getActiveKey(settings);
  if (!activeKey) {
    return {
      ok: true,
      text: buildStub(action, text, targetLang),
      stub: true,
      provider: settings.provider,
    };
  }

  if (settings.provider === AI_SETTINGS.PROVIDERS.AZURE) {
    // Azure 刻意維持既有單一 user message、prompt、temperature、max_tokens 與 API version。
    const result = await callAzureDeepSeek(settings, buildPrompt(action, text, targetLang), action, metrics);
    AI_OUTPUT.assertValid(action, text, result);
    return { ok: true, text: result, metrics: metrics, stub: false, provider: 'azure-deepseek', deployment: settings.azureDeployment };
  }

  if (settings.provider === AI_SETTINGS.PROVIDERS.ORNITH) {
    const result = await callOrnith(settings, buildOrnithRequest(action, text, targetLang), action, metrics);
    AI_OUTPUT.assertValid(action, text, result);
    return { ok: true, text: result, metrics: metrics, stub: false, provider: 'ornith', model: settings.ornithModel };
  }

  throw new Error('請先選擇 AI Provider');
}

// ═══════════════════════════════════════════════════════════════
// 獨立 Note 編輯視窗：開窗、保管 session、在兩端之間轉送
//
// 為什麼 session 要放 chrome.storage.session 而不是模組變數：
// MV3 的 service worker 隨時會被回收，但編輯視窗會一直開著。
// 存記憶體的話，SW 一睡醒 session 就不見，使用者按「套用」會直接失敗。
// storage.session 不落地、關瀏覽器即清除，符合「不留工單內容」的原則。
// ═══════════════════════════════════════════════════════════════

const NOTE_SESSION_KEY = 'hpx_note_session';
const EDITOR_PAGE = 'src/editor-window/editor.html';

async function noteSessionRead() {
  const data = await chrome.storage.session.get(NOTE_SESSION_KEY);
  return (data && data[NOTE_SESSION_KEY]) || null;
}

async function noteSessionWrite(session) {
  await chrome.storage.session.set({ [NOTE_SESSION_KEY]: session });
}

async function noteSessionClear() {
  await chrome.storage.session.remove(NOTE_SESSION_KEY);
}

/** 視窗還在嗎？（使用者可能直接關掉，我們不一定收得到事件） */
async function windowExists(windowId) {
  if (typeof windowId !== 'number') return false;
  try {
    await chrome.windows.get(windowId);
    return true;
  } catch (e) {
    return false;
  }
}

/** 把呼叫端建議的視窗尺寸壓進合理範圍，避免開出畸形視窗 */
function sanitizeBounds(bounds) {
  const source = bounds && typeof bounds === 'object' ? bounds : {};
  const clamp = function (value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };
  return {
    width: clamp(source.width, 420, 2000, 720),
    height: clamp(source.height, 400, 2000, 820),
    left: clamp(source.left, -4000, 8000, 100),
    top: clamp(source.top, -4000, 8000, 60),
  };
}

/** content script 要求開啟編輯視窗 */
async function handleNoteOpen(payload, sender) {
  const tabId = sender && sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') {
    return { ok: false, error: '無法辨識來源分頁。' };
  }

  // V1 一次只允許一個編輯視窗：已經有一個就把它帶到前景，不要開第二個。
  const existing = await noteSessionRead();
  if (existing && (await windowExists(existing.windowId))) {
    await chrome.windows.update(existing.windowId, { focused: true, drawAttention: true });
    return {
      ok: false,
      error: '已經有一個 Note 編輯視窗開著了，請先套用或取消它。',
      alreadyOpen: true,
    };
  }
  if (existing) await noteSessionClear();

  const bounds = sanitizeBounds(payload && payload.bounds);
  const sessionId = 'note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL(EDITOR_PAGE) + '?session=' + encodeURIComponent(sessionId),
    type: 'popup',
    width: bounds.width,
    height: bounds.height,
    left: bounds.left,
    top: bounds.top,
    focused: true,
  });

  await noteSessionWrite({
    sessionId: sessionId,
    tabId: tabId,
    windowId: created && created.id,
    html: String((payload && payload.html) || ''),
    title: String((payload && payload.title) || 'HaloPSA Note'),
  });

  return { ok: true, sessionId: sessionId };
}

/** 編輯視窗載入後索取自己的內容 */
async function handleNoteSessionGet(payload) {
  const session = await noteSessionRead();
  if (!session || session.sessionId !== (payload && payload.sessionId)) {
    return { ok: false, error: '這個編輯工作階段已失效，請關閉本視窗後重新開啟。' };
  }
  return { ok: true, html: session.html, title: session.title };
}

/** 編輯視窗按下「套用」→ 轉給 content script 寫回 HaloPSA */
async function handleNoteApply(payload) {
  const session = await noteSessionRead();
  if (!session || session.sessionId !== (payload && payload.sessionId)) {
    return { ok: false, error: '這個編輯工作階段已失效，內容沒有被寫入任何地方。' };
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(session.tabId, {
      type: 'HPX_NOTE_APPLY_TO_EDITOR',
      sessionId: session.sessionId,
      html: String((payload && payload.html) || ''),
      force: !!(payload && payload.force),
    });
  } catch (error) {
    return {
      ok: false,
      error: '無法連線到 HaloPSA 分頁（可能已關閉或重新載入）。內容沒有被寫入任何地方。',
    };
  }

  return response || { ok: false, error: 'HaloPSA 分頁沒有回應。' };
}

/** 關閉編輯視窗（取消，或套用成功後收工）。不會動到 HaloPSA 內容。 */
async function handleNoteClose(payload) {
  const session = await noteSessionRead();
  if (!session || session.sessionId !== (payload && payload.sessionId)) {
    return { ok: true };
  }
  await noteSessionClear();
  notifyTabSessionEnded(session);
  if (await windowExists(session.windowId)) {
    try {
      await chrome.windows.remove(session.windowId);
    } catch (e) {
      /* 視窗可能已經被使用者關掉 */
    }
  }
  return { ok: true };
}

/** 告知 content script 可以丟掉 session 狀態（失敗無所謂，分頁可能已關） */
function notifyTabSessionEnded(session) {
  if (!session || typeof session.tabId !== 'number') return;
  chrome.tabs
    .sendMessage(session.tabId, {
      type: 'HPX_NOTE_SESSION_ENDED',
      sessionId: session.sessionId,
    })
    .catch(function () {
      /* 分頁已關閉或沒有 content script，忽略 */
    });
}

// 使用者直接關掉編輯視窗 = 取消。只清 session，不寫回任何內容。
chrome.windows.onRemoved.addListener(function (windowId) {
  noteSessionRead().then(function (session) {
    if (!session || session.windowId !== windowId) return;
    noteSessionClear();
    notifyTabSessionEnded(session);
  });
});

// HaloPSA 分頁關閉 / 重新載入時，順手讓孤兒編輯視窗收掉。
chrome.tabs.onRemoved.addListener(function (tabId) {
  noteSessionRead().then(async function (session) {
    if (!session || session.tabId !== tabId) return;
    await noteSessionClear();
    if (await windowExists(session.windowId)) {
      chrome.windows.remove(session.windowId).catch(function () {});
    }
  });
});

// ── 訊息路由 ──
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message) return false;

  if (message.type === 'HPX_OPEN_OPTIONS') {
    try {
      const opening = chrome.runtime.openOptionsPage();
      if (opening && typeof opening.then === 'function') {
        opening.then(function () { sendResponse({ ok: true }); }).catch(function (error) {
          sendResponse({ ok: false, error: error && error.message ? error.message : '無法開啟設定頁' });
        });
        return true;
      }
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error && error.message ? error.message : '無法開啟設定頁' });
    }
    return false;
  }

  if (message.type === 'HPX_OPEN_ONBOARDING') {
    try {
      openOnboardingPage(sendResponse, sender, message.sourceUrl);
    } catch (error) {
      sendResponse({ ok: false, error: error.message || '無法開啟首次登入提示' });
    }
    return true;
  }

  if (message.type === 'HPX_OPEN_HALOPSA_HOME') {
    try {
      openHaloHomePage(sendResponse, sender);
    } catch (error) {
      sendResponse({ ok: false, error: error.message || '無法返回 HaloPSA 主頁' });
    }
    return true;
  }

  let work = null;
  if (message.type === 'HPX_AI_REQUEST') {
    work = handleAiRequest(message.payload || {});
  } else if (message.type === 'HPX_AI_PING') {
    work = handleAiPing();
  } else if (message.type === 'HPX_NOTE_OPEN') {
    work = handleNoteOpen(message.payload || {}, sender);
  } else if (message.type === 'HPX_NOTE_SESSION_GET') {
    work = handleNoteSessionGet(message.payload || {});
  } else if (message.type === 'HPX_NOTE_APPLY') {
    work = handleNoteApply(message.payload || {});
  } else if (message.type === 'HPX_NOTE_CLOSE') {
    work = handleNoteClose(message.payload || {});
  } else {
    return false;
  }

  work
    .then(function (res) {
      sendResponse(res);
    })
    .catch(function (err) {
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    });

  return true;
});

// ── 點擊工具列圖示 → 開啟設定頁 ──
chrome.action.onClicked.addListener(function () {
  chrome.runtime.openOptionsPage();
});
