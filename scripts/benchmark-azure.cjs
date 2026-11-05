'use strict';

// Credentials come from the process environment and are never printed or saved.
const { HPX_AI_SETTINGS } = require('../src/ai/provider-settings.js');
const HPX_PROMPTS = require('../src/ai/prompt-templates.js');

async function main() {
  const endpoint = new URL(process.env.AZURE_OPENAI_ENDPOINT || '');
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.openai.azure.com') ||
      endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw new Error('AZURE_OPENAI_ENDPOINT must be the HTTPS Azure resource origin.');
  }
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const key = process.env.AZURE_OPENAI_API_KEY;
  if (!deployment || !key) throw new Error('Set AZURE_OPENAI_DEPLOYMENT and AZURE_OPENAI_API_KEY.');
  const url = endpoint.origin + '/openai/deployments/' + encodeURIComponent(deployment) +
    '/chat/completions?api-version=2024-12-01-preview';
  const prompt = HPX_PROMPTS.buildPrompt('improve_tone',
    '使用者回報上午十點 Wi-Fi 連線不穩。已啟用快速漫遊、調整低訊號重新連線設定，並檢查無線頻道。目前等待使用者確認改善情況。');
  const samples = [];
  // Alternate modes to reduce ordering bias. No customer data is used.
  for (let round = 1; round <= 3; round++) {
    for (const mode of ['default', 'disabled']) {
      const start = performance.now();
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json', 'api-key': key },
        body: JSON.stringify(HPX_AI_SETTINGS.azureRequestBody({ azureThinkingMode: mode }, prompt)),
      });
      const data = await response.json();
      if (!response.ok) throw new Error('HTTP ' + response.status + ' for mode ' + mode + '; benchmark stopped.');
      const choice = data.choices && data.choices[0];
      if (!choice || choice.finish_reason !== 'stop' || !choice.message || !choice.message.content) {
        throw new Error('Incomplete response for mode ' + mode + '; benchmark stopped.');
      }
      const seconds = (performance.now() - start) / 1000;
      const usage = data.usage || {};
      const tokens = usage.completion_tokens;
      const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens ?? null;
      const rate = typeof tokens === 'number' ? Math.max(0, tokens - (reasoning || 0)) / seconds : null;
      const sample = { round, mode, seconds: +seconds.toFixed(2), completionTokens: tokens ?? null,
        reasoningTokens: reasoning, averageTokensPerSecond: rate === null ? null : +rate.toFixed(2) };
      samples.push(sample);
      console.log(JSON.stringify(sample));
    }
  }
  for (const mode of ['default', 'disabled']) {
    const rows = samples.filter(row => row.mode === mode);
    const rates = rows.map(row => row.averageTokensPerSecond).filter(value => value !== null).sort((a, b) => a - b);
    const median = rates.length === 3 ? rates[1] : null;
    console.log(JSON.stringify({ mode, medianAverageTokensPerSecond: median,
      target: 70, meetsTarget: median === null ? null : median >= 70 }));
  }
  console.log('Rates include waiting and transfer, not streaming generation speed. Unknown reasoning usage is not proof that thinking is off.');
}

module.exports = { main };
if (require.main === module) main().catch(error => {
  // Do not echo a provider response, URL, prompt, output, or credentials.
  console.error(error instanceof TypeError ? 'Connection or endpoint error; check Azure configuration and network.' : error.message);
  process.exitCode = 1;
});
