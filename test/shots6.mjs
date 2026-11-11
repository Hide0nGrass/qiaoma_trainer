// 摇铃模式截图：正常对局 / 他敲之后 / 看牌模式
import { writeFileSync } from 'node:fs';
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9407, profile: '.chrome-cdp67', url: 'http://127.0.0.1:8788/' });
await c.sleep(1100);
await c.evaluate("document.getElementById('modeRead').click(); 1");
await c.sleep(400);
await c.evaluate('__mjReadStart(20240301)');
await c.sleep(500);

async function shoot(name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(name, Buffer.from(r.data, 'base64'));
  console.log('shot', name);
}

async function discard() {
  await c.evaluate("document.querySelector('#rdHand .tile').click(); 1");
  await c.sleep(780);
}

// 打到第 3 手：两边的牌河都有东西
for (let i = 0; i < 3; i++) await discard();
await shoot('shot-read-1.png');

// 打到他敲
for (let i = 0; i < 26; i++) {
  if (await c.evaluate('__mjRead().knocked')) break;
  await discard();
}
await c.sleep(400);
await shoot('shot-read-2.png');

// 看牌
await c.evaluate("document.getElementById('cheatBtn').click(); 1");
await c.sleep(300);
await shoot('shot-read-3.png');

const st = await c.evaluate(`JSON.stringify({ knocked: __mjRead().knocked, frozen: __mjRead().frozen.length, turnNo: __mjRead().turnNo })`);
console.log('state', st);
console.log('errors', c.logs.filter((l) => l.type === 'error'));
await c.close();
