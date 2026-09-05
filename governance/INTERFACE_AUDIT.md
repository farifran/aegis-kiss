# Auditoria de Interfaces de Governança

Este documento fixa a fronteira de migração do intake do Aegis. Ele descreve
interfaces reais verificadas no repositório em 2026-09-04; não altera o fluxo
de execução por si só.

## Estado atual

| Interface | Estado | Limite atual | Destino da migração |
| --- | --- | --- | --- |
| `./aegis "<demanda>"` | Ativa | Emite prompt de preflight com demanda normalizada, fatos mecânicos e política compacta no `stdout`; não persiste a demanda bruta. | A demanda esclarecida será a primeira saída durável após confirmação. |
| `.skills/briefing.md` | Ativa | Mistura intenção, Contract IR e detalhes de implementação TypeScript. | Refatoração pendente, fora desta modificação; quando iniciada, receberá demanda esclarecida e emitirá somente compromisso semântico. |
| `ARCHITECTURE.md` | Ativa | Projeção humana inicial, com range rastreável da regra estruturada. | `governance/architecture.policy.json` é a política canônica; o normalizador seleciona regras por tags e detecta fonte desatualizada. |
| `.harness/active_contract_ir.json` | Ativa quando há produto governado | Aceita exclusivamente `aegis.contract_ir.v2`; valida escopo, comportamento, invariantes, obrigações e cobertura de cada requisito esclarecido. | Evolução explícita pelo próprio contrato, nunca conversão automática de `v1`. |
| `.harness/proof_registry.json` | Ativa quando há produto governado | Valida identidade, risco, autoridade, custo, cadência, target e comando; toda obrigação e invariante de `v2` precisa apontar para ele. | Permanece a autoridade da execução de provas. |
| `.git/aegis/precommit_receipt.json` | Ativa na autorização | Liga índice, manifesto, contrato, registro, demanda esclarecida, política arquitetural, artefato de validação e perfil. | O recibo verifica novamente todos esses digests contra o índice. |

## Separação obrigatória

```text
Demanda bruta              → transitória, apenas em memória
Demanda normalizada        → transitória, apenas em memória
Decisão de preflight       → transitória, apenas em memória
Demanda esclarecida        → canônica e durável após confirmação
Política arquitetural      → durável e versionada
Contract IR                → durável e semântico
Plano de implementação     → transitório e específico da execução
Proof registry / receipt   → duráveis, com evidência verificável
```

## Incompatibilidades que a migração deve remover

1. A demanda do usuário não pode ser registrada em runtime como memória
   durável da execução.
2. Um contrato não pode exigir corpos de métodos, imports ou estruturas de
   dados privadas para ser válido.
3. Uma regra de arquitetura não pode ser aplicada sem `id`, nível e condição
   de aplicabilidade.
4. Uma política técnica não pode aparecer como requisito do usuário.
5. Uma pergunta de preflight não pode ser confundida com uma decisão interna
   do harness.

## Corte de versão deliberado

Os schemas `v1` deste diretório descrevem artefatos de entrada e preflight;
eles não são uma continuação de `Contract IR v1`. O único contrato ativo para
novas demandas será `aegis.contract_ir.v2`.

Não haverá conversão automática nem período de compatibilidade para contratos
ativos `v1`: uma conversão desse tipo poderia inventar intenção, invariantes ou
provas. Antes de ativar os gates de `v2`, o operador reinicia o estado
governado com ação explícita. O Git preserva contratos e receipts históricos;
o runtime novo começa sem metadados ativos herdados.

O normalizador, o intake `v2`, o preflight semântico e a migração de Contract
IR já estão ativos. O gate rejeita contrato legado, valida o `v2` no worktree
e no índice, e o receipt preserva os vínculos da demanda esclarecida e da
política arquitetural.

## Critério de encerramento desta fase

- todos os artefatos futuros possuem schema versionado;
- cada artefato declara se é transitório ou durável;
- não há mudança silenciosa no comportamento de `./aegis`;
- os schemas e esta auditoria são validados no conjunto de testes do harness.
