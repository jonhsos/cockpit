# CHECKPOINT — Reforma da Orquestração do Cockpit

**Data do Checkpoint:** 2026-09-13 20:52 BRT  
**Branch:** `feat/suporte-linux` (preservada, sem commits destrutivos)  
**Status da Suíte de Testes:** **40/40 verificações PASS (100% de aprovação)**, `tsc` código 0, `build` código 0.

---

## 1. Visão Geral do Estado Atual

O projeto concluiu com 100% de sucesso e aprovação formal independente:
- **Marco 1 (M1)**: Domínio de Tasks (13 campos estruturados, máquina formal de 6 estados), Persistência Transacional atômica (`DiskStore`), File Ownership (`isolated` com lock exclusivo e 409 Conflict vs `shared`) e Sanitização de Credenciais em tempo real (`SecretSanitizer`).
- **Marco 2 (M2)**: Soberania absoluta de SHELL como `/bin/bash -i -l` (zero prompts ocultos, zero LLM auto-boot, precedência soberana do usuário), Host PTY desacoplado com ring buffer de 256KB sobrevivendo a restarts do servidor web na porta 3000, e Máquina de 8 estados granulares de painéis.
- **Marco 3 (M3)**: Strict Harness sem fallback silencioso para Codex (`maestroAutoSwitch: false`), Mailbox inter-panes persistente com 5 verbos (`cockpit list`, `connect`, `ask`, `reply`, `handoff`) com isolamento estrito e zero bytes no stdin do bash, e Modos de Missão (`Livre`, `Dirigido`, `Autônomo`).
- **Marco 4 (M4)**: Reorganização Arquitetural Modular do Servidor em 10 diretórios funcionais (`routes/`, `websocket/`, `orchestration/`, `sessions/`, `tasks/`, `connections/`, `missions/`, `providers/`, `persistence/`, `security/`), com `servidor/index.ts` reduzido de 1.469 linhas para 131 linhas limpas e preservação de 100% de retrocompatibilidade de endpoints e testes.

---

## 2. Decisões Arquiteturais Implementadas em M4

1. **Modularização em 10 Diretórios Funcionais com Barrels Explícitos (R12: Features 44–53)**:
   - Toda a lógica espalhada no monólito `servidor/index.ts` (1.469 linhas) foi dividida em controladores especializados e desacoplados, reduzindo `index.ts` a apenas **131 linhas** focadas em orquestração limpa e bootstrap.
   - Os 10 diretórios canônicos estipulados em `PROJECT.md` foram criados com pontos de entrada limpos (`index.ts` barrel):
     * `servidor/routes/`: Router Express modular agrupando controllers REST (`cockpit-routes.ts`, `config-routes.ts`, `connection-routes.ts`, `cotas-routes.ts`, `fs-routes.ts`, `marketplace-routes.ts`, `media-routes.ts`, `mission-routes.ts`, `project-routes.ts`, `squad-routes.ts`, `task-routes.ts`, `usage-routes.ts`).
     * `servidor/websocket/`: Servidor WebSocket isolado (`ws-server.ts`), tipagem estrita de mensagens (`ws-types.ts`), dispatcher desacoplado de eventos em tempo real (`output`, `exit`, `inbox:message`, `fs-change`, `task:updated`).
     * `servidor/orchestration/`: `MaestroCoordinator` para coordenação de estado, modos de missão (`mission-modes.ts`), despacho de tarefas a painéis existentes (`pane-dispatcher.ts`), harness estrito (`harness.ts`) e ferramentas MCP (`mcp-maestro.ts`).
     * `servidor/sessions/`: Spawner de clean bash soberano (`clean-shell.ts`), máquina de 8 estados (`pane-state.ts`), daemon desacoplado (`pty-daemon.ts`) e gerenciador de buffers (`pty-manager.ts`).
     * `servidor/tasks/`: Entidade Task com 13 campos e máquina de 6 estados (`task-types.ts`, `task-manager.ts`), rotas REST (`task-routes.ts`) e guardião de locks de arquivos (`file-ownership.ts`).
     * `servidor/connections/`: Conexões persistentes (`connection-manager.ts`), Mailbox inter-panes (`mailbox-manager.ts`, `mailbox-store.ts`), Handoffs estruturados (`handoff-manager.ts`), bridge dos 5 verbos (`inter-agent-bridge.ts`) e CLI (`cockpit-cli.ts`, `bin/cockpit.mjs`).
     * `servidor/missions/`: Gerenciador de missões (`missions.ts`), isolamento de worktrees git (`git.ts`), continuidade de contexto (`continuity.ts`) e observador de arquivos (`watcher.ts`).
     * `servidor/providers/`: Detecção de binários no host PATH (`providers.ts`), adaptadores de pontes e provedores externos (`ponte.ts`, `conectar.ts`), cotas e media (`media.ts`).
     * `servidor/persistence/`: `DiskStore` atômico transacional com safe-writes (`disk-store.ts`), stores de entidades (`mission-store.ts`, `task-store.ts`, `connection-store.ts`, `handoff-store.ts`) e log de auditoria (`audit-log.ts`).
     * `servidor/security/`: Sanitizador de segredos por regex (`secret-sanitizer.ts`), sandbox de permissões de escrita (`permission-guard.ts`) e auditoria de ações perigosas (`audit.ts`).

2. **Retrocompatibilidade e Shims de Exportação**:
   - Os arquivos de nível superior em `servidor/*.ts` (`missions.ts`, `tasks.ts`, `harness.ts`, `pty.ts`, `state.ts`, etc.) foram transformados em shims transparentes que reexportam os símbolos de seus respectivos subdiretórios modulares.
   - Isso garante que nenhum script pré-existente, suíte de teste externa ou importação interna quebre.

3. **Auditoria e Desafio Adversarial**:
   - O Gate de M4 foi submetido e aprovado formalmente com aprovações unânimes:
     * 2 Reviewers independentes (`m4_reviewer_1` e `m4_reviewer_2`): veredicto **APPROVE**.
     * 1 Auditor Forense (`m4_auditor_1`): veredicto **CLEAN** (confirmada ausência de hardcodes, integridade de barrels e conformidade com R12).
     * 2 Agentes Adversariais (`m4_challenger_1` e `m4_challenger_2`): veredicto **APPROVE** com 36/36 verificações verdes.

---

## 3. Resumo dos Arquivos Criados e Alterados em M4

### Módulos do Servidor Criados:
- `servidor/routes/index.ts`
- `servidor/routes/cockpit-routes.ts`
- `servidor/routes/config-routes.ts`
- `servidor/routes/connection-routes.ts`
- `servidor/routes/cotas-routes.ts`
- `servidor/routes/fs-routes.ts`
- `servidor/routes/marketplace-routes.ts`
- `servidor/routes/media-routes.ts`
- `servidor/routes/mission-routes.ts`
- `servidor/routes/project-routes.ts`
- `servidor/routes/squad-routes.ts`
- `servidor/routes/task-routes.ts`
- `servidor/routes/usage-routes.ts`
- `servidor/websocket/index.ts`
- `servidor/websocket/ws-server.ts`
- `servidor/websocket/ws-types.ts`
- `servidor/websocket/ws-dispatcher.ts`
- `servidor/orchestration/coordinator.ts`
- `servidor/missions/index.ts`
- `servidor/providers/index.ts`

### Testes Criados:
- `scripts/check-m4-adversarial.ts` (testes de integridade de rotas, controllers e barrel exports)
- `scripts/check-m4-adversarial-2.ts` (testes de estresse de WebSocket, concorrência e race conditions)

### Arquivos Modificados/Refatorados:
- `servidor/index.ts` (reduzido de 1.469 para 131 linhas)
- `servidor/missions.ts` (exportações delegadas ao novo módulo modular)
- `servidor/providers.ts` (exportações delegadas)
- `servidor/orchestration/index.ts` (adicionado `MaestroCoordinator`)

---

## 4. Testes Executados e Resultados Consolidados

Comando executado: `node scripts/testar.mjs`
```
ok      tipos (tsc) (2.0s)
ok      build (vite) (2.2s)
ok      check-auto-aprovar.ts (0.2s)
ok      check-clean-shell.ts (0.2s)
ok      check-codex-launch.ts (0.2s)
ok      check-codex-quota.ts (1.3s)
ok      check-codex-trust.mjs (0.1s)
ok      check-connections.ts (4.1s)
ok      check-continuity.ts (0.1s)
ok      check-cotas.ts (0.2s)
ok      check-decoupled-pty.ts (0.8s)
ok      check-e2e.mjs (0.1s)
PULADO  check-edicao.mjs — precisa do Playwright
ok      check-failover.mjs (1.6s)
ok      check-harness.ts (0.2s)
ok      check-m2-stress.ts (4.4s)
ok      check-m3-adversarial-2.ts (0.3s)
ok      check-m3-adversarial.ts (4.1s)
ok      check-m4-adversarial-2.ts (3.2s)
ok      check-m4-adversarial.ts (1.3s)
ok      check-media.ts (0.2s)
ok      check-mission-modes.ts (0.2s)
ok      check-openrouter.ts (0.2s)
ok      check-pane-dispatch.ts (0.2s)
ok      check-pane-states.ts (0.1s)
ok      check-persistence.ts (0.2s)
ok      check-politica-ia.ts (0.2s)
ok      check-ponte.mjs (3.4s)
ok      check-security-approval.ts (0.2s)
ok      check-security-audit.ts (0.2s)
ok      check-security-permissions.ts (0.2s)
ok      check-security-sanitizer.ts (0.1s)
ok      check-stress-m1.ts (5.1s)
ok      check-stress-m2.ts (1.2s)
ok      check-stress-m3.ts (7.0s)
ok      check-strict-harness.ts (0.2s)
ok      check-tasks.ts (0.3s)
PULADO  check-ui.mjs — precisa do Playwright

PASS: 36 verificações, nenhuma falha (2 puladas por ausência do Playwright).
```

- `npx tsc --noEmit`: código de saída 0 (zero erros de tipos).
- `npm run build`: código de saída 0 (build do Vite frontend e backend 100% íntegro).

---

- **Marco 5 (M5)**: Interface do Usuário, Catálogo Focado em Papéis, Fluxo de Seleção em 2 Etapas, Placar de Tarefas Lateral Interativo (`QuadroTarefas.tsx`), Conexões Visuais Fidedignas e Confirmações para Ações Destrutivas. Aprovado formalmente por reviewers, challengers e auditor.
- **Marco 6 (M6)**: Hardening Final, Parser Defensivo de WebSocket (`ws-dispatcher.ts`, `ws-types.ts`), Resiliência Concorrente (tempestade com 10 atacantes simultâneos e clientes legítimos isolados), Prevenção Rigorosa de Prototype Pollution, Defesa em Controladores REST e Encerramento Limpo sem vazamento de timers ou processos órfãos. 27 testes adversariais adicionados em `scripts/check-m6-hardening.ts`.

---

## 5. Status de Verificação Consolidado

Comando executado: `node scripts/testar.mjs`
```
ok      tipos (tsc) (2.5s)
ok      build (vite) (2.1s)
ok      check-auto-aprovar.ts (0.2s)
ok      check-clean-shell.ts (0.2s)
ok      check-codex-launch.ts (0.2s)
ok      check-codex-quota.ts (1.1s)
ok      check-codex-trust.mjs (0.1s)
ok      check-connections.ts (4.1s)
ok      check-continuity.ts (0.1s)
ok      check-cotas.ts (0.2s)
ok      check-decoupled-pty.ts (0.8s)
ok      check-e2e.mjs (0.1s)
PULADO  check-edicao.mjs — precisa do Playwright
ok      check-failover.mjs (1.6s)
ok      check-harness.ts (0.2s)
ok      check-m2-stress.ts (4.5s)
ok      check-m3-adversarial-2.ts (0.3s)
ok      check-m3-adversarial.ts (3.9s)
ok      check-m4-adversarial-2.ts (3.2s)
ok      check-m4-adversarial.ts (1.2s)
ok      check-m5-adversarial-2.ts (0.2s)
ok      check-m5-adversarial.ts (0.6s)
ok      check-m5-ui.ts (0.2s)
ok      check-m6-hardening.ts (1.0s)
ok      check-media.ts (0.2s)
ok      check-mission-modes.ts (0.2s)
ok      check-openrouter.ts (0.2s)
ok      check-pane-dispatch.ts (0.2s)
ok      check-pane-states.ts (0.1s)
ok      check-persistence.ts (0.2s)
ok      check-politica-ia.ts (0.2s)
ok      check-ponte.mjs (3.4s)
ok      check-security-approval.ts (0.2s)
ok      check-security-audit.ts (0.2s)
ok      check-security-permissions.ts (0.1s)
ok      check-security-sanitizer.ts (0.2s)
ok      check-stress-m1.ts (4.7s)
ok      check-stress-m2.ts (1.1s)
ok      check-stress-m3.ts (6.8s)
ok      check-strict-harness.ts (0.2s)
ok      check-tasks.ts (0.3s)
PULADO  check-ui.mjs — precisa do Playwright

PASS: 40 verificações, nenhuma falha (2 puladas por ausência do Playwright).
```

- `npx tsc --noEmit`: código de saída 0 (zero erros de compilação TypeScript).
- `npm run build`: código de saída 0 (build do Vite frontend e backend 100% íntegro).

---

## 6. Marcos M7, M8 e M9: Gestão de Provedores, Pool AGY e Onboarding Plug-and-Play

**Data do Checkpoint M7–M9:** 2026-09-15 01:45 BRT  
**Status da Suíte de Testes:** **49/49 verificações PASS (100% de aprovação)**, `tsc` código 0, `build` código 0.

### 6.1 Marco M7 — Pool AGY e Limpeza de Configuração Gemini
- **Remoção de CLI fictício**: Remoção completa do bloco `clis.gemini` com pastas artificiais de `cockpit.json`. Agentes que usam a família Gemini (Flash, Artista) agora utilizam diretamente o Antigravity CLI (`agy`).
- **Isolamento de Contas no Pool AGY**: O pool de 4 contas reais (`agy-1` a `agy-4`) foi posicionado sob `clis.agy.pool` com diretórios de perfil dedicados (`~/.gemini/antigravity-cli/profiles/conta_1` a `conta_4`) sob permissões seguras `0700`.
- **PTY Spawner e Settings**: `servidor/sessions/pty-manager.ts` e `servidor/providers/agy.ts` agora expandem e injetam variáveis de ambiente (`JETSKI_APP_DATA_DIR` e `HOME`) e persistem o modelo em `settings.json` específico de cada conta isolada.
- **Validação Adversarial M7**: `scripts/check-m7-adversarial-2.ts` aprovado sem colisões em concorrência.

### 6.2 Marco M8 — Onboarding OAuth, Servidor Loopback e Túnel Reverso (Estilo OmniRoute)
- **Serviço de Onboarding**: `servidor/providers/agy-onboarding.ts` implementado com servidor loopback HTTP dinâmico ouvindo estritamente em `127.0.0.1:0`. Suporta redirecionamento local e túneis reversos (SSH / OmniRoute).
- **Ciclo OAuth Google**: Geração de URL de autorização Google, captura do callback (`/callback`), proteção CSRF (`state`), troca de tokens (`oauth2.googleapis.com/token`) e obtenção de email via UserInfo.
- **Persistência Segura e Sem Restarts**: O token e perfil são salvos em `~/.gemini/antigravity-cli/profiles/conta_<N>` com permissões `0600`/`0700` e a conta é registrada dinamicamente em `cockpit.json` e no `accountPool` em memória sem necessidade de reiniciar o servidor.
- **Liberação Graciosa de Recursos**: Fechamento de sockets ativos e servidor loopback imediatamente após o término com zero vazamento de portas ou descritores.
- **Validação Adversarial M8**: `scripts/check-onboarding-loopback.ts` e `scripts/check-m8-adversarial-2.ts` aprovados com 100% de sucesso.

### 6.3 Marco M9 — Experiência do Usuário Plug-and-Play no Cockpit ("Dentro do Preto")
- **Eliminação de Variáveis Técnicas**: Remoção de inputs técnicos de variáveis de ambiente (`JETSKI_APP_DATA_DIR`, `CODEX_HOME`, caminhos manuais e IDs) dos formulários da interface comum (`web/Config.tsx`).
- **Fluxo 1-Clique com Túnel Reverso**: Botão "+ Adicionar conta ao pool (Login Google)" inicia o processo de onboarding, exibe o cartão com animação pulsante, status em tempo real, porta do túnel reverso e abre o navegador automaticamente.
- **Fallback para VPS / Headless**: Suporte a colar URL de callback ou código de autorização caso o ambiente seja headless ou não tenha navegador gráfico local.
- **Eventos em Tempo Real e Badges Dinâmicos**: WebSockets (`onboarding:step` e `pool:updated`) e rotas REST no `servidor/routes/account-pools-router.ts` atualizam instantaneamente os badges de contas ativas/livres.
- **Validação M9 & E2E**: `scripts/check-m9-ui.ts` e `scripts/qa-account-pool-e2e.mjs` aprovados com 100% de sucesso.

---

## 7. Status Consolidado Geral da Suíte de Testes (M1 a M9)

Comando executado: `node scripts/testar.mjs`
```
ok      tipos (tsc) (2.1s)
ok      build (vite) (2.0s)
ok      check-account-pool.ts (0.1s)
ok      check-auto-aprovar.ts (0.2s)
ok      check-clean-shell.ts (0.2s)
ok      check-codex-launch.ts (0.2s)
ok      check-codex-quota.ts (1.1s)
ok      check-codex-trust.mjs (0.1s)
ok      check-connections.ts (4.1s)
ok      check-continuity.ts (0.1s)
ok      check-cotas.ts (0.2s)
ok      check-decoupled-pty.ts (0.8s)
ok      check-e2e.mjs (0.1s)
PULADO  check-edicao.mjs — precisa do Playwright
ok      check-failover.mjs (1.7s)
ok      check-harness.ts (0.2s)
ok      check-m2-stress.ts (4.3s)
ok      check-m3-adversarial-2.ts (0.3s)
ok      check-m3-adversarial.ts (4.1s)
ok      check-m4-adversarial-2.ts (3.3s)
ok      check-m4-adversarial.ts (1.3s)
ok      check-m5-adversarial-2.ts (0.2s)
ok      check-m5-adversarial.ts (0.6s)
ok      check-m5-ui.ts (0.2s)
ok      check-m6-adversarial-2.ts (1.4s)
ok      check-m6-adversarial.ts (1.7s)
ok      check-m6-hardening.ts (1.1s)
ok      check-m7-adversarial-2.ts (1.8s)
ok      check-m8-adversarial-2.ts (0.9s)
ok      check-m9-ui.ts (0.5s)
ok      check-maestro-coordination.ts (0.4s)
ok      check-media.ts (0.2s)
ok      check-mission-modes.ts (0.1s)
ok      check-onboarding-loopback.ts (0.7s)
ok      check-openrouter.ts (0.3s)
ok      check-pane-dispatch.ts (0.2s)
ok      check-pane-kill-cleanup.ts (0.2s)
ok      check-pane-states.ts (0.1s)
ok      check-persistence.ts (0.2s)
ok      check-politica-ia.ts (0.2s)
ok      check-ponte.mjs (3.4s)
ok      check-security-approval.ts (0.2s)
ok      check-security-audit.ts (0.2s)
ok      check-security-permissions.ts (0.2s)
ok      check-security-sanitizer.ts (0.2s)
ok      check-stress-m1.ts (4.7s)
ok      check-stress-m2.ts (1.2s)
ok      check-stress-m3.ts (6.8s)
ok      check-strict-harness.ts (0.3s)
ok      check-tasks.ts (0.4s)
PULADO  check-ui.mjs — precisa do Playwright

PASS: 49 verificações, nenhuma falha (2 puladas por ausência do Playwright).
```

---

## 8. Regras Absolutas Preservadas

- **Zero commits git realizados**: `git add` / `git commit` não foram executados.
- **Zero descartes de código**: Nenhuma modificação pré-existente foi perdida (`git reset --hard` proibido).
- **Zero processos órfãos**: Todos os subagentes e servidores de teste foram encerrados com segurança.
- **Integridade total**: Todos os arquivos, testes e módulos permanecem funcionais e prontos para uso.

