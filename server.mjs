import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_PROMPT, buildUserPrompt, READ_SYSTEM_PROMPT, buildReadPrompt } from './prompts.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_ROOT = PUBLIC.endsWith(path.sep) ? PUBLIC : PUBLIC + path.sep;

/* ---------------- 配置 ---------------- */
function loadConfig() {
  const defaults = {
    baseUrl: 'http://127.0.0.1:3456',
    apiKey: '',
    model: 'deepseek-flash',
    maxTokens: 140,
    timeoutMs: 20000,
  };
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(ROOT, 'coach.config.json'), 'utf8'));
  } catch { /* 没有配置文件就走环境变量 */ }
  return {
    ...defaults,
    ...file,
    apiKey: process.env.COACH_API_KEY || file.apiKey || '',
    baseUrl: process.env.COACH_BASE_URL || file.baseUrl || defaults.baseUrl,
    model: process.env.COACH_MODEL || file.model || defaults.model,
  };
}
const CFG = loadConfig();

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = decodeURIComponent(rel);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(buf);
  });
}

/* ---------------- 点评 ---------------- */



const memo = new Map();
const MEMO_MAX = 300;

function sse(res, obj) {
  try {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  } catch {
    /* 客户端已断开，忽略 */
  }
}

/* ---------------- 摇铃（读牌）点评 ---------------- */
async function handleReadCoach(req, res) {
  let body;
  try {
    body = await readJson(req, 64 * 1024);
  } catch {
    res.writeHead(400); res.end('bad request'); return;
  }
  const clean = (v, n = 200) => String(v ?? '').slice(0, n);
  const payload = {
    mode: body.mode === 'tile' ? 'tile' : 'answer',
    knockTurn: Number(body.knockTurn) || 0,
    discardsText: clean(body.discardsText, 200),
    tile: clean(body.tile, 8),
    p: Number(body.p) || 0,
    rank: Number(body.rank) || 0,
    kinds: Number(body.kinds) || 27,
    modelDanger: !!body.modelDanger,
    agree: body.agree === true ? true : body.agree === null ? null : false,
    choice: body.choice === 'danger' ? 'danger' : 'safe',
    over: !!body.over,
    shape: clean(body.shape, 24),
    waitKinds: Number(body.waitKinds) || 0,
    waitsText: clean(body.waitsText, 40),
    cluesText: clean(body.cluesText, 200),
    softText: clean(body.softText, 160),
    resultText: clean(body.resultText, 20),
    fallback: clean(body.fallback, 400),
  };
  const userPrompt = buildReadPrompt(payload);
  await runCoach(req, res, READ_SYSTEM_PROMPT, userPrompt, payload.fallback);
}

async function handleCoach(req, res) {
  let body;
  try {
    body = await readJson(req, 64 * 1024);
  } catch {
    res.writeHead(400); res.end('bad request'); return;
  }

  const clean = (v, n = 160) => String(v ?? '').slice(0, n);
  const payload = {
    handText: clean(body.handText, 200),
    discard: clean(body.discard, 16),
    shanten: Number(body.shanten) || 0,
    ukeire: Number(body.ukeire) || 0,
    kinds: Number(body.kinds) || 0,
    verdict: ['best', 'good', 'sub', 'wrong'].includes(body.verdict) ? body.verdict : 'sub',
    verdictText: clean(body.verdictText, 8),
    impr: Number.isFinite(Number(body.impr)) ? Number(body.impr) : null,
    bestImpr: Number.isFinite(Number(body.bestImpr)) ? Number(body.bestImpr) : null,
    tied: Number.isFinite(Number(body.tied)) ? Number(body.tied) : 0,
    bestText: clean(body.bestText, 20),
    bestShanten: Number.isFinite(Number(body.bestShanten)) ? Number(body.bestShanten) : Number(body.shanten),
    bestUkeire: Number(body.bestUkeire) || 0,
    waitsText: clean(body.waitsText, 80),
    fallback: clean(body.fallback, 400),
  };

  const userPrompt = buildUserPrompt(payload);
  await runCoach(req, res, SYSTEM_PROMPT, userPrompt, payload.fallback);
}

async function runCoach(req, res, system, userPrompt, fallback) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.on('error', () => { /* 断连时不崩 */ });

  const cached = memo.get(userPrompt);
  if (cached) {
    sse(res, { t: cached, cached: true });
    sse(res, { done: true, ms: 0 });
    res.end();
    return;
  }

  if (!CFG.apiKey) {
    sse(res, { t: fallback, fallback: true });
    sse(res, { done: true, ms: 0 });
    res.end();
    return;
  }

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
  let closed = false;
  req.on('close', () => { closed = true; ctrl.abort(); });

  let full = '';
  let firstAt = 0;
  try {
    const upstream = await fetch(`${CFG.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': CFG.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CFG.model,
        max_tokens: CFG.maxTokens,
        temperature: 0.3,
        stream: true,
        thinking: { type: 'disabled' },
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      throw new Error('upstream ' + upstream.status);
    }

    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          if (!firstAt) firstAt = Date.now() - started;
          full += ev.delta.text;
          if (!closed) sse(res, { t: ev.delta.text });
        }
      }
    }

    if (!full) throw new Error('empty');
    memo.set(userPrompt, full);
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
    if (!closed) {
      sse(res, { done: true, ms: Date.now() - started, first: firstAt });
      res.end();
    }
  } catch (err) {
    if (!closed) {
      sse(res, { t: full ? '' : fallback, fallback: !full, error: String(err?.message || err) });
      sse(res, { done: true, ms: Date.now() - started, failed: true });
      res.end();
    }
  } finally {
    clearTimeout(timer);
  }
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* ---------------- 路由 ---------------- */
process.on('uncaughtException', (err) => {
  console.error('[guard] uncaught:', err?.message || err);
});
process.on('unhandledRejection', (err) => {
  console.error('[guard] unhandled:', err?.message || err);
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  if (req.method === 'POST' && url.pathname === '/api/read') {
    handleReadCoach(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/coach') {
    handleCoach(req, res).catch(() => { try { res.end(); } catch {} });
    return;
  }
  if (url.pathname === '/api/health') {
    const ok = Boolean(CFG.apiKey);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok, model: CFG.model, gateway: CFG.baseUrl, coach: ok }));
    return;
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  // 牌效引擎在项目根目录，前后端共用同一份
  if (['/engine.mjs', '/opponent.mjs', '/read.mjs', '/prompts.mjs'].includes(url.pathname)) {
    const file = path.join(ROOT, url.pathname.slice(1));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`[mahjong-trainer] http://${HOST}:${PORT}`);
  console.log(`[mahjong-trainer] coach: ${CFG.apiKey ? CFG.model + ' @ ' + CFG.baseUrl : '未配置 API key（仅本地分析）'}`);
});
