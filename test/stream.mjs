/** 冷缓存下的流式时延（随机手牌，避免 memo 命中） */
const BASE = 'http://127.0.0.1:8788';

const nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const suits = ['万', '筒', '条'];
function randomHand() {
  const pool = [];
  for (const s of suits) for (const n of nums) for (let k = 0; k < 4; k++) pool.push(n + s);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 14);
}

const hand = randomHand();
const payload = {
  handText: hand.join(' '),
  discard: hand[3],
  shanten: 2, ukeire: 17, kinds: 6,
  verdictText: '次优',
  bestText: '五条(22张)',
  waitsText: '',
  fallback: '打这张，次优。向听没退，但进张少一些。',
};

const t0 = Date.now();
const res = await fetch(BASE + '/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '', out = '', first = 0, marks = [];
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const dt = Date.now() - t0;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const pkt = buf.slice(0, i); buf = buf.slice(i + 2);
    const line = pkt.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const ev = JSON.parse(line.slice(5));
    if (ev.t) { if (!first) first = dt; out += ev.t; marks.push(dt); }
    if (ev.done) console.log('done', JSON.stringify(ev), 'at', dt);
  }
}
console.log('first', first, 'total', Date.now() - t0, 'chunks', marks.length);
console.log('marks', marks.join(','));
console.log('text>>', out);
