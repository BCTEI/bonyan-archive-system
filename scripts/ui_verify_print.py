#!/usr/bin/env python3
"""Verify attachment printing: open the PDF-carrying document, check the dialog
lists its attachment, then trigger print with window.print hooked (no OS dialog)
and inspect the generated print document."""
import asyncio, base64, json, os, time, urllib.request, sys
import websockets

PORT = 9222
OUT = os.path.join('screenshots', 'ui-verify')
os.makedirs(OUT, exist_ok=True)
CONSOLE_ERRORS = []
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
        CONSOLE_ERRORS.append('EXCEPTION: ' + str(d.get('text')) + ' ' + str((d.get('exception') or {}).get('description', ''))[:400])
    elif m == 'Runtime.consoleAPICalled' and msg['params']['type'] in ('error', 'warning'):
        args = ' '.join(str(a.get('value', a.get('description', '')))[:200] for a in msg['params']['args'])
        CONSOLE_ERRORS.append(msg['params']['type'] + ': ' + args)

def p(x):
    sys.stdout.buffer.write((json.dumps(x, ensure_ascii=False) + '\n').encode('utf-8'))

async def evaljs(ws, expr, timeout=30):
    res = await send(ws, 'Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True}, timeout=timeout)
    if 'exceptionDetails' in res:
        return 'JS-ERROR: ' + str(res['exceptionDetails'].get('exception', {}).get('description', ''))[:500]
    return res.get('result', {}).get('value')

async def shot(ws, name):
    res = await send(ws, 'Page.captureScreenshot', {'format': 'png'})
    open(os.path.join(OUT, name + '.png'), 'wb').write(base64.b64decode(res['data']))
    p('saved ' + name)

async def get_page(url_part=None):
    for _ in range(30):
        try:
            pages = [t for t in fetch_json(f'http://localhost:{PORT}/json') if t.get('type') == 'page']
            if url_part:
                hit = [t for t in pages if url_part in t.get('url', '')]
                if hit: return hit[0]
            elif pages:
                return pages[0]
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit('no page target')

async def main():
    page = await get_page('/login') if '/login' in str(fetch_json(f'http://localhost:{PORT}/json')) else await get_page()
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=100*1024*1024) as ws:
        await send(ws, 'Runtime.enable')
        await send(ws, 'Page.enable')
        await asyncio.sleep(2)
        if '/login' in page['url'] or True:
            p(await evaljs(ws, """
              (() => {
                const setVal = (el, v) => {
                  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                  s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
                };
                const inputs = document.querySelectorAll('input');
                if (inputs.length < 2) return 'no-inputs';
                setVal(inputs[0], 'admin'); setVal(inputs[1], 'admin123');
                const btn = [...document.querySelectorAll('button')].find(x => x.textContent.includes('تسجيل الدخول'));
                if (!btn) return 'btn-not-found';
                btn.click(); return 'clicked';
              })()
            """))
        await asyncio.sleep(1)

    # re-attach to the main window
    page = await get_page('/main')
    p({'main': page['url']})
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=100*1024*1024) as ws:
        await send(ws, 'Runtime.enable')
        await send(ws, 'Page.enable')
        await asyncio.sleep(3)
        await evaljs(ws, "location.hash = '#/main/documents'; 'ok'")
        await asyncio.sleep(2.5)

        # open the card menu for the document whose ref contains 6/173
        p(await evaljs(ws, """
          (() => {
            const cards = [...document.querySelectorAll('app-document-card')];
            const card = cards.find(c => c.textContent.includes('6/173'));
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
        await asyncio.sleep(3)
        p({'attachments in dialog': await evaljs(ws, """
          (() => {
            const dlg = document.querySelector('app-document-view');
            if (!dlg) return 'no-dialog';
            const chips = [...dlg.querySelectorAll('.attachment-chip, [class*=attachment]')].map(e => e.textContent.trim().slice(0,60));
            return chips;
          })()
        """)})
        await shot(ws, '16-docview-with-attachments')

        # hook window.open so print() never opens the OS dialog
        p(await evaljs(ws, """
          (() => {
            const origOpen = window.open;
            window.__printWin = null;
            window.open = (...a) => {
              const w = origOpen.apply(window, a);
              window.__printWin = w;
              try { w.print = () => { window.__printCalled = true; }; } catch(e) { window.__printHookError = String(e); }
              return w;
            };
            return 'hooked';
          })()
        """))
        # click the print button in the dialog
        p(await evaljs(ws, """
          (() => {
            const dlg = document.querySelector('app-document-view');
            const btn = [...dlg.querySelectorAll('button')].find(b => b.querySelector('mat-icon')?.textContent.trim() === 'print');
            if (!btn) return 'print-btn-not-found';
            btn.click(); return 'print-clicked';
          })()
        """))
        # wait for pdf.js render + document.write (2.9MB PDF, allow generous time)
        result = None
        for _ in range(30):
            await asyncio.sleep(1)
            result = await evaljs(ws, """
              (() => {
                const w = window.__printWin;
                if (!w) return {state: 'no-print-window'};
                try {
                  const sheets = w.document ? w.document.querySelectorAll('.sheet').length : -1;
                  if (!sheets) return {state: 'waiting', sheets};
                  return {
                    state: 'ready',
                    sheets,
                    imgs: w.document.images.length,
                    imgSizes: [...w.document.images].map(i => i.naturalWidth + 'x' + i.naturalHeight),
                    pdfSheets: w.document.querySelectorAll('.p2-frame.has-content').length,
                    placeholders: [...w.document.querySelectorAll('.p2-placeholder p')].map(x => x.textContent.slice(0,60)),
                    printCalled: !!window.__printCalled,
                    hookError: window.__printHookError || null
                  };
                } catch (e) { return {state: 'err', e: String(e)}; }
              })()
            """)
            if isinstance(result, dict) and result.get('state') == 'ready':
                break
        p({'print window': result})

    # attach to the print window target (about:blank) and screenshot it
    try:
        pw = await get_page('about:blank')
        async with websockets.connect(pw['webSocketDebuggerUrl'], max_size=100*1024*1024) as ws2:
            await send(ws2, 'Page.enable')
            await asyncio.sleep(1)
            await shot(ws2, '17-print-preview')
    except SystemExit:
        p('print window target not found for screenshot')

    p('--- console errors/warnings ---')
    for e in CONSOLE_ERRORS[:15]:
        p(e)
    if not CONSOLE_ERRORS:
        p('(none)')

asyncio.run(main())
