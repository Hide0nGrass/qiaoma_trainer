/** 页面内直接跑一次 /api/coach 流，逐事件记时（用于定位前端流式问题） */
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9334 });
try {
  await c.sleep(800);
  const result = await c.evaluate(`(async () => {
    const hand = window.__mj.state.hand.map(t => ['一','二','三','四','五','六','七','八','九'][t%9] + ['万','筒','条'][(t/9)|0]);
    const body = {
      handText: hand.join(' '),
      discard: hand[2],
      shanten: 1, ukeire: 15, kinds: 5,
      verdictText: '正确',
      bestText: '三条(20张)',
      waitsText: '',
      fallback: '本地兜底文案',
    };
    const t0 = performance.now();
    const res = await fetch('/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', text = '', first = 0, n = 0, marks = [], doneEv = null;
    const t = () => Math.round(performance.now() - t0);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\\n\\n')) >= 0) {
        const pkt = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = pkt.split('\\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.t) { if (!first) first = t(); text += ev.t; marks.push(t()); n++; }
        if (ev.done) { doneEv = ev; doneEv.at = t(); }
      }
    }
    return { first, total: t(), chunks: n, marks, doneEv, text };
  })()`);
  console.log(JSON.stringify(result, null, 1));
} finally {
  await c.close();
}
