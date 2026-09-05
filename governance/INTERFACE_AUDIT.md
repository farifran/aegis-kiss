# Auditoria de Interfaces de Governança

Este documento fixa a fronteira de migração do intake do Aegis. Ele descreve
interfaces reais verificadas no repositório em 2026-09-04; não altera o fluxo
de execução por si só.

## Estado atual

| Interface | Estado | Limite atual | Destino da migração |
| --- | --- | --- | --- |
| `./aegis "<demanda>"` | Ativa | Grava a demanda bruta em `.harness/runtime/ide_intake.json`. | A demanda bruta passa a existir somente em memória; a saída durável será a demanda esclarecida. |
| `.skills/briefing.md` | Ativa | Mistura intenção, Contract IR e detalhes de implementação TypeScript. | Refatoração pendente, fora desta modificação; quando iniciada, receberá demanda esclarecida e emitirá somente compromisso semântico. |
| `ARCHITECTURE.md` | Ativa | Documento humano, sem IDs, níveis ou critérios mecânicos de aplicabilidade. | Será projetado a partir de uma política estruturada e versionada. |
| `.harness/active_contract_ir.json` | Ativa quando há produto governado | A validação atual assegura targets e vínculos com provas, mas não valida pré/pós-condições nem invariantes. | Migrará gradualmente de `v1` para o schema semântico `v2`. |
| `.harness/proof_registry.json` | Ativa quando há produto governado | Já valida identidade, risco, autoridade, custo, cadência, target e comando. | Permanece a autoridade da execução de provas; será ligado a invariantes do contrato `v2`. |
| `.git/aegis/precommit_receipt.json` | Ativa na autorização | Liga índice, manifesto, contrato, registro, artefato de validação e perfil. | Continuará sendo o recibo; passará a referenciar os digests de demanda esclarecida e política arquitetural. |

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

Nesta etapa, nenhum gate escolhe automaticamente os novos schemas. A ativação
ocorrerá depois de o normalizador, o preflight e a migração de Contract IR
estarem implementados e testados.

## Critério de encerramento desta fase

- todos os artefatos futuros possuem schema versionado;
- cada artefato declara se é transitório ou durável;
- não há mudança silenciosa no comportamento de `./aegis`;
- os schemas e esta auditoria são validados no conjunto de testes do harness.
