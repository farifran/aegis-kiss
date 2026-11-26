# Arquitetura do Askesis

Este documento consolida a visão arquitetural do sistema em diagramas Mermaid para facilitar onboarding, revisão técnica e evolução do produto.

## 1) Contexto do Sistema (C4 - Nível 1)

```mermaid
flowchart LR
  U[Usuário]
  A[Askesis PWA]
  G[Google Gemini API]
  V[Vercel Serverless API]
  O[OneSignal]

  U -->|Usa diariamente| A
  A -->|Análise e reflexão| V
  V -->|Proxy de IA| G
  A -->|Registro de push| O
  O -->|Notificações| U
```

## 2) Diagrama Detalhado de Contêineres (C4 N2)

```mermaid
flowchart TB
  %% Nível 2 = visão de containers (sem repetir nomes de arquivos do Nível 3)
  %% Nota: evitamos o "loop" SW -> PWA para reduzir cruzamentos no render do GitHub.
  subgraph Client["Client (PWA)"]
    direction TB
    PWA["Askesis PWA\n(UI + Render)"]
    Store["Local Storage\n(IndexedDB)"]
    Sync["Sync Engine"]
    Worker["Web Worker\n(crypto + merge)"]
    SW["Service Worker\n(offline + bg sync)"]
  end

  subgraph External["External Services"]
    direction TB
    API["Vercel API\n(/api/sync, /api/analyze)"]
    AI["Gemini API"]
    PUSH["OneSignal"]
  end

  %% Core flows
  PWA --> Store
  PWA --> Sync
  Sync --> Worker
  Sync --> API --> AI

  %% Background sync + push notifications
  Sync -->|register bg sync| SW
  PWA -->|opt-in/consent| PUSH
  PUSH -->|push events| SW
  SW -->|notificationclick| Open["Open / focus Askesis"]
```

<!-- markdownlint-disable-next-line MD033 -->
<a id="componentes-internos"></a>

## 3) Componentes Internos (C4 N3)

```mermaid
flowchart TB
  %% Layout em camadas (mais fácil de ler): UI -> Domínio -> Infra
  subgraph UI["UI (DOM)"]
    direction TB
    IDX["index.tsx (boot)"]
    LISTEN["listeners/*"]
    RENDER["render/*"]
    EVENTS["events.ts (event hub)"]
  end

  subgraph DOMAIN["Domínio"]
    direction TB
    ACTIONS["services/habitActions/*\n(public API via habitActions.ts)"]
    SELECTORS["services/selectors.ts"]
    ANALYSIS["services/analysis.ts"]
    STATE["state.ts (single source of truth)"]
  end

  subgraph INFRA["Infra (persistência + sync)"]
    direction TB
    PERSIST["services/persistence.ts (IndexedDB)"]
    CLOUD["services/cloud.ts (sync)"]
    WRPC["services/workerClient.ts"]
    WORKER["services/sync.worker.ts"]
    API["services/api.ts (HTTP client)"]
    MERGE["services/dataMerge/*\n(public API via dataMerge.ts)"]
  end

  %% Boot / UI
  IDX --> LISTEN
  IDX --> RENDER
  IDX --> EVENTS

  %% Domínio
  LISTEN --> ACTIONS
  RENDER --> SELECTORS

  ACTIONS --> STATE
  SELECTORS --> STATE
  ANALYSIS --> STATE

  %% Persistência + Sync
  ACTIONS --> PERSIST
  PERSIST --> STATE
  PERSIST --> CLOUD

  %% Eventos globais (UI plumbing)
  ACTIONS --> EVENTS
  EVENTS --> RENDER
  EVENTS --> LISTEN

  %% Worker / Cloud
  ANALYSIS --> CLOUD
  CLOUD --> WRPC --> WORKER
  CLOUD --> API
  CLOUD --> MERGE
```

Leitura rápida: interação entra por `listeners/*`, regra de negócio vive em `services/habitActions/*` (re-export em `habitActions.ts`) e `selectors.ts`, estado central em `state.ts`, e persistência/sync ficam em `persistence.ts` + `cloud.ts` + `sync.worker.ts`.

<!-- markdownlint-disable-next-line MD033 -->
<a id="fluxo-dados"></a>

## 4) Fluxo de Dados (Local-first + Sync)

```mermaid
sequenceDiagram
  participant User as Usuário
  participant UI as UI
  participant Actions as habitActions
  participant Persist as persistence
  participant DB as IndexedDB
  participant Cloud as cloud.ts
  participant WRPC as workerClient
  participant Crypto as sync.worker (crypto)
  participant API as Vercel API /api/sync
  participant Merge as dataMerge

  User->>UI: Marca hábito / adiciona nota
  UI->>Actions: Atualiza hábito/nota
  Actions->>Persist: saveState() (debounced)
  Persist->>DB: Persistência local (split core + logs)
  Persist-->>Cloud: syncHandler(snapshot)
  Cloud->>WRPC: runWorkerTask(encrypt/decrypt...)
  WRPC->>Crypto: encrypt(shards alterados, syncKey)
  Crypto-->>Cloud: shards criptografados
  Cloud->>API: POST /api/sync
  alt 200 OK
    API-->>Cloud: ACK
  else 409 CONFLICT
    API-->>Cloud: shards remotos
    Cloud->>WRPC: runWorkerTask(decrypt...)
    WRPC->>Crypto: decrypt(shards remotos, syncKey)
    Crypto-->>Cloud: estado remoto
    Cloud->>Merge: mergeStates(local, remoto)
    Merge-->>Cloud: estado consolidado
    Cloud->>Persist: persistStateLocally(merged)
  end
```

<!-- markdownlint-disable-next-line MD033 -->
<a id="fluxo-conflito"></a>

## 5) Fluxo de Conflito de Sync

```mermaid
sequenceDiagram
  participant D1 as Dispositivo A
  participant D2 as Dispositivo B
  participant Cloud as Cloud State

  D1->>Cloud: Atualização 1 (hábito renomeado)
  D2->>Cloud: Atualização 2 (mesmo hábito, outro horário)
  Cloud-->>D1: Estado combinado
  Cloud-->>D2: Estado combinado

  Note over D1,D2: Regras de merge:
  Note over D1,D2: 1) Match por ID
  Note over D1,D2: 2) Dedup por nome normalizado
  Note over D1,D2: 3) LWW por schedule/history
```

## 6) Mapa rápido de módulos (pasta → responsabilidade)

- `render/`: composição visual e atualização de DOM.
- `listeners/`: eventos de interação (toque, drag, swipe, modais).
- `services/`: domínio e infraestrutura (persistência, sync, merge, crypto, análise).
- `api/`: endpoints serverless (analyze/sync) e hardening HTTP.
- `tests/`: cenários de jornada, segurança, resiliência e performance.

## Uso no README

Você pode copiar os blocos Mermaid acima e colar no README conforme a necessidade de profundidade:

- Curto: Contexto + Contêineres.
- Médio: + Fluxo de Dados.
- Completo: todos os diagramas.
