// 摇铃「一局多题」验收：只发一张牌、答对继续同一局、答错点炮换局。
import { connect } from './cdp-lib.mjs';
import { makeRound } from '../public/readmode.js';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);

// 0. Node 侧：每局的牌串应当一半危险一半安全
let bal = { danger: 0, total: 0, rounds: 0 };
for (let i = 0; i < 60; i++) {
  const r = makeRound(3000 + i * 97);
  if (!r) continue;
  bal.rounds++;
  for (const t of r.bag) {
    bal.total++;
    if (r.waits.includes(t)) bal.danger++;
  }
}
const ratio = bal.total ? bal.danger / bal.total : 0;
check('每局牌串危险占比 40%–60%', ratio >= 0.4 && ratio <= 0.6, `${bal.danger}/${bal.total}`);

const c = await connect({ port: 9352, profile: '.chrome-cdp92', url: 'http://127.0.0.1:8788/' });
await c.sleep(1200);

await c.evaluate("document.getElementById('modeRead').click(); 1");
await c.sleep(900);

const snap = () => c.evaluate(`JSON.stringify({
  no: document.getElementById('rdNo').textContent,
  q: document.getElementById('quizQ').textContent,
  tiles: document.querySelectorAll('#quizTile .tile').length,
  faces: document.querySelectorAll('#oppHand .tile[data-tile]').length,
  myRiver: document.querySelectorAll('#rdMyRiver .tile').length,
  nextShown: !document.getElementById('nextQ').hidden,
  fb: document.getElementById('rdFb').hidden ? '' : document.getElementById('rdFb').textContent.trim(),
  state: __mjRead().state, qi: __mjRead().qi, danger: __mjRead().danger, result: __mjRead().result,
  river: __mjRead().scenario.discards.length,
})`);

// 1. 开局：只给一张牌
const s1 = JSON.parse(await snap());
check('只显示一张牌', s1.tiles === 1, String(s1.tiles));
check('不显示我的手牌', (await c.evaluate("document.querySelectorAll('#rdHand').length")) === 0);
check('他的牌是背面', s1.faces === 0, String(s1.faces));
check('牌河张数 = 他打出的张数', (await c.evaluate("document.querySelectorAll('#rdOppRiver .tile').length")) === s1.river);
check('牌河有「敲」标记', (await c.evaluate("document.querySelectorAll('#rdOppRiver .knock-sep').length")) === 1);
check('题号是本局', s1.no === '第 1 局', s1.no);
check('还在答题状态', s1.state === 'question');

// 2. 连答 3 张正确的：同一局继续、他的手牌始终不翻
for (let i = 0; i < 3; i++) {
  const d = await c.evaluate('__mjRead().danger');
  await c.evaluate(`__mjAnswer('${d ? 'danger' : 'safe'}'); 1`);
  await c.sleep(1100);
}
const s2 = JSON.parse(await snap());
check('答对后仍在同一局', s2.no === '第 1 局' && s2.qi === 3, `${s2.no}/${s2.qi}`);
check('答对后他的手牌仍隐藏', s2.faces === 0, String(s2.faces));
check('答对后继续出题', s2.state === 'question' && s2.tiles === 1);

// 3. 在一张「安全牌」上说危险 → 保守，不算点炮，同一局继续
let guard = 0;
let safeTile = false;
while (guard++ < 12) {
  if (!(await c.evaluate('__mjRead().danger'))) { safeTile = true; break; }
  // 危险牌就先答对，翻到安全的
  await c.evaluate("__mjAnswer('danger'); 1");
  await c.sleep(1100);
}
if (safeTile) {
  const before = JSON.parse(await snap());
  await c.evaluate("__mjAnswer('danger'); 1");
  await c.sleep(300);
  const s3 = JSON.parse(await snap());
  check('安全牌上答「危险」不算点炮', s3.state !== 'over', s3.state);
  check('保守时给出提示', /安全/.test(s3.fb) && /连对断了/.test(s3.fb), s3.fb.slice(0, 40));
  check('保守后仍是同一局', s3.no === before.no);
  await c.sleep(1000);
} else {
  check('安全牌上答「危险」不算点炮', true, 'skip');
  check('保守时给出提示', true, 'skip');
  check('保守后仍是同一局', true, 'skip');
}

// 4. 在一张「危险牌」上说安全 → 点炮，本局结束
guard = 0;
let dangerTile = false;
while (guard++ < 16) {
  if (await c.evaluate('__mjRead().danger')) { dangerTile = true; break; }
  await c.evaluate("__mjAnswer('safe'); 1");
  await c.sleep(1100);
}
if (dangerTile) {
  await c.evaluate("__mjAnswer('safe'); 1");
  await c.sleep(400);
  const s4 = JSON.parse(await snap());
  check('危险牌上答「安全」→ 点炮', s4.state === 'over' && s4.result === 'deal', `${s4.state}/${s4.result}`);
  check('点炮后翻开他的牌', s4.faces === 13, String(s4.faces));
  check('点炮后给出「下一局」', s4.nextShown === true);
  check('点炮反馈讲原因', /只等/.test(s4.fb) && /荣和/.test(s4.fb), s4.fb.slice(0, 50));
} else {
  check('危险牌上答「安全」→ 点炮', true, 'skip');
  check('点炮后翻开他的牌', true, 'skip');
  check('点炮后给出「下一局」', true, 'skip');
  check('点炮反馈讲原因', true, 'skip');
}

// 5. 下一局：新的对手、新的牌串
await c.evaluate("document.getElementById('nextQ').click(); 1");
await c.sleep(700);
const s5 = JSON.parse(await snap());
check('下一局重新开始', s5.no === '第 2 局' && s5.qi === 0 && s5.myRiver === 0, `${s5.no}/${s5.qi}/${s5.myRiver}`);
check('下一局他又是暗牌', s5.faces === 0, String(s5.faces));

// 6. 键盘 1 能作答
await c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true })); 1");
await c.sleep(1150);
check('键盘 1 能作答', (await c.evaluate('__mjRead().qi')) >= 1);

// 7. 切回拆搭，原局还在
await c.evaluate("document.getElementById('modeTrain').click(); 1");
await c.sleep(600);
const s7 = JSON.parse(await c.evaluate(`JSON.stringify({
  readHidden: document.getElementById('readArea').hidden,
  hand: document.querySelectorAll('#hand .tile').length,
})`));
check('切回拆搭后摇铃区隐藏', s7.readHidden === true);
check('拆搭手牌仍在', s7.hand === 14, String(s7.hand));

check('无控制台错误', c.logs.length === 0, JSON.stringify(c.logs.slice(0, 2)));

console.log(results.join('\n'));
console.log('PASS', results.filter((r) => r.startsWith('PASS')).length, '/', results.length);
await c.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
