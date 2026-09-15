# Cockpit

Estação de trabalho local para rodar **vários agentes de IA no mesmo projeto**, em paralelo, com terminal real, missões, orquestração (Maestro) e controle total de cotas e contas.

O Cockpit **não intermedia nem revende** chamadas de IA. Ele orquestra diretamente os CLIs locais que você já possui (`claude`, `codex`, `agy`, `grok`, `bash`, OpenRouter…) e organiza o trabalho em paralelo.

```text
Você → UI (missões · painéis · terminal)
         ↓
      Cockpit (Express + WebSocket + PTY host)
         ↓
   ┌─────┴──────────────────────────┐
   │ Claude / Codex  → DeepSeek Harness (DSH, profile sdk)
   │ Agy / Grok / bash / OpenRouter → PTY direto (node-pty)
   └────────────────────────────────┘
```

---

## Recursos Principais

* **Orquestração Paralela**: Suba múltiplos agentes trabalhando no mesmo projeto simultaneamente.
* **Terminal Real via PTY**: Painéis desacoplados; reiniciar ou recarregar a interface não encerra seus processos de terminal.
* **Maestro e Delegação**: Crie missões, defina papéis especialistas e deixe o Maestro coordenar a divisão de tarefas.
* **Pool Multicontas e Failover**: Alterne contas e homes de CLI automaticamente sem colisões de sessão.
* **Worktrees e Isolamento**: Isole missões e tarefas em branches/worktrees do Git para evitar conflitos de arquivos.
* **Integração Híbrida**: Suporte nativo a CLIs tradicionais e SDKs modernos de agentes.

---

## Pré-requisitos

* **Node.js** 20+ (LTS recomendado)
* **npm** 10+
* **Git** 2.30+
* Linux ou Windows 10/11
* CLIs dos seus provedores preferidos instalados e autenticados:
  * `claude` (Claude Code)
  * `codex` (OpenAI Codex CLI)
  * `agy` (Antigravity)
  * `grok` (xAI CLI)

---

## Instalação e Execução

### 1. Clonar e Instalar

```bash
git clone https://github.com/jonhsos/cockpit.git
cd cockpit
npm ci
```

### 2. Iniciar a Aplicação

```bash
npm start
```

Acesse **http://localhost:3000** no seu navegador.

### Modo de Desenvolvimento

Caso deseje executar com Hot Reload no frontend:

```bash
# Terminal 1 (Servidor)
npm run server

# Terminal 2 (Frontend)
npm run dev
```

---

## Estrutura do Projeto

```text
cockpit/
├── web/                 # Interface gráfica React (Vite + xterm.js)
├── servidor/            # Backend modular (Express, WebSocket, PTY Daemon)
│   ├── sessions/        # Host PTY desacoplado e adapters de backend
│   ├── orchestration/   # Maestro, catálogo de tipos de tarefas e dispatchers
│   ├── providers/       # Gestão de pool multicontas, cotas e provedores
│   ├── tasks/           # Máquina de estados de tarefas e locks de arquivos
│   ├── connections/     # Barramento de comunicação entre agentes
│   ├── missions/        # Gestão de missões e isolamento por worktree
│   ├── security/        # Sanitização de segredos e controle de permissões
│   └── persistence/     # Persistência atômica local em disco
├── bin/cockpit.mjs      # CLI inter-agentes para automação via terminal
└── scripts/             # Bateria de testes, checks automatizados e QA
```

---

## CLI Cockpit (Comunicação Inter-Agentes)

O Cockpit expõe um utilitário CLI para comunicação direta entre agentes:

```bash
# Vincular globalmente
npm link

# Comandos disponíveis
cockpit list
cockpit connect <paneA> <paneB>
cockpit ask <pane> "tarefa a executar"
cockpit reply <pane> "resultado concluído"
cockpit handoff <de> <para> <taskId> "contexto"
cockpit inbox --unread
cockpit resultado <pane>
```

---

## Testes e Validação

Para rodar a bateria de testes e validação contínua:

```bash
npm test
```

---

## Licença

Distribuído sob licença privada / proprietária. Todos os direitos reservados.
