#!/usr/bin/env node

/**
 * Benchmark Adversarial Nível 5 (L5 Enterprise Stress Test)
 * 
 * Submete o Aegis ao teste de fogo em um ambiente corporativo com ~60 arquivos,
 * múltiplos domínios e uma demanda em linguagem natural pura (zero identificadores técnicos).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { generateL5Workspace } from './generate_l5_workspace.mjs';
import { observeWorkspace, buildPreflightHandoff, loadArchitecturePolicy } from '../scripts/lib/issue_contract_core.mjs';
import { loadSemanticConstitution, buildSemanticRequest } from '../scripts/lib/semantic_request.mjs';

const rootDir = process.cwd();
const tempWorkDir = mkdtempSync(resolve(tmpdir(), 'aegis-l5-stress-'));

console.log('='.repeat(80));
console.log('AEGIS L5 ENTERPRISE STRESS TEST: O BATISMO DE FOGO');
console.log('='.repeat(80));

try {
  // 1. GERAÇÃO DO MONOREPO L5
  console.log('\n[1. GERANDO MONOREPO CORPORATIVO REALISTA]');
  const { srcDir } = generateL5Workspace(tempWorkDir, rootDir);
  console.log(`• Workspace gerado em: ${tempWorkDir}`);

  // 2. DEMANDA HUMANA DE PRODUTO (ZERO IDENTIFICADORES TÉCNICOS)
  const humanDemand = 'Permitir que a equipe de suporte desfaça liquidações financeiras de clientes que tenham aberto uma contestação no mesmo dia. Se o cliente for da categoria Ouro, a taxa padrão de estorno deve ser cortada pela metade. O valor estornado não pode reabrir o limite diário caso a conta esteja sob suspeita de fraude, e toda a operação deve registrar um evento auditável no barramento antes de liberar o saldo.';
  
  console.log('\n[2. DEMANDA PURA DE NEGÓCIO (ZERO COLA)]');
  console.log(`"${humanDemand}"`);

  // 3. EXECUÇÃO DO DISCOVERY & PREFLIGHT
  console.log('\n[3. EXECUTANDO DISCOVERY E AST EXTRACTION]');
  const t0 = performance.now();
  const obs = observeWorkspace(tempWorkDir, humanDemand);
  const preflight = buildPreflightHandoff({ demand: humanDemand, discovery: obs.discovery, version: 'v3' });
  const tDiscovery = performance.now() - t0;

  console.log(`• Arquivos escaneados em src/:          ${obs.discovery.files.length}`);
  console.log(`• Volume total lido em bytes:          ${obs.discovery.scannedBytes.toLocaleString()} bytes (~${(obs.discovery.scannedBytes / 1024).toFixed(1)} KB)`);
  console.log(`• Símbolos extraídos na AST:           ${obs.discovery.workspaceSkeleton.symbolCount}`);
  console.log(`• Tempo de processamento Discovery:    ${tDiscovery.toFixed(2)} ms`);

  // 4. EXECUÇÃO DO SEMANTIC REQUEST (SELEÇÃO DE EVIDÊNCIA & PRIORIZAÇÃO)
  console.log('\n[4. EXECUTANDO SELEÇÃO DE EVIDÊNCIA E PRIORIZAÇÃO DE SÍMBOLOS]');
  const { policy } = loadArchitecturePolicy(tempWorkDir);
  const constitution = loadSemanticConstitution(tempWorkDir);

  const t1 = performance.now();
  const semanticRequest = buildSemanticRequest({
    repositoryRoot: tempWorkDir,
    preflight,
    policy,
    constitution,
    workspaceObservation: obs,
  });
  const tRequest = performance.now() - t1;
  console.log(`• Tempo de montagem SemanticRequest:   ${tRequest.toFixed(2)} ms`);

  // 5. AUDITORIA FORENSE DOS ARQUIVOS SELECIONADOS
  console.log('\n[5. AUDITORIA FORENSE DA VERDADE DE TERRENO ENTREGUE]');
  const evidence = semanticRequest.workspace.sourceEvidence || [];
  const selectedPaths = evidence.map((e) => e.path);
  const totalEvidenceBytes = evidence.reduce((acc, e) => acc + Buffer.byteLength(e.content, 'utf8'), 0);

  console.log(`• Arquivos selecionados no corte final: ${evidence.length}`);
  console.log(`• Orçamento de bytes consumido:         ${totalEvidenceBytes.toLocaleString()} / 32,768 bytes (${((totalEvidenceBytes / 32768) * 100).toFixed(1)}%)`);
  
  console.log('\nArquivos entregues para a IA:');
  evidence.forEach((e, idx) => {
    const bytes = Buffer.byteLength(e.content, 'utf8');
    console.log(`  [${idx + 1}] ${e.path.padEnd(50)} (${bytes} bytes, linhas ${e.startLine}-${e.endLine}, selection: ${e.selection})`);
  });

  // 6. MATRIZ DE AVALIAÇÃO DE GROUND TRUTH
  console.log('\n[6. MATRIZ DE VERIFICAÇÃO DAS 5 PROPRIEDADES CRÍTICAS]');
  const checks = [
    {
      prop: 'Domínio Settlement (Motor e Reversão)',
      expectedPath: 'src/domain/settlement/reversal_service.ts',
      found: selectedPaths.some(p => p.includes('settlement/reversal_service.ts') || p.includes('settlement/settlement_engine.ts')),
      detail: 'Necessário para estornar saldo e dailySettledCents',
    },
    {
      prop: 'Domínio Billing / Taxas (Desconto Categoria Ouro)',
      expectedPath: 'src/domain/billing/fee_calculator.ts',
      found: selectedPaths.some(p => p.includes('billing/fee_calculator.ts')),
      detail: 'Necessário para a regra de corte de taxa de 50% para Ouro',
    },
    {
      prop: 'Domínio Disputes (Contestação no mesmo dia)',
      expectedPath: 'src/domain/disputes/dispute_manager.ts',
      found: selectedPaths.some(p => p.includes('disputes/dispute_manager.ts')),
      detail: 'Necessário para hasSameDayDispute',
    },
    {
      prop: 'Domínio Risk (Suspeita de Fraude e Limites)',
      expectedPath: 'src/domain/risk/fraud_detector.ts',
      found: selectedPaths.some(p => p.includes('risk/fraud_detector.ts') || p.includes('risk/velocity_guard.ts')),
      detail: 'Necessário para checar suspeita ativa de fraude',
    },
    {
      prop: 'Infra Events (Barramento de Auditoria)',
      expectedPath: 'src/infra/events/event_bus.ts',
      found: selectedPaths.some(p => p.includes('infra/events/event_bus.ts')),
      detail: 'Necessário para publicar evento auditável antes da liberação',
    },
    {
      prop: 'Rejeição de Código Legado / @deprecated',
      expectedPath: 'Nenhum de src/legacy/',
      found: !selectedPaths.some(p => p.includes('src/legacy/')),
      detail: 'Nenhum dos 20 arquivos obsoletos pode poluir a evidência',
    },
    {
      prop: 'Rejeição de Homônimo Enganoso',
      expectedPath: 'Não selecionar reverse_transaction.ts (POS de cartão)',
      found: !selectedPaths.some(p => p.includes('billing/reverse_transaction.ts')),
      detail: 'reverse_transaction.ts de maquininha de cartão não pode enganar a IA',
    },
  ];

  let passedChecks = 0;
  for (const c of checks) {
    const status = c.found ? '✓ PASSOU' : '✗ FALHOU';
    if (c.found) passedChecks++;
    console.log(`• ${status} - ${c.prop}`);
    console.log(`    Objetivo: ${c.expectedPath}`);
    console.log(`    Razão:    ${c.detail}`);
  }

  // 7. AUDITORIA DOS SÍMBOLOS PRIORIZADOS NO SKELETON
  console.log('\n[7. TOP 10 SÍMBOLOS PRIORIZADOS NO WORKSPACE SKELETON]');
  const skeletonSymbols = semanticRequest.workspace.workspaceSkeleton?.symbols || [];
  skeletonSymbols.slice(0, 10).forEach((s, idx) => {
    console.log(`  #${idx + 1}: [${s.kind}] ${s.name} (${s.path})`);
  });

  console.log('\n' + '='.repeat(80));
  console.log(`RESULTADO DO BATISMO DE FOGO: ${passedChecks}/${checks.length} PROPRIEDADES ATENDIDAS`);
  console.log('='.repeat(80));

} finally {
  rmSync(tempWorkDir, { recursive: true, force: true });
}

