"""Exercise the unpacked extension against a local Halo fixture with Python Playwright."""
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
fixture = '<main><h1>Tickets</h1><label>Internal note <textarea class="hpx-target">Draft</textarea></label></main>'
with tempfile.TemporaryDirectory() as profile, sync_playwright() as pw:
    context = pw.chromium.launch_persistent_context(profile, headless=True, channel='chromium',
        executable_path=os.environ.get('CHROME_PATH') or pw.chromium.executable_path,
        args=[f'--disable-extensions-except={root}', f'--load-extension={root}'])
    try:
        worker = next(iter(context.service_workers), None) or context.wait_for_event('serviceworker')
        ext = worker.url.split('/')[2]
        options = context.new_page()
        options.goto(f'chrome-extension://{ext}/src/options/options.html')
        select = options.locator('#workspaceMode')
        expect(select).to_have_value('standard')
        worker.evaluate("chrome.storage.local.set({hpx_settings:{theme:'cute-ios',ultimateMode:true,petHidden:true,onboardingVersion:99}})")
        options.reload()
        expect(options.locator('#ultimateMode')).to_be_checked()
        select.select_option('quiet')
        expect(options.locator('#themeStatus')).to_contain_text('已自動套用')
        options.reload()
        expect(select).to_have_value('quiet')
        page = context.new_page()
        page.route('https://fixture.halopsa.com/**', lambda route: route.fulfill(content_type='text/html; charset=utf-8', body=fixture))
        page.goto('https://fixture.halopsa.com/tickets')
        html = page.locator('html')
        # Quiet keeps the toolbar and tools; only the native-page skin is off.
        expect(html).to_have_attribute('data-hpx-quiet', 'on')
        expect(page.locator('.hpx-sidebar-controls')).to_have_count(1)
        expect(page.locator('.hpx-toolbar')).to_have_count(1)
        quiet = page.locator('[data-hpx-sidebar-control="quiet"]')
        expect(quiet).to_have_attribute('aria-pressed', 'true')
        page.locator('textarea').fill('Keep my draft')
        page.evaluate("window.__hpxNoReload = true")
        quiet.click()
        expect(html).not_to_have_attribute('data-hpx-quiet', 'on')
        expect(quiet).to_have_attribute('aria-pressed', 'false')
        expect(page.locator('textarea')).to_have_value('Keep my draft')
        assert page.evaluate("window.__hpxNoReload === true"), 'quiet toggle must not reload the page'
        expect(html).to_have_attribute('data-hpx-ultimate-mode', 'on')
        expect(html).to_have_attribute('data-hpx-theme', 'cute-ios')
        options.reload()
        expect(select).to_have_value('standard')
        print('PASS: quiet persists, toolbar and tools stay mounted, live toggle keeps drafts without reload, settings stay in sync.')
    finally:
        context.close()
