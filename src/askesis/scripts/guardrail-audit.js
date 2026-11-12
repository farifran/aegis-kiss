#!/usr/bin/env node
/**
 * @file scripts/guardrail-audit.js
 * @description Guardrail: auditoria de vulnerabilidades npm.
 *
 * Política de atualização de dependências:
 *  - HIGH / CRITICAL: bloqueia CI imediatamente; corrigir com npm update ou patch manual.
 *  - MODERATE: corrigir na próxima sprint de manutenção (janela máx. 30 dias).
 *  - LOW / INFO: registrar no backlog; corrigir oportunisticamente em upgrades maiores.
 *
 * Dependências de produção (@google/genai, @upstash/redis) têm janela zero para HIGH+.
 * DevDependencies nunca chegam ao bundle de produção; auditadas com nível moderate.
 *
 * Uso: node scripts/guardrail-audit.js
 */

'use strict';

const { execSync, spawnSync } = require('child_process');

const PROD_LEVEL = 'high';
const DEV_LEVEL = 'moderate';

function run(args) {
    const result = spawnSync('npm', ['audit', '--json', ...args], { encoding: 'utf8' });
    let data;
    try {
        data = JSON.parse(result.stdout || '{}');
    } catch {
        data = {};
    }
    return { exitCode: result.status ?? 0, data };
}

function countBySeverity(vulnerabilities) {
    const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
    for (const v of Object.values(vulnerabilities || {})) {
        const sev = v.severity?.toLowerCase();
        if (sev in counts) counts[sev]++;
    }
    return counts;
}

// --- Produção (--omit=dev) ---
// Nota: prod.data.vulnerabilities contém TODOS os pacotes vulneráveis no JSON,
// incluindo dev-transitivos. A contagem autoritativa para o escopo --omit=dev
// está em metadata.vulnerabilities, que npm preenche corretamente.
const prod = run(['--omit=dev', '--audit-level=' + PROD_LEVEL]);
const prodMeta = prod.data.metadata?.vulnerabilities ?? {};
const prodTotal = prodMeta.total ?? 0;

console.log('[guardrail-audit] Dependências de produção:');
if (prodTotal === 0) {
    console.log('  ✓ Nenhuma vulnerabilidade encontrada.');
} else {
    const { critical = 0, high = 0, moderate = 0, low = 0, info = 0 } = prodMeta;
    if (critical) console.log(`  CRITICAL: ${critical}`);
    if (high)     console.log(`  HIGH:     ${high}`);
    if (moderate) console.log(`  moderate: ${moderate}`);
    if (low)      console.log(`  low:      ${low}`);
    if (info)     console.log(`  info:     ${info}`);
}

// --- Dev (inclui tudo, nível moderate) ---
const dev = run(['--include=dev', '--audit-level=' + DEV_LEVEL]);
const devMeta = dev.data.metadata?.vulnerabilities ?? {};
const devTotal = devMeta.total ?? 0;

console.log('[guardrail-audit] DevDependencies (informativo):');
if (devTotal === 0) {
    console.log('  ✓ Nenhuma vulnerabilidade encontrada.');
} else {
    const { critical = 0, high = 0, moderate = 0, low = 0, info = 0 } = devMeta;
    if (critical) console.log(`  CRITICAL: ${critical}`);
    if (high)     console.log(`  HIGH:     ${high}`);
    if (moderate) console.log(`  moderate: ${moderate}`);
    if (low)      console.log(`  low:      ${low}`);
    if (info)     console.log(`  info:     ${info}`);
}

// --- Falha CI apenas se prod tiver high/critical ---
const prodFail = ((prodMeta.critical ?? 0) + (prodMeta.high ?? 0)) > 0;

if (prodFail) {
    console.error(
        '[guardrail-audit] FALHOU: vulnerabilidades HIGH/CRITICAL nas dependências de produção.',
        '\nExecute "npm audit --omit=dev" para detalhes e corrija antes de fazer merge.'
    );
    process.exitCode = 1;
} else {
    console.log('[guardrail-audit] OK: nenhuma vulnerabilidade crítica/alta em produção.');
}
