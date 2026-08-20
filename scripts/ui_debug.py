#!/usr/bin/env python3
"""Debug: inspect stylesheet loading and login state in the running app."""
import asyncio, json, time, urllib.request
import websockets

PORT = 9222
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
        raw = await asyncio.wait_for(ws.recv(), timeout=30)
        msg = json.loads(raw)
        if msg.get('id') == mid:
            return msg.get('result', {})

async def evaljs(ws, expr):
    res = await send(ws, 'Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True})
    if 'exceptionDetails' in res:
        return 'JS-ERROR: ' + str(res['exceptionDetails'])[:400]
    return res.get('result', {}).get('value')

async def main():
    targets = fetch_json(f'http://localhost:{PORT}/json')
    page = [t for t in targets if t.get('type') == 'page'][0]
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=100*1024*1024) as ws:
        await send(ws, 'Runtime.enable')
        print('URL:', await evaljs(ws, 'location.href'))
        print('hash:', await evaljs(ws, 'location.hash'))
        print('stylesheets:', await evaljs(ws, """
          [...document.styleSheets].map(s => ({href: s.href, rules: (() => { try { return s.cssRules.length } catch(e) { return 'BLOCKED: '+e.name } })()}))
        """))
        print('link tags:', await evaljs(ws, "[...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href)"))
        print('card bg:', await evaljs(ws, """
          (() => { const c = document.querySelector('.login-card') || document.querySelector('form'); if (!c) return 'no card'; const cs = getComputedStyle(c); return {bg: cs.backgroundColor, radius: cs.borderRadius, padding: cs.padding, cls: c.className}; })()
        """))
        print('mat-icon font:', await evaljs(ws, """
          (() => { const i = document.querySelector('mat-icon'); if (!i) return 'no icon'; return getComputedStyle(i).fontFamily; })()
        """))
        print('fonts loaded:', await evaljs(ws, "[...document.fonts].map(f => f.family + ':' + f.status)"))
        print('toast/error:', await evaljs(ws, "document.querySelector('.toast, .error-box, [class*=error]')?.textContent?.trim()?.slice(0,200) || 'none'"))

asyncio.run(main())
