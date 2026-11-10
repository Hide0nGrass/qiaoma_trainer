/** 用 Chrome headless 截图（避免 PowerShell GUI 进程捕获问题） */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const out = process.argv[2] || 'shot.png';
const url = process.argv[3] || 'http://127.0.0.1:8788/';
const size = process.argv[4] || '1440,900';
const budget = process.argv[5] || '6000';

const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  '--disable-crash-reporter',
  `--window-size=${size}`,
  `--virtual-time-budget=${budget}`,
  `--user-data-dir=${process.cwd()}\\.chrome-profile`,
  `--screenshot=${out}`,
  url,
];

const child = spawn(CHROME, args, { stdio: ['ignore', 'inherit', 'inherit'] });
child.on('exit', (code) => {
  console.log('chrome exit', code);
  process.exit(0);
});
