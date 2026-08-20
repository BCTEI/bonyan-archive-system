#!/usr/bin/env python3
"""Capture screenshots of the main app pages via CDP for UI verification.

Requires the app running with: electron . --remote-debugging-port=9222
Logs in as admin, then visits each route and saves a PNG per page.
"""

import asyncio
import base64
import json
import os
import time
import urllib.request

import websockets

PORT = 9222
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'screenshots', 'ui-verify')
os.makedirs(OUT, exist_ok=True)

CONSOLE_ERRORS = []


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read().decode('utf-8'))


_msg_id = 0


async def send(ws, method, params=None):
    global _msg_id
    _msg_id += 1
    mid = _msg_id
    await ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=30)
        msg = json.loads(raw)
        if msg.get('id') == mid:
            return msg.get('result', {})
        handle_event(msg)


def handle_event(msg):
    m = msg.get('method', '')
    if m == 'Runtime.exceptionThrown':
        d = msg['params']['exceptionDetails']
        CONSOLE_ERRORS.append('EXCEPTION: ' + str(d.get('text')) + ' ' + str((d.get('exception') or {}).get('description', ''))[:300])
    elif m == 'Runtime.consoleAPICalled' and msg['params']['type'] == 'error':
        args = ' '.join(str(a.get('value', a.get('description', '')))[:200] for a in msg['params']['args'])
        CONSOLE_ERRORS.append('console.error: ' + args)


async def drain(ws, seconds):
    end = time.time() + seconds
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(0.05, end - time.time()))
            handle_event(json.loads(raw))
        except asyncio.TimeoutError:
            break


async def shot(ws, name):
    res = await send(ws, 'Page.captureScreenshot', {'format': 'png'})
    with open(os.path.join(OUT, name + '.png'), 'wb') as f:
        f.write(base64.b64decode(res['data']))
    print('saved', name)


async def evaljs(ws, expr):
    res = await send(ws, 'Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True})
    return res.get('result', {}).get('value')


async def main():
    # find the app page target
    target = None
    for _ in range(20):
        try:
            targets = fetch_json(f'http://localhost:{PORT}/json')
            pages = [t for t in targets if t.get('type') == 'page']
            if pages:
                target = pages[0]
                break
        except Exception:
            pass
        time.sleep(0.5)
    if not target:
        raise SystemExit('no CDP page target found')

    async with websockets.connect(target['webSocketDebuggerUrl'], max_size=100 * 1024 * 1024) as ws:
        await send(ws, 'Runtime.enable')
        await send(ws, 'Page.enable')
        await drain(ws, 3)

        # 1. login page
        await shot(ws, '01-login')

        # fill and submit the login form
        login_js = """
        (() => {
          const setVal = (el, v) => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, v);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          const inputs = document.querySelectorAll('input');
          if (inputs.length < 2) return 'no-inputs';
          setVal(inputs[0], 'admin');
          setVal(inputs[1], 'admin123');
          const btn = [...document.querySelectorAll('button')].find(x => x.textContent.includes('تسجيل الدخول'));
          if (!btn) return 'btn-not-found';
          btn.click();
          return 'submitted';
        })()
        """
        print('login:', await evaljs(ws, login_js))
        await drain(ws, 4)
        await shot(ws, '02-dashboard')

        routes = [
            ('03-documents', '/main/documents'),
            ('04-users', '/main/users'),
            ('05-org-units', '/main/org-units'),
            ('06-document-types', '/main/document-types'),
            ('07-folder-categories', '/main/folder-categories'),
            ('08-security-center', '/main/security'),
            ('09-master-lists', '/main/master-lists'),
            ('10-annual-closing', '/main/annual-closing'),
            ('11-audit', '/main/audit'),
            ('12-profile', '/main/profile'),
        ]
        for name, route in routes:
            await evaljs(ws, f"location.hash = '#{route}'; 'ok'")
            await drain(ws, 2.5)
            await shot(ws, name)

        # open the new-document dialog on the documents page
        await evaljs(ws, "location.hash = '#/main/documents'; 'ok'")
        await drain(ws, 2)
        opened = await evaljs(ws, """
        (() => {
          const btns = [...document.querySelectorAll('button')];
          const b = btns.find(x => x.textContent.includes('وثيقة جديدة'));
          if (b) { b.click(); return 'clicked'; }
          return 'not-found';
        })()
        """)
        print('new-doc dialog:', opened)
        await drain(ws, 2)
        await shot(ws, '13-document-form')

        # close dialog, open first document card details if any
        await evaljs(ws, """
        (() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'إلغاء'); if (b) b.click(); return 'ok'; })()
        """)
        await drain(ws, 1.5)
        opened = await evaljs(ws, """
        (() => {
          const card = document.querySelector('app-document-card mat-card, app-document-card .mat-mdc-card');
          if (!card) return 'no-cards';
          const btn = [...card.querySelectorAll('button')].find(x => x.textContent.includes('عرض'));
          (btn || card).click();
          return 'clicked';
        })()
        """)
        print('doc view:', opened)
        await drain(ws, 2)
        await shot(ws, '14-document-view')

        print('--- console/runtime errors ---')
        for e in CONSOLE_ERRORS:
            print(e)
        if not CONSOLE_ERRORS:
            print('(none)')


asyncio.run(main())
