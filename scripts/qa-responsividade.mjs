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
      model: 'gpt-5.4-hyper-deep-preview',
      effort: 'high'
    },
    {
      paneId: 'pane2',
      agent: 'builder',
      label: 'Builder de Frontend Web',
      cor: '#4fb286',
      missionId: 'm1',
      status: 'idle',
      atividade: [0, 1, 2],
      iniciadoEm: Date.now() - 180000,
      usage,
      maestro: false,
      cli: 'claude',
      model: 'claude-3-7-sonnet-latest'
    },
    {
      paneId: 'pane3',
      agent: 'terminal',
      label: 'Terminal Bash Local',
      cor: '#8fb8ff',
      missionId: 'm1',
      status: 'idle',
      atividade: [],
      iniciadoEm: Date.now() - 90000,
      usage,
      maestro: false,
      cli: 'bash',
      model: null
    }
  ];

  const tasks = [
    {
      id: 'task-101',
      missionId: 'm1',
      título: 'Ajustar quebra de linhas e responsividade do cabeçalho de terminais',
      status: 'in-progress',
      assignedPaneId: 'pane1',
      evidências: []
    },
    {
      id: 'task-102',
      missionId: 'm1',
      título: 'Otimizar gaveta mobile e remoção de overflow horizontal',
      status: 'todo',
      assignedPaneId: 'pane2',
      evidências: []
    }
  ];

  const connections = [
    { id: 'conn-1', missionId: 'm1', sourcePaneId: 'pane1', targetPaneId: 'pane2', criadoEm: Date.now() }
  ];

  const maestroSettings = { agent: { label: 'MAESTRO', cli: 'codex', model: 'gpt-5.4', effort: 'high' }, auto: true, limits: {} };
  const providers = [
    { id: 'codex', comando: 'codex', disponivel: true, caminho: '/usr/bin/codex', modelos: ['gpt-5.4', 'gpt-4o'], efforts: ['low', 'high'], agentes: ['maestro'] },
    { id: 'claude', comando: 'claude', disponivel: true, caminho: '/usr/bin/claude', modelos: ['sonnet', 'opus'], efforts: [], agentes: ['builder'] }
  ];
  const pontes = [];

  const setupPage = async (page) => {
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/projects') return route.fulfill({ json: { projects } });
      if (path === '/api/missions') return route.fulfill({ json: { missions } });
      if (path === '/api/panes') return route.fulfill({ json: { panes } });
      if (path === '/api/tasks') return route.fulfill({ json: { tasks } });
      if (path === '/api/connections') return route.fulfill({ json: { connections } });
      if (path === '/api/providers') return route.fulfill({ json: { providers, presets: [] } });
      if (path === '/api/pontes') return route.fulfill({ json: { pontes } });
      if (path === '/api/maestro' || path === '/api/maestro/refresh') return route.fulfill({ json: maestroSettings });
      if (path === '/api/config') return route.fulfill({ json: { agents: { maestro: { label: 'Maestro', cli: 'codex', cor: '#b8a1ff', maestro: true }, builder: { label: 'Builder', cli: 'claude', cor: '#4fb286' } }, squads: {}, tarefas: {}, providers } });
      if (path === '/api/skills') return route.fulfill({ json: { skills: [], acervo: { total: 0, porOrigem: {} } } });
      if (path === '/api/receitas') return route.fulfill({ json: { receitas: {} } });
      if (path === '/api/marketplace') return route.fulfill({ json: { fontes: [], plugins: [] } });
      if (path === '/api/media') return route.fulfill({ json: { provedores: [] } });
      if (path === '/api/consumo') return route.fulfill({ json: { claude: { total: usage, porModelo: [], porDia: [], sessoes: 1, desde: null }, agy: { conversas: 0, pedidos: 0, ultima: null } } });
      if (path === '/api/memoria') return route.fulfill({ json: [] });
      if (path === '/api/tree') return route.fulfill({ json: { tree: [] } });
      return route.fulfill({ json: {} });
    });
    await page.routeWebSocket('**/ws', ws => {
      // no-op mock socket
    });
  };

  const viewports = [
    { name: 'desktop-1440', width: 1440, height: 900 },
    { name: 'desktop-1024', width: 1024, height: 768 },
    { name: 'desktop-800',  width: 800,  height: 600 },
    { name: 'tablet-768',   width: 768,  height: 1024 },
    { name: 'mobile-390',   width: 390,  height: 844 },
    { name: 'mobile-360',   width: 360,  height: 740 }
  ];

  const results = [];

  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await setupPage(page);
    await page.goto(appUrl);
    await page.waitForSelector('.stage');
    await page.waitForTimeout(600);

    // Avaliar transbordamentos e elementos cortados
    const overflowReport = await page.evaluate(() => {
      const docW = document.documentElement.scrollWidth;
      const winW = window.innerWidth;
      const docH = document.documentElement.scrollHeight;
      const winH = window.innerHeight;

      const topbar = document.querySelector('.stage-topbar');
      const topbarBox = topbar ? topbar.getBoundingClientRect() : null;

      const paneHeads = Array.from(document.querySelectorAll('.pane-head')).map(h => {
        const box = h.getBoundingClientRect();
        const main = h.querySelector('.pane-head-main');
        const mainBox = main ? main.getBoundingClientRect() : null;
        const actions = h.querySelector('.pane-head-actions');
        const actionsBox = actions ? actions.getBoundingClientRect() : null;
        return {
          width: box.width,
          mainScrollWidth: main ? main.scrollWidth : 0,
          mainClientWidth: main ? main.clientWidth : 0,
          mainHasOverflow: main ? main.scrollWidth > main.clientWidth + 1 : false,
          actionsVisible: actionsBox ? (actionsBox.right <= window.innerWidth && actionsBox.width > 0) : false,
          actionsRight: actionsBox ? actionsBox.right : 0
        };
      });

      const btnAbrirLateral = document.querySelector('.abrir-lateral');
      const btnAbrirBox = btnAbrirLateral && getComputedStyle(btnAbrirLateral).display !== 'none'
        ? btnAbrirLateral.getBoundingClientRect()
        : null;

      let topbarOverlap = false;
      if (btnAbrirBox && topbarBox) {
        // Checar se o botão sobrepõe a barra do topo
        topbarOverlap = !(
          btnAbrirBox.right < topbarBox.left ||
          btnAbrirBox.left > topbarBox.right ||
          btnAbrirBox.bottom < topbarBox.top ||
          btnAbrirBox.top > topbarBox.bottom
        );
      }

      return {
        docW,
        winW,
        hasHorizontalDocScroll: docW > winW,
        paneHeads,
        btnAbrirBox,
        topbarBox,
        topbarOverlap
      };
    });

    await page.screenshot({ path: `/tmp/cockpit-prints/resp-${vp.name}.png` });

    // Testar abrindo modal de Ajustes para ver layout das abas e corpo
    await page.getByRole('button', { name: 'Configurações', exact: true }).click().catch(() => {});
    const modalAjustes = await page.locator('dialog.modal-window').isVisible().catch(() => false);
    if (modalAjustes) {
      await page.waitForTimeout(300);
      const modalReport = await page.evaluate(() => {
        const dialog = document.querySelector('dialog.modal-window');
        const box = dialog ? dialog.getBoundingClientRect() : null;
        const abas = dialog ? dialog.querySelector('.abas') : null;
        return {
          dialogBox: box,
          overflowX: box ? box.right > window.innerWidth || box.left < 0 : false,
          abasScrollWidth: abas ? abas.scrollWidth : 0,
          abasClientWidth: abas ? abas.clientWidth : 0
        };
      });
      await page.screenshot({ path: `/tmp/cockpit-prints/resp-${vp.name}-ajustes.png` });
      overflowReport.modalAjustes = modalReport;
      await page.keyboard.press('Escape');
    }

    results.push({ viewport: vp, overflowReport });
    await page.close();
  }

  console.log(JSON.stringify(results, null, 2));

} finally {
  await browser.close();
  server.close();
}
