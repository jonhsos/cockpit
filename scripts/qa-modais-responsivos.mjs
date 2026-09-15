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
      label: 'Maestro Coordenador',
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
    }
  ];

  const tasks = [
    {
      id: 'task-101',
      missionId: 'm1',
      título: 'Ajustar quebra de linhas e responsividade do cabeçalho',
      status: 'in-progress',
      assignedPaneId: 'pane1',
      evidências: []
    }
  ];

  const setupPage = async (page) => {
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/projects') return route.fulfill({ json: { projects } });
      if (path === '/api/missions') return route.fulfill({ json: { missions } });
      if (path === '/api/panes') return route.fulfill({ json: { panes } });
      if (path === '/api/tasks') return route.fulfill({ json: { tasks } });
      if (path === '/api/connections') return route.fulfill({ json: { connections: [] } });
      if (path === '/api/providers') return route.fulfill({ json: { providers: [{ id: 'codex', comando: 'codex', disponivel: true, caminho: '/usr/bin/codex', modelos: ['gpt-5.4'], efforts: ['low', 'high'], agentes: ['maestro'] }], presets: [] } });
      if (path === '/api/pontes') return route.fulfill({ json: { pontes: [] } });
      if (path === '/api/maestro' || path === '/api/maestro/refresh') return route.fulfill({ json: { agent: { label: 'MAESTRO', cli: 'codex', model: 'gpt-5.4', effort: 'high' }, auto: true, limits: {} } });
      if (path === '/api/config') return route.fulfill({ json: { agents: { maestro: { label: 'Maestro', cli: 'codex', cor: '#b8a1ff', maestro: true } }, squads: {}, tarefas: {}, providers: [] } });
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

  // Testar mobile: abertura de lateral, detalhes, adicionar agente
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await setupPage(page);
  await page.goto(appUrl);
  await page.waitForSelector('.stage');
  await page.waitForTimeout(400);

  // 1. Abrir lateral no mobile
  await page.locator('.abrir-lateral').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/cockpit-prints/mobile-lateral-aberta.png' });
  await page.locator('.fechar-lateral').click();
  await page.waitForTimeout(300);

  // 2. Abrir Detalhes da Missão no mobile
  await page.getByRole('button', { name: 'Detalhes', exact: true }).click();
  await page.waitForSelector('dialog.modal-window');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/cockpit-prints/mobile-detalhes-missao.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 3. Abrir Adicionar Agente (RoleCatalog) no mobile
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.waitForSelector('dialog.modal-window');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/cockpit-prints/mobile-adicionar-agente.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await page.close();

  // Testar desktop 800px: Detalhes e Adicionar Agente
  const page800 = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await setupPage(page800);
  await page800.goto(appUrl);
  await page800.waitForSelector('.stage');
  await page800.waitForTimeout(400);

  await page800.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page800.waitForSelector('dialog.modal-window');
  await page800.waitForTimeout(300);
  await page800.screenshot({ path: '/tmp/cockpit-prints/desktop800-adicionar-agente.png' });
  await page800.keyboard.press('Escape');

  await page800.close();

  console.log('Prints gravados com sucesso!');
} finally {
  await browser.close();
  server.close();
}
