// Integration test: real backend and PTYs; fake CLIs, isolated state/config.
// Cadeia completa: Codex conta A → Codex conta B (mesma conversa, mesmo modelo)
// → todas as contas do Codex no limite → Claude → Claude no limite → Grok.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const dir = mkdtempSync(join(tmpdir(), 'cockpit-failover-contas-'));
const root = join(dir, 'project'); mkdirSync(root);
const homeA = join(dir, 'codex-a'); const homeB = join(dir, 'codex-b');
const reserve = createServer(); await new Promise(done => reserve.listen(0, '127.0.0.1', done));
const port = reserve.address().port; await new Promise(done => reserve.close(done));

const SESSAO = '01a0ffff-0000-7000-8000-00000000abcd';
const cli = join(dir, 'fake-cli.mjs');
writeFileSync(cli, `
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const nome = process.env.FAKE_NAME;
const argv = process.argv.slice(2);
const limite = (texto) => setTimeout(() => console.log(texto), 900);
setInterval(() => {}, 1000);
if (nome === 'codex') {
  if (argv[0] === 'resume') {
    console.log('CODEX_RESUMED ' + argv.includes(${JSON.stringify(SESSAO)}) + ' ' + process.env.CODEX_HOME);
    limite("■ You've hit your usage limit. Upgrade to Pro or try again in 3 hours 10 minutes.");
  } else {
    const marca = argv.join(' ').match(/\\[cockpit-pane:[^\\]]+\\]/)[0];
    const d = new Date();
    const pasta = join(process.env.CODEX_HOME, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    mkdirSync(pasta, { recursive: true });
    const linhas = [
      { type: 'session_meta', payload: { id: ${JSON.stringify(SESSAO)}, cwd: process.cwd() } },
      { type: 'response_item', payload: { role: 'developer', content: [{ type: 'input_text', text: marca }] } },
      { type: 'turn_context', payload: { model: 'gpt-base', effort: 'high' } },
      { type: 'turn_context', payload: { model: 'gpt-escolhido', effort: 'low' } },
    ];
    writeFileSync(join(pasta, 'rollout-2026-01-01T00-00-00-${SESSAO}.jsonl'), linhas.map(l => JSON.stringify(l)).join('\\n') + '\\n');
    console.log('CODEX_ORIGINAL');
    limite("■ You've hit your usage limit. Upgrade to Pro or try again in 2 hours 5 minutes.");
  }
} else if (nome === 'claude') {
  console.log('CLAUDE_READY');
  limite('Claude AI usage limit reached|' + Math.floor(Date.now() / 1000 + 7200));
} else {
  console.log('GROK_READY');
}
`);

const cfg = JSON.parse(readFileSync('cockpit.json', 'utf8'));
cfg.port = port; cfg.confiarNasPastasQueEuAbrir = false;
cfg.politicaIA = { modo: 'padrao' };
const fake = (nome, extra = {}) => ({ command: process.execPath, args: [cli], env: { FAKE_NAME: nome }, ...extra });
cfg.clis = {
  bash: cfg.clis.bash,
  codex: fake('codex', { pool: [
    { id: 'codex-a', label: 'conta A', env: { CODEX_HOME: homeA, FAKE_NAME: 'codex' } },
    { id: 'codex-b', label: 'conta B', env: { CODEX_HOME: homeB, FAKE_NAME: 'codex' } },
  ] }),
  claude: fake('claude'),
  grok: fake('grok'),
};
cfg.modelos = { codex: ['gpt-base', 'gpt-escolhido'], claude: ['claude-x'], grok: ['grok-x'] };
cfg.efforts = { codex: ['low', 'high'], claude: ['high'], grok: ['high'] };
cfg.maestroAutoSwitch = true;
delete cfg.ordemDeTroca;
const configFile = join(dir, 'config.json'); writeFileSync(configFile, JSON.stringify(cfg));
writeFileSync(join(dir, 'state.json'), JSON.stringify({ projects: [{ id: 'p1', nome: 'fixture', root, git: false, abertoEm: Date.now() }], missions: [{ id: 'm1', projectId: 'p1', nome: 'test', objetivo: 'Continuar sem perder a conversa', worktree: root, branch: null, isolada: false, panes: [], criadaEm: Date.now() }] }));

const server = spawn(process.execPath, [resolve('servidor/index.ts')], { env: { ...process.env, COCKPIT_CONFIG: configFile, COCKPIT_HOME: dir }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let errors = ''; server.stderr.on('data', data => { errors += data; }); server.stdout.resume();
const base = 'http://127.0.0.1:' + port;
async function api(path, body) { const res = await fetch(base + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const result = await res.json(); assert.equal(res.ok, true, JSON.stringify(result)); return result; }
async function until(fn, label) { for (let i = 0; i < 150; i++) { try { const value = await fn(); if (value) return value; } catch {} await new Promise(done => setTimeout(done, 100)); } throw Error('Timed out: ' + label + '\n' + errors); }
async function unico() { const { panes } = await api('/api/panes'); return panes.length === 1 ? panes[0] : null; }
async function saida(paneId) { return (await api(`/api/panes/${paneId}/replay`)).scrollback ?? ''; }

try {
  await until(() => api('/api/config'), 'config');
  const inicial = await api('/api/missions/m1/maestro', { cli: 'codex' });
  assert.equal(inicial.cli, 'codex');
  assert.equal(inicial.accountId, 'codex-a');

  // 1. Conta A esgota → conta B, mesma conversa (resume) e último modelo usado.
  const b = await until(async () => { const p = await unico(); return p && p.accountId === 'codex-b' ? p : null; }, 'rotação para conta B');
  assert.equal(b.cli, 'codex');
  assert.equal(b.model, 'gpt-escolhido', 'abre no último modelo usado na conversa, não no padrão');
  assert.equal(b.effort, 'low');
  assert.equal(b.sessionId, SESSAO);
  const copiado = join(homeB, 'sessions');
  assert.ok(existsSync(copiado) && readdirSync(copiado).length, 'conversa copiada para a conta B');
  const saidaB = await until(async () => { const s = await saida(b.paneId); return /CODEX_RESUMED/.test(s) ? s : null; }, 'resume');
  assert.match(saidaB, /CODEX_RESUMED true/);
  assert.ok(saidaB.includes(homeB), 'rodando com o CODEX_HOME da conta B');

  // 2. Conta B esgota → nenhuma conta Codex livre → Claude.
  const claude = await until(async () => { const p = await unico(); return p && p.cli === 'claude' ? p : null; }, 'troca para Claude');
  assert.equal(claude.maestro, true);
  const status = await api('/api/maestro');
  assert.equal(status.limits.codex.state, 'blocked');
  assert.ok(status.limits.codex.ate > Date.now() + 60 * 60 * 1000, 'Codex volta quando a primeira conta reseta');

  // 3. Claude esgota → Codex ainda no limite → Grok.
  const grok = await until(async () => { const p = await unico(); return p && p.cli === 'grok' ? p : null; }, 'troca para Grok');
  assert.equal(grok.maestro, true);
  await until(async () => /GROK_READY/.test(await saida(grok.paneId)), 'grok pronto');

  const history = readFileSync(join(dir, 'continuity', 'm1', 'history.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(history.filter(row => row.kind === 'start').length, 4);
  console.log('PASS: Codex A → Codex B (resume da mesma conversa, último modelo) → Claude → Grok, uma janela por vez. No real AI invoked.');
} finally {
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {} }
  else server.kill();
}
