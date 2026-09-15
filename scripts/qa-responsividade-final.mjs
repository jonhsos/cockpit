import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

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
  const usage = { in: 1200, out: 450, cacheWrite: 0, cacheRead: 0, custo: 0.15, turnos: 4, model: 'gpt-5' };
  const projects = [{ id: 'p1', nome: 'Projeto Responsividade Cockpit', root: '/DATA/Projetos/agent-project', git: true }];
  const missions = [{
    id: 'm1',
    projectId: 'p1',
    nome: 'Refatoração da Responsividade e Adaptação para Telas Pequenas e Mobile',
    objetivo: 'Garantir layout fluido, sem cortes ou informações comidas em qualquer tamanho de tela.',
    branch: 'missao/responsividade',
    git: { dirty: 2, head: 'a1b2c3' },
    usage,
    panes: [],
    modo: 'dirigido',
    elenco: { clis: ['codex', 'claude', 'bash'], soVisual: [] }
  }];

  const panes = [
    {
      paneId: 'pane1',
      agent: 'maestro',
      label: 'Maestro Coordenador Geral',
      cor: '#b8a1ff',
      missionId: 'm1',
      status: 'run',
      atividade: [1, 3, 5, 2, 7, 4],
      iniciadoEm: Date.now() - 360000,
      usage,
      maestro: true,
      cli: 'codex',
      model: 'gpt-5.4-hyper-preview',
      effort: 'high'
    },
    {
      paneId: 'pane2',
      agent: 'builder',
      label: 'Builder de Frontend',
      cor: '#4fb286',
      missionId: 'm1',
      status: 'idle',
      atividade: [0, 1, 2],
      iniciadoEm: Date.now() - 180000,
      usage,
      maestro: false,
      cli: 'claude',
      model: 'claude-3-7-sonnet'
    }
  ];

  const setupPage = async (page) => {
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/projects') return route.fulfill({ json: { projects } });
      if (path === '/api/missions') return route.fulfill({ json: { missions } });
      if (path === '/api/panes') return route.fulfill({ json: { panes } });
      if (path === '/api/tasks') return route.fulfill({ json: { tasks: [] } });
      if (path === '/api/connections') return route.fulfill({ json: { connections: [] } });
      if (path === '/api/providers') return route.fulfill({ json: { providers: [{ id: 'codex', comando: 'codex', disponivel: true, caminho: '/usr/bin/codex', modelos: ['gpt-5.4'], efforts: ['low', 'high'], agentes: ['maestro'] }], presets: [] } });
      if (path === '/api/pontes') return route.fulfill({ json: { pontes: [] } });
      if (path === '/api/maestro' || path === '/api/maestro/refresh') return route.fulfill({ json: { agent: { label: 'MAESTRO', cli: 'codex', model: 'gpt-5.4', effort: 'high' }, auto: true, limits: {} } });
      if (path === '/api/config') return route.fulfill({ json: { agents: { maestro: { label: 'Maestro', cli: 'codex', cor: '#b8a1ff', maestro: true }, builder: { label: 'Builder', cli: 'claude', cor: '#4fb286' } }, squads: {}, tarefas: {}, providers: [] } });
      if (path === '/api/skills') return route.fulfill({ json: { skills: [], acervo: { total: 0, porOrigem: {} } } });
      if (path === '/api/receitas') return route.fulfill({ json: { receitas: {} } });
      if (path === '/api/marketplace') return route.fulfill({ json: { fontes: [], plugins: [] } });
      if (path === '/api/media') return route.fulfill({ json: { provedores: [] } });
      if (path === '/api/consumo') return route.fulfill({ json: { claude: { total: usage, porModelo: [], porDia: [], sessoes: 1, desde: null }, agy: { conversas: 0, pedidos: 0, ultima: null } } });
      if (path === '/api/memoria') return route.fulfill({ json: [] });
      if (path === '/api/tree') return route.fulfill({ json: { tree: [] } });
      return route.fulfill({ json: {} });
    });
    await page.routeWebSocket('**/ws', ws => {});
  };

  const testViewports = [
    { name: '1440x900 (Desktop Full)', width: 1440, height: 900 },
    { name: '1024x768 (Desktop Médio)', width: 1024, height: 768 },
    { name: '800x600 (Desktop Reduzido)', width: 800, height: 600 },
    { name: '768x1024 (Tablet)', width: 768, height: 1024 },
    { name: '390x844 (Mobile iPhone)', width: 390, height: 844 },
    { name: '360x740 (Mobile Android)', width: 360, height: 740 },
  ];

  for (const vp of testViewports) {
    console.log(`\nVerificando viewport: ${vp.name}...`);
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await setupPage(page);
    await page.goto(appUrl);
    await page.waitForSelector('.stage');
    await page.waitForTimeout(400);

    // 1. Verificar ausência de overflow horizontal no documento
    const scrollReport = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: window.innerWidth,
      hasOverflow: document.documentElement.scrollWidth > window.innerWidth
    }));
    assert.equal(scrollReport.hasOverflow, false, `Overflow horizontal detectado em ${vp.name}: ${scrollReport.scrollW} > ${scrollReport.clientW}`);
    console.log(`  ✓ Sem overflow horizontal (${scrollReport.scrollW} <= ${scrollReport.clientW})`);

    // 2. Verificar que os botões de ação do cabeçalho dos painéis estão visíveis e clicáveis
    const paneActionsCheck = await page.evaluate(() => {
      const actions = Array.from(document.querySelectorAll('.pane-head-actions'));
      return actions.every(a => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.right <= window.innerWidth && r.left >= 0;
      });
    });
    assert.equal(paneActionsCheck, true, `Botões de ação do painel cortados em ${vp.name}`);
    console.log(`  ✓ Botões do terminal (Detalhes e Fechar) 100% visíveis e acessíveis`);

    // 3. Testar se o modal de Adicionar Agente abre e tem botões visíveis
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await page.waitForSelector('dialog.modal-window');
    await page.waitForTimeout(200);

    const modalActionsCheck = await page.evaluate(() => {
      const actions = document.querySelector('.catalog-actions');
      if (!actions) return false;
      const r = actions.getBoundingClientRect();
      const modal = document.querySelector('dialog.modal-window');
      const mr = modal.getBoundingClientRect();
      // As ações devem estar dentro dos limites visíveis do modal e da viewport
      return r.bottom <= mr.bottom + 2 && r.top >= mr.top && r.height > 0 && r.right <= window.innerWidth;
    });
    assert.equal(modalActionsCheck, true, `Ações do modal não estão visíveis ou estão cortadas em ${vp.name}`);
    console.log(`  ✓ Modal: botões de ação (Cancelar/Avançar) perfeitamente visíveis e fixados`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 4. Se for mobile, testar gaveta lateral
    if (vp.width <= 760) {
      await page.locator('.abrir-lateral').click();
      await page.waitForSelector('.sidebar.aberta');
      await page.waitForTimeout(300);
      const drawerReport = await page.evaluate(() => {
        const sb = document.querySelector('.sidebar');
        const r = sb.getBoundingClientRect();
        return {
          left: r.left,
          width: r.width,
          scrollW: document.documentElement.scrollWidth,
          winW: window.innerWidth
        };
      });
      assert.ok(drawerReport.left >= -1, `Gaveta lateral não abriu corretamente: left=${drawerReport.left}`);
      assert.ok(drawerReport.scrollW <= drawerReport.winW, `Gaveta lateral causou overflow horizontal: ${drawerReport.scrollW} > ${drawerReport.winW}`);
      console.log(`  ✓ Gaveta lateral mobile abre sem overflow e se ajusta à tela`);
      await page.locator('.fechar-lateral').click();
      await page.waitForTimeout(300);
    }

    await page.close();
  }

  console.log('\n=============================================');
  console.log('TODAS AS VERIFICAÇÕES DE RESPONSIVIDADE PASSARAM COM SUCESSO!');
  console.log('=============================================');
} finally {
  await browser.close();
  server.close();
}
