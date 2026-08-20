#!/usr/bin/env python3
"""Capture screenshots of all main-window pages after login (window already swapped)."""
import asyncio, base64, json, os, time, urllib.request
import websockets

PORT = 9222
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'screenshots', 'ui-verify')
os.makedirs(OUT, exist_ok=True)
CONSOLE_ERRORS = []
_msg_id = 0

def fetch_json(url):
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read().decode('utf-8'))

async def send(ws, method, params=None):
    global _msg_id
    _msg_id += 1
    mid = _msg_id
    await ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
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
    if 'exceptionDetails' in res:
        return 'JS-ERROR: ' + str(res['exceptionDetails'].get('exception', {}).get('description', ''))[:300]
    return res.get('result', {}).get('value')

async def main():
    target = None
    for _ in range(20):
        try:
            pages = [t for t in fetch_json(f'http://localhost:{PORT}/json') if t.get('type') == 'page']
            if pages:
                target = pages[0]
                break
        except Exception:
            pass
        time.sleep(0.5)
    if not target:
        raise SystemExit('no CDP page target found')
    print('attached to:', target.get('url'))

    async with websockets.connect(target['webSocketDebuggerUrl'], max_size=100 * 1024 * 1024) as ws:
        await send(ws, 'Runtime.enable')
        await send(ws, 'Page.enable')
        print('hash:', await evaljs(ws, 'location.hash'))
        await drain(ws, 3)
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

        # back to documents; open the new-document dialog
        await evaljs(ws, "location.hash = '#/main/documents'; 'ok'")
        await drain(ws, 2)
        opened = await evaljs(ws, """
        (() => {
          const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('وثيقة جديدة'));
          if (b) { b.click(); return 'clicked'; }
          return 'not-found';
        })()
        """)
        print('new-doc dialog:', opened)
        await drain(ws, 2)
        await shot(ws, '13-document-form')

        # close dialog via إلغاء, then open the first document's details
        await evaljs(ws, """
        (() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes('إلغاء')); if (b) b.click(); return 'ok'; })()
        """)
        await drain(ws, 1.5)
        opened = await evaljs(ws, """
        (() => {
          const card = document.querySelector('app-document-card mat-card, app-document-card .mat-mdc-card, app-document-card');
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
