# 🛰️ Cockpit — Ambiente Autônomo & Orquestrador Multiagente Local

> **Cockpit** é uma estação de trabalho local e orquestrador autônomo projetado para desenvolvedores e equipes de agentes de IA colaborarem no mesmo projeto de software. Ele integra e executa múltiplos provedores e CLIs de IA (**Codex**, **Claude Code**, **Gemini CLI**, **Grok**, **Antigravity**) e terminais puros em paralelo, com **Pool Multicontas nativo**, **máquina de estados transacional de tarefas**, **comunicação inter-agentes via mailbox**, **isolamento seguro de worktrees Git** e **arquitetura de backend modular**.

O Cockpit **não vende nem intermedia chamadas de IA**: ele aproveita suas credenciais, sessões e chaves de API locais com **soberania absoluta**, privacidade total e custo zero de intermediação.

---

## 📑 Sumário

1. [Visão Geral & Recursos Principais](#-visão-geral--recursos-principais)
2. [Arquitetura & Engenharia do Sistema](#-arquitetura--engenharia-do-sistema)
3. [Pré-Requisitos do Ambiente](#-pré-requisitos-do-ambiente)
4. [Instalação & Inicialização Rápida](#-instalação--inicialização-rápida)
5. [Guia Passo a Passo de Uso](#-guia-passo-a-passo-de-uso)
   - [Passo 1: Autenticar e Configurar Provedores de IA](#passo-1-autenticar-e-configurar-provedores-de-ia)
   - [Passo 2: Configurar o Pool Multicontas (True Concurrency)](#passo-2-configurar-o-pool-multicontas-true-concurrency)
   - [Passo 3: Usar Modelos 100% Grátis via Ponte OpenRouter](#passo-3-usar-modelos-100-grátis-via-ponte-openrouter)
   - [Passo 4: Abrir um Projeto e Criar Missões com Worktrees Isolados](#passo-4-abrir-um-projeto-e-criar-missões-com-worktrees-isolados)
   - [Passo 5: Operar os Três Modos de Missão (Livre, Squad, Agêntico)](#passo-5-operar-os-três-modos-de-missão-livre-squad-agêntico)
   - [Passo 6: Orquestração com Maestro, Quadro de Tarefas e RoleCatalog](#passo-6-orquestração-com-maestro-quadro-de-tarefas-e-rolecatalog)
   - [Passo 7: Comunicação Inter-Painéis via CLI Cockpit (5 Verbos)](#passo-7-comunicação-inter-painéis-via-cli-cockpit-5-verbos)
   - [Passo 8: Ativar Receitas Automatizadas](#passo-8-ativar-receitas-automatizadas)
6. [Segurança, Sanitização e Cofre de Segredos](#-segurança-sanitização-e-cofre-de-segredos)
7. [Bateria de Testes, QA e Homologação E2E](#-bateria-de-testes-qa-e-homologação-e2e)
8. [Estrutura de Arquivos & Configuração (`cockpit.json`)](#-estrutura-de-arquivos--configuração-cockpitjson)
9. [Variáveis de Ambiente & Customização](#-variáveis-de-ambiente--customização)
10. [Governança & Contribuição](#-governança--contribuição)

---

## 🌟 Visão Geral & Recursos Principais

### 1. Sistema Nativo de Pool Multicontas (Estilo OmniRoute)
- **True Concurrency (Concorrência Simultânea Real):** Execute simultaneamente múltiplas contas Codex, Gemini e Grok. Quando múltiplos especialistas (ex: Scout, Builder, Reviewer) trabalham ao mesmo tempo, cada um recebe uma conta independente do pool sem colisão de sessão e sem disputa de cota.
- **Algoritmo Least-Loaded / LRU:** Alocação dinâmica transparente que prioriza contas ociosas ou com menor índice de requisições recentes.
- **Afinidade de Sessão com Auto-Release Defensivo:** Preserva a afinidade de sessão por `paneId` para tirar proveito do cache de prompt (KV Cache) dos provedores, liberando slots imediatamente caso um painel mude de contexto ou encerre.
- **Circuit Breaker e Failover Intra-Pool:** Se uma conta bater limite de taxa (HTTP 429 RFC 6585 ou erro de quota), ela entra em *cooldown* temporário de forma automática e o Maestro migra a tarefa para uma conta reserva saudável.
- **Interface de Gestão em Tempo Real:** Badges dinâmicos em **Ajustes → Provedores** (`Pool: 4 contas: 3 livres · 1 em uso`), drawer expansível com status detalhado e botões de reset individual ou global de cota.

### 2. Quadro de Tarefas & Gestão Transacional de Tasks
- **13 Campos Estruturados:** Máquina de estados formal (`backlog` ➔ `todo` ➔ `in_progress` ➔ `blocked` ➔ `in_review` ➔ `done`).
- **File Ownership & Trava de Arquivos:** Suporte a arquivos em modo `isolated` (com lock exclusivo e prevenção de conflitos HTTP 409) ou modo `shared`.
- **Interface Visual Drag & Drop:** Quadro de Tarefas integrado na UI (`QuadroTarefas.tsx`) com visualização de dependências, atribuição de especialistas e badges de bloqueio.

### 3. Modos de Missão Flexíveis
- **Modo Livre:** Painéis sob demanda; abra quantos terminais e IAs desejar e opere manualmente.
- **Modo Squad:** Fases planejadas em pipeline contínuo com papéis pré-definidos (Scout ➔ Builder ➔ Reviewer) e passagens de bastão automáticas.
- **Modo Agêntico (Maestro):** O Maestro assume o comando, divide o objetivo geral em subtarefas, delega para painéis especialistas e monitora o progresso até a conclusão.

### 4. Mailbox Inter-Painéis & CLI Cockpit (5 Verbos)
- Os painéis conversam entre si de forma estruturada através do binário `cockpit` (`bin/cockpit.mjs`):
  1. `cockpit list`: Lista painéis ativos, IAs em uso e papéis.
  2. `cockpit connect`: Abre canal de mensageria direto com outro painel.
  3. `cockpit ask`: Envia perguntas e solicitações de forma assíncrona.
  4. `cockpit reply`: Responde com histórico de contexto preservado.
  5. `cockpit handoff`: Transfere tarefas com sumário executivo estruturado.
- **Zero Poluição:** As mensagens trafegam via IPC/WebSocket isolado, sem injetar dados indesejados no `stdin` dos terminais.

### 5. Host PTY Desacoplado & Soberania do Shell
- **Ring Buffer de 256KB:** O daemon PTY roda desacoplado do servidor web. Se o servidor Express ou a interface reiniciar, o processo de terminal permanece vivo e o histórico de saída não é perdido.
- **Shell Puro & Sanitizado:** Abertura de sessões `/bin/bash -i -l` no Linux (e PowerShell no Windows) com sanitização de variáveis de ambiente, sem prompts ocultos de IA e sem auto-boot indesejado.

### 6. Ponte OpenRouter para Modelos Grátis
- Empresta o motor executável do Codex para conectar diretamente à API de Responses do OpenRouter.
- Filtro automático de modelos com custo $0,00 e suporte nativo a ferramentas (tool use / file editing).
- Failover de emergência: se as cotas pagas esgotarem no meio de uma missão, o Maestro pode assumir modelos gratuitos para não parar o trabalho.

---

## 🏛️ Arquitetura & Engenharia do Sistema

O backend foi desacoplado em **10 subsistemas modulares com barrels explícitos** em `servidor/`:

```text
servidor/
├── index.ts                # Bootstrap limpo do servidor HTTP e WebSocket
├── routes/                 # Controladores REST isolados (pools, panes, tasks, etc.)
│   ├── account-pools-router.ts
│   ├── config-router.ts
│   ├── connections-router.ts
│   ├── panes-router.ts
│   ├── tasks-router.ts
│   └── ...
├── providers/              # Provedores de IA, Pool Multicontas e detecção de CLIs
│   ├── account-pool.ts     # Engine do Pool Multicontas (Least-Loaded / LRU / Afinidade)
│   ├── ponte.ts            # Adaptador OpenRouter Responses API
│   └── ...
├── sessions/               # Sessões de terminal, PTY host desacoplado e clean shell
│   ├── pty-manager.ts      # Gerenciamento de processos PTY e ciclo de vida de slots
│   ├── pty-client.ts
│   └── clean-shell.ts
├── orchestration/          # Maestro, modos de missão e harness de delegações
│   ├── maestro-coordinator.ts
│   ├── pane-dispatcher.ts
│   └── ...
├── tasks/                  # Máquina de estados de tarefas e controle de file ownership
├── connections/            # Mailbox inter-agentes e CLI bridge (5 verbos)
├── persistence/            # DiskStore transacional com safe-writes e audit log
├── security/               # Sanitizador de segredos, cofre e gating de aprovações
├── missions/               # Gerenciador de missões e worktrees Git
└── websocket/              # Servidor WebSocket e dispatcher de eventos reativos
```

---

## 💻 Pré-Requisitos do Ambiente

O Cockpit roda de forma nativa e validada em:
- **Linux:** Ubuntu 20.04+, Debian 11+, Fedora 38+, Arch Linux e distribuições derivadas.
- **Windows:** Windows 10 e Windows 11 (com suporte nativo ao PowerShell e Git Bash).
- **Node.js:** Versão 24 ou LTS recente (mínimo Node.js 20+).
- **npm:** Versão 10+.
- **Git:** Instalado e configurado no `PATH` (fundamental para worktrees isolados).

---

## ⚡ Instalação & Inicialização Rápida

### 1. Clonar o Repositório
```bash
git clone https://github.com/jonhsos/agent-project.git
cd agent-project
```

### 2. Instalar as Dependências
Utilize `npm ci` para garantir as versões exatas travadas em `package-lock.json`:
```bash
npm ci
```

### 3. Iniciar o Cockpit
O comando `npm start` compila o frontend com Vite e inicia o servidor Express integrado:
```bash
npm start
```

Pronto! Acesse o painel pelo navegador: **[http://localhost:3000](http://localhost:3000)**

> **Dica de Performance:** Se você já executou a compilação e quer reiniciar apenas o backend de forma instantânea:
> ```bash
> npm run server
> ```

---

## 📖 Guia Passo a Passo de Uso

### Passo 1: Autenticar e Configurar Provedores de IA

O Cockpit utiliza os binários oficiais instalados no sistema. Instale e faça o primeiro login nos provedores que você possui:

#### • Codex (OpenAI):
```bash
npm i -g @openai/codex
codex
# Siga as instruções no navegador ou terminal para login
```

#### • Claude Code (Anthropic):
```bash
npm i -g @anthropic-ai/claude-code
claude
# Conclua a autenticação OAuth oficial
```

#### • Gemini CLI (Google):
```bash
npm i -g @google/gemini-cli
gemini
# Faça o login com sua conta Google
```

#### • Grok (xAI):
Instale o binário do Grok e execute `grok` para autenticar via OIDC (`~/.grok/auth.json`).

#### • Antigravity CLI:
Instale o CLI da Antigravity e verifique a autenticação executando `agy models`.

---

### Passo 2: Configurar o Pool Multicontas (True Concurrency)

Para rodar múltiplos agentes do mesmo provedor em paralelo sem bater limite de taxa, configure as credenciais no `cockpit.json` apontando para diretórios de ambiente separados (ex: `CODEX_HOME` ou `GEMINI_CLI_HOME`):

```json
{
  "clis": {
    "codex": {
      "command": "codex",
      "sandbox": "danger-full-access",
      "pool": [
        { "id": "codex-1", "label": "Conta Principal", "env": { "CODEX_HOME": "~/.jion" } },
        { "id": "codex-2", "label": "Conta Trabalho", "env": { "CODEX_HOME": "~/.codex-acc2" } },
        { "id": "codex-3", "label": "Conta Reserva", "env": { "CODEX_HOME": "~/.codex-acc3" } },
        { "id": "codex-4", "label": "Conta Consultoria", "env": { "CODEX_HOME": "~/.codex-acc4" } }
      ]
    },
    "gemini": {
      "command": "gemini",
      "pool": [
        { "id": "gemini-1", "label": "Gemini 1", "env": { "GEMINI_CLI_HOME": "~/.gemini-1" } },
        { "id": "gemini-2", "label": "Gemini 2", "env": { "GEMINI_CLI_HOME": "~/.gemini-2" } }
      ]
    }
  }
}
```

> **Dica Visual:** Você também pode gerenciar o pool diretamente pela interface:
> 1. Vá em **Ajustes ➔ Provedores**.
> 2. Clique no badge do **Pool** para expandir a gaveta.
> 3. Visualize as contas livres e em uso, redefina cotas ou cadastre novas contas.

---

### Passo 3: Usar Modelos 100% Grátis via Ponte OpenRouter

Não quer gastar tokens pagos em tarefas simples de rascunho ou varredura de código?
1. Obtenha uma chave gratuita em [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
2. No Cockpit, acesse **Ajustes ➔ Grátis**.
3. Cole a sua chave e clique em **Testar de verdade** (a chave fica cifrada em `~/.cockpit/chaves.json`).
4. Clique em **Atualizar modelos** para carregar os modelos gratuitos em destaque.
5. Nas suas missões, selecione o agente **GRÁTIS** ou a receita **De graça**.

---

### Passo 4: Abrir um Projeto e Criar Missões com Worktrees Isolados

1. Na tela inicial do Cockpit, clique em **Abrir projeto** e selecione a pasta desejada através do seletor embutido.
2. Clique no botão **Nova Missão** no canto superior.
3. Dê um nome para a missão e descreva o objetivo geral.
4. **Isolamento Git (Worktree):**
   - Se o projeto for um repositório Git, marque a opção de criar **Worktree isolado**.
   - O Cockpit criará uma branch dedicada (ex: `cockpit/missao-xyz`) em uma pasta temporária, permitindo que os agentes alterem código, instalem pacotes e testem sem arriscar a sua branch principal.

---

### Passo 5: Operar os Três Modos de Missão (Livre, Squad, Agêntico)

Ao iniciar uma missão, escolha a modalidade ideal para a sua necessidade:

* **Modo Livre:**
  - O palco exibe a grade de terminais vazia.
  - Clique no botão `+` para abrir qualquer IA (Codex, Claude, Grok, Gemini, Shell puro).
  - Interaja diretamente digitando comandos em cada painel.
* **Modo Squad:**
  - O Cockpit aciona um time estruturado por fases.
  - O agente **Scout** faz o levantamento de requisitos; em seguida, o **Builder** implementa as alterações; por fim, o **Reviewer** audita o código e roda testes.
* **Modo Agêntico (Maestro):**
  - O **Maestro** assume o comando autônomo.
  - Ele quebra a demanda em tarefas, distribui cada item para o especialista mais adequado e faz a rotação de contas do pool caso alguma atinja o limite.

---

### Passo 6: Orquestração com Maestro, Quadro de Tarefas e RoleCatalog

1. **Quadro de Tarefas (`QuadroTarefas.tsx`):**
   - Acesse a aba **Tarefas** na lateral da missão para ver o fluxo Kanban em tempo real.
   - Acompanhe tarefas em progresso, bloqueadas por dependências ou em revisão.
2. **Catálogo de Especialistas (`RoleCatalog.tsx`):**
   - Acesse **Maestro ➔ Quem faz o trabalho**.
   - Configure IAs específicas para papéis como Arquiteto, Pesquisador, Implementador e Revisor.
   - Ajuste o nível de esforço (`low`, `medium`, `high`) para controlar os custos de inferência.

---

### Passo 7: Comunicação Inter-Painéis via CLI Cockpit (5 Verbos)

Dentro de qualquer terminal aberto no Cockpit, os agentes ou o próprio usuário podem disparar comandos de mensageria:

```bash
# 1. Listar agentes ativos no projeto
cockpit list

# 2. Conectar-se ao painel do Builder
cockpit connect pane-builder

# 3. Fazer uma consulta assíncrona ao Scout
cockpit ask pane-scout "Onde fica a rota de autenticação de usuários?"

# 4. Responder a uma requisição recebida
cockpit reply msg-102 "A autenticação fica em servidor/routes/auth.ts"

# 5. Fazer handoff completo da fase com sumário
cockpit handoff pane-reviewer "Implementação concluída. 45 testes passando. Solicito revisão de código."
```

---

### Passo 8: Ativar Receitas Automatizadas

Na lateral do Cockpit, clique na aba **Receitas** para disparar rotinas prontas:
- **"Grátis faz, pago revisa":** Um modelo de custo zero do OpenRouter gera o código preliminar e o Claude Sonnet/Opus revisa a arquitetura e aplica testes.
- **"Auditoria Geral":** Um time de agentes desafia o código atual em busca de vulnerabilidades, dead code e vazamentos de memória.
- **"De Graça":** Fluxo completo conduzido exclusivamente por modelos sem custo.

---

## 🔒 Segurança, Sanitização e Cofre de Segredos

O Cockpit foi projetado com diretrizes rigorosas de isolamento e proteção:

1. **Sanitização de Segredos em Tempo Real (`StreamSanitizer`):**
   - Todas as saídas de terminal e logs de auditoria passam por filtro regex que substitui padrões de credenciais por `[REDACTED_API_KEY]`.
   - Cobre tokens da OpenAI (`sk-proj-`, `sk-admin-`), Anthropic (`sk-ant-`), OpenRouter (`sk-or-v1-`), Google (`AIza`) e Bearer JWTs.
2. **Aprovação de Comandos Destrutivos:**
   - Comandos com potencial de dano ao sistema passam pelo `ApprovalManager` com tokens criptográficos de uso único, prevenindo ataques do tipo *Confused Deputy* e *Replay Attacks*.
   - A flag `autoAprovar: true` em `cockpit.json` passa argumentos não-interativos automáticos aos CLIs (`-y`, `--dangerously-skip-permissions`), mas pode ser desativada para máxima restrição.
3. **Cofre Pessoal Cifrado:**
   - Chaves de API do OpenRouter e credenciais dinâmicas são armazenadas exclusivamente em `~/.cockpit/chaves.json` com permissões restritas ao usuário atual.

---

## 🧪 Bateria de Testes, QA e Homologação E2E

O repositório possui uma bateria completa de testes automatizados e testes empíricos de estresse:

```bash
# 1. Executar a bateria completa padrão (45+ verificações)
npm test

# 2. Verificar consistência de tipos TypeScript sem compilar
npx tsc --noEmit

# 3. Gerar build de produção da interface Vite
npm run build

# 4. Testar exclusivamente o Pool Multicontas (15 verificações de alocação/resiliência)
npx tsx scripts/check-account-pool.ts

# 5. Testar estresse de segurança, traversals de path e sanitização
npx tsx scripts/stress-test-security.ts

# 6. Rodar teste E2E real via Playwright contra o servidor Express ativo
node scripts/qa-pool-live-e2e.mjs
```

As evidências fotográficas dos testes E2E geradas no navegador ficam salvas na pasta [`prints/`](file:///DATA/Projetos/agent-project/prints).

---

## 📁 Estrutura de Arquivos & Configuração (`cockpit.json`)

O arquivo `cockpit.json` na raiz define todo o ecossistema de operação:

| Chave | Descrição |
| :--- | :--- |
| `port` | Porta HTTP do servidor web (padrão: `3000`). |
| `clis` | Cadastro dos binários instalados, argumentos, sandboxes e pools multicontas. |
| `modelos` | Relação de modelos de IA válidos e homologados para cada provedor. |
| `agents` | Catálogo de agentes com cores, papéis padrão, esforço e modelos vinculados. |
| `squads` | Configuração dos times pré-moldados e sequenciamento de fases. |
| `receitas` | Workflows prontos para execução em um clique. |
| `autoAprovar` | Se ativado (`true`), passa flags não-interativas aos CLIs para evitar travamentos. |

---

## 🌍 Variáveis de Ambiente & Customização

Você pode sobrescrever qualquer configuração via variáveis de ambiente no sistema:

- `COCKPIT_PORTA`: Porta de rede do Cockpit (ex: `export COCKPIT_PORTA=8080`).
- `COCKPIT_HOME`: Diretório de persistência do estado, histórico e chaves (padrão: `~/.cockpit`).
- `COCKPIT_CONFIG`: Caminho para um arquivo `cockpit.json` alternativo.
- `CODEX_HOME`: Diretório de credenciais e cache do Codex (usado para isolar contas do pool).
- `GEMINI_CLI_HOME`: Diretório de credenciais da CLI do Gemini.
- `GROK_HOME`: Diretório de autenticação da CLI do Grok.
- `OPENROUTER_API_KEY`: Fornece a chave do OpenRouter diretamente via ambiente.

---

## 🤝 Governança & Contribuição

Contribuições são muito bem-vindas! Siga estas boas práticas ao colaborar:

1. Faça um Fork do projeto para o seu GitHub pessoal.
2. Crie uma branch com nome descritivo: `git checkout -b feat/minha-melhoria`.
3. Certifique-se de que todos os testes passem: `npm test` e `npx tsc --noEmit`.
4. Suba suas alterações para o seu fork: `git push origin feat/minha-melhoria`.
5. Abra um **Pull Request** para a branch principal (`main`).

---

**Cockpit — Liberdade, Concorrência e Soberania Total para os Seus Agentes de IA.**
