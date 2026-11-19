// 静态版 AI：访客自己的 key 直接连模型商（BYOK），没有 key 就退回同源 /api/*
// 返回的 Response 与服务端 SSE 完全同格式：data: {"t":"..."} / {"done":true} / {"fallback":true}
import { SYSTEM_PROMPT, buildUserPrompt, READ_SYSTEM_PROMPT, buildReadPrompt } from '../prompts.mjs';

const CFG_KEY = 'qiaoma.ai.v1';

export function getAICfg() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && c.base && c.key ? c : null;
  } catch {
    return null;
  }
}

export function setAICfg(cfg) {
  try {
    if (cfg && cfg.base && cfg.key) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CFG_KEY);
  } catch {
    /* 隐私模式下写不进去，忽略 */
  }
}

export function aiConfigured() {
  return !!getAICfg();
}

/**
 * 把一次 AI 请求变成「服务端同格式的 SSE Response」。
 * byob：有本地 key → 浏览器直连；否则打到 /api/*（本地开发或自建服务器）。
 */
export async function aiFetch(path, payload, signal) {
  const cfg = getAICfg();
  if (!cfg) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  }
  const isRead = path === '/api/read';
  const system = isRead ? READ_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const user = isRead ? buildReadPrompt(payload) : buildUserPrompt(payload);

  const enc = new TextEncoder();
  const started = Date.now();
  let firstAt = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const push = (obj) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* 已关闭 */
        }
      };
      try {
        await callProvider(cfg, system, user, signal, (text) => {
          if (!firstAt) firstAt = Date.now();
          push({ t: text });
        });
        push({ done: true, ms: Date.now() - started, first: firstAt || started });
        controller.close();
      } catch (err) {
        if (signal?.aborted) {
          try { controller.close(); } catch { /* noop */ }
          return;
        }
        push({ t: payload?.fallback || '', fallback: true, error: String(err?.message || err) });
        push({ done: true, ms: Date.now() - started, failed: true });
        try { controller.close(); } catch { /* noop */ }
      }
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function callProvider(cfg, system, user, signal, onDelta) {
  const base = String(cfg.base).replace(/\/$/, '');
  const proto = cfg.proto === 'openai' ? 'openai' : 'anthropic';
  const model = cfg.model || (proto === 'openai' ? 'deepseek-chat' : 'claude-3-5-haiku-latest');

  const url = proto === 'openai' ? `${base}/chat/completions` : `${base}/v1/messages`;
  const headers =
    proto === 'openai'
      ? { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` }
      : {
          'content-type': 'application/json',
          'x-api-key': cfg.key,
          'anthropic-version': '2023-06-01',
          // 浏览器直连 Anthropic 官方接口需要这个头
          'anthropic-dangerous-direct-browser-access': 'true',
        };
  const body =
    proto === 'openai'
      ? {
          model,
          stream: true,
          max_tokens: 160,
          temperature: 0.3,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }
      : {
          model,
          stream: true,
          max_tokens: 160,
          temperature: 0.3,
          system,
          messages: [{ role: 'user', content: user }],
        };

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${detail.slice(0, 160)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(raw); } catch { continue; }
      const text =
        proto === 'openai'
          ? ev.choices?.[0]?.delta?.content || ''
          : ev.type === 'content_block_delta' ? ev.delta?.text || '' : '';
      if (text) onDelta(text);
    }
  }
}
