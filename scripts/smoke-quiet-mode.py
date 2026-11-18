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
        expect(options.locator('#themeStatus')).to_contain_text('已儲存')
        options.reload()
        expect(select).to_have_value('quiet')
        page = context.new_page()
        page.route('https://fixture.halopsa.com/**', lambda route: route.fulfill(content_type='text/html; charset=utf-8', body=fixture))
        page.goto('https://fixture.halopsa.com/tickets')
        button = page.get_by_role('button', name='啟用本頁工具')
        expect(button).to_be_visible()
        expect(page.locator('html')).not_to_have_attribute('data-hpx-theme', 'cute-ios')
        expect(page.locator('.hpx-toolbar,.hpx-sidebar-controls')).to_have_count(0)
        page.locator('textarea').fill('Keep my draft')
        button.focus()
        page.keyboard.press('Enter')
        expect(page.locator('#hpx-quiet-dock [role=status]')).to_have_text('本頁工具已開啟')
        expect(page.locator('.hpx-toolbar')).to_have_count(1)
        expect(page.get_by_role('link', name='設定')).to_be_focused()
        expect(page.locator('textarea')).to_have_value('Keep my draft')
        page.evaluate("document.querySelector('main').innerHTML='<label>Note <textarea class=hpx-target></textarea></label>'")
        expect(page.locator('.hpx-toolbar')).to_have_count(1)
        page.reload()
        expect(button).to_be_visible()
        expect(page.locator('.hpx-toolbar')).to_have_count(0)
        with context.expect_page() as opened:
            page.get_by_role('link', name='設定').click()
        reopened = opened.value
        expect(reopened.locator('#workspaceMode')).to_have_value('quiet')
        reopened.locator('#workspaceMode').select_option('standard')
        expect(reopened.locator('#themeStatus')).to_contain_text('已儲存')
        page.reload()
        expect(page.locator('.hpx-sidebar-controls')).to_have_count(1)
        expect(page.locator('html')).to_have_attribute('data-hpx-ultimate-mode','on')
        expect(page.locator('html')).to_have_attribute('data-hpx-theme','cute-ios')
        expect(page.locator('#hpx-quiet-dock')).to_have_count(0)
        print('PASS: mode persists, keyboard activation, draft retention, SPA remount, reload, settings link, standard theme and simple navigation restored.')
    finally:
        context.close()
