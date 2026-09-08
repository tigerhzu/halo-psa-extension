'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'Configure-Ornith.ps1');
const shell = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : '';

test('Ornith configuration changes only the exact manifest host and refuses unsafe origins', { skip: !shell || !fs.existsSync(shell) }, function () {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-configure-'));
  const manifestPath = path.join(temporaryRoot, 'manifest.json');
  const original = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(original));
    const invoke = origin => cp.spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', script, '-Origin', origin, '-ExtensionPath', temporaryRoot], { encoding: 'utf8', timeout: 15000 });
    const success = invoke('https://ai.example.com');
    assert.equal(success.status, 0, success.stderr);
    const configured = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(configured.host_permissions, ['https://*.openai.azure.com/*', 'https://ai.example.com/*']);
    configured.host_permissions = original.host_permissions;
    assert.deepEqual(configured, original);
    const saved = fs.readFileSync(manifestPath, 'utf8');
    for (const origin of ['http://ai.example.com', 'https://ai.example.com/v1', 'https://ai.example.com?x=1', 'https://user:pass@ai.example.com', 'https://*.example.com', 'https://ai.example.com:8443', 'https://ai.example.com#fragment']) {
      const failure = invoke(origin);
      assert.notEqual(failure.status, 0, 'Unsafe origin accepted: ' + origin);
      assert.equal(fs.readFileSync(manifestPath, 'utf8'), saved);
    }
    const repeat = invoke('https://second.example.com/');
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).host_permissions, ['https://*.openai.azure.com/*', 'https://second.example.com/*']);
  } finally {
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
