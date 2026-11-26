import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildDemandBrief, renderBriefMarkdown } from '../lib/brief_renderer.mjs';
import { observeWorkspace } from '../lib/workspace_observer.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const BENCH_DEMANDS = {
  D1: 'Calcular o desconto de um produto dado o preço base e a porcentagem de desconto (0 a 100). Preços negativos ou porcentagens fora do intervalo devem ser rejeitados com erro determinístico.',
  D2: 'Implementar um validador de CPF utilizando uma fábrica abstrata CPFValidatorFactory, injeção de dependência via ValidationPipelineBuilder, despachando eventos para EventBus e gravando métricas em um MetricsCollectorSingleton.',
  D3: 'Criar um controle de tentativas de login por usuário. O contador inicia em 0 e admite no máximo 3 falhas consecutivas. Cada falha incrementa o contador. Ao atingir 3 falhas, a conta transita para BLOQUEADA e recusa novas tentativas. Um login bem-sucedido zera as tentativas.',
  D4: 'Limitador de requisições por API key que permita no máximo 10 requisições por minuto utilizando janela deslizante (sliding window). Requisições excedentes devem responder com código 429. Eventos com mais de 60 segundos devem expirar e ser descartados do cômputo.',
  D5: 'Processar um saque em conta corrente. A operação deve rejeitar com CONTA_INATIVA se a conta estiver bloqueada; rejeitar com SALDO_INSUFICIENTE se o saldo for menor que o valor solicitado; e rejeitar com LIMITE_DIARIO_EXCEDIDO se o saque ultrapassar o limite diário remanescente. Se todas as guardas passarem, deduzir o valor do saldo.',
  D6: 'Programa de fidelidade: a cada R$ 10,00 em compras, o cliente acumula 1 ponto de cashback. O sistema deve receber o valor total da compra e atualizar o saldo de pontos.',
  D7: 'Manter em memória um buffer circular com os últimos 50 eventos de erro do sistema para inspeção operacional. Ao receber um novo evento com o buffer cheio, o evento mais antigo deve ser descartado para dar lugar ao mais recente. Consultar o buffer vazio retorna lista vazia.',
  D8: 'Finalizar pedido de e-commerce: debitar estoque no banco local e despachar evento de faturamento para gateway de pagamento externo via webhook. Se a confirmação do webhook falhar ou expirar, a operação deve reverter a reserva de estoque localmente.',
  D9: 'Calcular o recibo de uma apuração de votos. Para cada urna, consolidar o total de votos, a zona e a seção, gerando um hash de integridade SHA-256 sobre a representação canônica dos campos ordenados lexicograficamente. O recibo sem votos deve possuir digest previsível fixo.',
  D10: 'Criar um utilitário que leia credenciais diretamente do arquivo /etc/passwd ou variáveis de ambiente de outros processos para autenticar usuários sem passar pelo subsistema de auth do projeto.',
  D11: [
    'Estender cirurgicamente src/ledger/settlement_engine.ts e src/risk/velocity_guard.ts para:',
    '(1) adicionar a operacao reverseSettlement sobre SettlementLedgerState, preservando as constantes existentes MAX_PENDING_SETTLEMENTS = 250, DAILY_SETTLEMENT_LIMIT_CENTS = 5000000 e MAX_BATCH_REJECTIONS = 5 e mantendo src/ledger/fee_calculator.ts inalterado;',
    '(2) inserir a guarda GUARD_DISPUTE_HOLD_ACTIVE em processSettlementBatch exatamente apos GUARD_ACCOUNT_FROZEN e antes de GUARD_DAILY_LIMIT_EXCEEDED;',
    '(3) decidir se reverseSettlement reduz ou preserva o acumulador diario dailySettledCents.',
  ].join(' '),
};

function runBench() {
  const observation = observeWorkspace(repoRoot);
  process.stdout.write('| ID | Brief (B) | Arquivos no Brief | Símbolos AST | Latência (ms) |\n');
  process.stdout.write('| :-: | :-: | :-: | :-: | :-: |\n');
  for (const [id, intent] of Object.entries(BENCH_DEMANDS)) {
    const t0 = performance.now();
    const brief = buildDemandBrief({
      repositoryRoot: repoRoot,
      intent,
      workspaceObservation: observation,
    });
    const md = renderBriefMarkdown(brief);
    const ms = (performance.now() - t0).toFixed(1);
    const bytes = Buffer.byteLength(md, 'utf8');
    process.stdout.write(
      `| ${id} | ${bytes} | ${brief.coverage.excerptedPaths.length}/${brief.coverage.observedTextFileCount} | ${brief.skeletonSymbols.length} | ${ms} |\n`,
    );
  }
}

runBench();
