# Original User Request

## Initial Request — 2026-09-13T16:09:35Z

Implementar uma reforma completa da orquestração do Cockpit no repositório /DATA/Projetos/agent-project, inspirada em Maestri, Overclock e BridgeMind, garantindo SHELL como terminal Linux limpo e vazio (/bin/bash -i -l) e conferindo soberania total ao usuário sobre papel, executor, modelo, conexões, tarefas e autonomia.

Working directory: /DATA/Projetos/agent-project
Integrity mode: development

## Requirements

### R1. SHELL Limpo, Seguro e Soberano
- SHELL sempre inicia estritamente como `/bin/bash -i -l`.
- Proibido iniciar Codex, Claude, Gemini, Agy ou qualquer LLM automaticamente ao abrir terminal.
- Proibido enviar prompt automático ao abrir painel.
- Proibido injetar papel, elenco, memória, modelo ou instruções ocultas no boot do shell.
- Proibido injetar texto arbitrário do Maestro diretamente em stdin do bash.
- Se o usuário desejar executar Codex, Claude ou Agy, fará manualmente dentro do terminal.
- A escolha explícita de `bash` tem precedência absoluta sobre elenco, failover, política e configuração.

### R2. Separação Estrita de Conceitos
- Desacoplar e manter como entidades independentes:
  - Role: Maestro, Builder, Luna, Reviewer ou qualquer papel criado pelo usuário.
  - Runner: Shell, Codex, Claude, Agy, Gemini ou outro CLI.
  - Model: Modelo ou combo configurado pelo usuário (ex: gpt-5.6-luna, Claude Sonnet, etc.).
  - Pane: Processo vivo (PTY).
  - Connection: Ligação persistente entre dois panes.
  - Task: Trabalho persistente estruturado.
  - Handoff: Entrega estruturada entre agentes.
- Proibido usar o nome do papel para escolher ou inferir modelo ou provedor.

### R3. Interface de Usuário e Catálogo
- O catálogo inicial deve exibir somente papéis (sem expor nomes de modelos como OPUS, FLASH ou ASTRA).
- Fluxo de seleção: o usuário escolhe primeiro o papel e depois o executor (runner).
- Permitir renomear missões.
- Permitir renomear e reclassificar qualquer Shell aberto.
- Exibir executor e modelo separadamente.
- Linhas visuais de conexão entre panes só devem ser renderizadas quando existir conexão real persistida.
- Diferenciação visual clara entre: papel, executor, modelo, status e tarefa ativa.

### R4. Harness e Políticas de Execução
- Remover fallback silencioso para Codex.
- Elenco (roster) deve atuar estritamente como lista de executores permitidos.
- Se o executor escolhido não estiver disponível, exibir erro claro (sem substituição silenciosa).
- Proibido alternar automaticamente para o primeiro executor disponível.
- O tipo de tarefa não pode alterar ou escolher modelo.
- O Maestro não pode alterar executor ou modelo por decisão própria.
- Failover automático desativado por padrão; qualquer troca exige autorização explícita e auditoria no histórico.

### R5. Comunicação Real entre Panes e Ponte Inter-Agentes
- Criar conexão persistente entre panes com operações estruturadas equivalentes a:
  - `cockpit list`
  - `cockpit connect <PANE_A> <PANE_B>`
  - `cockpit ask <PANE> <tarefa>`
  - `cockpit reply <PANE> <resultado>`
  - `cockpit handoff <PANE_ORIGEM> <PANE_DESTINO>`
- Suporte a comunicação heterogênea entre executores (Shell, Codex, Claude, Agy/Gemini).
- Mecanismo via inbox/outbox persistente ou MCP seguro; proibido escrever comandos arbitrários dentro de um Shell conectado.
- O Maestro deve conseguir consultar panes conectados e despachar tarefas para painéis existentes sem a obrigatoriedade de instanciar novos painéis.

### R6. Entidade Task e Ciclo de Vida de Tarefas
- Entidade Task com os campos: `id`, `título`, `descrição`, `responsável`, `papel`, `pane`, `arquivos permitidos`, `dependências`, `prioridade`, `status`, `evidências`, `resultado`, `timestamps`.
- Máquina de estados formal: `todo`, `in-progress`, `blocked`, `in-review`, `complete`, `failed`.
- Ferramentas e rotas de API para: criar tarefa, atribuir tarefa, listar tarefas, atualizar status, registrar conhecimento, enviar handoff, solicitar revisão.
- Exibir placar de tarefas interativo na barra lateral do Cockpit.

### R7. Ownership de Arquivos e Prevenção de Conflitos
- Modo Compartilhado: usuário assume o risco, com avisos visuais de arquivos compartilhados.
- Modo Isolado: a tarefa adquire ownership exclusivo dos arquivos atribuídos, impedindo edições simultâneas e colisões entre agentes.

### R8. Modos de Missão
- Suporte a três modos explícitos:
  - Livre (padrão): o usuário tem controle manual absoluto.
  - Dirigido: Maestro distribui tarefas estritamente dentro da equipe e permissões definidas pelo usuário.
  - Autônomo: Maestro pode criar tarefas e panes conforme escopo concedido.
- O Maestro nunca deve inventar elenco, papéis ou distribuição não autorizados.

### R9. Persistência e Desacoplamento da Interface
- Persistência em disco após restart: missões, nomes, papéis, executores, modelos, conexões, layout, tarefas, handoffs, histórico, ownership.
- Desacoplar o processo da interface: reiniciar o servidor web/interface (porta 3000) não pode derrubar panes ou processos PTY ativos.

### R10. Estados Avançados e Observabilidade
- Substituir estado simplista run/idle/dead por estados granulares: `starting`, `waiting-user`, `working`, `blocked`, `review`, `completed`, `failed`, `dead`.
- Registro e auditoria detalhados de: atividade, custo, tokens, comandos administrativos, mudanças de executor, handoffs, arquivos alterados, testes executados e erros.

### R11. Segurança e Escopo de Acesso
- Nunca imprimir chaves de API, tokens ou segredos na tela.
- Nunca gravar credenciais em logs ou arquivos de histórico.
- Permissão padrão: `workspace-write`; modo `danger-full-access` restrito à escolha explícita do usuário.
- MCP com escopo isolado por missão e por painel.
- Não executar texto recebido de outro agente automaticamente no Shell.
- Confirmação explícita para ações destrutivas (kill, merge, troca de executor, alteração de ownership).

### R12. Refatoração Arquitetural Modular do Servidor
- Modularizar o monólito `servidor/` sem quebrar funcionalidades existentes, estruturando em:
  - `servidor/routes/`
  - `servidor/websocket/`
  - `servidor/orchestration/`
  - `servidor/sessions/`
  - `servidor/tasks/`
  - `servidor/connections/`
  - `servidor/missions/`
  - `servidor/providers/`
  - `servidor/persistence/`
  - `servidor/security/`

### R13. Regras de Execução e Preservação
- Trabalhar diretamente no repositório `/DATA/Projetos/agent-project`.
- Preservar alterações existentes nos arquivos de trabalho.
- Nunca usar `git reset --hard`, checkout destrutivo ou remover arquivos sem autorização explícita.
- Não fazer commit ao final.
- Não reiniciar nem matar processos ou serviços ativos sem necessidade estrita.
- Ao terminar:
  1. mostrar arquivos alterados;
  2. mostrar decisões arquiteturais;
  3. mostrar testes executados;
  4. mostrar falhas restantes;
  5. não dizer que algo foi implementado se apenas foi planejado.

## Acceptance Criteria

### Integridade de Compilação e Tipagem
- [ ] `npx tsc --noEmit` executa com código de saída 0 sem erros de compilação TypeScript.
- [ ] `npm run build` conclui com sucesso a compilação do bundle frontend e servidor.

### Validação do SHELL
- [ ] Todo painel com runner SHELL inicia exclusivamente `/bin/bash -i -l` como terminal limpo.
- [ ] Painéis SHELL não inicializam LLMs automaticamente, não recebem prompts nem instruções no boot.
- [ ] A seleção de bash tem precedência absoluta sobre elenco, failover e configuração.

### Desacoplamento e Harness
- [ ] Papéis não definem executores ou modelos e vice-versa. Catálogo inicial lista apenas papéis.
- [ ] Se um executor não estiver disponível, exibe erro claro sem fallback silencioso para Codex.
- [ ] Codex utiliza o combo configurado pelo usuário.
- [ ] Failover automático permanece desativado por padrão.

### Conexões, Inbox/Outbox e Handoffs
- [ ] Conexões entre panes são criadas e persistidas.
- [ ] Comunicação inter-agentes funcional (Codex ↔ Claude, Shell ↔ Agente) via inbox/outbox sem injeção de comandos arbitrários no stdin do bash.
- [ ] Handoff transfere contexto, registra dependências e gera evidências na tarefa.

### Tarefas e Ownership de Arquivos
- [ ] Entidade Task gerenciável via API e WebSocket com suporte a todos os 6 estados (`todo`, `in-progress`, `blocked`, `in-review`, `complete`, `failed`).
- [ ] Painel lateral renderiza placar de tarefas em tempo real.
- [ ] Modo isolado bloqueia edições concorrentes de arquivos por mais de um agente.

### Persistência e Resiliência
- [ ] Missões, tarefas, histórico, conexões e ownership persistem entre reinicializações do servidor.
- [ ] Reiniciar a interface web não interrompe panes ativos em execução.
- [ ] WebSocket reconecta automaticamente preservando o estado da sessão.

### Cobertura de Testes Automatizados
- [ ] `npm test` executa com sucesso todos os testes unitários e de integração.
- [ ] Testes cobrem os cenários: todos os papéis com SHELL, SHELL abrindo /bin/bash, isolamento de modelo no Shell, conexão entre panes, handoff, inbox/outbox, tarefas e ownership, persistência, kill seguro e provider indisponível.


## Follow-up — 2026-09-13T19:12:01Z

# Teamwork Project Prompt

> Status: Launched
> Goal: Retomar a reforma da orquestração do Cockpit a partir do Checkpoint M1, implementando M2 a M6 via teamwork_preview
> Requested team: Full team (architects, backend engineers, frontend engineers, test verification)

Continuar a reforma arquitetural da orquestração do Cockpit em `/DATA/Projetos/agent-project` a partir do Checkpoint M1 concluído, implementando o daemon PTY desacoplado (M2), Harness estrito e comunicação inter-panes via Mailbox (M3), modularização do servidor (M4), refinamentos de UI com placar de tarefas (M5) e validação completa sem regressões (M6).

Working directory: /DATA/Projetos/agent-project
Integrity mode: development

## Contexto do Checkpoint (M1 Concluído)
- Domínio de Tasks com 13 campos (`servidor/tasks/task-types.ts` e `task-manager.ts`) e máquina de 6 estados.
- Persistência transacional atômica via `DiskStore` (`servidor/persistence/disk-store.ts`).
- Ownership de arquivos com modos Isolado (lock exclusivo / 409 Conflict) e Compartilhado (`servidor/persistence/file-lock.ts`).
- Sanitização de segredos em tempo real e guardião de permissões `workspace-write` (`servidor/security/`).
- Máquina de 8 estados de painéis (`servidor/sessions/pane-state.ts`).

---

## Requirements

### R1. Daemon PTY Desacoplado e Soberania do Shell (M2)
- Implementar o host PTY desacoplado (`servidor/sessions/pty-daemon.ts` ou socket Unix/IPC) com ring buffer (256KB) para que a reinicialização da interface web / servidor Express na porta 3000 NÃO derrube processos ou terminais ativos.
- Garantir reconexão WebSocket transparente restaurando o buffer de saída do terminal.
- Terminal SHELL inicia estritamente como `/bin/bash -i -l` sem injeção de prompt, sem LLM auto-boot e com precedência absoluta da escolha do usuário sobre qualquer política.
- Integrar a máquina de 8 estados granulares de painéis (`starting`, `waiting-user`, `working`, `blocked`, `review`, `completed`, `failed`, `dead`).

### R2. Harness Estrito, Modos de Missão e Mailbox Inter-Panes (M3)
- Remover qualquer fallback silencioso para Codex: se um executor não estiver disponível ou não for autorizado no elenco (whitelist), retornar erro claro e explícito.
- Desativar failover automático por padrão (`maestroAutoSwitch: false`), exigindo confirmação explícita.
- Implementar a infraestrutura de Mailbox inter-panes persistente (inbox/outbox) e os verbos de comunicação estruturada: `cockpit list`, `cockpit connect <A> <B>`, `cockpit ask <PANE> <tarefa>`, `cockpit reply <PANE> <resultado>`, `cockpit handoff <A> <B>`.
- Garantir que mensagens entre agentes NUNCA injetem texto arbitrário diretamente no stdin de um shell interativo.
- Implementar os três modos de missão: `Livre` (controle manual do usuário), `Dirigido` (Maestro opera dentro do elenco aprovado), `Autônomo` (Maestro pode criar tarefas e panes dentro do escopo concedido).

### R3. Reorganização Arquitetural Modular de `servidor/` (M4)
- Estruturar a base do servidor nos 10 diretórios modulares especificados em `PROJECT.md`:
  1. `servidor/routes/`
  2. `servidor/websocket/`
  3. `servidor/orchestration/`
  4. `servidor/sessions/`
  5. `servidor/tasks/`
  6. `servidor/connections/`
  7. `servidor/missions/`
  8. `servidor/providers/`
  9. `servidor/persistence/`
  10. `servidor/security/`
- Manter compatibilidade total com as rotas HTTP e eventos WebSocket existentes, garantindo que nenhum teste ou script quebre com a modularização.

### R4. Interface do Usuário, Placar de Tarefas e Conexões Visuais (M5)
- Catálogo de agentes exibindo papéis primeiro, ocultando nomes de modelos do catálogo inicial.
- Fluxo de 2 etapas: seleção de Papel (Role) primeiro, depois Executor (Runner), depois Modelo.
- Sidebar com o placar de tarefas interativo exibindo tarefas nas 6 colunas/estados da máquina de estados.
- Linhas visuais de conexão renderizadas unicamente quando houver conexão real ativa/persistida entre os painéis.
- Permitir renomear missões e renomear/reclassificar painéis de shell abertos.

### R5. Validação E2E, Preservação e Zero Regressões (M6)
- Preservar todas as regras operacionais: NÃO fazer commit no git (`git commit`), NÃO descartar alterações existentes (`git reset --hard` proibido).
- Não derrubar processos não relacionados do usuário.
- Garantir 100% de aprovação na suíte de testes e integridade de build.

---

## Acceptance Criteria

### Integridade de Compilação e Tipagem
- [ ] `npx tsc --noEmit` executa com código de saída 0 (zero erros de compilação).
- [ ] `npm run build` completa a compilação do Vite frontend e backend sem erros.

### Resiliência do PTY e Sessões (M2)
- [ ] Reiniciar o servidor web na porta 3000 preserva processos PTY em execução em segundo plano.
- [ ] O WebSocket do terminal reconecta e recupera o histórico recente via ring buffer.
- [ ] Painel Shell inicia `/bin/bash -i -l` limpo, sem injeção de prompt ou LLMs.

### Comunicação Inter-Panes e Harness (M3)
- [ ] Tentativa de usar executor indisponível emite erro descritivo sem fallback para Codex.
- [ ] Operações de Mailbox (`cockpit list`, `connect`, `ask`, `reply`, `handoff`) entregam mensagens na caixa de entrada sem violar o stdin do bash.
- [ ] Modos de missão (`Livre`, `Dirigido`, `Autônomo`) respeitam as permissões do usuário.

### Estrutura Modular e Estabilidade de API (M4)
- [ ] `servidor/` organizado nos 10 módulos funcionais com pontos de entrada limpos.
- [ ] Todas as APIs REST e eventos WS continuam respondendo aos formatos esperados pelo frontend e testes.

### Interface e Placar de Tarefas (M5)
- [ ] Placar de tarefas lateral reflete mudanças de estado em tempo real.
- [ ] Conexões visuais só aparecem para conexões persistidas.
- [ ] Catálogo inicial prioriza papéis.

### Cobertura e Aprovação de Testes (M6)
- [ ] `node scripts/testar.mjs` executa com 100% de aprovação em todos os testes locais automatizados.
- [ ] Nenhum commit não autorizado foi feito no repositório git.


## Follow-up — 2026-09-13T19:59:57Z

Diretriz prioritária do usuário: Quando estiver faltando aproximadamente 5% da capacidade de tokens/sessão (ou ao aproximar-se do limite de contexto dos orquestradores/workers), realize um CHECKPOINT formal completo (atualizando CHECKPOINT.md na raiz, pausando processos com segurança, garantindo 100% dos testes verdes e zero commits git não autorizados). Repasse essa diretriz ao orchestrator_2 e seus workers/crons.

## Follow-up — 2026-09-13T22:23:44Z

# Teamwork Project Prompt

> Status: Launched
> Goal: Concluir a reforma da orquestração do Cockpit a partir do Checkpoint M3, implementando M4 a M6 via teamwork_preview
> Requested team: Full team (architects, backend engineers, frontend engineers, test verification)

Continuar a reforma arquitetural da orquestração do Cockpit em `/DATA/Projetos/agent-project` a partir dos Marcos M1, M2 e M3 concluídos e 100% validados (34/34 testes passando, `tsc --noEmit` código 0, `build` código 0). Implementar a modularização da arquitetura do servidor em 10 diretórios (M4), a interface com catálogo por papéis e placar de tarefas interativo na barra lateral (M5) e a validação final/hardening sem regressões (M6).

Working directory: /DATA/Projetos/agent-project
Integrity mode: development

## Contexto do Estado Atual (Marcos M1, M2 e M3 100% Concluídos)
- **M1 (Domínio de Tasks, Persistência e Segurança)**: Entidade Task com 13 campos, máquina formal de 6 estados, persistência atômica via `DiskStore`, ownership de arquivos (Isolado com 409 Conflict vs Compartilhado com alertas) e sanitização regex de credenciais em tempo real.
- **M2 (Sovereign Clean Shell, PTY Desacoplado & 8 Estados)**: Host PTY desacoplado com ring buffer de 256KB resiliente a restarts da porta 3000, soberania absoluta de `/bin/bash -i -l` sem LLM auto-boot e máquina de 8 estados granulares de painéis.
- **M3 (Strict Harness, Mailbox Inter-Panes & Modos de Missão)**: Harness estrito sem fallback silencioso para Codex (`maestroAutoSwitch: false`), Mailbox inter-panes persistente com os 5 verbos (`cockpit list`, `connect`, `ask`, `reply`, `handoff`) com zero bytes injetados no stdin do bash, e modos de missão (`Livre`, `Dirigido`, `Autônomo`).
- **Suíte de Testes**: 34/34 testes automatizados aprovados (100% PASS), 2 testes pulados por dependência de Playwright.

---

## Requirements

### R1. Reorganização Arquitetural Modular de `servidor/` (M4)
- Estruturar o backend `servidor/` nos 10 diretórios funcionais modulares estipulados na arquitetura de `PROJECT.md`:
  1. `servidor/routes/` — Rotas Express modulares (missões, tarefas, conexões, fs, cotas, media, etc.).
  2. `servidor/websocket/` — Servidor WebSocket, despacho de eventos tipados e handlers de clientes.
  3. `servidor/orchestration/` — Maestro, harness estrito, modos de missão, despacho para painéis existentes e MCP.
  4. `servidor/sessions/` — Daemon PTY desacoplado, spawner de clean shell e ciclo de vida de 8 estados.
  5. `servidor/tasks/` — Entidade Task de 13 campos, máquina de 6 estados, evidências e gerenciador de ownership.
  6. `servidor/connections/` — Conexões persistentes, mailbox (inbox/outbox), verbos CLI e ponte inter-agentes.
  7. `servidor/missions/` — Serviço de missões, gerenciamento de git worktrees e checkpoints.
  8. `servidor/providers/` — Detecção de executores/provedores, adaptadores de ponte, cotas e media.
  9. `servidor/persistence/` — `DiskStore` atômico com safe-writes, stores de entidades e audit logger.
  10. `servidor/security/` — Sanitizador de segredos (redação em tempo real) e sandbox de permissões.
- Preservar compatibilidade total e retrocompatibilidade de todos os endpoints REST, formatos JSON, rotas WebSocket e interfaces públicas utilizadas pelos testes e pelo frontend.
- `servidor/index.ts` deve atuar como orquestrador e ponto de entrada limpo que conecta os módulos.

### R2. Interface do Usuário, Catálogo por Papéis e Placar de Tarefas (M5)
- **Catálogo Focado em Papéis**: O catálogo inicial de adição de agentes deve exibir prioritariamente os papéis (Roles: Maestro, Builder, Reviewer, Scout, etc.), ocultando nomes de modelos (ASTRA, FLASH, OPUS).
- **Fluxo de 2 Etapas**: O usuário seleciona primeiro o Papel (Role), em seguida escolhe explicitamente o Executor (Runner: bash, codex, claude, agy, openrouter) e por fim o Modelo.
- **Placar de Tarefas na Barra Lateral (`QuadroTarefas.tsx`)**: Integrar à barra lateral (`Lateral.tsx`) uma aba dedicada "Tarefas" (Missões / Tarefas / Arquivos) exibindo as tarefas agrupadas pelas 6 colunas de status (`todo`, `in-progress`, `blocked`, `in-review`, `complete`, `failed`), com atualização reativa em tempo real via WebSocket.
- **Linhas Visuais de Conexão Estritas**: Renderizar fios visuais de conexão entre painéis no canvas somente quando houver vínculo real e persistido retornado pela API de conexões.
- **Diferenciação Visual e Renomeação**: Badges distintas para Papel, Executor, Modelo, Status granular (8 estados) e Tarefa Ativa. Suporte a renomear missões e renomear/reclassificar painéis de shell abertos.
- **Confirmações Explícitas**: Exigir confirmação do usuário para ações destrutivas (kill de painel, merge de branch, override forçado de locks).

### R3. Validação Final, Hardening e Preservação Absoluta (M6)
- **Aprovação Total de Testes**: 100% de aprovação na suíte de testes automatizados (`node scripts/testar.mjs`).
- **Integridade de Tipagem e Build**: `npx tsc --noEmit` com código de saída 0 e `npm run build` concluído com sucesso.
- **Regras Operacionais Invioláveis**:
  - Proibido executar `git commit` ou criar commits no repositório.
  - Proibido executar comandos destrutivos no git (`git reset --hard`, `git checkout -f`).
  - Proibido encerrar ou interferir em processos externos do usuário.
- **Diretriz de Segurança de Sessão (Gatilho 5%)**: Caso a sessão ou subagentes se aproximem do limiar de 5% restantes da cota ou contexto, atualizar o arquivo `CHECKPOINT.md` na raiz com o balanço completo, pausar subprocessos com segurança e preparar o relatório de consolidação.

---

## Acceptance Criteria

### Integridade de Compilação e Modularização (M4)
- [ ] `servidor/` organizado nos 10 diretórios modulares com limites claros de responsabilidade.
- [ ] `npx tsc --noEmit` executa com código de saída 0 (zero erros de tipos).
- [ ] Todas as rotas REST (`/api/missions`, `/api/tasks`, `/api/cockpit`, etc.) e eventos WebSocket mantêm retrocompatibilidade com frontend e scripts de teste.

### Interface e Placar de Tarefas (M5)
- [ ] Modal de novo agente exibe catálogo por papéis primeiro, desacoplado de nomes de modelos.
- [ ] Barra lateral contém a aba "Tarefas" com o placar de tarefas interativo renderizando os 6 estados formais.
- [ ] Conexões visuais entre painéis renderizadas estritamente para conexões reais persistidas.
- [ ] Painéis e missões suportam renomeação interativa na UI.
- [ ] Ações destrutivas exibem modal/diálogo de confirmação explícita.

### Verificação Geral e Hardening (M6)
- [ ] `node scripts/testar.mjs` conclui com 100% de aprovação em todos os testes locais automatizados.
- [ ] `npm run build` compila o pacote Vite sem nenhum erro.
- [ ] Nenhum commit não autorizado foi feito no repositório git (`git status -s` preserva a integridade).

---
*Status: Launched*

## Follow-up — 2026-09-13T23:15:24Z

Implementação e validação completa dos Marcos 5 (Interface de Usuário e Placar de Tarefas) e 6 (Hardening Final e Victory Audit) da reforma do Cockpit, assegurando catálogo orientado a papéis, quadro de tarefas reativo em 6 estados, conexões estritas no canvas, robustez contra payloads malformados e zero commits automáticos no git.

Working directory: /DATA/Projetos/agent-project
Integrity mode: benchmark

## Requirements

### R1. Catálogo Orientado a Papéis e Fluxo em 2 Etapas
- A interface de criação e adição de agentes deve apresentar e priorizar primariamente os **Papéis funcionais** (Roles: Maestro, Builder, Reviewer, Challenger, etc.), desacoplando o papel do modelo.
- O fluxo de configuração e seleção deve operar em etapas estruturadas: primeiro a escolha do Papel funcional, seguido pela seleção do Executor (Runner) e Modelo.

### R2. Placar de Tarefas Lateral e Sincronização em Tempo Real
- Implementar componente de placar de tarefas interativo integrado à barra lateral (`web/Lateral.tsx`) acessível como aba "Tarefas".
- Exibir e organizar tarefas nas 6 colunas formais da máquina de estados (`todo`, `in-progress`, `blocked`, `in-review`, `complete`, `failed`).
- Garantir sincronização bidirecional em tempo real via WebSocket para transições de estado, novas tarefas e atualizações sem exigir reload de página.

### R3. Conexões Estritas no Canvas e Interações Seguras
- Renderizar linhas visuais de conexão no canvas estritamente quando houver conexão real, ativa e persistida no backend.
- Suportar renomeação interativa de missões e reclassificação de papéis em painéis shell abertos.
- Exibir modal de confirmação explícita antes de executar ações destrutivas (kill de painel, merge e override forçado de locks de arquivos).

### R4. Hardening de WebSocket, Segurança e Concorrência (Marco 6)
- Implementar validação e sanitização defensiva rigorosa em todas as mensagens recebidas pelo WebSocket e controladores REST, tratando payloads malformados sem instabilidade ou crash do servidor.
- Garantir liberação limpa de recursos, buffers e ausência de vazamento de processos.

### R5. Governança e Regras do Repositório
- Manter política estrita de **zero commits** no git: nenhum `git commit` ou `git add` automático deve ser executado.
- Preservar todas as modificações pré-existentes na branch de trabalho, sem descartar alterações (`git reset --hard` proibido).
- Garantir que nenhum processo ou daemon fique órfão ao final da execução.

## Acceptance Criteria

### Compilação e Build
- [ ] `npx tsc --noEmit` executa com código de saída 0 (zero erros TypeScript).
- [ ] `npm run build` conclui com código de saída 0 (build de produção do Vite e bundles sem erros).

### Suíte de Testes e Validação Adversarial
- [ ] `node scripts/testar.mjs` aprova 100% das verificações ativas sem falhas nem regressões nos marcos anteriores (M1 a M4).
- [ ] Nova suíte de testes de validação adversarial para M5 e M6 adicionada em `scripts/` e aprovada pelo testador.

### Integridade Funcional
- [ ] O quadro de tarefas na barra lateral reflete com fidelidade as tarefas da missão ativa nos 6 estados formais.
- [ ] A interface permite o fluxo de criação Papel → Executor → Modelo sem expor modelos no primeiro nível.
- [ ] Linhas no canvas só são desenhadas entre painéis com conexões ativas registradas.
- [ ] Modais de confirmação protegem operações destrutivas.
- [ ] O servidor WebSocket rejeita mensagens inválidas e malformadas sem derrubar a conexão de outros clientes.

### Auditoria de Vitória
- [ ] Auditoria final de vitória independente aprovada (Victory Audit), confirmando a conclusão dos Marcos 5 e 6.
- [ ] Zero comandos `git commit` ou `git add` executados no repositório.


## Follow-up — 2026-09-15T03:21:23Z

Refatorar a gestão de provedores e o sistema de pool multicontas do Cockpit, migrando o pool das 4 contas para o Antigravity CLI (`agy`), removendo o CLI fictício `gemini` e transformando o botão "+ Adicionar conta ao pool" em um fluxo 100% plug-and-play com servidor loopback e túnel reverso OAuth (estilo OmniRoute).

Working directory: /DATA/Projetos/agent-project
Integrity mode: development

## Requirements

### R1. Reestruturação do Pool do AGY e Higienização de Configuração
- Remover completamente a seção `clis.gemini` com as pastas fictícias do `cockpit.json`.
- Configurar as contas do pool diretamente em `clis.agy` com isolamento por perfil (diretório de configuração/sessão dedicado por conta).
- Assegurar que os agentes que utilizam modelos Gemini (ex: Flash, Artista) estejam apontados para o provedor `agy` e recebam contas dinâmicas do pool sem colisões.

### R2. Serviço de Onboarding Automatizado (Loopback & Túnel Reverso estilo OmniRoute)
- Criar endpoint no servidor do Cockpit para gerenciar o ciclo de vida da autenticação de contas do Antigravity CLI.
- Implementar servidor loopback HTTP local (127.0.0.1) com suporte a túnel reverso (estilo `omniroute login antigravity`) para captura segura do código/token de autorização Google em ambientes locais ou remotos.
- Ao concluir a autorização, persistir o perfil da conta em pasta isolada e registrar a nova conta automaticamente no pool do `agy` no `cockpit.json`.

### R3. Experiência do Usuário Plug-and-Play no Cockpit
- Na interface web do Cockpit (`web/Config.tsx` / `web/Ajustes.tsx`), eliminar formulários técnicos que solicitam variáveis de ambiente (`CLI_HOME`, chaves manuais).
- Substituir por um fluxo guiado de 1 clique: botão "+ Adicionar conta ao pool" dispara a conexão, abre o navegador para autenticação e exibe status em tempo real (Aguardando login ➔ Conta vinculada com sucesso).
- Atualização instantânea dos badges de status do pool (`Pool: X contas (Y livres · Z em uso)`) sem necessidade de reiniciar o Cockpit manualmente.

## Acceptance Criteria

### Integridade do Pool AGY
- [ ] `cockpit.json` não contém mais o bloco `clis.gemini` com caminhos artificiais.
- [ ] `clis.agy` possui as 4 contas configuradas com perfis isolados.
- [ ] `AccountPoolManager` adquire (`acquire`) e rotaciona as contas do `agy` para os agentes sem erros de concorrência.

### Fluxo de Autenticação Loopback / Túnel Reverso
- [ ] O backend disponibiliza rota de autenticação que inicia o servidor de captura de autorização OAuth sem travamentos ou vazamento de portas.
- [ ] O processo de login é compatível com o mecanismo de autenticação do Antigravity CLI.
- [ ] Novas contas autenticadas são salvas e persistidas no arquivo de configuração do Cockpit.

### Usabilidade Plug-and-Play na Interface
- [ ] O botão "+ Adicionar conta ao pool" não expõe campos de variáveis de ambiente para o usuário comum.
- [ ] A interface exibe feedback claro de progresso e confirmação visual quando uma nova conta é integrada ao pool.
- [ ] Os badges e lista de contas refletem o estado em tempo real das contas ativas e livres.

### Verificação e Testes
- [ ] Teste de regressão ou script de validação de rotas do pool executado com saída positiva.
- [ ] O build do frontend (`npm run build`) e o servidor do Cockpit iniciam sem erros de tipo ou compilação.

## 2026-09-15T21:33:06Z

This is a single self-contained fix; keep it small and focused.

Adicionar suporte interativo completo para agentes com backend DSH (Codex e Claude) no Cockpit, incluindo entrada dedicada de prompts na interface, diagnóstico e suporte a login para contas do pool, e opção clara de alternância entre backend DSH e PTY tradicional.

Working directory: /DATA/Projetos/cockpit
Integrity mode: development

## Requirements

### R1. Entrada Interativa de Prompts para Painéis DSH
Implementar na interface do Cockpit um componente de entrada de prompt (input/textarea) para painéis cujo executor utilize o backend DSH, garantindo que o usuário possa digitar instruções completas e enviá-las de forma estruturada (evitando que digitações no xterm enviem caracteres soltos via websocket). Exibir feedback visual de status no painel (aguardando entrada, executando, resposta concluída).

### R2. Diagnóstico e Fluxo de Login de Contas
Prover detecção visual do status de autenticação para as contas do pool (ex: presença de `auth.json` em `CODEX_HOME` para o Codex e credenciais do Claude). Caso uma conta não esteja autenticada, exibir aviso explícito e prover ação rápida para abrir um terminal configurado com as variáveis da conta (ex: `CODEX_HOME=<caminho> codex login`) para que o usuário autentique a conta sem atrito.

### R3. Alternância Transparente entre Backend DSH e PTY
Garantir que o usuário possa escolher ou configurar facilmente se o Codex e o Claude devem rodar via backend `dsh` (SDK headless com subagentes) ou `pty` (terminal interativo tradicional do CLI), mantendo compatibilidade total com o `cockpit.json` e com o seletor de papéis/executores.

## Acceptance Criteria

### Interação com Agentes DSH
- [ ] Painéis com backend DSH disponibilizam campo de entrada para digitação e envio de prompts pelo usuário na interface.
- [ ] Prompts submetidos são enfileirados corretamente no `DshManager` e os eventos de resposta são exibidos no transcript do painel xterm.
- [ ] O status do painel transiciona de forma consistente entre `waiting-user`, `working` e idle/conclusão.

### Autenticação de Contas
- [ ] Contas não autenticadas em `CODEX_HOME` ou Claude são identificadas e sinalizadas na interface antes ou durante o uso.
- [ ] Há um mecanismo ou atalho facilitador para abrir um shell no ambiente da conta e realizar o login oficial do CLI (`codex login` / `claude login`).

### Compatibilidade e Testes
- [ ] A suíte de testes e checks existentes (`node scripts/check-dsh-config.ts`, `node scripts/check-dsh-pane-lifecycle.ts`, `node scripts/check-decoupled-pty.ts`) continua executando com sucesso.
- [ ] O modo PTY tradicional para Codex e Claude continua plenamente funcional quando selecionado.
