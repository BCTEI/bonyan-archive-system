#!/usr/bin/env python3
"""Reproduce the top-secret multi-PDF display/print failure.
Logs in, issues a verification code for admin, opens the top-secret document
م.ب/7/14 (3 PDF attachments), passes the security modal, inspects the dialog's
attachment list, then triggers print (window.print hooked) and watches timing."""
import asyncio, base64, json, os, time, urllib.request, sys
import websockets

PORT = 9222
OUT = os.path.join('screenshots', 'ui-verify')
os.makedirs(OUT, exist_ok=True)
CONSOLE = []
_msg_id = 0

def fetch_json(url):
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read().decode('utf-8'))

async def send(ws, method, params=None, timeout=30):
    global _msg_id
    _msg_id += 1
    mid = _msg_id
    await ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        if msg.get('id') == mid:
            return msg.get('result', {})
        handle_event(msg)

def handle_event(msg):
    m = msg.get('method', '')
    if m == 'Runtime.exceptionThrown':
        d = msg['params']['exceptionDetails']
        CONSOLE.append('EXCEPTION: ' + str(d.get('text')) + ' ' + str((d.get('exception') or {}).get('description', ''))[:400])
    elif m == 'Runtime.consoleAPICalled' and msg['params']['type'] in ('error', 'warning'):
        args = ' '.join(str(a.get('value', a.get('description', '')))[:200] for a in msg['params']['args'])
        CONSOLE.append(msg['params']['type'] + ': ' + args)

def p(x):
    sys.stdout.buffer.write((json.dumps(x, ensure_ascii=False) + '\n').encode('utf-8'))
    sys.stdout.buffer.flush()

async def evaljs(ws, expr, timeout=60):
    res = await send(ws, 'Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True}, timeout=timeout)
    if 'exceptionDetails' in res:
        return 'JS-ERROR: ' + str(res['exceptionDetails'].get('exception', {}).get('description', ''))[:500]
    return res.get('result', {}).get('value')

async def shot(ws, name):
    res = await send(ws, 'Page.captureScreenshot', {'format': 'png'})
    open(os.path.join(OUT, name + '.png'), 'wb').write(base64.b64decode(res['data']))
    p('saved ' + name)

async def get_page(url_part):
    for _ in range(40):
        try:
            pages = [t for t in fetch_json(f'http://localhost:{PORT}/json') if t.get('type') == 'page']
            hit = [t for t in pages if url_part in t.get('url', '')]
            if hit: return hit[0]
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit('no page target: ' + url_part)

async def main():
    page = await get_page('/login')
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=100*1024*1024) as ws:
        await send(ws, 'Runtime.enable')
        await send(ws, 'Page.enable')
        await asyncio.sleep(2)
        p(await evaljs(ws, """
          (() => {
            const setVal = (el, v) => {
              const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
            };
            const inputs = document.querySelectorAll('input');
            setVal(inputs[0], 'admin'); setVal(inputs[1], 'admin123');
            const btn = [...document.querySelectorAll('button')].find(x => x.textContent.includes('تسجيل الدخول'));
            btn.click(); return 'login-clicked';
          })()
        """))
        await asyncio.sleep(1)

    page = await get_page('/main')
    p({'main': page['url']})
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=100*1024*1024) as ws:
        await send(ws, 'Runtime.enable')
        await send(ws, 'Page.enable')
        await asyncio.sleep(3)

        # issue a verification code for the admin user (id 1) via IPC
        code = await evaljs(ws, """
          (async () => {
            const me = await window.electronAPI.getCurrentUser();
            const userId = (me.user || me).id;
            const r = await window.electronAPI.securityAPI.generateCode(userId);
            return r;
          })()
        """)
        p({'generateCode': code})
        code_value = code.get('code') if isinstance(code, dict) else None
        if not code_value:
            p('FATAL: no code issued')
            return

        await evaljs(ws, "location.hash = '#/main/documents'; 'ok'")
        await asyncio.sleep(2.5)

        # open the top-secret document 7/14
        p(await evaljs(ws, """
          (() => {
            const card = [...document.querySelectorAll('app-document-card')].find(c => c.textContent.includes('7/14'));
            if (!card) return 'card-not-found';
            card.querySelector('button[mat-icon-button]').click();
            return 'menu-opened';
          })()
        """))
        await asyncio.sleep(1)
        p(await evaljs(ws, """
          (() => {
            const item = [...document.querySelectorAll('.mat-mdc-menu-panel button')].find(x => x.textContent.includes('عرض'));
            if (!item) return 'item-not-found';
            item.click(); return 'view-clicked';
          })()
        """))
        await asyncio.sleep(2)

        # security modal: password step
        p({'modal': await evaljs(ws, "document.querySelector('app-security-modal') ? 'open' : 'not-found'")})
        p(await evaljs(ws, """
          (() => {
            const dlg = document.querySelector('app-security-modal');
            if (!dlg) return 'no-modal';
            const input = dlg.querySelector('input[type="password"], input');
            const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            s.call(input, 'admin123');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const btn = [...dlg.querySelectorAll('button')].find(x => x.textContent.includes('تأكيد'));
            btn.click(); return 'password-submitted';
          })()
        """))
        await asyncio.sleep(2.5)
        # code step
        p(await evaljs(ws, f"""
          (() => {{
            const dlg = document.querySelector('app-security-modal');
            if (!dlg) return 'modal-gone';
            const input = dlg.querySelector('input');
            if (!input) return 'no-input';
            const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            s.call(input, '{code_value}');
            input.dispatchEvent(new Event('input', {{ bubbles: true }}));
            const btn = [...dlg.querySelectorAll('button')].find(x => x.textContent.includes('تأكيد'));
            if (!btn) return 'no-confirm-btn';
            btn.click(); return 'code-submitted';
          }})()
        """))
        await asyncio.sleep(4)

        # dialog should now show the document with 3 attachments
        p({'dialog': await evaljs(ws, "document.querySelector('app-document-view') ? 'open' : 'not-open'")})
        p({'attachment chips': await evaljs(ws, "[...document.querySelectorAll('app-document-view .attachment-chip')].map(e => e.textContent.trim().slice(0,70))")})
        p({'attachments count label': await evaljs(ws, """
          (() => { const el = [...document.querySelectorAll('app-document-view *')].find(e => e.textContent.match(/\\d+ ملفات/)); return el ? el.textContent.trim().slice(0,40) : 'not-found'; })()
        """)})
        await shot(ws, '19-topsecret-docview')

        # hook print and trigger it
        p(await evaljs(ws, """
          (() => {
            const origOpen = window.open;
            window.__printWin = null; window.__printCalled = false;
            window.open = (...a) => {
              const w = origOpen.apply(window, a);
              window.__printWin = w;
              try { w.print = () => { window.__printCalled = true; }; } catch(e) {}
              return w;
            };
            const dlg = document.querySelector('app-document-view');
            const btn = [...dlg.querySelectorAll('button')].find(b => b.querySelector('mat-icon')?.textContent.trim() === 'print');
            if (!btn) return 'print-btn-not-found';
            btn.click(); return 'print-clicked';
          })()
        """))
        t0 = time.time()
        last = None
        for i in range(90):
            await asyncio.sleep(2)
            last = await evaljs(ws, """
              (() => {
                const w = window.__printWin;
                if (!w) return {state: 'no-window'};
                try {
                  const sheets = w.document ? w.document.querySelectorAll('.sheet').length : -1;
                  return {state: sheets > 0 ? 'ready' : 'blank', sheets,
                          imgs: w.document ? w.document.images.length : -1,
                          printCalled: !!window.__printCalled,
                          mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) + 'MB' : 'n/a'};
                } catch (e) { return {state: 'err', e: String(e)}; }
              })()
            """, timeout=10)
            p({'t': int(time.time() - t0), **(last if isinstance(last, dict) else {'raw': last})})
            if isinstance(last, dict) and last.get('printCalled'):
                break
            if not isinstance(last, dict):
                break

    p('--- console errors/warnings ---')
    for e in CONSOLE[:20]:
        p(e)
    if not CONSOLE:
        p('(none)')

asyncio.run(main())
