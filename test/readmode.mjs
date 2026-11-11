// 摇铃「一局多题」验收：只发一张牌、作答后停在反馈等空格、答错点炮换局。
import { connect } from './cdp-lib.mjs';
import { makeRound } from '../public/readmode.js';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);

// 0. Node 侧：每局的牌串应当一半危险一半安全
let bal = { danger: 0, total: 0 };
for (let i = 0; i < 60; i++) {
  const r = makeRound(3000 + i * 97);
  if (!r) continue;
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

const space = async () => {
  await c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); 1");
  await c.sleep(300);
};
const snap = () => c.evaluate(`JSON.stringify({
  no: document.getElementById('rdNo').textContent,
  tiles: document.querySelectorAll('#quizTile .tile').length,
  faces: document.querySelectorAll('#oppHand .tile[data-tile]').length,
  myRiver: document.querySelectorAll('#rdMyRiver .tile').length,
  nextShown: !document.getElementById('nextQ').hidden,
  nextText: document.getElementById('nextQ').textContent,
  fb: document.getElementById('rdFb').hidden ? '' : document.getElementById('rdFb').textContent.trim(),
  state: __mjRead().state, qi: __mjRead().qi, danger: __mjRead().danger, result: __mjRead().result,
  river: __mjRead().scenario.discards.length,
})`);
const answer = async (v) => { await c.evaluate(`__mjAnswer('${v}'); 1`); await c.sleep(220); };

// 1. 开局
const s1 = JSON.parse(await snap());
check('只显示一张牌', s1.tiles === 1, String(s1.tiles));
check('不显示我的手牌', (await c.evaluate("document.querySelectorAll('#rdHand').length")) === 0);
check('他的牌是背面', s1.faces === 0, String(s1.faces));
check('牌河张数 = 他打出的张数', (await c.evaluate("document.querySelectorAll('#rdOppRiver .tile').length")) === s1.river);
check('牌河有「敲」标记', (await c.evaluate("document.querySelectorAll('#rdOppRiver .knock-sep').length")) === 1);
check('题号是本局', s1.no === '第 1 局', s1.no);
check('还在答题状态', s1.state === 'question');

// 2. 答对 → 停在反馈（不自动跳），按空格才进下一张
const d0 = s1.danger;
await answer(d0 ? 'danger' : 'safe');
const s2 = JSON.parse(await snap());
check('答完停在反馈不自动跳', s2.state === 'revealed' && s2.qi === 1, `${s2.state}/${s2.qi}`);
check('给出「继续」按钮', s2.nextShown === true && /继续/.test(s2.nextText), s2.nextText);
check('反馈可见', s2.fb.length > 0, s2.fb.slice(0, 24));
check('答对后他的牌仍隐藏', s2.faces === 0, String(s2.faces));
await space();
const s3 = JSON.parse(await snap());
check('空格后进入下一张', s3.state === 'question' && s3.qi === 1, `${s3.state}/${s3.qi}`);
check('同一局继续', s3.no === '第 1 局', s3.no);

// 3. 安全牌上答「危险」→ 保守，不算点炮
let found = false;
for (let i = 0; i < 10 && !found; i++) {
  const st = JSON.parse(await snap());
  if (st.state !== 'question') break;
  if (!st.danger) { found = true; break; }
  await answer('danger');
  await space();
}
if (found) {
  await answer('danger');
  const s4 = JSON.parse(await snap());
  check('安全牌答「危险」不算点炮', s4.state === 'revealed', s4.state);
  check('保守时说明「没点炮」', /没点炮/.test(s4.fb), s4.fb.slice(0, 40));
  await space();
} else {
  check('安全牌答「危险」不算点炮', true, 'skip');
  check('保守时说明「没点炮」', true, 'skip');
}

// 4. 危险牌上答「安全」→ 点炮，本局结束并揭底
let hitDanger = false;
for (let i = 0; i < 12 && !hitDanger; i++) {
  const st = JSON.parse(await snap());
  if (st.state !== 'question') break;
  if (st.danger) { hitDanger = true; break; }
  await answer('safe');
  await space();
}
if (hitDanger) {
  await answer('safe');
  const s5 = JSON.parse(await snap());
  check('危险牌答「安全」→ 点炮', s5.state === 'over' && s5.result === 'deal', `${s5.state}/${s5.result}`);
  check('点炮后翻开他的牌', s5.faces === 13, String(s5.faces));
  check('点炮后按钮变「下一局」', s5.nextShown && /下一局/.test(s5.nextText), s5.nextText);
  check('点炮反馈讲原因', /等的就是/.test(s5.fb) && /荣和/.test(s5.fb), s5.fb.slice(0, 46));
  await c.evaluate("document.getElementById('nextQ').click(); 1");
} else {
  check('危险牌答「安全」→ 点炮', true, 'skip');
  check('点炮后翻开他的牌', true, 'skip');
  check('点炮后按钮变「下一局」', true, 'skip');
  check('点炮反馈讲原因', true, 'skip');
  await c.evaluate("document.getElementById('nextQ').click(); 1");
}
await c.sleep(600);

// 5. 下一局重新开始
const s6 = JSON.parse(await snap());
check('下一局从零开始', s6.qi === 0 && s6.myRiver === 0 && s6.state === 'question', `${s6.qi}/${s6.myRiver}/${s6.state}`);
check('下一局他又是暗牌', s6.faces === 0, String(s6.faces));

// 6. 键盘 1 能作答
await c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true })); 1");
await c.sleep(250);
check('键盘 1 能作答', (await c.evaluate('__mjRead().state')) === 'revealed');

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
