// Usage: node scripts/check-ui.mjs <path-to-playwright-core/index.mjs>
// Serves the production build with isolated fixtures; never starts agent CLIs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : 'playwright');
const root = resolve('web/dist');
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url));
    if (!file.startsWith(root + '\\') && !file.startsWith(root + '/')) throw Error('Invalid path');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
// CHROME_PATH permite reaproveitar um Chromium ja baixado quando a versao do
// playwright-core disponivel nao bate com a dos navegadores instalados.
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let projects = [], missions = [], panes = [];
  let holdTree = false;
  const lateTrees = [];
  let maestroSettings = { agent: { label: 'MAESTRO', cli: 'codex', model: 'gpt-6-astra', effort: 'high' }, auto: true, limits: {}, providers: [{ id: 'codex', disponivel: true, modelos: ['gpt-6-astra'] }, { id: 'claude', disponivel: true, modelos: ['opus'] }, { id: 'agy', disponivel: true, modelos: ['gemini-3.1-pro-high'] }] };
  const politicaIA = { politica: { modo: 'padrao' }, agents: { maestro: { label: 'Maestro', cor: '#4195ff', cli: 'codex', model: 'gpt-6-astra' }, piloto: { label: 'Piloto', cor: '#4195ff', cli: 'claude', model: 'opus' }, builder: { label: 'Builder', cor: '#4195ff', cli: 'claude', model: 'sonnet' } }, providers: [{ id: 'codex', comando: 'codex', disponivel: true, caminho: 'C:/codex.exe', modelos: ['gpt-6-astra'], efforts: ['low', 'high'], agentes: ['maestro'] }] };
  const pontes = [{ id: 'openrouter', label: 'OpenRouter', base: 'codex', baseDisponivel: true, baseUrl: 'https://openrouter.ai/api/v1', chaveEnv: 'OPENROUTER_API_KEY', chaveEm: null, pronto: false, falta: 'falta a chave (OPENROUTER_API_KEY)', chaveUrl: 'https://openrouter.ai/settings/keys', modelos: [{ id: 'livre/modelo', nome: 'Livre', contexto: 200000, ferramentas: true, gratis: true }, { id: 'livre/conversa', nome: 'Conversa', contexto: 8000, ferramentas: false, gratis: true }], modelo: 'livre/modelo', agentes: ['gratis'], catalogoEm: Date.now(), nota: null }];
  let dshApis = [];
  const usage = { in: 0, out: 0, cacheWrite: 0, cacheRead: 0, custo: 0, turnos: 0, model: null };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/tree' && holdTree) { lateTrees.push(route); return; }
    if (path.startsWith('/api/projects/') && route.request().method() === 'DELETE') { projects = []; return route.fulfill({ json: { ok: true } }); }
    if (path === '/api/maestro' && route.request().method() === 'POST') { const body = route.request().postDataJSON(); maestroSettings = { ...maestroSettings, agent: { ...maestroSettings.agent, cli: body.cli, model: body.model, effort: body.effort }, auto: body.auto }; return route.fulfill({ json: maestroSettings }); }
    if (path === '/api/maestro' || path === '/api/maestro/refresh') return route.fulfill({ json: maestroSettings });
    if (path === '/api/politica-ia') return route.fulfill({ json: politicaIA });
    if (path === '/api/dsh-apis/modelos' && route.request().method() === 'POST') return route.fulfill({ json: { ok: true, modelos: [{ id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' }, { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }] } });
    if (path === '/api/dsh-apis') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        dshApis = [{ id: body.id, label: body.label, provider: body.provider, model: body.model, modelos: body.modelos || [], api: body.api || null, baseURL: body.baseURL || null, chaveEnv: 'COCKPIT_DSH_TEST_API_KEY', chaveEm: body.chave ? 'cofre do cockpit' : null, pronto: Boolean(body.chave), falta: body.chave ? null : 'falta a chave', chaveUrl: body.chaveUrl || null }];
        return route.fulfill({ json: { ok: true, api: dshApis[0] } });
      }
      if (route.request().method() === 'DELETE') { dshApis = []; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { apis: dshApis } });
    }
    if (path.startsWith('/api/pontes')) return route.fulfill({ json: route.request().method() === 'POST' ? { ok: true } : { pontes } });
    const data = path === '/api/config' ? { agents: { maestro: { label: 'Maestro', cli: 'claude', cor: '#00b4ff', maestro: true }, piloto: { label: 'Piloto', cli: 'claude', cor: '#e2703a', papel: 'Executa a tarefa direto' }, builder: { label: 'Builder', cli: 'claude', cor: '#4fb286', papel: 'Constroi e testa' }, artista: { label: 'Artista', cli: 'agy', cor: '#d9a441', papel: 'Imagens e video' } }, squads: {}, tarefas: {}, providers: [] }
      : path === '/api/projects' ? { projects } : path === '/api/missions' ? { missions }
      : path === '/api/providers' ? { providers: [], presets: [] }
      : path === '/api/consumo' ? { claude: { total: usage, porModelo: [], porDia: [], sessoes: 0, desde: null }, agy: { conversas: 0, pedidos: 0, ultima: null } }
      : path === '/api/skills' ? { skills: [{ nome: 'exemplo', descricao: 'skill de teste', papeis: [], caminho: 'C:/x/SKILL.md', origem: 'cockpit', editavel: true, tamanho: 10 }], acervo: { total: 1, porOrigem: { cockpit: 1 } } }
      : path === '/api/receitas' ? { receitas: { teste: { label: 'Teste', descricao: 'uma receita', modo: 'livre', daCasa: true } } }
      : path === '/api/marketplace' ? { fontes: [{ id: 'oficial', url: null, origem: 'claude', plugins: 1, caminho: 'C:/x' }], plugins: [{ id: 'oficial/exemplo', nome: 'exemplo', descricao: 'plugin de teste', categoria: 'design', marketplace: 'oficial', skills: [], mcps: [], local: true, remoto: null, homepage: null }] }
      : path === '/api/media' ? { provedores: [{ id: 'gemini-image', label: 'Gemini', faz: ['image'], via: 'http', pronto: false, falta: 'falta a chave', chaveEm: null, modelos: ['m1'], modelo: 'm1', instalar: null, nota: null }] }
      : path === '/api/panes' ? { panes } : path === '/api/file' ? { content: 'export const test = true;' } : path === '/api/tree' ? { tree: projects.length ? [{ nome: 'exemplo.ts', caminho: 'exemplo.ts', dir: false }] : [] } : [];
    return route.fulfill({ json: data });
  });
  let socket;
  const clientMessages = [];
  await page.routeWebSocket('**/ws', ws => { socket = ws; ws.onMessage(data => clientMessages.push(JSON.parse(String(data)))); });
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page.getByRole('button', { name: 'Abrir projeto', exact: true }).waitFor();
  await page.screenshot({ path: 'web/ui-desktop.png', fullPage: true });
  assert.equal(await page.locator('.sidebar-paginas').count(), 0, 'sem projeto nao ha pagina de arquivos');
  assert.equal(await page.getByRole('button', { name: 'Abrir projeto', exact: true }).count(), 1, 'so um botao diz Abrir projeto');
  projects = [{ id: 'p1', nome: 'Meu projeto', root: 'C:/projetos/exemplo', git: true }];
  missions = [{ id: 'm1', projectId: 'p1', nome: 'Interface do cockpit', objetivo: 'Refinar a experiência', branch: 'missao/interface', git: { dirty: 0, head: 'abc123' }, usage, panes: [], squad: null }];
  await page.reload();
  await page.getByRole('heading', { name: 'Traga o primeiro agente.' }).waitFor();
  // Projetos e missões moram numa janela, aberta pelo botão do projeto.
  await page.locator('.brand-button').click();
  await page.getByRole('dialog', { name: 'Projetos e missões', exact: true }).waitFor();
  assert.equal(await page.locator('.linha-toque').count(), 2, 'um projeto e uma missão na janela');
  await page.getByRole('button', { name: 'Fechar projetos', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  // Arquivos e memoria sao a segunda pagina da lateral, nao um painel novo.
  const paginas = page.getByRole('tablist', { name: 'Páginas da lateral' });
  await paginas.getByRole('tab', { name: 'Arquivos', exact: true }).click();
  await page.locator('.arquivos-pagina').waitFor();
  assert.equal(await page.locator('.mission-row').count(), 0, 'a pagina de arquivos substitui a de missoes na ilha');
  await page.getByRole('tab', { name: /Memória/ }).click();
  await paginas.getByRole('tab', { name: 'Missões', exact: true }).click();
  assert.equal(await page.locator('.arquivos-pagina').count(), 0);
  assert.equal(await page.locator('.sidebar-island').count(), 1, 'as duas paginas dividem a mesma ilha');
  // Duas missoes coexistem na lateral; a ativa abre com um terminal na tela.
  missions = [missions[0], { id: 'm2', projectId: 'p1', nome: 'Correcoes da API', objetivo: 'Ajustar contratos', branch: 'missao/api', git: { dirty: 0, head: 'def456' }, usage, panes: [], squad: null }];
  // Cores e estados variados: o mascote de cada agente e o estado dele precisam aparecer nos screenshots.
  const cores = ['#b8a1ff', '#e2703a', '#4fb286'];
  const estados = ['run', 'idle', 'dead'];
  panes = [1, 2, 3].map(n => ({ paneId: `pane${n}`, agent: 'maestro', label: 'Maestro', cor: cores[n - 1], missionId: 'm1', status: estados[n - 1], atividade: [], iniciadoEm: Date.now(), usage }));
  panes.push({ paneId: 'pane4', agent: 'maestro', label: 'Maestro', cor: '#8fb8ff', missionId: 'm2', status: 'idle', atividade: [], iniciadoEm: Date.now(), usage });
  await page.reload();
  await page.locator('.mission-row').first().waitFor();
  assert.equal(await page.locator('.mission-row').count(), 2, 'as duas missoes aparecem na lateral');
  await page.locator('.pane:visible .xterm').first().waitFor();
  assert.equal(await page.locator('.pane:visible').count(), 3, 'a missao aberta mostra todos os seus terminais, nao caixinhas');
  assert.equal(await page.locator('.agent-row').count(), 4, 'a missao ativa lista seus tres agentes e o atalho de adicionar');
  // Foco em qualquer painel abre uma camada centralizada sem desmontar os demais terminais.
  const primeiroPainel = page.locator('[data-pane-id="pane1"]');
  await primeiroPainel.getByRole('button', { name: /Focar Maestro/ }).click();
  await primeiroPainel.waitFor({ state: 'visible' });
  assert.equal(await primeiroPainel.evaluate(el => el.classList.contains('em-foco')), true, 'o primeiro painel entrou em foco');
  assert.equal(await primeiroPainel.getAttribute('role'), 'dialog', 'o painel focado tem semantica de dialogo');
  assert.equal(await primeiroPainel.getAttribute('aria-modal'), 'true', 'o painel focado e modal');
  assert.equal(await page.locator('.pane-focus-backdrop').count(), 1, 'a camada escura aparece');
  assert.equal(await primeiroPainel.getByRole('button', { name: /tela cheia/i }).count(), 1, 'o popup tem botão de tela cheia');
  assert.equal(await page.locator('.panes.tem-foco > .pane:not(.em-foco)').evaluateAll(els => els.every(el => getComputedStyle(el).visibility === 'hidden')), true, 'os outros paineis ficam fora da vista');
  const focoBounds = await primeiroPainel.boundingBox();
  assert.ok(focoBounds && Math.abs((focoBounds.x + focoBounds.width / 2) - 720) < 3, 'o painel focado fica centralizado na horizontal');
  assert.ok(focoBounds && Math.abs((focoBounds.y + focoBounds.height / 2) - 500) < 3, 'o painel focado fica centralizado na vertical');
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  assert.equal(await page.locator('.pane-focus-backdrop').count(), 0, 'Voltar fecha a camada');
  assert.equal(await page.locator('.pane:visible').count(), 3, 'Voltar devolve a grade completa');
  // Cada agente tem mascote, e o mascote carrega o estado real do painel.
  assert.equal(await page.locator('.agent-row .mascote').count(), 3, 'cada agente da missao tem um mascote');
  assert.equal(await page.locator('.agent-row .mascote.e-run').count(), 1, 'so o agente em atividade tem a cara de trabalhando');
  assert.equal(await page.locator('.agent-row .mascote.e-dead').count(), 1, 'o agente encerrado nao parece vivo');
  assert.equal(await page.locator('.sidebar-island').count(), 1, 'as missoes vivem numa ilha');
  await page.screenshot({ path: 'web/ui-lateral.png', fullPage: true });
  await page.getByRole('button', { name: 'Adicionar agente', exact: true }).click();
  await page.getByRole('dialog', { name: 'Adicionar Agente ou Terminal', exact: true }).waitFor();
  const catalog = page.getByRole('dialog', { name: 'Adicionar Agente ou Terminal', exact: true });
  assert.equal(await catalog.getByRole('radio').count(), 10, 'o catalogo exibe oito posições e duas especializações auxiliares');
  for (const nome of ['Orquestrador', 'Explorador', 'Arquiteto', 'Construtor', 'Depurador', 'Revisor', 'Verificador', 'Finalizador']) {
    assert.equal(await catalog.getByRole('radio', { name: new RegExp(nome) }).count(), 1, `${nome} aparece no catalogo`);
  }
  assert.equal(await catalog.getByText('Funções incorporadas', { exact: true }).count(), 1, 'o contrato explicita funções incorporadas');
  await catalog.getByRole('radio', { name: /Verificador/ }).click();
  await catalog.getByText('Auditor', { exact: true }).waitFor();
  assert.equal(await catalog.locator('.role-tile .mascote').count(), 10, 'cada posição do catalogo tem seu mascote');
  assert.equal(await catalog.locator('.role-tile .mascote.e-run').count(), 0, 'no catalogo ninguem finge estar trabalhando');
  await page.screenshot({ path: 'web/ui-agentes.png', fullPage: true });
  await page.getByRole('button', { name: 'Fechar catálogo', exact: true }).click();
  const originalTerminal = await page.locator('[data-pane-id="pane1"] .xterm').elementHandle();
  socket.send(JSON.stringify({ type: 'output', paneId: 'pane1', data: 'ANTES-DE-TROCAR\r\n' }));
  // Trocar de agente e depois de missao: a sessao do primeiro segue viva e escondida.
  await page.getByRole('button', { name: 'Maestro · 2', exact: true }).click();
  await page.locator('[data-pane-id="pane2"]:visible').waitFor();
  assert.equal(await page.locator('[data-pane-id="pane2"] .xterm').evaluate(el => el.contains(document.activeElement)), true, 'escolher o agente leva o cursor para o terminal dele');
  await page.getByRole('button', { name: 'Correcoes da API', exact: true }).click();
  await page.locator('[data-pane-id="pane4"]:visible').waitFor();
  assert.equal(await page.locator('.pane:visible').count(), 1, 'a outra missao traz so o terminal dela');
  assert.equal(await page.locator('[data-pane-id="pane1"]:visible').count(), 0, 'os terminais da missao anterior saem de vista');
  socket.send(JSON.stringify({ type: 'output', paneId: 'pane1', data: 'DURANTE-OUTRA-MISSAO\r\n' }));
  await page.getByRole('button', { name: 'Interface do cockpit', exact: true }).click();
  await page.getByRole('button', { name: 'Maestro · 1', exact: true }).click();
  await page.locator('[data-pane-id="pane1"]:visible').waitFor();
  assert.equal(await originalTerminal.evaluate(el => el === document.querySelector('[data-pane-id="pane1"] .xterm')), true, 'voltar preserva a instancia do terminal');
  await page.waitForFunction(() => /DURANTE-OUTRA-MISSAO/.test(document.querySelector('[data-pane-id="pane1"] .xterm-rows')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
  const linhas = await page.locator('[data-pane-id="pane1"] .xterm-rows').innerText();
  assert.match(linhas, /ANTES-DE-TROCAR/, 'a saida anterior a troca continua no terminal');
  assert.match(linhas, /DURANTE-OUTRA-MISSAO/, 'a saida recebida em outra missao chegou ao terminal');
  await page.screenshot({ path: 'web/ui-agent-focus.png', fullPage: true });
  assert.equal(clientMessages.filter(msg => msg.type === 'kill' || msg.type === 'spawn').length, 0, 'navegar nao encerra nem recria agentes');
  // Doze agentes: a lateral rola, um nome longo nao empurra a largura e o teclado abre.
  const nomeLongo = 'Especialista em integracao continua e revisao de contratos';
  panes = Array.from({ length: 12 }, (_, i) => ({ paneId: `muitos${i}`, agent: i === 0 ? 'revisor' : 'maestro', label: i === 0 ? nomeLongo : 'Maestro', cor: '#b8a1ff', missionId: 'm1', status: 'idle', atividade: [], iniciadoEm: Date.now(), usage }));
  await page.reload();
  await page.locator('.agent-row').first().waitFor();
  assert.equal(await page.locator('.agent-row').count(), 13, 'os doze agentes cabem na arvore da missao');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'doze agentes nao criam rolagem horizontal');
  assert.equal(await page.locator('.island-corpo').evaluate(el => getComputedStyle(el).overflowY), 'auto', 'a lista de missoes rola em vez de espremer');
  // As ferramentas ficam na ilha, ancoradas embaixo, mesmo com a lista rolando.
  assert.equal(await page.locator('.sidebar-island .sidebar-foot').count(), 1, 'as ferramentas moram na ilha');
  // A ilha e cheia: ocupa a lateral toda, com uma missao ou com doze.
  assert.equal(await page.locator('.sidebar-island').evaluate(el => el.getBoundingClientRect().height > el.closest('.sidebar').getBoundingClientRect().height * 0.6), true, 'a ilha ocupa a lateral');
  assert.equal(await page.locator('.agent-row').last().evaluate(el => el.getBoundingClientRect().right <= el.closest('.sidebar').getBoundingClientRect().right + 1), true, 'os nomes ficam dentro da lateral');
  const largura = await page.locator('.sidebar').boundingBox();
  assert.ok(largura.width <= 300, `a lateral esticou com o nome longo: ${largura.width}`);
  const primeiro = page.getByRole('button', { name: nomeLongo, exact: true });
  await primeiro.focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-pane-id="muitos0"]:visible').waitFor();
  assert.equal(await page.locator('.pane:visible').count(), 12, 'doze agentes abrem doze terminais');
  missions = [missions[0]];
  panes = [1, 2, 3].map(n => ({ paneId: `pane${n}`, agent: 'maestro', label: 'Maestro', cor: '#b8a1ff', missionId: 'm1', status: 'idle', atividade: [], iniciadoEm: Date.now(), usage }));
  await page.reload();
  await page.locator('.pane:visible').first().waitFor();
  // Tres agentes aparecem juntos, sem seletor na tela: a grade e automatica.
  assert.equal(await page.locator('.pane:visible').count(), 3, 'a missao mostra todos os seus terminais');
  assert.equal(await page.locator('.stage-bar').count(), 0, 'o palco nao tem barra em cima dos terminais');
  assert.equal(await page.getByRole('group', { name: 'Colunas dos terminais' }).count(), 0, 'o seletor de colunas saiu da tela principal');
  assert.equal(await page.locator('.panes').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2, 'tres terminais entram em duas colunas');
  // Tres painéis em duas colunas: o terceiro estica e nao sobra buraco preto.
  const larguras = await page.locator('.pane:visible').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().width)));
  assert.ok(larguras[2] >= larguras[0] + larguras[1] - 2, `terceiro painel nao esticou: ${larguras}`);
  // Quem quiser fixar colunas acha nos Ajustes, aba Tela.
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('tab', { name: 'Tela', exact: true }).click();
  const colunas = page.getByRole('group', { name: 'Colunas dos terminais' });
  await colunas.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar ajustes', exact: true }).click();
  assert.equal(await page.locator('.panes').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1, 'a escolha dos Ajustes vale no palco');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('tab', { name: 'Tela', exact: true }).click();
  await colunas.getByRole('button', { name: 'Auto', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar ajustes', exact: true }).click();
  assert.equal(await page.locator('.panes').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2, 'de volta ao automatico');
  await page.screenshot({ path: 'web/ui-workspace.png', fullPage: true });
  const paneBounds = await page.locator('.pane').first().boundingBox();
  await page.getByRole('button', { name: 'Consumo', exact: true }).click();
  await page.getByRole('dialog', { name: 'Atividade', exact: true }).waitFor();
  await page.getByRole('button', { name: /Detalhar consumo/ }).click();
  await page.getByRole('dialog', { name: 'Consumo', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Claude', exact: true }).waitFor();
  assert.deepEqual(await page.locator('.pane').first().boundingBox(), paneBounds);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
  await page.screenshot({ path: 'web/ui-modal.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  // Fechar a camada devolve o foco a quem a abriu, mesmo apos Atividade virar Consumo.
  assert.equal(await page.getByRole('button', { name: 'Consumo', exact: true }).evaluate(el => el === document.activeElement), true, 'o foco volta para o acionador da camada');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('dialog', { name: 'Ajustes', exact: true }).waitFor();
  // As seis abas dos ajustes existem e trocam de conteúdo.
  for (const aba of ['Grátis', 'Marketplace', 'Skills', 'Receitas', 'Media']) await page.getByRole('tab', { name: aba }).click();
  assert.equal(await page.getByRole('tab', { name: 'Media' }).getAttribute('aria-selected'), 'true');
  // Grátis: a ponte sem chave diz o que falta, e o modelo sem ferramentas
  // aparece desabilitado — clicar nele abriria um painel que não trabalha.
  await page.getByRole('tab', { name: 'Grátis' }).click();
  await page.getByText('falta a chave (OPENROUTER_API_KEY)').waitFor();
  assert.equal(await page.getByRole('button', { name: /livre\/modelo/ }).isDisabled(), false);
  assert.equal(await page.getByRole('button', { name: /livre\/conversa/ }).count(), 0, 'quem nao roda agente fica escondido por padrao');
  await page.getByRole('button', { name: /sem ferramentas$/ }).click();
  assert.equal(await page.getByRole('button', { name: /livre\/conversa/ }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Testar de verdade', exact: true }).isDisabled(), true, 'sem chave não há o que testar');
  await page.screenshot({ path: 'web/ui-gratis.png' });
  // Regressão: um servidor mais antigo que a tela devolve a página 404 do
  // Express, e a tela dizia "Unexpected token '<'". Agora diz o que fazer.
  await page.route('**/api/pontes', route => route.fulfill({ status: 404, contentType: 'text/html', body: '<!DOCTYPE html><body>Cannot GET</body>' }));
  await page.getByRole('tab', { name: 'Provedores' }).click();
  await page.getByRole('tab', { name: 'Grátis' }).click();
  await page.getByText(/servidor do cockpit está desatualizado/).waitFor();
  assert.equal(await page.locator('.tombo').count(), 0);
  await page.unroute('**/api/pontes');
  await page.getByRole('tab', { name: 'APIs DSH' }).click();
  await page.getByText('APIs diretas do DSH', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Conectar API ao DSH', exact: true }).click();
  await page.getByLabel('Chave da API').fill('chave-dsh-de-teste');
  await page.getByRole('button', { name: 'Salvar e disponibilizar no catálogo', exact: true }).click();
  await page.getByText('DeepSeek API', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Fechar ajustes', exact: true }).click();
  await page.locator('.brand-button').click();
  await page.getByRole('dialog', { name: 'Projetos e missões', exact: true }).getByRole('button', { name: 'Nova missão', exact: true }).click();
  await page.getByRole('dialog', { name: 'Nova missão', exact: true }).waitFor();
  const missionWizard = page.getByRole('dialog', { name: 'Nova missão', exact: true });
  assert.equal(await missionWizard.locator('.mission-role-card.primary').count(), 8, 'Nova missão exibe as oito posições principais');
  for (const nome of ['Orquestrador', 'Explorador', 'Arquiteto', 'Construtor', 'Depurador', 'Revisor', 'Verificador', 'Finalizador']) {
    assert.equal(await missionWizard.locator('.mission-role-card').filter({ hasText: nome }).count(), 1, `${nome} aparece na composição da missão`);
  }
  await missionWizard.getByRole('button', { name: /Verificador/ }).click();
  assert.equal(await missionWizard.getByText('Abrange: Verificador · Testador · Auditor', { exact: true }).count(), 1, 'Nova missão mostra as funções incorporadas');
  assert.deepEqual(await page.locator('.pane').first().boundingBox(), paneBounds);
  await page.getByRole('button', { name: 'Fechar nova missão', exact: true }).click();
  await page.getByRole('button', { name: 'Detalhes da missão', exact: true }).click();
  await page.getByRole('button', { name: 'Maestro', exact: true }).click();
  await page.getByRole('dialog', { name: 'Maestro e continuidade' }).waitFor();
  await page.getByRole('button', { name: 'Claude Cota não informada', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar padrão', exact: true }).click();
  await page.getByText('Preferência salva para os próximos maestros.').waitFor();
  assert.equal(maestroSettings.agent.cli, 'claude');
  // Regressão: uma resposta fora do formato nesta rota derrubava o cockpit
  // inteiro para a página de "a tela quebrou". Agora é um aviso local.
  await page.getByRole('button', { name: 'Fechar maestro', exact: true }).click();
  await page.route('**/api/politica-ia', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'Detalhes da missão', exact: true }).click();
  await page.getByRole('button', { name: 'Maestro', exact: true }).click();
  await page.getByRole('dialog', { name: 'Maestro e continuidade' }).waitFor();
  await page.getByText(/formato que esta tela não entende/).waitFor();
  assert.equal(await page.locator('.tombo').count(), 0, 'formato inesperado não pode derrubar o aplicativo');
  await page.getByRole('button', { name: 'Fechar maestro', exact: true }).click();
  await page.unroute('**/api/politica-ia');
  // A arvore vive na pagina Arquivos da lateral; o editor e que divide o palco.
  await page.getByRole('tablist', { name: 'Páginas da lateral' }).getByRole('tab', { name: 'Arquivos', exact: true }).click();
  await page.getByRole('button', { name: 'exemplo.ts', exact: true }).click();
  await page.locator('.editor-host').waitFor();
  await page.screenshot({ path: 'web/ui-arquivos.png', fullPage: true });
  holdTree = true;
  socket.send(JSON.stringify({ type: 'fs-change', path: 'exemplo.ts', base: 'C:/projetos/exemplo' }));
  await page.waitForRequest('**/api/tree?**');
  await page.locator('.brand-button').click();
  await page.getByTitle('Fechar projeto no cockpit', { exact: true }).click();
  await page.getByRole('button', { name: 'fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir projeto', exact: true }).waitFor();
  for (const route of lateTrees) await route.fulfill({ json: { tree: [{ nome: 'arquivo-antigo.ts', caminho: 'arquivo-antigo.ts', dir: false }] } });
  holdTree = false;
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.fnode').count(), 0);
  assert.equal(await page.locator('.editor').count(), 0);
  await socket.close();
  await page.getByRole('button', { name: 'Recarregar', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Abrir painel', exact: true }).count(), 0);
  projects = []; missions = []; panes = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Abrir projeto', exact: true }).waitFor();
  assert.equal(await page.locator('.sidebar-paginas').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'web/ui-mobile.png', fullPage: true });
  // Mobile com agentes: o palco e o terminal e a lateral vira gaveta.
  projects = [{ id: 'p1', nome: 'Meu projeto', root: 'C:/projetos/exemplo', git: true }];
  missions = [{ id: 'm1', projectId: 'p1', nome: 'Interface do cockpit', objetivo: 'Refinar a experiência', branch: 'b', git: { dirty: 0, head: 'a' }, usage, panes: [], squad: null }];
  panes = [1, 2, 3].map(n => ({ paneId: `pane${n}`, agent: 'maestro', label: 'Maestro', cor: '#b8a1ff', missionId: 'm1', status: 'idle', atividade: [], iniciadoEm: Date.now(), usage }));
  await page.reload();
  await page.locator('.pane:visible').first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().right <= 1), true, 'a gaveta comeca fora da tela no mobile');
  await page.screenshot({ path: 'web/ui-mobile-focus.png', fullPage: true });
  await page.getByRole('button', { name: 'Abrir lateral', exact: true }).click();
  await page.locator('.sidebar.aberta').waitFor();
  await page.waitForFunction(() => (document.querySelector('.sidebar')?.getBoundingClientRect().left ?? -999) >= -1, null, { timeout: 4000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'web/ui-mobile-lateral.png', fullPage: true });
  await page.getByRole('button', { name: 'Maestro · 3', exact: true }).click();
  await page.locator('[data-pane-id="pane3"]:visible').waitFor();
  assert.equal(await page.locator('.sidebar.aberta').count(), 0, 'escolher um agente fecha a gaveta');
  assert.deepEqual(errors, []);
  console.log('PASS: welcome, navigation, mission sidebar (switching mission or agent keeps every session and its output), twelve agents with keyboard, search, terminal layouts, modals with focus return, maestro selection, free-model bridge tab, malformed payload recovery, closing project with delayed tree response, disconnection, mobile drawer; no page errors.');
} finally { await browser.close(); server.close(); }
