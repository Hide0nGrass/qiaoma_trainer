/** 构造「退向听」场景，验证 metrics 不再把不同向听的进张数放在一起比 */
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9338, profile: '.chrome-cdp6' });
try {
  for (let i = 0; i < 40; i++) {
    if (await c.evaluate('Boolean(window.__mj)')) break;
    await c.sleep(150);
  }
  // 123456789万 + 11筒 23筒 5条：听 1筒/4筒/5条，拆 2筒 会退向听
  const hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 10, 11, 22];
  const wall = Array.from({ length: 40 }, (_, i) => 12 + (i % 15));
  await c.evaluate(`window.__mj.setHand(${JSON.stringify(hand)}, ${JSON.stringify(wall)})`);
  await c.sleep(150);

  const idx = await c.evaluate(`window.__mj.state.hand.indexOf(10)`);
  console.log('discard index', idx, await c.evaluate('document.getElementById("hand").children.length'));
  await c.evaluate(`document.querySelectorAll('#hand .tile')[${idx}].click()`);
  await c.sleep(120);
  console.log('badge', await c.evaluate("document.getElementById('badge').textContent"));
  console.log('headline', await c.evaluate("document.getElementById('headline').textContent"));
  console.log('metrics', await c.evaluate("document.getElementById('metrics').textContent"));
  console.log('local', await c.evaluate("document.getElementById('coachText').textContent"));
  console.log('errors', JSON.stringify(c.logs));
} finally {
  await c.close();
}

