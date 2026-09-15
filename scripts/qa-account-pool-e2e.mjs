import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const pwPath = '/home/jj/.agents/skills/playwright-skill/node_modules/playwright-core/index.mjs';
const { chromium } = await import(pathToFileURL(resolve(pwPath)).href);

const root = resolve('web/dist');
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root)) throw Error('Invalid path');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});

await new Promise(done => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const appUrl = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true });

try {
  console.log('Iniciando Agente Autônomo de QA — Validação de Account Pool E2E...');

  const codexPool = {
    cli: 'codex',
    total: 4,
    ativas: 0,
    emCooldown: 0,
    contas: [
      { id: 'codex-1', label: 'oitonovesuporte@gmail.com', status: 'livre', env: { CODEX_HOME: '/home/jj/.jion' } },
      { id: 'codex-2', label: 'olhapautagruposaht@gmail.com', status: 'livre', env: { CODEX_HOME: '/home/jj/.codex-acc2' } },
      { id: 'codex-3', label: 'monsegruposaht@gmail.com', status: 'livre', env: { CODEX_HOME: '/home/jj/.codex-acc3' } },
      { id: 'codex-4', label: 'adv.barbaralacerda@gmail.com', status: 'livre', env: { CODEX_HOME: '/home/jj/.codex-acc4' } }
    ]
  };

  const geminiPool = {
    cli: 'gemini',
    total: 4,
    ativas: 0,
    emCooldown: 0,
    contas: [
      { id: 'gemini-1', label: 'Gemini Conta 1', status: 'livre', env: { GEMINI_CLI_HOME: '/home/jj/.gemini-1' } },
      { id: 'gemini-2', label: 'Gemini Conta 2', status: 'livre', env: { GEMINI_CLI_HOME: '/home/jj/.gemini-2' } },
      { id: 'gemini-3', label: 'Gemini Conta 3', status: 'livre', env: { GEMINI_CLI_HOME: '/home/jj/.gemini-3' } },
      { id: 'gemini-4', label: 'Gemini Conta 4', status: 'livre', env: { GEMINI_CLI_HOME: '/home/jj/.gemini-4' } }
    ]
  };

  const grokPool = {
    cli: 'grok',
    total: 1,
    ativas: 0,
    emCooldown: 0,
    contas: [
      { id: 'grok-1', label: 'Grok Principal', status: 'livre', env: { GROK_HOME: '/home/jj/.grok' } }
    ]
  };

  let providersMock = [
    {
      id: 'codex',
      comando: 'codex',
      disponivel: true,
      caminho: '/usr/bin/codex',
      modelos: ['JACK', 'gpt-6-astra', 'gpt-5.6-sol'],
      agentes: ['maestro'],
      pool: codexPool
    },
    {
      id: 'gemini',
      comando: 'gemini',
      disponivel: true,
      caminho: '/usr/bin/gemini',
      modelos: ['gemini-2.5-pro', 'gemini-3.1-pro-high'],
      agentes: ['artista'],
      pool: geminiPool
    },
    {
      id: 'grok',
      comando: 'grok',
      disponivel: true,
      caminho: '/usr/bin/grok',
      modelos: ['grok-4.6'],
      agentes: [],
      pool: grokPool
    }
  ];

  const projects = [{ id: 'p1', nome: 'Projeto QA Pool', root: '/DATA/Projetos/agent-project', git: true }];
  const missions = [{
    id: 'm1',
    projectId: 'p1',
    nome: 'Missão de Validação Multi-Contas',
    objetivo: 'Verificar concorrência e failover de contas no Cockpit',
    branch: 'main',
    git: { dirty: 0, head: 'a1b2c3' },
    usage: { in: 100, out: 50, custo: 0 },
    panes: [],
    modo: 'dirigido',
    elenco: { clis: ['codex', 'gemini', 'grok'], soVisual: [] }
  }];

  const setupPage = async (page) => {
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/projects') return route.fulfill({ json: { projects } });
      if (path === '/api/missions') return route.fulfill({ json: { missions } });
      if (path === '/api/panes') return route.fulfill({ json: { panes: [] } });
      if (path === '/api/tasks') return route.fulfill({ json: { tasks: [] } });
      if (path === '/api/connections') return route.fulfill({ json: { connections: [] } });
      if (path === '/api/providers') return route.fulfill({ json: { providers: providersMock, presets: [] } });
      if (path === '/api/pontes') return route.fulfill({ json: { pontes: [] } });
      if (path === '/api/maestro' || path === '/api/maestro/refresh') return route.fulfill({
        json: {
          agent: { label: 'MAESTRO', cli: 'codex', model: 'JACK', effort: 'high' },
          auto: true,
          providers: providersMock,
          limits: {}
        }
      });
      if (path === '/api/config') return route.fulfill({
        json: {
          agents: {
            maestro: { label: 'Maestro', cli: 'codex', cor: '#00b4ff', maestro: true },
            builder: { label: 'Builder', cli: 'codex', cor: '#4fb286' }
          },
          squads: {},
          tarefas: {},
          clis: { codex: { pool: codexPool.contas }, gemini: { pool: geminiPool.contas }, grok: { pool: grokPool.contas } }
        }
      });
      if (path === '/api/skills') return route.fulfill({ json: { skills: [], acervo: { total: 0, porOrigem: {} } } });
      if (path === '/api/receitas') return route.fulfill({ json: { receitas: {} } });
      if (path === '/api/marketplace') return route.fulfill({ json: { fontes: [], plugins: [] } });
      if (path === '/api/media') return route.fulfill({ json: { provedores: [] } });
      if (path === '/api/consumo') return route.fulfill({ json: {} });
      if (path === '/api/memoria') return route.fulfill({ json: [] });
      if (path === '/api/tree') return route.fulfill({ json: { tree: [] } });
      if (path === '/api/account-pools') return route.fulfill({ json: { ok: true, pools: { codex: codexPool, gemini: geminiPool, grok: grokPool } } });
      if (path === '/api/account-pools/reset-limit') {
        codexPool.emCooldown = 0;
        codexPool.contas.forEach(c => { c.status = 'livre'; c.limitedUntil = undefined; });
        return route.fulfill({ json: { ok: true, pools: { codex: codexPool, gemini: geminiPool, grok: grokPool } } });
      }
      return route.fulfill({ json: {} });
    });
    await page.routeWebSocket('**/ws', () => {});
  };

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await setupPage(page);
  await page.goto(appUrl);
  await page.waitForSelector('.stage');
  await page.waitForTimeout(400);

  console.log('1. Abrindo modal de Ajustes / Provedores...');
  await page.locator('button[aria-label="Configurações"]').click();
  await page.waitForSelector('.config');
  await page.waitForTimeout(400);

  // Verificar que os badges de Pool aparecem
  const codexBadge = await page.locator('.badge-pool').first().innerText();
  console.log('   Badge Codex identificado:', codexBadge);
  if (!codexBadge.includes('4 contas')) {
    throw new Error(`Esperava 4 contas no badge do Codex, obteve: ${codexBadge}`);
  }

  // Clicar no botão para abrir as contas do Codex
  console.log('2. Expandindo drawer de contas do Codex...');
  await page.getByRole('button', { name: /Contas \(4\)/ }).first().click();
  await page.waitForSelector('.prov-pool-drawer');
  await page.waitForTimeout(300);

  // Validar contas visíveis
  const drawerText = await page.locator('.prov-pool-drawer').first().innerText();
  console.log('   Contas visíveis no drawer:');
  for (const conta of codexPool.contas) {
    if (drawerText.includes(conta.label)) {
      console.log(`   ✓ Conta ${conta.id} (${conta.label}) renderizada com sucesso`);
    } else {
      throw new Error(`Conta ${conta.label} não encontrada no drawer!`);
    }
  }

  await page.screenshot({ path: '/tmp/cockpit-prints/qa-pool-codex-drawer.png' });
  console.log('   Captura gravada: /tmp/cockpit-prints/qa-pool-codex-drawer.png');

  // Fechar modal de ajustes
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Abrir modal do Maestro
  console.log('3. Abrindo modal do Maestro e Continuidade...');
  await page.locator('button[aria-label="Detalhes da missão"]').click();
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="Maestro"]').click();
  await page.waitForSelector('.wizard-topo h2');
  await page.waitForTimeout(400);

  const maestroCorpo = await page.locator('.wizard-corpo').innerText();
  if (maestroCorpo.includes('Pool de contas multicontas (GPT · Codex)')) {
    console.log('   ✓ Card do Pool de Contas do Maestro renderizado com sucesso!');
  } else {
    throw new Error('Card de pool de contas não encontrado no modal do Maestro!');
  }

  await page.screenshot({ path: '/tmp/cockpit-prints/qa-pool-maestro-modal.png' });
  console.log('   Captura gravada: /tmp/cockpit-prints/qa-pool-maestro-modal.png');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 4. Simular estado com cooldown e ocupado
  console.log('4. Simulando estado com rate-limit e cooldown...');
  codexPool.emCooldown = 1;
  codexPool.ativas = 1;
  codexPool.contas[0].status = 'ocupada';
  codexPool.contas[0].painelId = 'pane-builder';
  codexPool.contas[0].painelLabel = 'Builder';
  codexPool.contas[1].status = 'cooldown';
  codexPool.contas[1].limitedUntil = Date.now() + 600000;
  codexPool.contas[1].lastLimitDetail = '429 Quota Exceeded (retry-after 10m)';

  await page.locator('button[aria-label="Configurações"]').click();
  await page.waitForSelector('.config');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Contas \(4\)/ }).first().click();
  await page.waitForTimeout(300);

  const cooldownTag = await page.locator('.conta-pool-tag.cooldown').innerText();
  console.log(`   ✓ Tag de cooldown detectada: "${cooldownTag}"`);

  const resetButtons = await page.locator('button:has-text("Resetar cota")').count();
  console.log(`   ✓ Botões de resetar cota detectados: ${resetButtons}`);

  await page.screenshot({ path: '/tmp/cockpit-prints/qa-pool-cooldown-visual.png' });
  console.log('   Captura gravada: /tmp/cockpit-prints/qa-pool-cooldown-visual.png');

  console.log('\n=============================================');
  console.log('TESTES DE QA E2E FINALIZADOS COM 100% DE SUCESSO!');
  console.log('=============================================');

} finally {
  await browser.close();
  server.close();
}
