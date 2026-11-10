/** 极简 CDP 客户端：启动无头 Chrome，返回 {send, evaluate, screenshot, close, logs} */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect({ port = 9334, url = 'http://127.0.0.1:8788/', profile = '.chrome-cdp' } = {}) {
  const cwd = process.cwd();
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-crash-reporter',
    '--hide-scrollbars', '--window-size=1440,900',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(cwd, profile)}`,
    url,
  ], { stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* not ready */ }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('devtools not ready');

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
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      logs.push('[log] ' + m.params.entry.text);
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
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }

  async function screenshot(file) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const abs = path.resolve(file);
    fs.writeFileSync(abs, Buffer.from(shot.data, 'base64'));
    return abs;
  }

  async function close() {
    try { ws.close(); } catch { /* ignore */ }
    child.kill();
  }

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');

  return { send, evaluate, screenshot, close, logs, sleep };
}
