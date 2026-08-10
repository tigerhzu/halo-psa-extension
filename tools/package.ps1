<#
.SYNOPSIS
    打包可上架 / 可安裝的擴充功能 zip，只包含 runtime 檔案。

.DESCRIPTION
    來源是 `git archive HEAD`，不是掃描檔案系統——未提交的實驗檔案因此不可能混進 release。
    排除清單由 .gitattributes 的 export-ignore 決定（tools/、tests/、.claude/、AGENTS.md…）。

    壓縮完成後會做兩道出貨前檢查，任何一道失敗就刪除 zip 並以非零結束：
      1. 封存內只能有 manifest.json、src/、assets/
      2. manifest.json 引用的每個路徑都必須真的存在於封存內

    無外部相依，不需要 npm。

.PARAMETER AllowDirty
    允許工作目錄有未提交變更時打包。預設不允許：git archive 取的是 HEAD，
    工作目錄的修改不會進 zip，靜默的不一致正是最該避免的失敗模式。

.EXAMPLE
    pwsh tools/package.ps1
    pwsh tools/package.ps1 -AllowDirty
#>
[CmdletBinding()]
param(
    [switch]$AllowDirty
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    # ── 1. 工作目錄必須乾淨 ────────────────────────────────────────────────
    $dirty = git status --porcelain
    if ($dirty -and -not $AllowDirty) {
        Write-Host '工作目錄有未提交的變更：' -ForegroundColor Red
        $dirty | ForEach-Object { Write-Host "  $_" }
        Write-Host ''
        Write-Host 'git archive 打包的是 HEAD，上列變更不會進 zip。' -ForegroundColor Yellow
        Write-Host '請先 commit，或用 -AllowDirty 明確接受這個落差。' -ForegroundColor Yellow
        exit 1
    }

    # ── 2. 產生封存 ────────────────────────────────────────────────────────
    $manifest = Get-Content 'manifest.json' -Raw | ConvertFrom-Json
    $version = $manifest.version
    $distDir = Join-Path $root 'dist'
    $zipPath = Join-Path $distDir "halo-psa-extension-$version.zip"

    if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    git archive --format=zip --output=$zipPath HEAD
    if ($LASTEXITCODE -ne 0) { throw "git archive 失敗（exit $LASTEXITCODE）" }

    # ── 3. 檢查封存內容 ────────────────────────────────────────────────────
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entries = @($zip.Entries | Where-Object { -not $_.FullName.EndsWith('/') } | ForEach-Object { $_.FullName })
    } finally {
        $zip.Dispose()
    }

    # 3a. 白名單：只允許 manifest.json / src/ / assets/
    $violations = @($entries | Where-Object {
        $_ -ne 'manifest.json' -and -not $_.StartsWith('src/') -and -not $_.StartsWith('assets/')
    })
    if ($violations.Count -gt 0) {
        Remove-Item $zipPath -Force
        Write-Host '封存包含非 runtime 檔案，已刪除 zip：' -ForegroundColor Red
        $violations | ForEach-Object { Write-Host "  $_" }
        Write-Host ''
        Write-Host '請在 .gitattributes 補上對應的 export-ignore。' -ForegroundColor Yellow
        exit 1
    }

    # 3b. manifest 引用的路徑都必須在封存內
    $referenced = New-Object System.Collections.Generic.List[string]
    $referenced.Add($manifest.background.service_worker)
    $referenced.Add($manifest.options_ui.page)
    $manifest.icons.PSObject.Properties | ForEach-Object { $referenced.Add($_.Value) }
    if ($manifest.action.PSObject.Properties.Name -contains 'default_icon') {
        $manifest.action.default_icon.PSObject.Properties | ForEach-Object { $referenced.Add($_.Value) }
    }
    foreach ($cs in $manifest.content_scripts) {
        if ($cs.PSObject.Properties.Name -contains 'js')  { $cs.js  | ForEach-Object { $referenced.Add($_) } }
        if ($cs.PSObject.Properties.Name -contains 'css') { $cs.css | ForEach-Object { $referenced.Add($_) } }
    }
    foreach ($war in $manifest.web_accessible_resources) {
        $war.resources | ForEach-Object { $referenced.Add($_) }
    }

    $entrySet = [System.Collections.Generic.HashSet[string]]::new([string[]]$entries)
    $missing = @($referenced | Sort-Object -Unique | Where-Object { -not $entrySet.Contains($_) })
    if ($missing.Count -gt 0) {
        Remove-Item $zipPath -Force
        Write-Host 'manifest.json 引用的檔案不在封存內，已刪除 zip：' -ForegroundColor Red
        $missing | ForEach-Object { Write-Host "  $_" }
        exit 1
    }

    # ── 4. 摘要 ────────────────────────────────────────────────────────────
    $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    $srcCount = @($entries | Where-Object { $_.StartsWith('src/') }).Count
    $assetCount = @($entries | Where-Object { $_.StartsWith('assets/') }).Count

    Write-Host ''
    Write-Host "✅ $zipPath" -ForegroundColor Green
    Write-Host "   版本 $version｜$($entries.Count) 個檔案（src $srcCount、assets $assetCount、manifest 1）｜$sizeMB MB"
    Write-Host "   已驗證：無 dev 檔案、manifest 引用完整（$($referenced.Count) 筆）"
    Write-Host ''
}
finally {
    Pop-Location
}
