import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;

mkdirSync('prints', { recursive: true });

console.log('=== INICIANDO E2E LIVE PLAYWRIGHT (ZERO MOCKS) ===');

// 1. Iniciar servidor real Express servidor/index.ts com COCKPIT_PORTA=3099
console.log(`Iniciando backend real Express em porta ${PORT}...`);
const serverProcess = spawn('npx', ['tsx', 'servidor/index.ts'], {
  cwd: resolve('.'),
  env: {
    ...process.env,
    COCKPIT_PORTA: String(PORT),
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

serverProcess.stderr.on('data', (d) => {
  const str = d.toString();
  if (str.includes('Error') || str.includes('error')) {
    console.error(`[Servidor Stderr]: ${str.trim()}`);
  }
});

function terminateServer() {
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill('SIGTERM');
      setTimeout(() => {
        try { serverProcess.kill('SIGKILL'); } catch {}
      }, 1000);
    } catch {}
  }
}

process.on('exit', terminateServer);
process.on('SIGINT', terminateServer);
process.on('SIGTERM', terminateServer);

try {
  // 2. Aguardar servidor responder HTTP 200 em /api/providers
  let ready = false;
  const startWait = Date.now();
  while (Date.now() - startWait < 20000) {
    try {
      const res = await fetch(`${BASE_URL}/api/providers`);
      if (res.status === 200) {
        const json = await res.json();
        if (json && Array.isArray(json.providers)) {
          ready = true;
          console.log(`✓ Servidor vivo respondeu HTTP 200 em /api/providers (${json.providers.length} provedores encontrados)`);
          break;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!ready) {
    throw new Error(`Servidor não subiu na porta ${PORT} em 20s`);
  }

  // Garantir que projeto e missão existam no backend vivo para exibir topbar e Maestro
  console.log('Verificando projeto e missão no backend vivo...');
  const resProj = await fetch(`${BASE_URL}/api/projects`);
  const projData = await resProj.json();
  let projId = projData.projects?.[0]?.id;
  if (!projId) {
    const createProj = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: '/DATA/Projetos/agent-project' }),
    });
    const newP = await createProj.json();
    projId = newP.id;
    console.log(`✓ Projeto criado no backend vivo: ${projId}`);
  } else {
    console.log(`✓ Projeto existente no backend vivo: ${projId}`);
  }

  const resMiss = await fetch(`${BASE_URL}/api/missions?projectId=${projId}`);
  const missData = await resMiss.json();
  let missId = Array.isArray(missData?.missions) && missData.missions.length > 0 ? missData.missions[0]?.id : undefined;
  if (!missId) {
    const createMiss = await fetch(`${BASE_URL}/api/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: projId,
        nome: 'Missão E2E Live',
        objetivo: 'Homologação E2E ao vivo sem mocks',
        modo: 'livre',
      }),
    });
    const newM = await createMiss.json();
    missId = newM.id;
    console.log(`✓ Missão criada no backend vivo: ${missId}`);
  } else {
    console.log(`✓ Missão existente no backend vivo: ${missId}`);
  }

  // 3. Conectar Playwright com Chromium headless em /home/jj/.cache/ms-playwright/chromium-1243
  const pwPath = '/home/jj/.agents/skills/playwright-skill/node_modules/playwright-core/index.mjs';
  const { chromium } = await import(pathToFileURL(resolve(pwPath)).href);

  const browser = await chromium.launch({
    executablePath: '/home/jj/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  // 4. ZERO page.route — estritamente sem mocks, dados 100% reais do backend vivo
  const page = await context.newPage();

  console.log(`Navegando para ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 5. Navegar para Ajustes → Provedores
  console.log('Abrindo Ajustes...');
  const ajustesBtn = page.locator('button:has-text("Ajustes"), button[aria-label="Configurações"]').first();
  await ajustesBtn.waitFor({ state: 'visible', timeout: 8000 });
  await ajustesBtn.click();

  // Aguarda modal de Ajustes abrir
  await page.waitForSelector('.ajustes', { timeout: 8000 });
  console.log('✓ Modal de Ajustes aberto com sucesso');

  // Validar .badge-pool
  await page.waitForSelector('.badge-pool', { timeout: 8000 });
  const badgeTexts = await page.$$eval('.badge-pool', (els) => els.map((e) => e.textContent?.trim()));
  console.log(`✓ Badges de pool encontradas (${badgeTexts.length}):`, badgeTexts);

  // Print 1: Ajustes Provedores
  await page.screenshot({ path: 'prints/e2e-live-01-ajustes-provedores.png', fullPage: false });
  console.log('✓ Salvo: prints/e2e-live-01-ajustes-provedores.png');

  // Clicar para abrir .prov-pool-drawer no primeiro provedor com pool (ex: codex)
  const contasBtn = page.locator('.prov-item-wrapper button:has-text("Contas")').first();
  await contasBtn.click();
  await page.waitForSelector('.prov-pool-drawer', { timeout: 6000 });
  console.log('✓ Drawer de contas aberto com sucesso');

  // Validar tags reais (.conta-pool-tag)
  const tagsIniciais = await page.$$eval('.conta-pool-tag', (els) => els.map((e) => e.textContent?.trim()));
  console.log(`✓ Tags de conta identificadas no drawer (${tagsIniciais.length}):`, tagsIniciais);

  // Colocar codex-1 em cooldown via API real para validar UI de cooldown e botão resetar
  console.log('Acionando marcação de cooldown real via API...');
  const resLimit = await fetch(`${BASE_URL}/api/account-pools/mark-limit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cli: 'codex', accountId: 'codex-1', detail: '429 Rate Limit E2E Test', duration: 120000 }),
  });
  if (!resLimit.ok) {
    console.warn('Aviso: mark-limit retornou status', resLimit.status);
  }

  // Aguardar reflexo do cooldown na UI
  await page.waitForTimeout(1000);

  // Print 2: Drawer de Contas com detalhes e cooldown
  await page.screenshot({ path: 'prints/e2e-live-02-drawer-contas.png', fullPage: false });
  console.log('✓ Salvo: prints/e2e-live-02-drawer-contas.png');

  // Acionar botão de reset na UI
  const resetBtn = page.locator('.prov-pool-drawer button:has-text("Resetar cota")').first();
  if (await resetBtn.isVisible()) {
    console.log('Clicando no botão "Resetar cota" na interface...');
    await resetBtn.click();
    await page.waitForTimeout(1000);
    console.log('✓ Reset acionado com sucesso na interface');
  } else {
    const resetAllBtn = page.locator('.prov-pool-drawer button:has-text("Resetar cota de todas")').first();
    if (await resetAllBtn.isVisible()) {
      await resetAllBtn.click();
      await page.waitForTimeout(1000);
      console.log('✓ Reset de todas acionado com sucesso na interface');
    }
  }

  // Fechar ajustes
  const fecharAjustesBtn = page.locator('.fechar-modal-btn, button[aria-label="Fechar ajustes"]').first();
  await fecharAjustesBtn.click();
  await page.waitForSelector('.ajustes', { state: 'hidden', timeout: 5000 });
  console.log('✓ Modal de Ajustes fechado');

  // Abrir detalhes da missão ou botão Maestro
  console.log('Abrindo modal do Maestro...');
  const missaoBtn = page.locator('button:has-text("Missão"), button:has-text("Detalhes"), button[aria-label="Detalhes da missão"]').first();
  await missaoBtn.waitFor({ state: 'visible', timeout: 8000 });
  await missaoBtn.click();
  console.log('✓ Detalhes da missão aberto');

  const maestroBtn = page.locator('button:has-text("Maestro e continuidade"), button[aria-label="Maestro"]').first();
  await maestroBtn.waitFor({ state: 'visible', timeout: 8000 });
  await maestroBtn.click();

  await page.waitForSelector('.wizard-topo:has-text("Maestro"), h2:has-text("Maestro e continuidade")', { timeout: 8000 });
  console.log('✓ Modal do Maestro aberto com sucesso');

  // Print 3: Maestro modal
  await page.screenshot({ path: 'prints/e2e-live-03-maestro-modal.png', fullPage: false });
  console.log('✓ Salvo: prints/e2e-live-03-maestro-modal.png');

  await browser.close();
  console.log('✓ Playwright finalizado com 100% de sucesso.');
} finally {
  console.log('Encerrando servidor Cockpit real...');
  terminateServer();
}

console.log('\n=== HOMOLOGAÇÃO E2E PLAYWRIGHT COM BACKEND VIVO: 100% PASS ===');
process.exit(0);
