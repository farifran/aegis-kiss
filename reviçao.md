# Revisão Arquitetural, Bússola e Dossiê Consolidado do Aegis (`reviçao.md`)

> [!IMPORTANT]
> **INTEGRAÇÃO DE DOCUMENTOS CONCLUÍDA:**  
> Este documento foi integralmente integrado e unificado com o [`resolver.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md) no **Dossiê Arquitetural & Adversarial Integrado do Aegis**.  
> Todas as seções (Bússola Fundamental, Leis Anti-Regressão, Mapa de Componentes Ativos, Dossiê de Descoberta, O Teste Askesis, O Acordo Mecânico-Semântico, o Parecer Crítico do Advogado do Diabo e a Matriz de Benchmarks D1 a D11) agora residem centralizadas na fonte canônica:
> 
> 👉 **[Acessar o Dossiê Canônico Completo: resolver.md](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md)**

---

## 1. Síntese Executiva do Parecer do Advogado do Diabo

Confrontando o estado atual da arte no Aegis contra os princípios inegociáveis de [`AGENTS.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md):

1. **A Desmistificação da "Solução Mágica":**
   * Afirmar que o abismo semântico estava "resolvido por JSDoc" era um autoengano perigoso. Comentários narrativos falham em bases de código sem docstrings e funcionam como cavalos de Troia de falsos positivos em monorepos reais (comprovado no teste com o Askesis de 204 arquivos).
   * O abismo semântico é uma tensão ontológica permanente entre linguagem natural e código formal. No Aegis, o status foi reclassificado de `RESOLVIDO` para **`MITIGADO EM 3 CAMADAS (DESAFIO ABERTO)`**.

2. **O Triângulo Inquebrável de Blindagem Atual:**
   * **Camada 1 (AST Mecânica, 0 ms, $0.00):** Símbolos públicos, subtokens de identificadores e caminhos com regra anti-sequestro de comentários.
   * **Camada 2 (Léxico Declarativo, 0 ms, $0.00):** Mapeamento canônico determinístico sob soberania humana em [`.harness/domain-lexicon.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/.harness/domain-lexicon.json).
   * **Camada 3 (Scout Adaptativo Fail-Closed):** Consulta atômica sobre mapa topográfico (< 4 KB), com filtro físico contra alucinações e cristalização imediata no Auto-Lexicon para retorno ao fast-path determinístico.

3. **A Nova Fronteira: O Consenso Semântico-Mecânico Local:**
   * O avanço dos LLMs locais quantizados e gratuitos (\$0.00 via Ollama, llama.cpp, vLLM) viabiliza inferência semântica com total privacidade e baixa latência.
   * O desafio real agora é o **Protocolo de Acordo Mecânico-Semântico**: como a mecânica física e a semântica da IA convergem em rodada única ($O(1)$) sem sobre-engenharia (rejeitando bancos de vetores pesados, enxames multi-agentes e knowledge graphs em runtime), convocando o árbitro humano via Wizard TTY exclusivamente diante de ambiguidades materiais reais ([`CONST-DECISIONS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L15)).

---

## 2. Mapa de Navegação no Dossiê Canônico (`resolver.md`)

Para consultar o conteúdo completo, acesse diretamente os links abaixo:

* [**1. Bússola Fundamental e Arquitetura Operacional do Aegis**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L9): Missão, Visão, As 3 Leis Anti-Regressão e Fluxo em 3 Passos.
* [**2. Mapa do Sistema Atual (Componentes Ativos)**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L35): Inventário completo e atualizado de CLI, Core Mecânico/Semântico (com AST Skeleton e Scout) e Governança.
* [**3. O Problema Fundamental da Descoberta de Código (`src/` $\to$ IA)**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L91): O dilema central da entrega de contexto.
* [**4. Inventário dos 8 Problemas Estruturais de Terreno**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L106): Do Abismo Semântico (P1) à Ancoragem Humana (P8).
* [**5. Matriz de Requisitos Inegociáveis e Julgamento Adversarial**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L148): Critérios de aceitação e reprovação de alternativas teóricas.
* [**6. Resoluções Implementadas no Core do Aegis**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L170): Defesa em 3 Camadas, Ancoragem por Diretório Irmão e Esqueleto AST tipado.
* [**7. Matriz Consolidada de Fechamento dos 8 Problemas**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L198): Tabela com status falsificáveis e testes associados.
* [**8. O Teste de Estresse Extremo em Monorepo Real (Askesis)**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L213): Diagnóstico de contaminação, blindagens, corte residual, Scout e expurgo do BM25.
* [**9. A Fronteira Arquitetural: O Desafio do Acordo Mecânico-Semântico**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L260): O choque dialético, as armadilhas rejeitadas, os 4 princípios KISS e o parecer do Advogado do Diabo.
* [**10. Validação Empírica: Benchmark das Demandas Multidimensionais (D1 a D11)**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L318): Matriz consolidada de demandas e verificação de reprodutibilidade bit-a-bit (D6 Run 5 vs Run 6).
* [**11. Análise Forense: Histórico de Melhorias do Core e Backlog Ativo**](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/resolver.md#L354): As 10 melhorias blindadas e as 2 oportunidades ativas de simplificação.
