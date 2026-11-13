"""Package the installed 1.1.4 maintenance branch, never the newer API branch."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'output/halo-psa-extension-1.1.4.3'
OUTPUT = (ROOT / 'release').resolve()
OUTPUT.mkdir(exist_ok=True)
manifest = json.loads((SOURCE / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
assert version == '1.1.4.3'
assert not list((SOURCE / 'src').rglob('*halo-api*')), 'Wrong release baseline'
archive = OUTPUT / f'halo-psa-extension-{version}.zip'
if archive.exists():
    raise SystemExit('Release already exists; preserve it and use a new version.')
stage = Path(tempfile.mkdtemp(prefix='stage-', dir=OUTPUT)).resolve()
verify = Path(tempfile.mkdtemp(prefix='verify-', dir=OUTPUT)).resolve()
try:
    allowed = {'.js', '.html', '.css', '.svg', '.png', '.webp', '.jpg', '.jpeg', '.gif', '.json', '.md'}
    source_digest = hashlib.sha256()
    for folder in ('src', 'assets', 'pet'):
        for source in sorted((SOURCE / folder).rglob('*')):
            assert not source.is_symlink(), f'Symlink: {source.name}'
            if not source.is_file():
                continue
            assert source.suffix.lower() in allowed, f'Unexpected file: {source.name}'
            relative = source.relative_to(SOURCE)
            source_digest.update(relative.as_posix().encode() + b'\0' + source.read_bytes())
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    manifest['host_permissions'] = ['https://*.openai.azure.com/*', 'https://ornith.example.invalid/*']
    (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (stage / 'scripts').mkdir()
    shutil.copy2(ROOT / 'scripts/Configure-Ornith.ps1', stage / 'scripts/Configure-Ornith.ps1')
    for pattern in ('LICENSE*', 'NOTICE*', 'COPYING*'):
        for source in SOURCE.glob(pattern):
            if source.is_file():
                shutil.copy2(source, stage / source.name)
    readme = f'''# Halo Companion {version}

Chrome / Edge 的 HaloPSA 輔助擴充功能，以 1.1.4 為基底，包含狀態文字自動帶入、AI 草稿、範本、工單閱讀及工時工具。

## 安裝及更新

1. 將 ZIP 完整解壓縮到固定資料夾。
2. Edge 開啟 edge://extensions；Chrome 開啟 chrome://extensions。
3. 開啟「開發人員模式」，選「載入未封裝項目」，選取含 manifest.json 的資料夾。
4. 重新整理 Halo 網頁，按左下角「設定」開啟後台，也可點瀏覽器的擴充功能圖示。

更新既有安裝：先備份原資料夾及設定，把新檔案覆蓋到原安裝目錄，於擴充功能管理頁按「重新載入」，再重新整理所有 Halo 分頁。保留原安裝位置以沿用本機設定；不需移除擴充功能。

## 狀態文字自動帶入

在「設定 → 狀態自動帶入」修改八種狀態的預設文字，離開欄位即自動儲存，下次開啟狀態動作時生效。留白可停用單一狀態，另提供總開關及恢復預設文字。
預設文字沒有「流程說明補登」前綴。空白或純 $SERVICESTATUSNOTE 會替換為對應文字；保留已輸入內容，送出前可再修改。
本功能不自行按 Save。原本快速改狀態的前置流程若需儲存，仍沿用 1.1.4 的原生操作行為。
此版本沒有透過 Halo API key 改狀態的功能，自動帶入不需要 API key。

## AI（選用）

AI 憑證由各使用者自行設定，不使用 AI 也能使用狀態自動帶入。
Azure OpenAI：在「AI 服務」填入自己的 Endpoint、Deployment 與 API Key。
自架 Ornith：在解壓資料夾的 PowerShell 執行以下命令，將範例換成自己的 HTTPS 主機，再重新載入擴充功能並填寫 AI 設定。

    .\\scripts\\Configure-Ornith.ps1 -Origin 'https://ai.example.com'

## 分享及支援範圍

本包不包含個人 API key、瀏覽器設定備份、工單資料或私人 AI 主機設定。
需要 Chromium 122 以上。預設支援 halopsa.com、haloitsm.com、halocrm.com、haloservicedesk.com 子網域；自訂網域需調整 manifest。
這是可解壓載入的 ZIP，非商店簽署套件；公司瀏覽器政策可能限制載入未封裝項目。
版本及基底資訊見 release-info.json；變更及驗證限制見 RELEASE-NOTES.md。
'''
    (stage / 'README.md').write_text(readme, encoding='utf-8')
    (stage / '安裝說明.txt').write_text(readme, encoding='utf-8-sig')
    notes = f'''# {version} · 2026-11-13

- 新增八種狀態的預設文字自動帶入，可在設定頁修改、停用或恢復預設。
- 修正 Halo 新增動作被當成歷史紀錄跳過；支援 $SERVICESTATUSNOTE 佔位文字替換。
- 修正工作台「設定」入口：改成直接開啟設定頁，避免背景訊息失敗造成無反應；連結在擴充功能連線失效時仍可使用。
- 以原掛載 1.1.4 為基底，未加入主線的 Halo API 操作功能。
- 分享包移除私人 AI 主機權限，每位使用者可自行設定 AI。

驗證：狀態辨識／內容保護、設定入口、設定保存及原生流程等待測試通過；ZIP 解壓及 manifest 資源完整性通過。
已在內建瀏覽器以正式程式碼及模擬擴充功能環境驗證入口、失效連線及設定保存；實際 Halo 新動作 DOM 結構已確認。
內建瀏覽器無法替代 Edge 的正式擴充功能載入測試；未對正式工單按 Save。更新後需重新載入擴充功能及重新整理 Halo 分頁。
'''
    (stage / 'RELEASE-NOTES.md').write_text(notes, encoding='utf-8')
    metadata = {'version': version, 'baselineVersion': '1.1.4',
                'builtAt': datetime.now(timezone(timedelta(hours=8))).isoformat(),
                'sourceRuntimeSha256': source_digest.hexdigest(),
                'sourceIncludesLocalChanges': True, 'personalHostPermissionsRemoved': True}
    (stage / 'release-info.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    forbidden = [r'[a-z0-9.-]+\.ts\.net', r'[A-Z]:[\\/]Users[\\/]', r'freedom\.halopsa\.com',
                 r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY', r'\bAKIA[A-Z0-9]{16}\b',
                 r'\bsk-[a-zA-Z0-9_-]{24,}', r'\beyJ[\w-]{15,}\.[\w-]{15,}\.[\w-]{15,}',
                 r'''\b\w*(?:apiKey|clientSecret|access_token)\w*\s*[:=]\s*['"][A-Za-z0-9_+/=-]{24,}['"]''']
    for candidate in stage.rglob('*'):
        if candidate.is_file() and candidate.suffix.lower() in {'.js', '.html', '.css', '.svg', '.json', '.md', '.txt', '.ps1'}:
            content = candidate.read_text(encoding='utf-8-sig')
            assert not any(re.search(p, content, re.I) for p in forbidden), f'Private marker in {candidate.relative_to(stage)}'
    files = sorted(p for p in stage.rglob('*') if p.is_file())
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for candidate in files:
            bundle.write(candidate, candidate.relative_to(stage).as_posix())
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None
        assert 'manifest.json' in bundle.namelist()
        assert not any(Path(n).is_absolute() or '..' in Path(n).parts for n in bundle.namelist())
        bundle.extractall(verify)
    for candidate in files:
        assert candidate.read_bytes() == (verify / candidate.relative_to(stage)).read_bytes()
    shutil.copy2(ROOT / 'scripts/verify-manifest.js', verify / 'scripts/verify-manifest.js')
    subprocess.run(['node', str(verify / 'scripts/verify-manifest.js')], check=True)
    subprocess.run(['node', '--test', 'tests/status-notes.test.js', 'tests/settings-launch.test.js'],
                   cwd=ROOT, env={**os.environ, 'HPX_TEST_ROOT': str(verify)}, check=True)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (OUTPUT / (archive.name + '.sha256')).write_text(f'{digest}  {archive.name}\n', encoding='ascii')
    print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size, 'files': len(files), 'sha256': digest}, ensure_ascii=False))
finally:
    for folder in (stage, verify):
        assert folder.parent == OUTPUT and folder.name.startswith(('stage-', 'verify-'))
        shutil.rmtree(folder)
