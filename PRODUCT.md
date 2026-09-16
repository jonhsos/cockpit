# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript e Vite no frontend; Express, WebSocket e `node-pty` no backend. O Cockpit também integra CLIs de agentes e o backend DSH.

## Users

O usuário principal é um desenvolvedor/operador que trabalha sozinho no dia a dia e coordena vários painéis de agentes sobre um projeto real. Esta é uma inferência baseada na interface, nos fluxos existentes e no pedido de reformulação; deve ser confirmada se o produto passar a ser usado por uma equipe.

## Purpose

O Cockpit permite abrir missões, escolher papéis funcionais, atribuir executores e acompanhar agentes trabalhando diretamente na pasta do projeto. O mecanismo central é separar o contrato semântico do papel do executor técnico (CLI, backend, modelo e conta).

## Core workflows

- Criar uma missão com nome, objetivo, modo de coordenação e formação de executores.
- Adicionar um painel por meio do catálogo, escolhendo papel, executor, backend, modelo e conta.
- Usar prompts internos por papel para manter cada agente dentro do escopo oficializado.
- Alternar entre DSH e PTY para CLIs de IA, preservando o Shell Bash limpo como terminal soberano.
- Acompanhar tarefas, evidências, estados, conexões e resultados.

## Durable constraints

- Papéis semânticos não devem depender de nomes de modelos.
- A escolha de executor/modelo/backend deve ser explícita e auditável.
- O Shell limpo inicia como `/bin/bash -i -l`, sem prompt oculto ou injeção de LLM.
- Credenciais e variáveis de ambiente ficam restritas ao processo do painel correspondente.
- Missões trabalham na pasta real do projeto; o fluxo existente de isolamento e concorrência deve ser preservado.
- A interface deve manter foco, teclado, estados de erro/carregamento e adaptação a telas pequenas.
- A cópia da interface é em português brasileiro.

## Open decisions

- Persistência e edição compartilhada de papéis customizados ainda não estão definidas; nesta etapa eles permanecem limitados ao fluxo que os criou.
