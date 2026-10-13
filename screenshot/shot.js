// Screenshot a page with headless Chrome, optionally outlining elements in red.
// Usage: node shot.js <url> <out.jpg|png> [--sel "<css>"] [--text "<visible text>"] [--crop N] [--mobile] [--full] [--width N] [--height N]
//   --sel   outline every element matching the CSS selector; scroll the first into view
//   --text  outline the first occurrence of this text, case-insensitive (works on view-source: URLs too)
//   --crop  capture only N px above and below the highlight (full width)
// No dependencies: drives Chrome over the DevTools protocol (Node 22+ for global WebSocket).
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i < 0 ? null : args.splice(i, 2)[1]; };
const flag = (k) => { const i = args.indexOf(k); return i < 0 ? false : (args.splice(i, 1), true); };
const sel = opt('--sel'), text = opt('--text'), crop = +(opt('--crop') || 0), mobile = flag('--mobile'), full = flag('--full');
const width = +(opt('--width') || (mobile ? 390 : 1440)), height = +(opt('--height') || (mobile ? 844 : 900));
const [url, out] = args;
if (!url || !out) { console.error('usage: node shot.js <url> <out.jpg|png> [--sel css] [--text str] [--mobile] [--full]'); process.exit(1); }

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(100); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = {}, events = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } else events.push(m.method);
  });
  const send = (method, params = {}) => new Promise((r) => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })); })
    .then((m) => { if (m.error) throw new Error(`${method}: ${m.error.message}`); return m.result; });
  const run = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  await send('Page.navigate', { url });
  for (let i = 0; i < 300 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
  await sleep(2500); // let lazy images, sliders and popups settle

  const found = await run(`(() => {
    let els = [];
    ${sel ? `els = [...document.querySelectorAll(${JSON.stringify(sel)})];` : ''}
    const wrap = document.querySelector('input[type=checkbox]'); // view-source: tick "wrap" so long lines fit
    if (${JSON.stringify(url.startsWith('view-source:'))} && wrap && !wrap.checked) wrap.click();
    ${text ? `const t = ${JSON.stringify(text.toLowerCase())};
      // Box the exact text first: wrap its first occurrence in a span.
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) {
        const i = n.data.toLowerCase().indexOf(t);
        if (i < 0) continue;
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length);
        const s = document.createElement('span'); s.style.cssText = 'display:inline-block;padding:0 2px';
        r.surroundContents(s); els.push(s); break;
      }
      // Text split across elements: fall back to the smallest element containing it.
      if (!els.length) els = [...document.querySelectorAll('body *')].filter(e => e.offsetParent !== null && e.textContent.toLowerCase().includes(t))
        .filter((e, _, a) => !a.some(o => o !== e && e.contains(o))).slice(0, 5);` : ''}
    els.forEach(e => { e.style.outline = '4px solid #e00'; e.style.outlineOffset = '3px'; });
    if (els[0]) { els[0].setAttribute('data-shot', ''); els[0].scrollIntoView({ block: 'center' }); }
    return els.length;
  })()`);
  if ((sel || text) && !found) console.warn('warning: nothing matched --sel/--text; screenshot taken without highlight');
  await sleep(500);

  const jpg = /\.jpe?g$/i.test(out);
  const shot = { format: jpg ? 'jpeg' : 'png', captureBeyondViewport: full };
  if (jpg) shot.quality = 80;
  if (crop && found) { // only the band around the highlight, full width
    const r = await run(`(() => { const b = document.querySelector('[data-shot]')?.getBoundingClientRect(); return b && { y: b.top + scrollY, h: b.height }; })()`);
    if (r) shot.clip = { x: 0, y: Math.max(0, r.y - crop), width, height: r.h + 2 * crop, scale: 1 };
    shot.captureBeyondViewport = true;
  } else if (full) {
    const h = await run('document.documentElement.scrollHeight');
    shot.clip = { x: 0, y: 0, width, height: Math.min(h, 16000), scale: 1 };
  }
  fs.writeFileSync(out, Buffer.from((await send('Page.captureScreenshot', shot)).data, 'base64'));
  console.log(`${out} (${found} highlighted)`);
  ws.close();
})().catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500); });
