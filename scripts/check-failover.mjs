// Integration test: real backend and PTYs; fake CLIs, isolated state/config.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
const dir = mkdtempSync(join(tmpdir(), 'cockpit-failover-'));
const root = join(dir, 'project'); mkdirSync(root);
const reserve = createServer(); await new Promise(done => reserve.listen(0, '127.0.0.1', done));
const port = reserve.address().port; await new Promise(done => reserve.close(done));
const cli = join(dir, 'fake-cli.mjs');
writeFileSync(cli, `
const successor = process.argv.includes('--session-id');
console.log(successor ? 'SUCCESSOR_READY' : 'ORIGINAL_READY');
if (!successor) setTimeout(async () => {
 await fetch('http://127.0.0.1:' + process.env.COCKPIT_PORT + '/api/missions/m1/checkpoint', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({texto:'Preservar preto e azul. Header concluído. Testes pendentes.'}) });
 console.log("You've hit your usage limit. Try again later.");
}, 700);
setInterval(() => {}, 1000);
`);
const cfg = JSON.parse(readFileSync('cockpit.json', 'utf8'));
cfg.port = port; cfg.confiarNasPastasQueEuAbrir = false;
cfg.politicaIA = { modo: 'padrao' };
cfg.clis = { codex: { command: process.execPath, args: [cli] }, claude: { command: process.execPath, args: [cli] } };
cfg.maestroAutoSwitch = true;
const configFile = join(dir, 'config.json'); writeFileSync(configFile, JSON.stringify(cfg));
writeFileSync(join(dir, 'state.json'), JSON.stringify({ projects: [{id:'p1',nome:'fixture',root,git:false,abertoEm:Date.now()}], missions: [{ id:'m1',projectId:'p1',nome:'test',objetivo:'Melhorar o design',worktree:root,branch:null,isolada:false,panes:[],criadaEm:Date.now() }] }));
const server = spawn(process.execPath, [resolve('servidor/index.ts')], { env: { ...process.env, COCKPIT_CONFIG:configFile, COCKPIT_HOME:dir }, windowsHide:true, stdio:['ignore','pipe','pipe'] });
let errors = ''; server.stderr.on('data', data => { errors += data; }); server.stdout.resume();
const base = 'http://127.0.0.1:' + port;
async function api(path, body) { const res = await fetch(base+path, body === undefined ? undefined : {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)}); const result = await res.json(); assert.equal(res.ok,true, JSON.stringify(result)); return result; }
async function until(fn) { for(let i=0;i<100;i++){try{const value=await fn(); if(value)return value;}catch{} await new Promise(done=>setTimeout(done,100));} throw Error('Timed out: '+errors); }
try {
  await until(() => api('/api/config'));
  const initial = await api('/api/missions/m1/maestro',{cli:'codex'});
  assert.equal(initial.cli,'codex'); assert.equal(initial.maestro,true);
  const successor = await until(async()=>{ const {panes}=await api('/api/panes'); return panes.length===1 && panes[0].cli==='claude' ? panes[0] : null; });
  assert.equal(successor.maestro,true); assert.equal(successor.cwd,root);
  const history = readFileSync(join(dir,'continuity','m1','history.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const start = history.find(row=>row.kind==='start' && row.pane===successor.paneId);
  assert.match(start.text,/Preservar preto e azul/);
  assert.match(start.text,/Melhorar o design/);
  assert.equal(history.filter(row=>row.kind==='start').length,2);
  const status = await api('/api/maestro'); assert.equal(status.limits.codex.state,'blocked');
  console.log('PASS: backend + real PTYs switched Codex fixture to Claude fixture once, preserved mission/checkpoint, kept one maestro, and recorded quota exhaustion. No real AI invoked.');
} finally {
  if (process.platform==='win32') { try { execFileSync('taskkill',['/pid',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}); } catch {} }
  else server.kill();
}
