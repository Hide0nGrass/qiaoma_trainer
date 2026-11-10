// 截图：收藏面板 / 错题本面板
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9348, profile: '.chrome-cdp14', url: 'http://127.0.0.1:8788/' });
await c.sleep(1200);

// 收藏两手，方便看列表
for (let i = 0; i < 2; i++) {
  await c.evaluate("document.getElementById('saveFav').click(); 1");
  await c.sleep(180);
  if (i === 0) {
    await c.evaluate("__mj.startRound(__mj.nextSeed()); 1");
    await c.sleep(420);
  }
}
await c.evaluate("document.getElementById('favBtn').click(); 1");
await c.sleep(300);
await c.screenshot('shot-favs.png');
await c.evaluate("document.getElementById('favClose').click(); 1");
await c.sleep(200);

// 打一张差的，进错题本
await c.evaluate(`(() => {
  const s = __mj.state;
  const cands = __mj.analyzeHand(s.hand);
  const worst = cands[cands.length - 1];
  const idx = s.hand.indexOf(worst.tile);
  document.querySelectorAll('#hand .tile')[idx].click();
  return 1;
})()`);
await c.sleep(1500);
await c.evaluate("document.getElementById('mistakeBtn').click(); 1");
await c.sleep(320);
await c.screenshot('shot-mistakes.png');

console.log('favs', await c.evaluate("__mj.state.favs.length"));
console.log('errors', c.logs);
await c.close();
