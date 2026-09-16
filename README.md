# Cockpit

O **Cockpit** é uma estação de trabalho local para coordenar vários agentes de IA no mesmo projeto. Ele reúne, em uma única interface, projetos, missões, terminais reais, papéis semânticos, tarefas, memória, conexões entre agentes, controle de contas e acompanhamento do Maestro.

O Cockpit não revende chamadas de IA nem funciona como um provedor intermediário. Ele inicia e coordena os programas e serviços que já existem na sua máquina, como `claude`, `codex`, `agy`, `grok`, `bash`, OpenRouter e o DeepSeek Harness (DSH).

```text
Você
 └─ Cockpit: projeto → missão → papéis → painéis → tarefas/evidências
       ├─ PTY: terminal interativo real (bash, Codex, Grok, Agy...)
       └─ DSH: execução headless/SDK e subagentes (Claude, DeepSeek...)
```

> **Importante:** papel, executor técnico, modelo e backend são conceitos diferentes. Um painel pode ter o papel **Construtor**, ser executado dentro de um `/bin/bash` e ter um agente como Grok aberto manualmente dentro desse shell. Essa situação é suportada e está explicada em [Shell limpo, papel e agente conectado](#shell-limpo-papel-e-agente-conectado).

## Índice

- [O modelo mental](#o-modelo-mental)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Configuração do DSH](#configuração-do-dsh)
- [Primeiro uso](#primeiro-uso)
- [Projetos e missões](#projetos-e-missões)
- [Papéis e executores](#papéis-e-executores)
- [Modos de coordenação](#modos-de-coordenação)
- [Shell limpo, papel e agente conectado](#shell-limpo-papel-e-agente-conectado)
- [Maestro e continuidade](#maestro-e-continuidade)
- [Squads](#squads)
- [Painéis e terminais](#painéis-e-terminais)
- [Quadro de tarefas](#quadro-de-tarefas)
- [Arquivos e memória](#arquivos-e-memória)
- [Conexões e handoffs](#conexões-e-handoffs)
- [Provedores, contas e cotas](#provedores-contas-e-cotas)
- [Política de IA](#política-de-ia)
- [Skills, Marketplace e Receitas](#skills-marketplace-e-receitas)
- [Media](#media)
- [CLI de comunicação](#cli-de-comunicação)
- [Arquitetura do projeto](#arquitetura-do-projeto)
- [Segurança e limites](#segurança-e-limites)
- [Solução de problemas](#solução-de-problemas)
- [Scripts](#scripts)

## O modelo mental

O Cockpit organiza o trabalho em quatro camadas:

| Camada | O que representa | Exemplo |
| --- | --- | --- |
| **Projeto** | Uma pasta real no disco | `/DATA/Projetos/cockpit` |
| **Missão** | Um objetivo de trabalho dentro do projeto | “Corrigir o dispatcher” |
| **Papel** | A responsabilidade funcional do painel | `Construtor`, `Revisor`, `Explorador` |
| **Executor** | O programa, CLI ou perfil que executa | Claude, Codex, Grok, Agy, Bash |

Um quinto conceito define o transporte:

- **PTY:** mantém um terminal interativo conectado a um processo real. É o caminho usado por shells e CLIs que você quer controlar como se estivesse no terminal.
- **DSH:** usa o DeepSeek Harness para uma execução headless/SDK. É o caminho usado pelos agentes que precisam de integração estruturada com o harness e subagentes.

O papel não é o modelo. **Construtor** pode ser executado por Claude, Codex, Grok, DeepSeek ou até por um shell que tenha um agente conectado. O Cockpit resolve o perfil técnico depois que a função foi escolhida.

## Requisitos

- Node.js 20 ou superior.
- npm 10 ou superior.
- Git 2.30 ou superior quando a missão usar integração Git.
- Linux é o ambiente principal do código atual. No Windows, o repositório inclui um wrapper em `app/`, mas os CLIs configurados precisam estar instalados e disponíveis no `PATH`.
- Os executores que você pretende usar precisam estar instalados e autenticados fora do Cockpit:
  - `claude` — Claude Code;
  - `codex` — OpenAI Codex CLI;
  - `agy` — Antigravity/Gemini;
  - `grok` — CLI do Grok;
  - `bash` — shell local;
  - **DSH (DeepSeek Harness) instalado localmente** — obrigatório apenas para os perfis configurados com backend `dsh`.

> **DSH não acompanha o Cockpit:** `npm ci` instala somente as dependências deste repositório. Para usar Claude ou DeepSeek pelo backend `dsh`, você precisa instalar ou clonar o DeepSeek Harness na sua máquina, manter o checkout acessível e configurar `DSH_REPO_PATH`, `DSH_BIN` e um `DSH_HOME` isolado. Se você usar somente executores `pty` — por exemplo Bash, Codex, Agy ou Grok — o DSH não é necessário.

O Cockpit não instala nem autentica automaticamente todos esses programas. Ele pode auxiliar no onboarding de algumas contas e registrar comandos de instalação de provedores, mas a disponibilidade final depende da sua máquina, da sua conta e das credenciais do respectivo CLI.

## Instalação

### Instalação normal

```bash
git clone https://github.com/jonhsos/cockpit.git
cd cockpit
npm ci
npm start
```

Depois, abra `http://localhost:3000`.

O comando `npm start` primeiro executa o build do frontend com Vite e depois inicia o servidor Node.

### Desenvolvimento com frontend separado

Use dois terminais:

```bash
# Terminal 1: backend
npm run server

# Terminal 2: Vite com atualização do frontend
npm run dev
```

Quando a interface avisar que o servidor está desatualizado, encerre o processo do Cockpit e rode `npm start` novamente. O frontend pode ter sido recompilado enquanto o processo Node antigo ainda estava em execução.

### CLI global opcional

Para usar o comando de comunicação entre agentes:

```bash
npm link
cockpit --help
```

## Configuração

O arquivo principal é `cockpit.json`. Ele define porta, CLIs, perfis, modelos, papéis, squads, tipos de tarefa, receitas, provedores de mídia e política de IA.

O arquivo atual já contém configurações para:

| Identificador | Comando | Backend | Uso típico |
| --- | --- | --- | --- |
| `claude` | `claude` | `dsh` | Claude/Claude Code integrado ao DSH |
| `agy` | `agy` | `pty` | Antigravity/Gemini em terminal real |
| `bash` | `/bin/bash -i -l` | `pty` | Shell limpo e soberano |
| `codex` | `codex` | `pty` | Codex interativo |
| `openrouter` | `codex` | `pty` | Modelos OpenRouter via configuração do Codex |
| `grok` | `grok` | `pty` | Grok em terminal real |
| `deepseek` | `codex` | `dsh` | DeepSeek via rota configurada no DSH |

### Variáveis de ambiente

| Variável | Função | Padrão |
| --- | --- | --- |
| `COCKPIT_PORTA` | Porta do servidor web | `port` de `cockpit.json`, normalmente `3000` |
| `COCKPIT_HOME` | Diretório de estado, sockets, histórico, memória e persistência | `~/.cockpit` |
| `COCKPIT_CONFIG` | Arquivo de configuração alternativo | `cockpit.json` do repositório |
| `COCKPIT_PTY_SOCKET` | Socket alternativo do host de PTYs | Socket dentro de `COCKPIT_HOME` |
| `DSH_REPO_PATH` | Checkout local do DeepSeek Harness | `/DATA/Projetos/deepseek-harness` |
| `DSH_BIN` | Binário/entrypoint do DSH | `<DSH_REPO_PATH>/apps/cli/lib/bin.js` |
| `DSH_HOME` | Home isolado do DSH usado pelo Cockpit | `$COCKPIT_HOME/dsh-home` |

Exemplo:

```bash
export COCKPIT_PORTA=3000
export COCKPIT_HOME="$HOME/.cockpit"
export DSH_REPO_PATH="/DATA/Projetos/deepseek-harness"
export DSH_BIN="$DSH_REPO_PATH/apps/cli/lib/bin.js"
export DSH_HOME="$COCKPIT_HOME/dsh-home"
npm start
```

`COCKPIT_PORT` é usado principalmente pela CLI `cockpit` e por algumas ferramentas auxiliares. Para trocar a porta do servidor, prefira `COCKPIT_PORTA`.

### Opções importantes de `cockpit.json`

- `autoAprovar`: quando `true`, inicia CLIs com as opções de aprovação automática suportadas por cada executor. Use apenas em uma pasta confiável.
- `confiarNasPastasQueEuAbrir`: marca as pastas escolhidas por você como confiáveis para o Claude Code quando esse fluxo for suportado pelo executor.
- `workspace.modo`: atualmente `pasta-real`; todos os painéis da missão trabalham na pasta real do projeto.
- `workspace.worktreesAutomaticos`: controla o uso automático de worktrees. O padrão atual é `false`.
- `workspace.umaMissaoEscritoraPorProjeto`: ajuda a evitar duas missões alterando o mesmo projeto simultaneamente.
- `workspace.bloquearPastasCockpitWorktrees`: impede que pastas internas de worktrees do Cockpit sejam escolhidas como workspace.
- `maestroAutoSwitch`: permite configurar a troca automática do Maestro quando a política e os checkpoints autorizarem.
- `vozIdioma`: idioma usado pelo ditado por voz, atualmente `portuguese`.
- `instrucoesGerais`: texto incluído no contexto inicial dos agentes; use para fatos estáveis da máquina e regras do projeto, nunca para guardar segredos.

## Configuração do DSH

Antes de configurar esta seção, instale ou clone o **DeepSeek Harness** na máquina em que o Cockpit será executado. O Cockpit espera um checkout local do DSH; ele não baixa, compila nem distribui o DSH automaticamente. Depois informe onde ele está com `DSH_REPO_PATH` ou aponte diretamente para seu entrypoint com `DSH_BIN`.

O DSH tem dois usos diferentes e não deve compartilhar o mesmo home nos dois modos:

1. **DSH web interativo**, normalmente usando `~/.dsh`.
2. **Motor do Cockpit**, usando um `DSH_HOME` isolado, normalmente `~/.cockpit/dsh-home`.

Nunca aponte o Cockpit para `~/.dsh`. O isolamento evita colisão de configurações, sessões, plugins e credenciais entre o DSH web e os processos iniciados pelo Cockpit.

### Preparar o home isolado

Com o checkout do DSH disponível:

```bash
export DSH_REPO_PATH="/DATA/Projetos/deepseek-harness"
export DSH_HOME="$HOME/.cockpit/dsh-home"
./scripts/setup-dsh-cockpit-home.sh
```

O script é idempotente. Ele:

- valida o checkout e o binário pinado do DSH;
- rejeita `DSH_HOME=~/.dsh`;
- cria o profile `sdk`;
- instala os plugins oficiais de subagentes Claude Code e Codex;
- cria o overlay `profiles/sdk/cordis.patch.yml` com as ferramentas de delegação.

O exemplo de catálogo fica em `docs/dsh-home/settings.example.yaml`.

### APIs do DSH

Na interface, abra **Ajustes → APIs DSH** para:

1. adicionar ou editar uma rota;
2. informar identificador e nome visível;
3. escolher a rota/provider do DSH;
4. consultar o catálogo de modelos;
5. selecionar o modelo ativo;
6. guardar a chave sem colocá-la no Git;
7. opcionalmente configurar um gateway OpenAI-compatible com protocolo e URL base.

A chave pode ser referenciada por variável de ambiente, como `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY` ou outra definida no cadastro. Não coloque chaves diretamente no `cockpit.json` versionado.

## Primeiro uso

1. Rode `npm start`.
2. Abra a interface no navegador.
3. Escolha uma pasta pelo seletor nativo ou pelo navegador de pastas embutido.
4. Abra a pasta como **projeto**.
5. Se necessário, abra **Ajustes → Provedores**, atualize a detecção e teste os CLIs.
6. Crie uma **missão** com nome e objetivo claros.
7. Defina o modo, os papéis, o tipo de trabalho, a distribuição de IA e, se necessário, skills ou uma receita.
8. Crie os painéis sugeridos ou abra um shell manualmente.
9. Acompanhe o trabalho em **Missões**, **Tarefas**, **Arquivos** e nos próprios terminais.

Para uma primeira validação segura, use uma pasta de teste, mantenha `autoAprovar` desligado e comece no modo `Livre`.

## Projetos e missões

### Projeto

Um projeto aponta para uma pasta real. O Cockpit observa mudanças no filesystem e mostra a árvore de arquivos da pasta escolhida.

Ao fechar um projeto pela interface:

- ele sai da lista ativa;
- os painéis são encerrados;
- o conteúdo no disco não é apagado;
- worktrees e branches existentes continuam no disco e podem voltar quando a pasta for aberta novamente.

Se a pasta ainda não tiver Git, a ação de preparar Git cria a estrutura necessária somente quando você pedir. Isso habilita recursos de isolamento e status de branch.

### Missão

Uma missão contém:

- objetivo e nome;
- modo de coordenação;
- papéis e painéis associados;
- elenco de provedores permitidos;
- skills e receita opcional;
- tarefas, dependências, evidências e locks;
- histórico de continuidade e checkpoints.

Para criar uma missão, descreva o resultado esperado, não apenas uma ação vaga. Prefira:

```text
Corrigir a busca de painéis livres do Maestro, preservar aliases em português,
adicionar cobertura para um shell com agente conectado e registrar a validação.
```

Em cada missão, a lateral permite alternar entre:

- **Missões:** seleciona, renomeia, expande e fecha missões do projeto;
- **Tarefas:** abre o quadro Kanban da missão;
- **Arquivos:** mostra a árvore e a memória compartilhada do projeto.

## Papéis e executores

### Papéis semânticos

O papel define o contrato funcional: o que o painel deve fazer, o que não deve fazer, quais são os gates de qualidade e qual entrega precisa devolver.

| Papel | Responsabilidade |
| --- | --- |
| **Maestro / Orquestrador** | Entende o objetivo, escolhe o fluxo, delega, acompanha bloqueios e consolida evidências. Não deve implementar tudo sozinho. |
| **Construtor** | Implementa, integra, corrige e entrega mudanças funcionais com validação. |
| **Explorador** | Localiza código, lê o sistema, investiga contexto e devolve um mapa útil antes da alteração. |
| **Arquiteto** | Define fronteiras, interfaces, dependências, trade-offs e critérios de aceite. |
| **Revisor** | Lê o diff e procura defeitos, riscos, regressões e violações de contrato. |
| **Verificador** | Executa testes e cenários de aceitação e dá um veredito sustentado por evidências. |
| **Depurador** | Reproduz a falha, isola a causa raiz, corrige ou orienta a correção e valida a regressão. |
| **Finalizador** | Integra, limpa, documenta, confere a entrega final e lista pendências. |
| **Artista / Pintor** | Produz arquivos de imagem, vídeo ou áudio para o produto; não decide o layout da interface. |
| **Cineasta** | Planeja roteiro, planos, imagens-chave, animação, trilha e narração na ordem correta. |

Também existem especializações auxiliares e perfis de execução, como `Piloto`, `Flash`, `Opus 4.6`, `Astra`, `Terra`, `Luna`, `Grátis`, `Gemini` e `DeepSeek`. Eles são perfis técnicos catalogados; não substituem o contrato do papel.

### Papel versus executor

Ao criar uma missão, escolha competências na seção **Composição por papel**. O Cockpit então resolve:

```text
papel semântico → perfil técnico → CLI/executor → modelo e esforço → backend
```

Por exemplo, `Construtor` pode resultar em `builder → Claude → DSH`, enquanto outra missão pode usar `builder → Codex → PTY`. O elenco da missão pode restringir quais provedores entram nessa resolução.

Aliases em português são aceitos na delegação e na localização de painéis, incluindo `construtor`, `executor`, `explorador`, `pesquisador`, `arquiteto`, `planejador`, `revisor`, `verificador`, `testador`, `auditor`, `depurador`, `finalizador` e `documentador`.

### Tipos de tarefa

O **Contexto do trabalho** organiza a missão, mas não substitui o papel nem escolhe um modelo por conta própria. Exemplos do catálogo atual:

- Mecânico;
- Explorar;
- Site / front-end;
- Site (volume);
- Arquitetura;
- Auditoria;
- Imagem (arquivo);
- Volume.

Use o tipo para explicar a natureza da tarefa; use o papel para definir quem é responsável por ela.

## Modos de coordenação

O modo responde à pergunta: **quanto poder o Maestro tem para delegar e abrir painéis?** Ele não altera o contrato dos papéis.

| Modo | O que o Maestro pode fazer |
| --- | --- |
| **Livre** | Não faz delegação autônoma. Você escolhe e abre painéis manualmente. |
| **Dirigido** | Pode delegar somente para agentes, papéis ou painéis autorizados. Não pode criar novos painéis sozinho. |
| **Autônomo** | Pode decompor, delegar e criar painéis dentro do limite de concorrência; o padrão é 4 painéis. |
| **Agêntico** | Fluxo de planejamento, execução e verificação conduzido pelo Maestro. Use junto da configuração de autonomia apropriada. |
| **Squad** | Fluxo por fases com uma formação previamente definida; a próxima fase é liberada por você. |

Na prática, os três guardas de autorização persistidos no servidor são `Livre`, `Dirigido` e `Autônomo`. `Agêntico` e `Squad` são fluxos de lançamento: `Squad` usa as rotas próprias de fases, enquanto o Maestro continua sujeito às regras de delegação da missão.

### Dirigido em detalhes

No modo `Dirigido`:

- o Maestro pode enviar trabalho a um papel autorizado;
- aliases em português são normalizados;
- um painel livre existente é reutilizado antes de qualquer tentativa de criação;
- se não houver painel compatível e pronto, a delegação não cria um novo painel;
- o usuário precisa abrir previamente os painéis que deseja autorizar.

### Autônomo em detalhes

No modo `Autônomo`:

- o Maestro pode delegar a perfis permitidos;
- painéis livres são reutilizados primeiro;
- quando não há painel compatível, um novo PTY pode ser criado;
- o limite padrão é 4 painéis autônomos, salvo override configurado;
- tarefas e delegações são registradas para permitir retomada e auditoria.

### Parada de emergência

A **parada de emergência** bloqueia delegações e novas ações autônomas da missão. Ela não deve ser confundida com encerrar um painel:

1. acione a parada no controle da missão;
2. verifique o status dos painéis;
3. encerre manualmente processos que precisam parar imediatamente;
4. use **Retomar** somente depois de revisar o estado.

## Shell limpo, papel e agente conectado

Este é o caso mais importante para entender o Cockpit.

### Como o shell limpo inicia

O perfil `bash` inicia estritamente:

```bash
/bin/bash -i -l
```

O shell limpo é soberano:

- não inicia LLM automaticamente;
- não recebe prompt oculto ou system prompt;
- não recebe a primeira tarefa do Maestro por injeção silenciosa;
- não ganha `DSH_HOME` por acidente;
- continua sendo um terminal normal até você digitar algo.

### Exemplo: Bash marcado como Construtor e Grok aberto dentro dele

Suponha este fluxo:

1. você abre um painel `bash`;
2. o Cockpit inicia `/bin/bash -i -l`;
3. você reclassifica o papel desse painel para **Construtor**;
4. dentro do terminal, você digita `grok` e inicia o Grok;
5. o Cockpit observa a saída e identifica o executor conectado como `attachedRunner: "grok"`.

Nesse cenário, o Maestro **pode enviar uma tarefa para esse Construtor**, mesmo que o painel técnico continue sendo um shell Bash. O dispatcher procura painéis no estado do servidor — não somente os painéis visíveis na janela — e considera:

- a mesma missão;
- conexão viva;
- status pronto ou ocioso;
- papel ou label correspondente;
- shell com um agente efetivamente conectado.

Quando a tarefa é despachada, o Cockpit escreve a instrução no mesmo PTY. O Grok, que está rodando dentro do Bash, recebe a tarefa pelo terminal.

### O que não funciona

Um Bash puro, sem Grok, Claude, Codex ou outro executor conectado, **não é um agente**. Apenas marcar esse shell como `Construtor` não cria inteligência nele. O dispatcher não envia uma delegação automática para um shell sem `attachedRunner`.

Em resumo:

```text
Bash + papel Construtor + Grok rodando dentro dele = pode receber tarefa
Bash + papel Construtor sem agente conectado       = shell manual, não agente
```

O badge do painel mostra separadamente executor, backend, conta, modelo, papel e status para que essa diferença fique visível.

## Maestro e continuidade

O Maestro é o painel que coordena uma missão. Ele pode:

- listar especialistas disponíveis;
- interpretar o objetivo;
- dividir o trabalho em tarefas autossuficientes;
- delegar respeitando o modo e o elenco;
- reutilizar painéis conectados e livres;
- acompanhar situação, bloqueios e resultados;
- registrar checkpoints;
- ler a saída completa de um especialista;
- guardar decisões duráveis na memória do projeto;
- retomar uma missão após uma troca de painel ou de provedor.

O especialista não vê automaticamente a conversa que você teve fora do terminal. Ao delegar, escreva o contexto necessário: objetivo, arquivos permitidos, dependências, critérios de aceite e formato de entrega.

### Checkpoints

Um checkpoint registra o estado útil da missão em um ponto de controle. Use-o depois de uma etapa importante, especialmente antes de:

- trocar o Maestro;
- trocar de provedor;
- retomar uma tarefa bloqueada;
- encerrar uma rodada de implementação;
- liberar a próxima fase de um squad.

Se um painel bloquear ou uma conta atingir limite, o histórico local e os checkpoints ajudam o novo painel a continuar sem começar do zero.

### Troca do Maestro

Em **Maestro e continuidade**, você pode consultar status, provedor, pool e escolher outro executor para a coordenação. A nova IA recebe o objetivo, a memória, o progresso e o histórico local da mesma missão. A troca não valida automaticamente o resultado: confira testes, diff e entregas após a retomada.

## Squads

Um **Squad** é uma formação por fases. Cada fase possui agentes, tipo de tarefa e, opcionalmente, um roster que altera o tipo para um agente específico.

O fluxo é:

1. escolha **Squad** na criação da missão;
2. selecione uma formação;
3. escreva o brief;
4. clique em **Lançar time**;
5. acompanhe os painéis da fase atual;
6. revise resultados e evidências;
7. clique em **Liberar próxima fase** quando estiver pronto.

Formações disponíveis no catálogo atual incluem:

- **Regido:** o Maestro divide o trabalho;
- **Revisão:** construção seguida de auditoria;
- **Paralelo:** vários agentes atacam o mesmo brief;
- **Site:** construção de interface com revisão e mídia quando necessário;
- **Provedores:** o mesmo trabalho comparado entre provedores;
- **Grátis + revisão:** volume barato e segunda leitura paga.

Os agentes de uma fase sobem de forma escalonada para evitar disputa de CPU e conflitos de inicialização. A fase seguinte não é aberta automaticamente: o botão funciona como portão de revisão humana.

## Painéis e terminais

Cada painel representa um processo real e possui estado próprio.

### O que o painel mostra

- nome/label renomeável;
- mascote e cor do perfil;
- papel funcional;
- executor técnico;
- backend `PTY` ou `DSH`;
- modelo e nível de esforço, quando existirem;
- conta do pool e indicação de conta fixada;
- status granular;
- tarefa ativa;
- conexões persistidas;
- consumo estimado de tokens e turnos;
- tempo desde a abertura;
- saída recente.

### Ações do painel

- **Focar:** abre o terminal em modo modal, com semântica `dialog`; pressione `Esc` ou use **Voltar** para retornar à grade.
- **Minimizar:** esconde o painel da grade, mas mantém o processo, o PTY e a saída ativos. Restaure pelo chip da bandeja.
- **Renomear:** clique no nome ou no lápis.
- **Reclassificar papel:** use o menu do papel para mudar a função sem necessariamente trocar o executor.
- **Conectar:** selecione outro painel para criar uma conexão persistida.
- **Desconectar:** remova uma conexão existente.
- **Encerrar:** termina o processo real e libera conta, locks e conexões associadas.
- **Enviar entrada:** em painéis DSH, use o campo estruturado; em PTY, digite diretamente no terminal.

### Grade e telas pequenas

Na configuração **Tela**, escolha:

- **Auto:** um painel ocupa a tela; até quatro usam duas colunas; acima disso, três colunas quando houver espaço;
- **1**, **2** ou **3:** fixa a quantidade de colunas.

Em telas pequenas, os painéis passam para uma coluna. O foco modal garante que um terminal seja utilizável mesmo quando a grade não comporta todos os painéis.

Trocar de missão muda o que está visível, mas não desmonta todos os terminais. Painéis de outras missões continuam no estado do servidor e continuam processando saída até serem encerrados.

## Quadro de tarefas

O quadro da lateral organiza o trabalho em seis estados:

| Estado | Significado |
| --- | --- |
| `todo` | Criada, mas ainda não iniciada |
| `in-progress` | Em execução por um painel ou responsável |
| `blocked` | Impedida por dependência, erro ou decisão pendente |
| `in-review` | Aguardando revisão/verificação |
| `complete` | Concluída com resultado registrado |
| `failed` | Falhou; o motivo deve ficar documentado |

Uma tarefa pode conter:

- título e descrição;
- responsável, papel e painel;
- arquivos permitidos;
- dependências por ID;
- prioridade (`baixa`, `normal`, `alta`, `urgente`);
- resultado;
- timestamps;
- evidências de diff, teste, log, nota, artefato, conhecimento ou handoff.

### Como trabalhar com tarefas

1. crie a tarefa com descrição e critério de aceite;
2. limite os arquivos permitidos quando o escopo for sensível;
3. defina dependências antes de iniciar;
4. atribua a um painel ou deixe o Maestro localizar um painel compatível;
5. mova o estado conforme o trabalho avança;
6. ao bloquear ou falhar, informe o motivo;
7. adicione evidências e resultado antes de marcar como concluída;
8. use `in-review` para exigir uma segunda leitura.

### Locks de arquivos

O Cockpit oferece ownership/locks por arquivo para reduzir concorrência destrutiva. Um lock pode ser `shared` ou `isolated`. Se dois agentes tentarem editar o mesmo caminho de forma incompatível, o Cockpit informa os arquivos e locks conflitantes. Ainda assim, em `pasta-real`, a decisão final é sua: revise o diff e não deixe dois agentes reescreverem o mesmo arquivo sem coordenação.

## Arquivos e memória

Em **Arquivos**, a aba **Arquivos** mostra a árvore do projeto. Clique em uma pasta para expandir ou em um arquivo para abrir o editor CodeMirror.

No editor:

- edite o conteúdo diretamente;
- use `Ctrl+S` no Linux/Windows ou `Cmd+S` no macOS para salvar;
- observe o indicador de arquivo alterado;
- confira o diff no Git depois de salvar.

Na aba **Memória**, registre decisões que todos os agentes do projeto precisam conhecer:

```text
O endpoint público permanece compatível com a versão anterior.
Não alterar migrations sem atualizar o script de rollback.
O diretório media/ contém apenas artefatos gerados e não entra no bundle.
```

A memória é do **projeto**, não de um painel. Um agente novo começa com essas notas disponíveis. Remova uma nota somente quando ela deixar de ser verdadeira.

## Conexões e handoffs

### Conexões

Uma conexão persistida liga dois painéis da mesma missão. Ela serve para tornar explícita a relação de trabalho e aparece no painel como conexão ativa. A conexão não transforma um shell sem agente em IA e não substitui a tarefa: ela é o vínculo de comunicação/coordenação.

### Handoff

Um handoff transfere uma tarefa de um painel para outro com contexto e evidência. O Cockpit:

- valida que a tarefa existe;
- verifica que o painel de origem possui a tarefa, salvo uso explícito de `--force`;
- rejeita alvo morto;
- detecta loops circulares;
- registra uma evidência de handoff;
- reatribui a tarefa;
- envia uma mensagem para a caixa de entrada do destino.

Use handoff quando a próxima função precisa continuar o trabalho, por exemplo, `Explorador → Construtor` ou `Construtor → Revisor`.

## Provedores, contas e cotas

Abra **Ajustes → Provedores** para detectar e testar os executores disponíveis.

### Provedor por CLI

Conectar um provedor significa informar ao Cockpit qual comando chamar. A autenticação continua sendo responsabilidade do CLI. O Cockpit mostra se o comando está instalado e se responde ao teste; isso não significa que ele possa expor ou validar todas as credenciais internas.

### Pools multicontas

Um pool permite cadastrar várias contas do mesmo CLI, cada uma com seu próprio home e ambiente. O Cockpit:

- mantém afinidade entre painel e conta;
- prefere contas com menor carga;
- prioriza perfis autenticados quando a informação está disponível;
- usa LRU como desempate;
- evita contas em cooldown;
- libera a conta quando o painel termina;
- permite fixar uma conta para uma sessão;
- mostra contas livres, ocupadas e em cooldown.

Quando uma conta atinge limite, ela entra em cooldown temporário. Use **Resetar limite** somente se você tiver certeza de que o provedor liberou a conta; resetar a marca local não remove um limite real do serviço.

### Onboarding

O onboarding pode abrir uma sessão de autenticação, aguardar o navegador, acompanhar o callback loopback e registrar a nova conta no pool. Se o callback automático não funcionar, use o fluxo manual oferecido pela interface. Cancele sessões antigas para não deixar processos de login pendurados.

### Failover

Quando a política permitir, o Maestro pode preservar o objetivo e continuar com outra conta ou provedor depois de um checkpoint. Failover não garante equivalência entre modelos. Sempre revise a saída, o diff e os testes após uma retomada.

## Política de IA

Abra **Ajustes → Provedores** e acesse a política de distribuição quando disponível. Os modos de política são:

- **Padrão:** respeita catálogo, tarefa, papel, elenco e configuração da missão;
- **Uma IA:** usa a mesma combinação de provedor, modelo e esforço em todos os papéis;
- **Dividida:** fixa combinações por papel e deixa os demais no padrão.

Ordem de decisão recomendada:

1. elenco da missão;
2. política de IA;
3. perfil do papel;
4. tipo de tarefa;
5. modelo e esforço compatíveis com o CLI;
6. pool/conta disponível.

Uma política fixa pode prevalecer sobre receitas, elenco ou tipos de tarefa. Confira a mensagem explicativa da interface antes de salvar uma distribuição global.

## Skills, Marketplace e Receitas

### Skills

Uma skill é uma instrução instalável para orientar um agente em uma competência específica. Em **Ajustes → Skills** você pode:

- consultar o acervo;
- abrir o conteúdo de uma skill;
- atribuir skills permitidas a um agente;
- revisar quais skills entram no contexto de uma missão.

Ao delegar, informe somente as skills necessárias. Skill não concede permissão de filesystem, não muda o modo da missão e não autoriza ultrapassar o contrato do papel.

### Marketplace

Em **Ajustes → Marketplace** você pode cadastrar fontes, atualizar catálogos, baixar e instalar plugins/skills. Trate repositórios externos como código não confiável: leia a origem e a finalidade antes de instalar.

### Receitas

Uma receita é um fluxo reutilizável com combinações de modo, squad, tipo, elenco e skills. Receitas disponíveis incluem:

- Landing page;
- Caçar um bug;
- Refatorar com rede;
- Decidir arquitetura;
- Mutirão;
- Peça visual;
- Vídeo curto;
- Auditoria;
- Site com Claude + GPT;
- Só Claude;
- De graça;
- Grátis faz, pago revisa.

Receita é atalho de configuração. Depois de escolhê-la, revise papéis, provedores, custos, arquivos permitidos e modo antes de lançar.

## Media

Em **Ajustes → Media**, configure provedores para gerar arquivos de imagem, vídeo e áudio.

O catálogo atual inclui:

- **Higgsfield:** CLI com assinatura para imagem, vídeo e áudio;
- **Gemini:** imagem via chave de API;
- **GPT Image:** imagem via chave de API;
- **Replicate:** vídeo via token de API;
- **ElevenLabs:** áudio via chave de API.

Diferença importante:

- assinatura do CLI usa a cota/assinatura daquele serviço;
- chave de API gera cobrança separada por uso;
- uma assinatura de chat não implica que a API de imagem, vídeo ou áudio esteja coberta.

O papel **Artista/Pintor** deve produzir arquivos e informar seus caminhos, normalmente dentro de `media/`. Ele não deve decidir a arquitetura visual do frontend. O papel **Cineasta** deve planejar antes de consumir gerações: roteiro, imagens-chave, animação e narração.

## CLI de comunicação

Depois de `npm link`, a CLI usa por padrão `http://127.0.0.1:3000` e a missão `default`.

```bash
# listar painéis da missão
cockpit list
cockpit list --format=json --mission=<id>

# criar conexão entre painéis
cockpit connect <painel-origem> <painel-destino> --mission=<id>

# enviar tarefa direta
cockpit ask <painel> "Analise o fluxo de autenticação" --mission=<id>
cockpit ask <painel> "Rode os testes do parser" --task-id=<taskId> --mission=<id>

# responder a outro painel
cockpit reply <painel> "A causa está em ..." --mission=<id>

# transferir uma tarefa com contexto
cockpit handoff <origem> <destino> <taskId> "Continue a partir deste diagnóstico" --mission=<id>

# forçar handoff quando a origem não é dona da tarefa
cockpit handoff <origem> <destino> <taskId> "Contexto" --force --mission=<id>

# ler caixa de entrada
cockpit inbox --unread --pane=<painel> --mission=<id>

# ler a saída registrada de um painel
cockpit resultado <painel> --mission=<id>
```

Variáveis úteis para a CLI:

| Variável | Função | Padrão |
| --- | --- | --- |
| `COCKPIT_PORT` | Porta HTTP usada pela CLI | `3000` |
| `COCKPIT_MISSION` | Missão padrão | `default` |
| `COCKPIT_PANE` | Painel padrão para `from` | `user` |

Os comandos aceitam IDs e, em vários fluxos, labels/papéis. Para automação, prefira IDs estáveis e `--format=json`.

## Arquitetura do projeto

```text
cockpit/
├── web/                 # React, Vite, xterm.js, CodeMirror e interface
├── servidor/            # Express, WebSocket, domínio e persistência
│   ├── sessions/        # Host PTY, shell limpo e adapters PTY/DSH
│   ├── orchestration/   # Maestro, papéis, modos, squads e dispatcher
│   ├── providers/       # Provedores, pools, onboarding, cotas e failover
│   ├── tasks/           # Máquina de estados, evidências e locks
│   ├── connections/     # Conexões, mailbox, bridge e handoffs
│   ├── missions/        # Missões, Git, continuidade e watcher
│   ├── security/        # Auditoria, sanitizer, cofres e permissões
│   └── persistence/     # Stores locais de missão, painel, tarefa e layout
├── bin/cockpit.mjs      # CLI entre agentes
├── docs/                # Exemplos e documentação complementar
├── scripts/             # Checks, testes, QA e setup do DSH
├── app/                 # Wrapper/artefatos Windows
├── cockpit.json         # Catálogo e configuração principal
└── package.json         # Scripts e dependências
```

Fluxo do backend:

```text
Browser
  ↕ WebSocket/REST
Express + domínio do Cockpit
  ├─ estado e persistência
  ├─ TaskManager + ownership/locks
  ├─ Mailbox + conexões + handoffs
  ├─ MissionModeManager + PaneDispatcher
  └─ PtyManager → host de PTY → processo real
                         ├─ bash/CLI via PTY
                         └─ DSH via runtime SDK/headless
```

O `PaneDispatcher` consulta a lista global de painéis do servidor, filtra pela missão e exige conexão, estado pronto e compatibilidade sem depender da janela atualmente aberta no navegador. Ele tenta reutilizar um painel livre antes de abrir um novo.

## Segurança e limites

- Não coloque tokens ou chaves de API no `cockpit.json`, em tarefas, na memória ou no README.
- Use `DSH_HOME` isolado; nunca compartilhe `~/.dsh` entre `dsh web` e Cockpit.
- O shell limpo não recebe prompt oculto nem inicia LLM sozinho.
- `autoAprovar=true` permite que CLIs executem ações sem pedir confirmação. Use somente em projetos confiáveis e mantenha uma parada de emergência disponível.
- Proteger caminhos não substitui revisão humana. Um agente ainda pode alterar muitos arquivos dentro da pasta autorizada.
- Em `pasta-real`, vários agentes podem editar o mesmo checkout. Use locks, arquivos permitidos, dependências, squads por fase e revisão independente.
- Não trate `connected` como sinônimo de “agente pensando”: confira status, executor e `attachedRunner`.
- Ao instalar plugins do Marketplace, valide a origem e o conteúdo.
- Ao trocar conta ou provedor, considere que modelos diferentes podem interpretar a tarefa de forma diferente.
- Revise sempre `git diff`, testes, logs e evidências antes de publicar ou fazer commit.

## Solução de problemas

### A página não abre

Confira o terminal do servidor e rode:

```bash
npm start
```

Se a porta estiver ocupada, use outra:

```bash
COCKPIT_PORTA=3100 npm start
```

Abra `http://localhost:3100`.

### A interface diz que o servidor está desatualizado

Feche o processo Node antigo e reinicie `npm start`. Isso normalmente acontece quando o Vite gerou uma interface nova, mas o backend em execução ainda é antigo.

### O DSH aparece indisponível

Verifique:

```bash
echo "$DSH_REPO_PATH"
echo "$DSH_BIN"
echo "$DSH_HOME"
test -f "$DSH_BIN" && echo "binário encontrado"
test -d "$DSH_HOME" && echo "home encontrado"
```

Depois rode `./scripts/setup-dsh-cockpit-home.sh`. Se `DSH_HOME` terminar em `/.dsh`, corrija-o para `~/.cockpit/dsh-home` ou outro diretório isolado.

### O Maestro não encontra o Construtor

Confira:

1. o painel pertence à mesma missão;
2. o papel/label está correto;
3. o status não é `starting`, `working`, `dead` ou `failed`;
4. `connected` está ativo;
5. se for Bash, existe um `attachedRunner` real;
6. no modo `Dirigido`, o alvo está no elenco autorizado;
7. a parada de emergência está desligada.

Um shell vazio marcado como Construtor não basta. Abra o CLI dentro dele ou use um painel criado diretamente para o executor.

### Uma tarefa não chega ao Bash

Isso é esperado quando o Bash está realmente vazio. O Cockpit protege o shell contra injeção automática. Inicie um agente dentro do terminal e aguarde a detecção do executor; então o dispatcher poderá escrever a tarefa no mesmo PTY.

### Uma conta ficou em cooldown

Veja **Ajustes → Provedores** ou **Maestro e continuidade**. Aguarde o período real de limite, use outra conta do pool ou faça failover. O botão de reset apenas limpa o estado local.

### O painel sumiu da tela

Ele pode estar minimizado ou pertencer a outra missão. Restaure-o pela bandeja de painéis ou selecione a missão correta na lateral. Trocar de missão não encerra automaticamente os demais painéis.

### Dois agentes alteraram o mesmo arquivo

Pare novas delegações, registre o bloqueio, compare os diffs e escolha uma versão. Depois reorganize as tarefas com arquivos permitidos, locks e dependências. Não resolva conflito aceitando cegamente o último arquivo escrito.

### O custo está maior que o esperado

Abra **Consumo** e confira modelo, esforço, turnos, entradas, saídas, cache e conta. Revise a política de IA, o elenco, a receita e os tipos de tarefa. Para trabalho volumoso, use um perfil mais barato e reserve modelos fortes para arquitetura, revisão e correção.

## Scripts

Comandos principais:

```bash
npm start                 # build do frontend e servidor
npm run server            # somente backend
npm run dev               # Vite em desenvolvimento
npm run build             # build de produção do frontend
npm test                  # bateria de checks e testes do projeto
npm run security:secrets  # procura segredos hardcoded
```

Scripts úteis no diretório `scripts/`:

- checks de PTY, shell limpo, estados de painel e lifecycle;
- checks de dispatcher, Maestro, continuidade e modos;
- checks de tarefas, locks, conexões e handoffs;
- checks de pools, onboarding, cotas e failover;
- checks de DSH, APIs e compatibilidade;
- checks de UI, responsividade, edição e modais;
- checks de segurança, permissões, sanitizer e segredos;
- runners E2E e QA para cenários locais e live.

Alguns checks live exigem CLIs, contas, Playwright ou um serviço externo disponível. Quando uma dependência opcional não existe, o runner pode pular o cenário em vez de indicar que a integração externa foi validada.

Antes de enviar uma mudança:

```bash
git status
git diff --check
git diff
```

Depois revise os arquivos alterados, execute a validação adequada ao seu ambiente e só então faça o commit.

## Licença

Distribuído sob licença privada/proprietária. Todos os direitos reservados.
