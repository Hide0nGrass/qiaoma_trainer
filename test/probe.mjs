/** 端到端探针：静态资源 + 点评接口时延 */
const BASE = 'http://127.0.0.1:8788';

async function get(p) {
  const r = await fetch(BASE + p);
  const text = await r.text();
  return { status: r.status, type: r.headers.get('content-type'), size: text.length, head: text.slice(0, 80) };
}

const files = ['/', '/app.js', '/engine.mjs', '/tiles.js', '/style.css'];
for (const f of files) {
  const r = await get(f);
  console.log(f.padEnd(12), r.status, String(r.size).padStart(6), r.type, '|', r.head.replace(/\n/g, ' ').slice(0, 50));
}

const health = await (await fetch(BASE + '/api/health')).json();
console.log('health', JSON.stringify(health));

const payload = {
  handText: '二万 三万 四万 六万 七万 九万 一筒 二筒 三筒 五筒 五筒 三条 四条 七条',
  discard: '九万',
  shanten: 2,
  ukeire: 18,
  kinds: 7,
  verdictText: '次优',
  bestText: '七条(24张)',
  waitsText: '',
  fallback: '打九万，次优。向听没退（2 向听），但有效进张只有 18 张，比最佳少 6 张。',
};

const t0 = Date.now();
const res = await fetch(BASE + '/api/coach', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
console.log('coach status', res.status, res.headers.get('content-type'));

const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '', out = '', first = 0, done = null, fb = false;
while (true) {
  const { done: d, value } = await reader.read();
  if (d) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const pkt = buf.slice(0, i); buf = buf.slice(i + 2);
    const line = pkt.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const ev = JSON.parse(line.slice(5));
    if (ev.fallback) fb = true;
    if (ev.t) { if (!first) first = Date.now() - t0; out += ev.t; }
    if (ev.done) done = ev;
  }
}
console.log('first token ms', first, '| total ms', Date.now() - t0, '| fallback', fb);
console.log('done event', JSON.stringify(done));
console.log('text>>', out);
