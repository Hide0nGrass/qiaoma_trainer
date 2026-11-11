import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8788);
const HOST = '127.0.0.1';

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
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('forbidden'); return; }
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
const SYSTEM_PROMPT = [
  '你是"敲麻"（108张：万筒条各1-9，无字牌；4面子+1将，另计七对）的拆搭教练。',
  '用户刚打完一张牌，系统已经算好判定和最优解；你要做的是讲清"为什么"，',
  '不要复述结论词（对/不对），直接说原因。输出两句、总共不超过 80 个汉字：',
  '第一句说这一手在向听和进张上的影响，第二句说最优那张为什么更好。',
  '判定分四级：最优 / 优 / 次优 / 退向听。最优和优都不算错，不要说"不对"。',
  '最优 = 一阶最好而且同分里后续改良最多；优 = 一阶和最优完全等价，只是后续改良略少。',
  '判为最优时：只讲它好在哪，不要推荐别的牌。判为优时：讲清"现在和最优一模一样，差别在后面"。',
  '严格服从给出的计算结果：只用题目里出现的数字，不要自己另算，不要推翻结论，',
  '不要比较不同向听下的进张数；向听已经退步时只讲向听退步，不要再评价进张变宽变窄。',
  '不要臆造手牌结构：你看不到面子怎么拆，禁止断言某处是刻子、顺子、两面搭、边张搭；',
  '只依据给出的向听、进张张数与种数来解释，可以说"进张更宽/更窄""向听退了一步"。',
  '不要客套、不要列表、不要复述全部手牌。',
].join('');

function buildUserPrompt(p) {
  const lines = [
    `手牌(14张)：${p.handText}`,
    `打出：${p.discard}`,
    `打后：${p.shanten}向听，有效进张${p.ukeire}张(${p.kinds}种)`,
    `系统判定：${p.verdictText}`,
  ];
  if (p.verdict === 'best') {
    lines.push(`这一手是最优解（${p.shanten}向听、进张${p.ukeire}张），不要再推荐别的牌。`);
    if (p.tied > 1 && p.impr != null) {
      lines.push(`同向听同进张的还有别的打法，但它们能改良的张数更少（这一手改良 ${p.impr} 张）。`);
    }
    if (p.waitsText) lines.push(`听牌：${p.waitsText}`);
    lines.push('请用两句说明它为什么是全部选择里最好的。');
    return lines.join('\n');
  }
  if (p.verdict === 'good') {
    lines.push(`这一手和最优的「打${p.bestText}」一阶完全等价：都是 ${p.shanten} 向听、进张 ${p.ukeire} 张，所以不算错。`);
    if (p.impr != null && p.bestImpr != null) {
      lines.push(`差别在后面：留${p.bestText}能多 ${p.bestImpr - p.impr} 张改良（它 ${p.bestImpr} 张、这一手 ${p.impr} 张）。`);
    }
    if (p.waitsText) lines.push(`听牌：${p.waitsText}`);
    lines.push('请用两句说明：现在为什么一样，差别又在哪里。');
    return lines.join('\n');
  }
  if (p.verdict === 'wrong' && p.bestShanten < p.shanten) {
    const keep = p.bestShanten === 0 ? '直接听牌' : `保持${p.bestShanten}向听`;
    lines.push(`最优解：打${p.bestText}可以${keep}（打这张退了一步，这就是判错的原因）`);
  } else {
    lines.push(`最优解：打${p.bestText}，${p.bestShanten}向听、进张${p.bestUkeire}张`);
  }
  if (p.waitsText) lines.push(`听牌：${p.waitsText}`);
  lines.push('请解释这一手的逻辑。');
  return lines.join('\n');
}

const memo = new Map();
const MEMO_MAX = 300;

function sse(res, obj) {
  try {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  } catch {
    /* 客户端已断开，忽略 */
  }
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

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.on('error', () => { /* 断连时不崩 */ });

  const userPrompt = buildUserPrompt(payload);
  const cached = memo.get(userPrompt);
  if (cached) {
    sse(res, { t: cached, cached: true });
    sse(res, { done: true, ms: 0 });
    res.end();
    return;
  }

  if (!CFG.apiKey) {
    sse(res, { t: payload.fallback, fallback: true });
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
        system: SYSTEM_PROMPT,
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
      sse(res, { t: full ? '' : payload.fallback, fallback: !full, error: String(err?.message || err) });
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
  if (url.pathname === '/engine.mjs' || url.pathname === '/opponent.mjs' || url.pathname === '/read.mjs') {
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
