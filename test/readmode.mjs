// 摇铃模式（M1）：模式切换、发牌、摸打循环、他敲、看牌、整局结束
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9405, profile: '.chrome-cdp65', url: 'http://127.0.0.1:8788/' });
await c.sleep(1100);
const out = [];
const ok = (name, cond, extra = '') => out.push([name, !!cond, extra]);

// 1. 两种模式都在，默认拆搭
let s = JSON.parse(await c.evaluate(`JSON.stringify({
  train: !!document.getElementById('modeTrain'),
  read: !!document.getElementById('modeRead'),
  trainState: document.getElementById('modeTrain').classList.contains('on'),
  readHidden: document.getElementById('readArea').hidden,
})`));
ok('默认是拆搭模式', s.train && s.read && s.trainState && s.readHidden, JSON.stringify(s));

// 2. 切到摇铃
await c.evaluate("document.getElementById('modeRead').click(); 1");
await c.sleep(700);
s = JSON.parse(await c.evaluate(`JSON.stringify({
  area: document.getElementById('readArea').hidden,
  trainHidden: document.getElementById('trainArea').hidden,
  coachHidden: document.getElementById('coach').hidden,
  my: document.getElementById('rdHand').children.length,
  his: document.getElementById('oppHand').children.length,
  wall: __mjRead().wall.length,
  body: document.body.classList.contains('mode-read'),
})`));
ok('切换后只显示摇铃', !s.area && s.trainHidden && s.coachHidden && s.body, JSON.stringify(s));
ok('发牌 14 / 对手 13 / 牌墙 81', s.my === 14 && s.his === 13 && s.wall === 81, JSON.stringify(s));

// 3. 打一张 → 他跟着摸打
const before = JSON.parse(await c.evaluate(`JSON.stringify({ wall: __mjRead().wall.length, his: __mjRead().hisRiver.length, my: __mjRead().myRiver.length })`));
await c.evaluate("document.querySelector('#rdHand .tile').click(); 1");
await c.sleep(900);
const after = JSON.parse(await c.evaluate(`JSON.stringify({ wall: __mjRead().wall.length, his: __mjRead().hisRiver.length, myRiver: __mjRead().myRiver.length, my: __mjRead().my.length, turn: __mjRead().turn, hand: document.getElementById('rdHand').children.length })`));
ok('我出牌进牌河', after.myRiver === before.my + 1, JSON.stringify(after));
ok('他跟着摸打（牌墙 -2）', after.wall === before.wall - 2, `${before.wall} → ${after.wall}`);
ok('他打出的牌进他的牌河', after.his === before.his + 1, JSON.stringify(after));
ok('轮回到我，手牌 14 张', after.turn === 'me' && after.my === 14 && after.hand === 14, JSON.stringify(after));

// 4. 看他的手牌
await c.evaluate("document.getElementById('cheatBtn').click(); 1");
await c.sleep(250);
const cheat = JSON.parse(await c.evaluate(`JSON.stringify({
  on: document.getElementById('cheatBtn').classList.contains('on'),
  faces: [...document.getElementById('oppHand').children].filter(e => e.dataset.tile).length,
})`));
ok('看牌开关显示 13 张明牌', cheat.on && cheat.faces === 13, JSON.stringify(cheat));
await c.evaluate("document.getElementById('cheatBtn').click(); 1");
await c.sleep(200);

// 5. 一直打到他敲（固定种子，结果可复现）
await c.evaluate('__mjReadStart(20240301)');
await c.sleep(500);
let knocked = false;
for (let i = 0; i < 26 && !knocked; i++) {
  knocked = await c.evaluate('__mjRead().knocked');
  if (knocked) break;
  await c.evaluate("document.querySelector('#rdHand .tile').click(); 1");
  await c.sleep(750);
}
const kn = JSON.parse(await c.evaluate(`JSON.stringify({
  knocked: __mjRead().knocked, frozen: __mjRead().frozen.length, tag: document.getElementById('rdTag').textContent,
})`));
ok('他会敲且手牌冻结 13 张', kn.knocked && kn.frozen === 13, JSON.stringify(kn));
ok('敲的标记出现在状态栏', /已敲/.test(kn.tag), kn.tag);

// 6. 敲之后他不再换牌（摸什么打什么）
const f0 = await c.evaluate('JSON.stringify(__mjRead().frozen)');
await c.evaluate("document.querySelector('#rdHand .tile').click(); 1");
await c.sleep(900);
const f1 = await c.evaluate('JSON.stringify(__mjRead().frozen)');
ok('敲后手牌不再变化', f0 === f1, `${f0.slice(0, 20)}…`);

// 7. 打到整局结束
for (let i = 0; i < 40; i++) {
  const over = await c.evaluate('__mjRead().over');
  if (over) break;
  await c.evaluate("document.querySelector('#rdHand .tile').click(); 1");
  await c.sleep(650);
}
const end = JSON.parse(await c.evaluate(`JSON.stringify({
  over: __mjRead().over, result: __mjRead().result,
  overlay: document.getElementById('readOver').hidden, title: document.getElementById('roTitle').textContent,
})`));
ok('一局能自然结束并弹结果', end.over && !end.overlay && end.title.length > 0, JSON.stringify(end));

// 8. 空格开新局
await c.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); 1`);
await c.sleep(500);
const nr = JSON.parse(await c.evaluate(`JSON.stringify({
  over: __mjRead().over, my: __mjRead().my.length, wall: __mjRead().wall.length,
  round: document.getElementById('rdRound').textContent, overlay: document.getElementById('readOver').hidden,
})`));
ok('空格开新局并清掉结果', !nr.over && nr.my === 14 && nr.wall === 81 && nr.overlay, JSON.stringify(nr));

// 9. 切回拆搭，状态还在
await c.evaluate("document.getElementById('modeTrain').click(); 1");
await c.sleep(400);
const back = JSON.parse(await c.evaluate(`JSON.stringify({
  area: document.getElementById('readArea').hidden,
  coach: document.getElementById('coach').hidden,
  hand: document.getElementById('hand').children.length,
})`));
ok('切回拆搭恢复原界面', back.area && !back.coach && back.hand === 14, JSON.stringify(back));

const errors = c.logs.filter((l) => l.type === 'error' || /Uncaught/.test(l.text || ''));
ok('无控制台错误', errors.length === 0, JSON.stringify(errors).slice(0, 200));

for (const [name, pass, extra] of out) console.log(pass ? '  ok  ' : '  FAIL', name, pass ? '' : extra);
const failed = out.filter((x) => !x[1]);
console.log(`\n${failed.length ? 'FAILED' : 'PASS'} ${out.length - failed.length}/${out.length}`);
await c.close();
process.exit(failed.length ? 1 : 0);
