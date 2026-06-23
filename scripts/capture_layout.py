#!/usr/bin/env python3
"""Capture screenshots of the app-shell sidebar toggle for visual verification."""

import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request
import websockets

PORT = 9222
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCREENSHOT_DIR = os.path.join(ROOT, 'screenshots')
os.makedirs(SCREENSHOT_DIR, exist_ok=True)


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read().decode('utf-8'))


_msg_id = 0

async def send(ws, method: str, params=None):
    global _msg_id
    _msg_id += 1
    sent_id = _msg_id
    msg = {'id': sent_id, 'method': method, 'params': params or {}}
    await ws.send(json.dumps(msg))
    while True:
        raw = await ws.recv()
        data = json.loads(raw)
        if data.get('id') == sent_id:
            return data
        # ignore events


async def capture(ws, filename: str):
    result = await send(ws, 'Page.captureScreenshot')
    data = result.get('result', {}).get('data')
    if not data:
        print(f'Failed to capture {filename}:', result)
        return
    path = os.path.join(SCREENSHOT_DIR, filename)
    with open(path, 'wb') as f:
        f.write(base64.b64decode(data))
    print(f'Saved {path}')


async def drain_console(ws, timeout=1.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=0.2)
            data = json.loads(raw)
            if data.get('method') == 'Runtime.consoleAPICalled':
                print('CONSOLE:', data.get('params', {}).get('type'), [a.get('value') for a in data.get('params', {}).get('args', [])])
            elif data.get('method') == 'Runtime.exceptionThrown':
                print('EXCEPTION:', data)
        except asyncio.TimeoutError:
            pass


async def wait_for_page(predicate, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        try:
            pages = fetch_json(f'http://127.0.0.1:{PORT}/json/list')
            for page in pages:
                if predicate(page):
                    return page['webSocketDebuggerUrl']
        except Exception as e:
            print('Polling pages...', e)
        await asyncio.sleep(0.5)
    raise RuntimeError('Target page not found')


async def main():
    global base64
    import base64

    proc = subprocess.Popen(
        ['./node_modules/.bin/electron', '.', f'--remote-debugging-port={PORT}'],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True
    )

    def log_output():
        for line in proc.stdout:
            print('[Electron]', line.rstrip())

    import threading
    threading.Thread(target=log_output, daemon=True).start()

    try:
        print('Waiting for login window...')
        login_ws_url = await wait_for_page(lambda p: '#/login' in p.get('url', ''))
        print('Login window found')

        async with websockets.connect(login_ws_url) as ws:
            await send(ws, 'Page.enable')
            await send(ws, 'Runtime.enable')
            await asyncio.sleep(1)
            await capture(ws, '00_login.png')

            print('Logging in as admin...')
            login_expr = """
                (async () => {
                    await window.electronAPI.login('admin', 'admin123');
                    return 'logged-in';
                })()
            """
            try:
                # The login window closes on success, so the WS may drop before the response.
                await send(ws, 'Runtime.evaluate', {'expression': login_expr, 'awaitPromise': True})
            except websockets.exceptions.ConnectionClosed:
                pass
            await asyncio.sleep(2)

        print('Waiting for main window...')
        main_ws_url = await wait_for_page(lambda p: '#/main' in p.get('url', '') or '#/login' in p.get('url', ''))
        print('Main window found')

        async with websockets.connect(main_ws_url) as ws:
            await send(ws, 'Page.enable')
            await send(ws, 'Runtime.enable')

            print('Waiting for main page load event...')
            await send(ws, 'Page.reload')
            loaded = False
            while not loaded:
                raw = await ws.recv()
                data = json.loads(raw)
                if data.get('method') == 'Page.loadEventFired':
                    loaded = True
            await asyncio.sleep(2)
            print('Main page loaded, draining console...')
            await drain_console(ws)

            # Inspect DOM
            dom = await send(ws, 'Runtime.evaluate', {
                'expression': "JSON.stringify({ url: location.href, title: document.title, ready: document.readyState, html: document.body.innerHTML.slice(0, 1000), header: !!document.querySelector('app-header'), shell: !!document.querySelector('.shell') })"
            })
            print('DOM:', dom.get('result', {}).get('result', {}).get('value'))

            # Screenshot 1: sidebar open (default on desktop)
            await capture(ws, '01_sidebar_open.png')

            # Toggle sidebar closed via menu button
            await send(ws, 'Runtime.evaluate', {
                'expression': "document.querySelector('.menu-btn')?.click(); 'clicked';"
            })
            await asyncio.sleep(1)
            await capture(ws, '02_sidebar_closed.png')

            # Toggle sidebar open again
            await send(ws, 'Runtime.evaluate', {
                'expression': "document.querySelector('.menu-btn')?.click(); 'clicked';"
            })
            await asyncio.sleep(1)
            await capture(ws, '03_sidebar_reopened.png')

            # Navigate to user management and capture
            await send(ws, 'Runtime.evaluate', {
                'expression': "window.location.hash = '#/main/users'; 'navigated';"
            })
            await asyncio.sleep(2)
            await capture(ws, '05_user_management.png')

            # Open add-user form
            await send(ws, 'Runtime.evaluate', {
                'expression': "document.querySelector('button[mat-raised-button]')?.click(); 'open form';"
            })
            await asyncio.sleep(1)
            await capture(ws, '06_user_form.png')
            # Close dialog
            await send(ws, 'Runtime.evaluate', {
                'expression': "document.querySelector('button.mat-mdc-button')?.click(); 'close dialog';"
            })
            await asyncio.sleep(0.5)

            # Open folder permissions from actions menu
            await send(ws, 'Runtime.evaluate', {
                'expression': "document.querySelector('app-user-management button[mat-icon-button]')?.click(); 'open menu';"
            })
            await asyncio.sleep(1)
            await send(ws, 'Runtime.evaluate', {
                'expression': "const items = [...document.querySelectorAll('.mat-mdc-menu-item')]; const p = items.find(b => b.textContent.includes('صلاحيات')); p?.click(); JSON.stringify({items: items.map(i=>i.textContent), clicked: !!p});"
            })
            await asyncio.sleep(2)
            await capture(ws, '07_folder_permissions.png')
            # Close dialog
            await send(ws, 'Runtime.evaluate', {
                'expression': "document.querySelector('button.mat-mdc-button')?.click(); 'close dialog';"
            })
            await asyncio.sleep(0.5)

            # Simulate mobile width and open overlay
            await send(ws, 'Emulation.setDeviceMetricsOverride', {
                'width': 375,
                'height': 812,
                'deviceScaleFactor': 1,
                'mobile': True
            })
            await asyncio.sleep(1)
            await send(ws, 'Runtime.evaluate', {
                'expression': "window.dispatchEvent(new Event('resize')); document.querySelector('.menu-btn')?.click(); 'mobile open';"
            })
            await asyncio.sleep(1)
            await capture(ws, '04_mobile_sidebar_overlay.png')

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == '__main__':
    asyncio.run(main())
