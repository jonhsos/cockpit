# Cockpit

Cockpit é uma interface local para trabalhar com agentes de IA no mesmo projeto. Ele abre painéis para Claude Code, Codex, Antigravity e outros CLIs, organiza missões, pode criar worktrees Git e mantém o contexto do trabalho entre painéis.

O Cockpit não traz nem paga modelos de IA. Cada pessoa conecta os CLIs e as contas que já usa.

## Rodar depois de clonar

Requisitos validados neste projeto:

- Windows 10 ou 11
- Node.js 24 (use uma versão recente do Node; o servidor executa arquivos TypeScript diretamente)
- npm, instalado junto com o Node
- Git, recomendado para abrir projetos com branches e worktrees isolados

No PowerShell ou Terminal, dentro da pasta clonada:

```powershell
git clone <URL_DO_REPOSITORIO>
cd agent-project
npm ci
npm start
```

Abra [http://localhost:3000](http://localhost:3000).

`npm ci` instala exatamente as versões guardadas no `package-lock.json`. `npm install` também funciona quando você quiser atualizar ou alterar dependências.

O comando `npm start` primeiro gera a interface e depois inicia o servidor. Para iniciar somente o servidor depois de já ter compilado, use `npm run server`.

> O repositório inclui `node-pty`, que é um módulo nativo. Em uma versão de Node muito nova ou incomum, o npm pode pedir ferramentas de compilação C++. Use a versão LTS/atual do Node; se o problema persistir no Windows, instale o **Visual Studio Build Tools** com a carga **Desktop development with C++** e execute `npm ci` novamente.

## Conectar uma IA

Instale e autentique ao menos um provedor. O Cockpit detecta os comandos no `PATH` e não guarda suas chaves ou sessões: o login continua sendo feito pelo CLI oficial de cada serviço.

| Provedor | Instalar | Primeiro login |
| --- | --- | --- |
| Codex / GPT | `npm i -g @openai/codex` | Execute `codex` e siga o login | 
| Claude Code | `npm i -g @anthropic-ai/claude-code` | Execute `claude` e siga o login |
| Antigravity / Gemini | Instale a Antigravity CLI | Execute `agy models` para conferir a conta |
| Gemini CLI | `npm i -g @google/gemini-cli` | Execute `gemini` e siga o login |
| OpenRouter (grátis) | já vem configurado; precisa do Codex instalado | Cole a chave em **Ajustes → Grátis** |

Feche e abra o Cockpit, ou entre em **Ajustes → Provedores** e atualize a lista. Um provedor que não está instalado aparece como indisponível, sem impedir o resto da aplicação de abrir.

Para usar o terminal interno, instale também o Git for Windows. Caso ele não esteja em `C:\Program Files\Git\bin\bash.exe`, abra `cockpit.json` e ajuste `clis.bash.command` para o caminho correto, ou remova esse provedor.

## IA de graça, pelo OpenRouter

O OpenRouter reúne modelos de vários laboratórios num endereço só, e uma parte
deles custa zero. Ele não tem CLI — é uma API. O Cockpit resolve isso com uma
**ponte**: empresta o binário do Codex e aponta ele para o servidor do
OpenRouter. O painel é o mesmo de sempre; o que muda é quem responde, e a
assinatura que não é consumida.

1. Instale o Codex (`npm i -g @openai/codex`). Ele é o motor da ponte, mesmo
   que você não use a conta da OpenAI.
2. Crie uma chave em [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
3. No Cockpit, abra **Ajustes → Grátis**, cole a chave e clique em
   **Testar de verdade** — isso fala com a API pelo mesmo caminho que o painel
   vai usar, então um "ok" aqui é um painel que sobe.
4. Use o agente **GRÁTIS** nas missões, ou a receita **De graça**.

A chave fica cifrada em `~/.cockpit/chaves.json` e só existe dentro do processo
do painel: ela não entra no `cockpit.json`, não aparece na tela e não vai para
o log. Você também pode simplesmente exportar `OPENROUTER_API_KEY` no ambiente.

**O catálogo é lido ao vivo.** "Atualizar modelos" relê a lista do OpenRouter,
guarda só os de preço zero e destaca quem aceita ferramentas — sem ferramentas
o modelo conversa, mas não edita arquivo. O modelo que você escolheu continua
sendo o padrão depois de uma atualização.

**Modelo grátis é modelo menor.** Ele serve para volume, rascunho e busca em
código; arquitetura e bug difícil continuam valendo a assinatura. Duas coisas
tiram proveito disso sem você pedir: a receita **Grátis faz, pago revisa** (o
modelo de graça escreve, o Claude revisa) e o failover — quando todas as cotas
pagas estouram no meio de uma missão, o maestro migra para a ponte em vez de
parar.

### Ligar outro provedor pela mesma ponte

Qualquer serviço que fale a **API de Responses da OpenAI** entra do mesmo jeito:
copie o bloco `clis.openrouter` no `cockpit.json`, troque `base_url`, `chaveEnv`
e `provider`. A exigência da API de Responses não é escolha do Cockpit — o Codex
0.154 removeu o suporte a `wire_api = "chat"`, e um provedor que só ofereça
`/chat/completions` vai recusar a conexão logo na subida.

Para modelos locais, o caminho não é a ponte: o Codex já traz `--oss` com
Ollama e LM Studio embutidos.

## Primeiro uso

1. Abra o Cockpit em `http://localhost:3000`.
2. Clique em **Abrir projeto** e escolha a pasta em que você quer trabalhar.
3. Clique em **Nova missão**, descreva o objetivo e escolha o modo:
   - **Livre:** você abre os painéis que quiser.
   - **Squad:** o Cockpit abre os agentes previstos nas fases do time.
   - **Agêntico:** abre o maestro, que acompanha e delega o trabalho.
4. Acompanhe os painéis no centro da tela. Eles executam comandos reais no projeto selecionado.

Em projetos Git, a missão pode usar um worktree separado. Isso cria uma branch de trabalho para evitar que uma missão altere diretamente a branch atual.

## Escolher quem executa

Em **Maestro → Quem faz o trabalho**, há três formas de operar:

- **Padrão atual:** usa perfil e modelo do agente escolhido em `cockpit.json`. Tipo de tarefa só organiza contexto.
- **Uma IA para tudo:** escolha, por exemplo, `gpt-5.6-sol`; ela assume maestro, piloto, builder e revisão. O maestro passa a poder implementar diretamente.
- **Escolher por papel:** fixa um provedor, modelo e esforço para papéis específicos, deixando o restante seguir o padrão.

A configuração vale para painéis abertos depois de salvar. Um painel já em execução preserva a configuração com que foi iniciado.

## Configuração e dados locais

`cockpit.json` é a configuração compartilhável do Cockpit: agentes, modelos, times, receitas, permissões e porta. O Cockpit grava alterações feitas nas telas nesse arquivo. A opção `autoAprovar` (ativa por padrão) passa flags como `--dangerously-skip-permissions`, `--ask-for-approval never` e `-y` para que os painéis não travem pedindo confirmação a cada comando.

O estado pessoal fica fora do repositório, em `~/.cockpit` (ou no caminho definido por `COCKPIT_HOME`). Ali ficam os projetos abertos, missões, notas e a continuidade. Essa pasta já está no `.gitignore`.

Se você quiser recomeçar com uma lista vazia de projetos e missões, feche o Cockpit e apague somente `~/.cockpit`. Isso não apaga os projetos originais nem worktrees que já tenham sido criados.

## Comandos úteis

```powershell
# Rodar a bateria inteira: tipos, build e todas as verificações
npm test

# Conferir tipos antes de enviar mudanças
npx tsc --noEmit

# Gerar a versão de produção da interface
npm run build

# Iniciar o Cockpit (compila e sobe o servidor)
npm start
```

`npm test` roda `tsc`, o build e todos os `scripts/check-*`. Os dois testes de
navegador ficam de fora por padrão, porque dependem do Playwright, que não é
dependência deste projeto. Para incluí-los, passe o caminho:

```powershell
npm test -- C:\caminho\para\playwright-core\index.mjs
```

Se o Chromium do Playwright não estiver baixado, aponte um navegador que você já
tem com `$env:CHROME_PATH`.

Três variáveis isolam uma execução de teste da sua instalação de verdade:
`COCKPIT_CONFIG` (outro `cockpit.json`), `COCKPIT_HOME` (outro estado pessoal) e
`COCKPIT_PORTA` (outra porta, para rodar uma segunda instância sem derrubar a
primeira).

## Limites conhecidos

O seletor gráfico de pastas foi feito para Windows. Em outros sistemas, o servidor e os CLIs podem funcionar, mas é necessário informar/abrir os projetos por um fluxo compatível ou adaptar esse seletor. Recursos de mídia dependem do provedor que cada pessoa configurar.
