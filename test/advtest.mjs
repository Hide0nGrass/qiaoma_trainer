import { connect } from './cdp-lib.mjs';
const c = await connect({ port: 9392, profile: '.chrome-cdp52', url: 'http://127.0.0.1:8788/' });
await c.sleep(1200);
const wall = Array.from({ length: 40 }, (_, i) => 12 + (i % 15));
const show = async (label) => console.log(label, '→', await c.evaluate("document.getElementById('advice').textContent.replace(/\\s+/g,' ')"));

// 碰碰胡：111 222 333 555 m + 4m + 9p（打 9p 听 4m）
await c.evaluate(`window.__mj.setHand(${JSON.stringify([0,0,0,1,1,1,2,2,2,4,4,4,3,17])}, ${JSON.stringify(wall)}); 1`);
await c.sleep(300);
await show('碰碰胡');
await c.screenshot('shot-advice-hold.png');

// 七对：11 22 33 44 55 66 m + 7m + 9p
await c.evaluate(`window.__mj.setHand(${JSON.stringify([0,0,2,2,4,4,6,6,9,9,12,12,6,17])}, ${JSON.stringify(wall)}); 1`);
await c.sleep(300);
await show('七对');

// 普通：123456789m 11p 23p 5s
await c.evaluate(`window.__mj.setHand(${JSON.stringify([0,1,2,3,4,5,6,7,8,9,9,10,11,22])}, ${JSON.stringify(wall)}); 1`);
await c.sleep(300);
await show('普通');
await c.screenshot('shot-advice-now.png');
console.log('errors', c.logs);
await c.close();
