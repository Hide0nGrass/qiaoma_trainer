/** 新功能回归：打错不摸牌 + 自动 AI、正确不请求、就这样打、后退一步、历史 */
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9341, profile: '.chrome-cdp9' });
const ok = [];
const bad = [];
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` (${extra})` : ''));

const coachCalls = () => c.evaluate('(__mj.state.coachCalls || 0)');

const snap = () => c.evaluate(`({
  hand: __mj.state.hand.length,
  river: __mj.state.river.length,
  dom: document.querySelectorAll('#hand .tile').length,
  force: !document.getElementById('forceBtn').hidden,
  badge: document.getElementById('badge').textContent,
  meta: document.getElementById('coachMeta').textContent,
  undo: __mj.state.undoStack.length,
  round: __mj.state.roundNo,
  rec: __mj.state.rec,
})`);

try {
  for (let i = 0; i < 60; i++) {
    if (await c.evaluate('Boolean(window.__mj && window.__mj.state.hand.length)')) break;
    await c.sleep(150);
  }
  // 清掉上一轮测试留下的历史
  await c.evaluate("localStorage.removeItem('qiaoma.history.v1')");

  // 找一张「打得最差」的牌：analyzeHand 的末位
  const worst = await c.evaluate(`(() => {
    const S = __mj.state;
    const cands = __mj.analyzeHand(S.hand);
    const last = cands[cands.length - 1];
    const idx = S.hand.indexOf(last.tile);
    return { idx, tile: last.tile, verdict: last.shanten > cands[0].shanten ? 'wrong' : 'sub',
             shanten: last.shanten, best: cands[0].shanten };
  })()`);
  console.log('worst', JSON.stringify(worst));

  const before = await snap();
  const calls0 = await coachCalls();

  // 1) 打错：不摸牌、牌退回、按钮出现、自动请求 AI
  await c.evaluate(`document.querySelectorAll('#hand .tile')[${worst.idx}].click()`);
  await c.sleep(900);
  const after = await snap();
  check('打错不摸牌', after.hand === 14 && after.dom === 14 && after.river === 0, `hand=${after.hand} river=${after.river}`);
  check('打错出现「就这样打」', after.force === true);
  const calls1 = await coachCalls();
  check('打错自动请求 AI', calls1 === calls0 + 1, `${calls0} -> ${calls1}`);
  check('打错后不产生撤销', after.undo === 0, `undo=${after.undo}`);

  // 等 AI 说完
  for (let i = 0; i < 40; i++) {
    const m = await c.evaluate("document.getElementById('coachMeta').textContent");
    if (!m.includes('组织语言') && !m.includes('正在想')) break;
    await c.sleep(200);
  }
  const aiText = await c.evaluate("document.getElementById('coachText').textContent");
  check('AI 正文非空', aiText.replace(/\s/g, '').length > 12, aiText.slice(0, 30));
  check('面板保留引擎结论', aiText.includes('引擎：'), aiText.slice(-30));

  // 2) Enter「就这样打」：进牌河并摸牌
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await c.sleep(500);
  const forced = await snap();
  check('就这样打后出牌并摸牌', forced.hand === 14 && forced.river === 1 && forced.force === false,
    `hand=${forced.hand} river=${forced.river}`);
  check('就这样打可撤销', forced.undo === 1, `undo=${forced.undo}`);
  check('记录出牌数', forced.rec && forced.rec.moves === 1, JSON.stringify(forced.rec));

  // 3) Z 后退一步：回到 14 张、牌河清空、统计回滚
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', text: 'z' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ' });
  await c.sleep(400);
  const undone = await snap();
  check('后退一步', undone.hand === 14 && undone.river === 0 && undone.undo === 0,
    `hand=${undone.hand} river=${undone.river} undo=${undone.undo}`);

  // 4) 打对：不请求 AI、直接摸牌、可撤销
  const calls2 = await coachCalls();
  const goodIdx = await c.evaluate(`(() => {
    const S = __mj.state;
    const cands = __mj.analyzeHand(S.hand);
    const best = cands[0];
    return S.hand.indexOf(best.tile);
  })()`);
  await c.evaluate(`document.querySelectorAll('#hand .tile')[${goodIdx}].click()`);
  await c.sleep(900);
  const goodRes = await snap();
  check('打对直接摸牌', goodRes.hand === 14 && goodRes.river === 1, `hand=${goodRes.hand} river=${goodRes.river}`);
  check('打对不请求 AI', (await coachCalls()) === calls2, `calls=${await coachCalls()}`);
  check('打对后按钮不出现', goodRes.force === false);
  check('打对可撤销', goodRes.undo === 1, `undo=${goodRes.undo}`);

  // 5) 历史：换一局后应记录上一局，并且能点回去重玩
  await c.evaluate("__mj.startRound(123456789)");
  await c.sleep(300);
  await c.evaluate("document.getElementById('historyBtn').click()");
  await c.sleep(300);
  const hist = await c.evaluate(`({
    open: !document.getElementById('historyModal').hidden,
    rows: document.querySelectorAll('#histList .hist-row').length,
    first: document.querySelector('#histList .hist-row')?.textContent || '',
    stored: JSON.parse(localStorage.getItem('qiaoma.history.v1') || '[]').length,
  })`);
  check('历史面板打开', hist.open === true);
  check('历史有记录', hist.rows >= 1, `rows=${hist.rows}`);
  check('历史写入 localStorage', hist.stored >= 1, `stored=${hist.stored}`);
  const histSeed = await c.evaluate('__mj.state.history[0].seed');
  console.log('hist row:', hist.first.replace(/\s+/g, ' '), 'seed', histSeed);

  await c.evaluate("document.querySelector('#histList .hist-row').click()");
  await c.sleep(400);
  const replay = await c.evaluate(`({ seed: __mj.state.seed, hand: __mj.state.hand.length,
    closed: document.getElementById('historyModal').hidden, round: __mj.state.roundNo })`);
  check('点历史重玩同一副', replay.seed === histSeed && replay.hand === 14 && replay.closed === true,
    `want=${histSeed} got=${replay.seed}`);

  check('无控制台错误', c.logs.filter((l) => l.type === 'error' || l.level === 'error').length === 0,
    JSON.stringify(c.logs).slice(0, 200));

  console.log('\nPASS', ok.length, ok);
  if (bad.length) { console.log('FAIL', bad.length, bad); process.exitCode = 1; }
} finally {
  await c.close();
}
