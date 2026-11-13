"""Integrate the same additive feature into a source tree or the mounted 1.1.4 copy."""
from pathlib import Path
import json
import sys

root = Path(sys.argv[1]).resolve()
def edit(name, before, after):
    path = root / name
    text = path.read_text(encoding='utf-8-sig')
    if after in text:
        return
    if before not in text:
        raise RuntimeError(f'Missing anchor: {name}: {before[:60]}')
    path.write_text(text.replace(before, after, 1), encoding='utf-8')

edit('manifest.json', '"src/config/time-adjuster-config.js",', '"src/config/time-adjuster-config.js",\n        "src/config/status-notes-config.js",')
edit('manifest.json', '"src/features/quick-status-chain.js",', '"src/features/status-notes.js",\n        "src/features/quick-status-chain.js",')
edit('src/content.js', '    NS.features.quickStatus.start();', '    NS.features.statusNotes.start();\n    NS.features.quickStatus.start();')
edit('src/content.js', '        NS.ui.toolbar.ensureAttached();', '        NS.ui.toolbar.ensureAttached();\n        NS.features.statusNotes.reconcile();')
edit('src/core/editor-adapter.js', 'setHtmlReliable: function (el, html) {', 'setHtmlReliable: function (el, html, options) {')
edit('src/core/editor-adapter.js', "      if (kind === 'textarea') {\n        adapter.setHtml(el, value);", "      const canWrite = options && options.canWrite;\n      if (canWrite && !canWrite()) return Promise.resolve({ ok: false, cancelled: true });\n      if (kind === 'textarea') {\n        adapter.setHtml(el, value);")
edit('src/core/editor-adapter.js', '        if (result && result.ok) return result;\n        adapter.setHtml(el, value);', '        if (result && result.ok) return result;\n        if (canWrite && !canWrite()) return { ok: false, cancelled: true };\n        adapter.setHtml(el, value);')
edit('src/features/quick-status.js', '      forms, modal, history, saveBlocker,', '      forms, modal, history, saveBlocker,\n      prepareForm: form => NS.features.statusNotes ? NS.features.statusNotes.prepare(form.node) : Promise.resolve(),')
edit('src/features/quick-status-chain.js', '              adapter.save(form);', '''              if (adapter.prepareForm) await adapter.prepareForm(form);
              guard(run);
              const preparedForms = adapter.forms();
              if (adapter.modal() || preparedForms.length !== 1 || preparedForms[0].node !== form.node || keyOf(preparedForms[0].label) !== step.key) {
                throw new Error('準備文字期間表單已變更，請手動檢查與儲存。');
              }
              adapter.save(form);''')
# The prerequisite wait callback must support awaiting editor/model synchronization.
edit('src/features/quick-status-chain.js', '          await until(run, () => {\n            if (adapter.modal())', '          await until(run, async () => {\n            if (adapter.modal())')
edit('src/features/quick-status-chain.js', '        const result = read();', '        const result = await read();')

edit('src/options/options.js', "new Set(['workspace', 'writing',", "new Set(['workspace', 'status-notes', 'writing',")
edit('src/options/options.html', '<a href="#contacts"', '<a href="#status-notes" class="nav-item"><span class="nav-icon" aria-hidden="true">\u270e</span><span>狀態自動帶入</span></a>\n<a href="#contacts"')
section = '''<section id="status-notes" class="settings-page" aria-labelledby="statusNotesTitle" hidden>
<section class="card"><div class="card-heading"><h2 id="statusNotesTitle">狀態自動帶入</h2></div>
<p class="card-description">開啟案件的狀態動作時，自動填入下方文字。保留已輸入的內容；文字可在送出前修改。</p>
<label class="toggle-row"><span><strong>啟用狀態文字自動帶入</strong><small>留白可停用單一狀態。修改文字後離開欄位即自動儲存，下次開啟動作時生效。</small></span><input id="statusNotesEnabled" type="checkbox" /><span class="switch-track" aria-hidden="true"></span></label>
<div id="statusNotesFields"></div>
<p class="hint">Closed 也適用於 Halo 的 Resolved Ticket／Resolve Ticket 動作。</p>
<div class="actions"><button id="resetStatusNotes" type="button">恢復全部預設文字</button><span id="statusNotesStatus" class="status" role="status" aria-live="polite"></span></div>
</section></section>
'''
edit('src/options/options.html', '<section id="backup"', section + '<section id="backup"')
edit('src/options/options.html', '</head>', '<link rel="stylesheet" href="status-notes-options.css" />\n</head>')
edit('src/options/options.html', '<script src="options.js"></script>', '<script src="options.js"></script><script src="../config/status-notes-config.js"></script><script src="status-notes-options.js"></script>')
if len(sys.argv) > 2:
    path = root / 'manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    manifest['version'] = sys.argv[2]
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
