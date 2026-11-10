/** 可视化三件套截图：结构色带 / 悬停预览 / 进张牌墙 */
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9343, profile: '.chrome-cdp11' });
try {
  for (let i = 0; i < 60; i++) {
    if (await c.evaluate('Boolean(window.__mj && window.__mj.state.hand.length)')) break;
    await c.sleep(150);
  }

  // 1) 结构色带：桌面 + 手牌局部放大
  console.log('shot1', await c.screenshot('shot-struct.png'));

  const box = await c.evaluate(`(() => {
    const h = document.querySelector('.hand-stage').getBoundingClientRect();
    return { x: Math.max(0, h.left - 24), y: Math.max(0, h.top - 40), width: h.width + 48, height: h.height + 60 };
  })()`);
  const clip = await c.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 2 } });
  const fs = await import('node:fs');
  fs.writeFileSync('shot-struct-zoom.png', Buffer.from(clip.data, 'base64'));

  // 2) 悬停预览：找一张「次优/错误」的牌悬停，更像教学场景
  const target = await c.evaluate(`(() => {
    const a = __mj.analyzeHand(__mj.state.hand);
    const best = a[0];
    const worst = a[a.length - 1];
    const t = a.find((x) => x.shanten === best.shanten && x.ukeire < best.ukeire) || worst;
    return { idx: __mj.state.hand.indexOf(t.tile), tile: t.tile };
  })()`);
  const r = await c.evaluate(`(() => {
    const el = document.querySelectorAll('#hand .tile')[${target.idx}];
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, button: 'none' });
  await c.sleep(400);
  console.log('preview hidden?', await c.evaluate("document.getElementById('preview').hidden"));
  console.log('preview text', await c.evaluate("document.getElementById('preview').textContent"));
  console.log('shot2', await c.screenshot('shot-hover.png'));

  // 3) 进张牌墙：打一张次优的牌，等 AI 说完
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, button: 'none' });
  await c.evaluate(`document.querySelectorAll('#hand .tile')[${target.idx}].click()`);
  await c.sleep(500);
  for (let i = 0; i < 40; i++) {
    const m = await c.evaluate("document.getElementById('coachMeta').textContent");
    if (!/组织语言|正在想/.test(m)) break;
    await c.sleep(200);
  }
  console.log('wall rows', await c.evaluate("document.getElementById('tilewall').children.length"));
  console.log('wall text', await c.evaluate("document.getElementById('tilewall').textContent"));
  console.log('shot3', await c.screenshot('shot-wall.png'));

  await c.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 880, deviceScaleFactor: 2, mobile: true });
  await c.sleep(600);
  console.log('shot4', await c.screenshot('shot-wall-mobile.png'));
  await c.send('Emulation.clearDeviceMetricsOverride', {});

  console.log('errors', JSON.stringify(c.logs));
} finally {
  await c.close();
}
