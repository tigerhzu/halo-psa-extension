"""Build a shareable, credential-free local release using an explicit file allowlist."""
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = (ROOT / 'release').resolve()
OUTPUT.mkdir(exist_ok=True)
manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
assert re.fullmatch(r'\d+\.\d+\.\d+', version)
archive = OUTPUT / f'halo-psa-extension-{version}.zip'
if archive.exists():
    raise SystemExit(f'Release already exists; use a new version or move it aside: {archive.name}')

stage = Path(tempfile.mkdtemp(prefix='stage-', dir=OUTPUT)).resolve()
verify = Path(tempfile.mkdtemp(prefix='verify-', dir=OUTPUT)).resolve()
try:
    allowed_extensions = {'.js', '.html', '.css', '.svg', '.png', '.webp', '.jpg', '.jpeg', '.gif', '.json', '.md'}
    for folder in ('src', 'assets', 'pet'):
        for source in sorted((ROOT / folder).rglob('*')):
            if source.is_symlink():
                raise ValueError(f'Symlinks are not packaged: {source.relative_to(ROOT)}')
            if not source.is_file():
                continue
            if source.suffix.lower() not in allowed_extensions:
                raise ValueError(f'Unexpected runtime file: {source.relative_to(ROOT)}')
            target = stage / source.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    # Personal deployment permission is deliberately replaced only in the release copy.
    manifest['host_permissions'] = ['https://*.openai.azure.com/*', 'https://ornith.example.invalid/*']
    (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for name in ('scripts/Configure-Ornith.ps1', 'docs/HALO-WRITE-API.md'):
        target = stage / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    for pattern in ('LICENSE*', 'NOTICE*', 'COPYING*'):
        for source in ROOT.glob(pattern):
            if source.is_file():
                shutil.copy2(source, stage / source.name)

    readme = f'''# Halo Companion {version}

Chrome / Edge 的 HaloPSA 輔助擴充功能，包含 AI 撰寫、工單閱讀、工時工具與 Halo API 直接開案、改狀態及結案。

## 安裝

1. 將 ZIP 完整解壓縮到固定資料夾；不要直接在 ZIP 內開啟檔案。
2. Chrome 開啟 chrome://extensions；Edge 開啟 edge://extensions。
3. 開啟「開發人員模式」，選「載入未封裝項目」，選取含 manifest.json 的解壓資料夾。
4. 重新整理 Halo 網頁，點擴充功能圖示進入後台。

若更新既有安裝，先備份舊程式及設定，再把新程式解壓覆蓋到原本安裝目錄，按擴充功能的「重新載入」。請保留原安裝位置以沿用瀏覽器本機設定。

## Halo API 設定

到後台「Halo API 與案件」：

1. 填 Resource Server URL，例如 https://company.halopsa.com/api。
2. Halo 原生金鑰選「Halo 原生 API Key（X-Halo-Api-Key）」；Access Token 選 Bearer。若公司指定 X-API-Key，選公司閘道模式並確認公司提供的 API 位址。
3. 勾選「啟用 API 直接操作」，按「儲存連線設定」，允許存取指定主機。
4. 按「測試連線／載入狀態」。測試只讀取狀態，不會修改工單。
5. 結案需選擇自己租戶的結案狀態，填入正確結案 Action ID，再次儲存。

開案件在後台下方填寫。改狀態、結案從工單頁「快速改狀態」執行；按操作按鈕會直接提交。Halo 原生通知與工作流程依租戶設定執行。若遇額外必填自訂欄位，請使用 Halo 原生表單。

完整操作與限制請看 docs/HALO-WRITE-API.md。停用 API 即恢復原生快速狀態流程。

## AI（選用）

AI 與 Halo API 分開設定；不用 AI 也能使用 Halo API。
Azure OpenAI 在後台「AI 服務」填 Endpoint、Deployment 與自己的 API Key。
自架 Ornith 先在 PowerShell 執行下列命令，換成自己的 HTTPS 主機，再重新載入擴充功能並填寫 AI 連線設定：

    .\\scripts\\Configure-Ornith.ps1 -Origin 'https://ai.example.com'

## 分享包說明

- 不包含使用者的 API key、瀏覽器設定備份、正式工單資料、測試資料與私人 AI 主機設定。每位使用者需自行設定憑證。
- Halo API 憑證存於瀏覽器擴充功能的本機儲存，與 AI 金鑰分開；現有設定備份不包含 Halo 連線。
- 需要 Chromium 122 以上；預設支援 halopsa.com、haloitsm.com、halocrm.com、haloservicedesk.com 子網域。自訂網域需調整 manifest 的頁面匹配範圍。
- 這是可載入的 ZIP，不是瀏覽器商店簽署套件。公司管理的瀏覽器可能限制載入未封裝項目。
- 版本與來源 commit 請見 release-info.json。
- 本機自動測試及模擬瀏覽器流程已驗證；沒有使用真實 API key 對正式 Halo 工單執行寫入。
'''
    (stage / 'README.md').write_text(readme, encoding='utf-8')
    (stage / '安裝說明.txt').write_text(readme, encoding='utf-8-sig')
    changelog = (ROOT / 'docs/CHANGELOG.md').read_text(encoding='utf-8')
    notes = re.search(rf'^## {re.escape(version)} · [^\n]+\n.*?(?=^## |\Z)', changelog, re.M | re.S)
    if not notes:
        raise ValueError(f'Missing changelog section for {version}')
    (stage / 'RELEASE-NOTES.md').write_text(notes.group().strip() + '\n', encoding='utf-8')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip()
    metadata = {'version': version, 'builtAt': datetime.now(timezone(timedelta(hours=8))).isoformat(),
                'sourceCommit': head, 'sourceIncludesWorkingTreeChanges': bool(dirty),
                'personalHostPermissionsRemoved': True}
    (stage / 'release-info.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')

    # Fail closed on private endpoint markers and common embedded credential formats.
    forbidden = [r'[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net', r'[A-Z]:[\\/]Users[\\/]', r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY',
                 r'\bAKIA[A-Z0-9]{16}\b', r'\bsk-[a-zA-Z0-9_-]{24,}',
                 r'\beyJ[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9_-]{15,}',
                 r'''\b\w*(?:apiKey|clientSecret|access_token)\w*\s*[:=]\s*['"][A-Za-z0-9_+/=-]{24,}['"]''']
    for candidate in stage.rglob('*'):
        if candidate.is_file() and candidate.suffix.lower() in {'.js', '.html', '.css', '.svg', '.json', '.md', '.txt', '.ps1'}:
            content = candidate.read_text(encoding='utf-8-sig')
            for pattern in forbidden:
                if re.search(pattern, content, re.IGNORECASE):
                    raise ValueError(f'Private data/credential marker in {candidate.relative_to(stage)} (value not printed)')

    files = sorted(p for p in stage.rglob('*') if p.is_file())
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for candidate in files:
            bundle.write(candidate, candidate.relative_to(stage).as_posix())
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None, 'ZIP CRC verification failed'
        assert 'manifest.json' in bundle.namelist()
        assert not any(Path(name).is_absolute() or '..' in Path(name).parts for name in bundle.namelist())
        bundle.extractall(verify)
    for candidate in files:
        assert candidate.read_bytes() == (verify / candidate.relative_to(stage)).read_bytes(), 'Extraction mismatch'
    # Execute the existing manifest verifier against the actual extracted package.
    shutil.copy2(ROOT / 'scripts/verify-manifest.js', verify / 'scripts/verify-manifest.js')
    subprocess.run(['node', str(verify / 'scripts/verify-manifest.js')], cwd=verify, check=True)
    assert json.loads((verify / 'manifest.json').read_text(encoding='utf-8'))['version'] == version
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (OUTPUT / (archive.name + '.sha256')).write_text(f'{digest}  {archive.name}\n', encoding='ascii')
    print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size, 'files': len(files), 'sha256': digest}, ensure_ascii=False))
finally:
    # Only remove the fresh temporary staging directories proven to be under release/.
    for folder in (stage, verify):
        assert folder.parent == OUTPUT and folder.name.startswith(('stage-', 'verify-'))
        shutil.rmtree(folder)
