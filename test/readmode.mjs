// 摇铃「二选一」题型的验收：出题、判分、揭底、下一题、统计、键盘、平衡性。
import { connect } from './cdp-lib.mjs';
import { makeScenario } from '../public/readmode.js';

const c = await connect({ port: 9351, profile: '.chrome-cdp91', url: 'http://127.0.0.1:8788/' });
await c.sleep(1200);

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);

// 1. 切到摇铃
await c.evaluate("document.getElementById('modeRead').click(); 1");
await c.sleep(900);
const s1 = JSON.parse(await c.evaluate(`JSON.stringify({
  area: !document.getElementById('readArea').hidden,
  train: document.getElementById('trainArea') ? document.getElementById('trainArea').hidden : null,
  no: document.getElementById('rdNo').textContent,
  hand: document.querySelectorAll('#rdHand .tile').length,
  qs: document.querySelectorAll('#rdHand .tile.q').length,
  backs: document.querySelectorAll('#oppHand .back').length,
  faces: document.querySelectorAll('#oppHand .tile[data-tile]').length,
  river: document.querySelectorAll('#rdOppRiver .tile').length,
  knock: document.querySelectorAll('#rdOppRiver .knock-sep').length,
  discards: __mjRead().scenario.discards.length,
  truth: __mjRead().scenario.danger,
  state: __mjRead().state,
  nextHidden: document.getElementById('nextQ').hidden,
})`));
check('摇铃区可见', s1.area);
check('题号', s1.no === '第 1 题', s1.no);
check('手牌 13 张', s1.hand === 13, String(s1.hand));
check('恰好一张问题牌', s1.qs === 1, String(s1.qs));
check('作答前他的牌是背面', s1.backs === 13 && s1.faces === 0, `${s1.backs}/${s1.faces}`);
check('牌河张数 = 他打出的张数', s1.river === s1.discards, `${s1.river}/${s1.discards}`);
check('牌河有「敲」标记', s1.knock === 1);
check('作答前「下一题」隐藏', s1.nextHidden === true);

// 2. 答一题（对着真值答，保证判分逻辑自洽）
const pick = s1.truth ? 'danger' : 'safe';
await c.evaluate(`__mjAnswer('${pick}'); 1`);
await c.sleep(250);
const s2 = JSON.parse(await c.evaluate(`JSON.stringify({
  state: __mjRead().state,
  faces: document.querySelectorAll('#oppHand .tile[data-tile]').length,
  fb: !document.getElementById('rdFb').hidden,
  fbText: document.getElementById('rdFb').textContent.trim(),
  fbClass: document.getElementById('rdFb').className,
  nextShown: !document.getElementById('nextQ').hidden,
  ansHidden: document.getElementById('ansDanger').hidden,
  right: __mjRead().right, total: __mjRead().total,
  stored: JSON.parse(localStorage.getItem('qiaoma.readquiz.v1') || '{}'),
})`));
check('揭底状态', s2.state === 'revealed');
check('揭底后他的牌翻开', s2.faces === 13, String(s2.faces));
check('反馈出现', s2.fb === true);
check('答对反馈是 ok', s2.fbClass.includes('ok') && s2.fbText.startsWith('对'), s2.fbText.slice(0, 24));
check('反馈给出他的听张', /他听|听 /.test(s2.fbText));
check('「下一题」出现', s2.nextShown === true);
check('选择按钮收起', s2.ansHidden === true);
check('统计 +1', s2.total >= 1 && s2.right >= 1, `${s2.right}/${s2.total}`);
check('统计落盘', s2.stored.total >= 1, JSON.stringify(s2.stored));

// 3. 故意答错一次，检查判错与连对清零
await c.evaluate('__mjReadNext(); 1');
await c.sleep(500);
const truth2 = await c.evaluate('__mjRead().scenario.danger');
await c.evaluate(`__mjAnswer('${truth2 ? 'safe' : 'danger'}'); 1`);
await c.sleep(250);
const s3 = JSON.parse(await c.evaluate(`JSON.stringify({
  fbClass: document.getElementById('rdFb').className,
  fbText: document.getElementById('rdFb').textContent.trim(),
  streak: __mjRead().streak,
})`));
check('答错反馈是 bad', s3.fbClass.includes('bad') && s3.fbText.startsWith('错'), s3.fbText.slice(0, 24));
check('答错连对清零', s3.streak === 0);

// 4. 键盘：1 = 危险
await c.evaluate('__mjReadNext(); 1');
await c.sleep(500);
await c.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true })); 1`);
await c.sleep(200);
check('键盘 1 作答', (await c.evaluate('__mjRead().state')) === 'revealed');
await c.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); 1`);
await c.sleep(500);
const s4 = JSON.parse(await c.evaluate(`JSON.stringify({ state: __mjRead().state, no: document.getElementById('rdNo').textContent })`));
check('空格进入下一题', s4.state === 'question' && s4.no.startsWith('第 '), s4.no);

// 5. 题面平衡：Node 侧直接跑 makeScenario（纯函数，不碰 DOM）
let bal = { danger: 0, total: 0 };
for (let i = 0; i < 40; i++) {
  const sc = makeScenario(1000 + i * 37);
  if (!sc) continue;
  bal.total++;
  if (sc.danger) bal.danger++;
}
const ratio = bal.total ? bal.danger / bal.total : 0;
check('题面平衡（危险题 30%–70%）', ratio >= 0.3 && ratio <= 0.7, `${bal.danger}/${bal.total}`);

// 6. 切回拆搭，原局还在
await c.evaluate("document.getElementById('modeTrain').click(); 1");
await c.sleep(600);
const s5 = JSON.parse(await c.evaluate(`JSON.stringify({
  readHidden: document.getElementById('readArea').hidden,
  hand: document.querySelectorAll('#hand .tile').length,
  judged: __mj.state.judged,
})`));
check('切回拆搭后摇铃区隐藏', s5.readHidden === true);
check('拆搭手牌仍在', s5.hand === 14, String(s5.hand));

check('无控制台错误', c.logs.length === 0, JSON.stringify(c.logs.slice(0, 2)));

console.log(results.join('\n'));
console.log('PASS', results.filter((r) => r.startsWith('PASS')).length, '/', results.length);
await c.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
