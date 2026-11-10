/** 用 CDP 驱动无头 Chrome 做交互自测 + 截图（无 puppeteer 依赖） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const outAbs = path.resolve(process.argv[2] || 'shot-e2e.png');
const url = process.argv[3] || 'http://127.0.0.1:8788/';
const keepOpen = process.argv[4] === '--keep';
const cwd = process.cwd();

const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-crash-reporter',
  '--hide-scrollbars', '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(cwd, '.chrome-cdp')}`,
  url,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('devtools not ready');
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    return;
  }
  if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) {
    logs.push(`[${m.params.entry.level}] ${m.params.entry.text}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
};

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

// 等应用就绪
for (let i = 0; i < 40; i++) {
  const ok = await evaluate('Boolean(window.__mj && window.__mj.state.hand.length)');
  if (ok) break;
  await sleep(150);
}

const before = await evaluate(`(() => {
  const s = window.__mj.state;
  return {
    hand: s.hand.length,
    river: s.river.length,
    inDom: document.querySelectorAll('#hand .tile').length,
    meta: document.getElementById('shantenInfo').textContent,
    wall: s.wall.length,
    seed: s.seed,
  };
})()`);
console.log('initial', JSON.stringify(before));

// 点击第一张牌：判定必须同步完成
const click1 = await evaluate(`(() => {
  const el = document.querySelector('#hand .tile');
  const t0 = performance.now();
  el.click();
  return {
    ms: Math.round((performance.now() - t0) * 10) / 10,
    badge: document.getElementById('badge').textContent,
    headline: document.getElementById('headline').textContent,
    metrics: [...document.querySelectorAll('#metrics .metric')].map(m => m.textContent),
    coach: document.getElementById('coachText').textContent.slice(0, 60),
  };
})()`);
console.log('click', JSON.stringify(click1));

await sleep(700);
const afterDraw = await evaluate(`(() => {
  const s = window.__mj.state;
  return {
    hand: s.hand.length,
    inDom: document.querySelectorAll('#hand .tile').length,
    river: document.getElementById('river').children.length,
    drawn: document.querySelectorAll('#hand .tile.drawn').length,
    meta: document.getElementById('shantenInfo').textContent,
    badge: document.getElementById('badge').textContent,
  };
})()`);
console.log('afterDraw', JSON.stringify(afterDraw));

// 等 AI 首字/全文
let coachMeta = '';
for (let i = 0; i < 60; i++) {
  coachMeta = await evaluate("document.getElementById('coachMeta').textContent");
  if (/DeepSeek|未连通|本地分析/.test(coachMeta)) break;
  await sleep(150);
}
const coachText = await evaluate("document.getElementById('coachText').textContent");
console.log('coachMeta', coachMeta);
console.log('coachText', coachText);

// 连打三张，验证状态机稳定
for (let k = 0; k < 3; k++) {
  await evaluate("document.querySelector('#hand .tile').click()");
  await sleep(650);
}
const after3 = await evaluate(`(() => {
  const s = window.__mj.state;
  return { hand: s.hand.length, river: s.river.length, judged: s.judged, done: s.done, badge: document.getElementById('badge').textContent };
})()`);
console.log('after3', JSON.stringify(after3));

// 截图（打了几张的状态）
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(outAbs, Buffer.from(shot.data, 'base64'));
console.log('shot', outAbs, fs.statSync(outAbs).size);

// 空格新局
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))`);
await sleep(400);
const afterSpace = await evaluate(`(() => {
  const s = window.__mj.state;
  return { hand: s.hand.length, river: s.river.length, round: s.roundNo, judged: s.judged };
})()`);
console.log('afterSpace', JSON.stringify(afterSpace));

console.log('consoleErrors', logs.length ? JSON.stringify(logs) : 'none');

ws.close();
if (!keepOpen) {
  child.kill();
  process.exit(0);
}
