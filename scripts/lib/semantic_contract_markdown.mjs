export function renderSemanticContractMarkdown(contract, {
  contractDigest = '',
  policyRules = [],
} = {}) {
  const specification = contract.specification;
  const governed = contract.approval !== null;
  const rules = new Map(policyRules.map((rule) => [rule.id, rule]));
  const selections = new Map(contract.humanResolutions
    .filter(({ kind }) => kind === 'ANSWER')
    .map(({ questionId, answerId }) => [questionId, answerId]));
  const renderBasis = (basis) => basis
    .map(({ source, reference }) => `${source}:${reference}`)
    .join(', ');
  const lines = [
    `# Issue / Contrato: ${specification.title}`,
    '',
    `> **Status:** ${governed ? 'Selado & Governado' : 'Rascunho aguardando confirmação'}`,
    `> **Modo:** ${specification.changeKind}`,
    `> **Determinismo efetivo:** ${contract.effectiveDeterminismStatus}`,
    '> **IMPLEMENTATION_AUTHORIZED:** `false`',
    ...(governed ? [`> **Digest do Contrato:** \`${contractDigest}\``] : []),
    ...(governed ? [
      `> **Rascunho aprovado:** \`${contract.approval.contractDraftDigest}\``,
      `> **Confirmação humana:** ${contract.approval.attestation} via ${contract.approval.method}`,
    ] : []),
    `> **Preflight:** \`${contract.sourcePreflightDigest}\``,
    `> **Requisição semântica:** \`${contract.sourceSemanticRequestDigest}\``,
    `> **Snapshot de src/:** \`${contract.sourceSnapshotDigest}\``,
    '',
    '## 1. Demanda interpretada',
    specification.interpretation,
    '',
    '> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.',
    '',
    '## 2. Escopo',
    '**Incluído:**',
    ...specification.scope.inScope.map((item) => `- ${item}`),
    '',
    '**Fora do escopo:**',
    ...(specification.scope.outOfScope.length > 0
      ? specification.scope.outOfScope.map((item) => `- ${item}`)
      : ['- Nada adicional declarado.']),
    '',
    '**Caminhos observados — não autorizam implementação:**',
    ...(contract.observedPaths.length > 0
      ? contract.observedPaths.map((path) => `- \`${path}\``)
      : ['- Nenhum caminho observado.']),
    '',
    '**Referências de caminho classificadas:**',
    ...(specification.pathReferences.length > 0
      ? specification.pathReferences.map(({ id, path, role, rationale }) => `- **${id}** — \`${path}\` — **${role}:** ${rationale}`)
      : ['- Nenhuma referência de caminho normativa ou sugerida.']),
    '',
    '> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.',
    '',
    '## 3. Governança e correções antecipadas',
  ];

  const compliantAssessments = specification.policyAssessments
    .filter(({ demandStatus }) => demandStatus === 'COMPLIANT');
  const conflictAssessments = specification.policyAssessments
    .filter(({ demandStatus }) => demandStatus === 'CONFLICT');
  lines.push(`- **Contextos detectados:** ${specification.architectureContexts.map(({ tag }) => tag).join(', ')}`);
  if (contract.policySignals.length > 0) {
    lines.push(`- **Sinais mecânicos:** ${contract.policySignals
      .map(({ ruleId, kind, reference }) => `${ruleId}/${kind}: ${reference}`)
      .join('; ')}.`);
  }
  if (contract.intentSignals.length > 0) {
    lines.push(`- **Sinais da intenção:** ${contract.intentSignals
      .map(({ id, kind, reference }) => `${id}/${kind}: ${reference}`)
      .join('; ')}.`);
  }
  if (compliantAssessments.length > 0) {
    lines.push(`- **Regras aplicáveis já conformes:** ${compliantAssessments.map(({ ruleId }) => ruleId).join(', ')}.`);
  }
  if (conflictAssessments.length === 0) lines.push('- Nenhuma correção constitucional necessária.');
  for (const assessment of conflictAssessments) {
    const rule = rules.get(assessment.ruleId);
    const disposition = assessment.decisionId
      ? 'DECISÃO MATERIAL PENDENTE'
      : rule?.level === 'hard' ? 'CORREÇÃO OBRIGATÓRIA' : 'CORREÇÃO KISS';
    lines.push(`- **${assessment.ruleId} — ${disposition}:** ${assessment.rationale}`);
    if (rule?.statement) lines.push(`  - Regra: ${rule.statement}`);
    if (assessment.decisionId) lines.push(`  - Decisão: \`${assessment.decisionId}\``);
    if (assessment.amendmentId) lines.push(`  - Emenda: \`${assessment.amendmentId}\``);
  }

  lines.push('', '## 4. Revisão de complexidade');
  lines.push(`- **${specification.complexityReview.status}:** ${specification.complexityReview.rationale}`);
  for (const alternative of specification.complexityReview.alternatives) {
    lines.push(`- **${alternative.requested} → ${alternative.simpler}:** ${alternative.rationale}`);
  }

  lines.push('', '### Rastreabilidade da intenção');
  for (const claim of specification.intentClaims) {
    lines.push(`- **${claim.id} — ${claim.kind}/${claim.disposition}:** “${claim.quote}” → ${claim.targetIds.join(', ')}.`);
  }
  if (specification.nonNormativeItems.length > 0) {
    lines.push('', '### Itens não normativos');
    for (const item of specification.nonNormativeItems) {
      lines.push(`- **${item.id} — ${item.kind}:** ${item.statement}`);
    }
  }

  lines.push('', '## 5. Requisitos e casos falsificáveis');
  for (const requirement of specification.requirements) {
    lines.push('', `### ${requirement.id}`, requirement.statement, `*Base: ${renderBasis(requirement.basis)}*`, '');
    if (requirement.measurement !== null) {
      lines.push(
        `- **Medição:** ${requirement.measurement.metric}`,
        `  - Método: ${requirement.measurement.method}`,
        `  - Alvo: ${requirement.measurement.target.value}`,
        `  - Procedência: ${requirement.measurement.target.source}:${requirement.measurement.target.reference}`,
        `  - Evidência de viabilidade: ${requirement.measurement.target.evidenceStatus}`,
        `  - Condições: ${requirement.measurement.conditions}`,
      );
    }
    for (const acceptanceCase of requirement.acceptanceCases) {
      lines.push(
        `- **${acceptanceCase.id} — ${acceptanceCase.kind}**`,
        `  - Dado: ${acceptanceCase.given}`,
        `  - Quando: ${acceptanceCase.when}`,
        `  - Então: ${acceptanceCase.then}`,
        `  - Resultado observável: ${acceptanceCase.outcomeKind}`,
      );
      if (acceptanceCase.boundaryBinding !== null) {
        lines.push(`  - Limite: ${acceptanceCase.boundaryBinding.ruleId}/${acceptanceCase.boundaryBinding.side} → ${acceptanceCase.boundaryBinding.expectedBehavior}${acceptanceCase.boundaryBinding.expectedValue === null ? '' : ` (${acceptanceCase.boundaryBinding.expectedValue})`}`);
      }
      if (acceptanceCase.decisionBinding !== null) {
        const selected = selections.get(acceptanceCase.decisionBinding.questionId)
          === acceptanceCase.decisionBinding.answerId;
        lines.push(selected
          ? `  - Autoridade: **ESCOLHA HUMANA SELADA — ${acceptanceCase.decisionBinding.questionId}/${acceptanceCase.decisionBinding.answerId}.**`
          : `  - Autoridade: **PROVISÓRIO — depende de ${acceptanceCase.decisionBinding.questionId}/${acceptanceCase.decisionBinding.answerId}; recomendação não é consentimento humano.**`);
      }
    }
  }

  lines.push('', '### Regras de limite e extrapolação');
  if (specification.boundaryRules.length === 0) {
    lines.push('- Nenhum valor público de representação finita identificado.');
  }
  for (const boundaryRule of specification.boundaryRules) {
    lines.push(`- **${boundaryRule.id}: ${boundaryRule.subject}**`);
    if (boundaryRule.representationKind !== undefined) {
      lines.push(`  - Natureza: ${boundaryRule.representationKind}.`);
    }
    lines.push(`  - Intervalo: ${boundaryRule.lowerBound} até ${boundaryRule.upperBound}.`);
    lines.push(`  - Abaixo: ${boundaryRule.underflowBehavior}; acima: ${boundaryRule.overflowBehavior}.`);
    if (boundaryRule.decisionId !== null) lines.push(`  - Decisão necessária: ${boundaryRule.decisionId}.`);
    lines.push(`  - Provas: ${boundaryRule.acceptanceCaseIds.join(', ')}.`);
  }

  lines.push('', '### Revisão de determinismo');
  lines.push(`- **${specification.determinismReview.status}:** ${specification.determinismReview.rationale}`);
  for (const dimension of specification.determinismReview.dimensions) {
    lines.push(`- **${dimension.kind}/${dimension.subjectId}/${dimension.status}:** ${dimension.rationale}${dimension.targetIds.length === 0 ? '' : ` → ${dimension.targetIds.join(', ')}`}`);
    lines.push(`  - Base: ${renderBasis(dimension.basis)}.`);
    lines.push(`  - Autoridade de fechamento: ${dimension.closureAuthority}.`);
    lines.push(`  - Contraexemplo obrigatório: ${dimension.counterexampleWitness.id}/${dimension.counterexampleWitness.inputClass}.`);
    lines.push(`    - Base mecânica: ${dimension.counterexampleWitness.baseline}`);
    lines.push(`    - Variação mecânica: ${dimension.counterexampleWitness.variation}`);
    if (dimension.acceptanceCaseId !== null) lines.push(`  - Prova única: ${dimension.acceptanceCaseId}.`);
    if (dimension.proofObligation !== null) {
      lines.push(`  - Obrigação de prova: ${dimension.proofObligation.relation} sobre ${dimension.proofObligation.observables.join(', ')}.`);
    }
    if (dimension.inapplicabilityProof !== undefined
      && dimension.inapplicabilityProof !== null) {
      const proof = dimension.inapplicabilityProof;
      lines.push(`  - Ausência estrutural: ${proof.absentStructure} — ${proof.evidence}`);
    }
  }

  lines.push('', '## 6. Invariantes');
  for (const invariant of specification.invariants) {
    lines.push(`- **${invariant.id}:** ${invariant.statement}`);
    lines.push(`  - Falsificado se: ${invariant.falsification}`);
  }

  lines.push('', '## 7. Riscos e vulnerabilidades');
  lines.push(`- **Revisão ${specification.riskReview.status}:** ${specification.riskReview.rationale}`);
  if (specification.risks.length === 0) lines.push('- Nenhum risco material identificado.');
  for (const risk of specification.risks) {
    lines.push(`- **${risk.id} — ${risk.kind}/${risk.level}:** ${risk.statement}`);
    lines.push(`  - Mitigação: ${risk.mitigation}`);
    lines.push(`  - Base: ${renderBasis(risk.basis)}`);
  }

  lines.push('', '## 8. Parecer adversarial');
  lines.push(`- **${specification.adversarialReview.status}:** ${specification.adversarialReview.rationale}`);
  for (const finding of specification.adversarialReview.findings) {
    lines.push(`- **${finding.id} — ${finding.kind}/${finding.disposition}:** ${finding.challenge}`);
    lines.push(`  - Resposta incorporada: ${finding.response}`);
    lines.push(`  - Afeta: ${finding.targetIds.join(', ')}.`);
    lines.push(`  - Base: ${renderBasis(finding.basis)}`);
  }

  const unknownsByDecision = new Map();
  for (const unknown of specification.unknowns.filter(({ decisionId }) => decisionId !== null)) {
    const related = unknownsByDecision.get(unknown.decisionId) ?? [];
    related.push(unknown);
    unknownsByDecision.set(unknown.decisionId, related);
  }
  const blockingUnknowns = specification.unknowns.filter(({ material, decisionId }) => (
    material && decisionId === null
  ));
  const informationalUnknowns = specification.unknowns.filter(({ material, decisionId }) => (
    !material && decisionId === null
  ));

  lines.push('', governed ? '## 9. Decisões humanas seladas' : '## 9. Decisões aguardando escolha humana');
  if (specification.decisions.length === 0) {
    lines.push(blockingUnknowns.length === 0
      ? 'Nenhuma ambiguidade material detectada.'
      : 'Nenhuma decisão madura está disponível enquanto existirem lacunas bloqueantes.');
  } else {
    for (const decision of specification.decisions) {
      lines.push('', `### ${decision.questionId}: ${decision.question}`);
      for (const unknown of unknownsByDecision.get(decision.questionId) ?? []) {
        lines.push(`**${governed ? 'Lacuna resolvida' : 'Lacuna'}:** ${unknown.statement}`);
      }
      for (const answer of decision.answers) {
        const selected = selections.get(decision.questionId) === answer.id;
        const mark = selected ? '(*)' : '( )';
        const evidence = selected
          ? ' **[ESCOLHA HUMANA]**'
          : answer.recommended ? ' **[RECOMENDADO — NÃO É CONSENTIMENTO]**' : '';
        lines.push(`${mark} **${answer.label}**${evidence}: ${answer.rationale}`);
        lines.push(`  - Efeito no contrato: ${answer.contractEffect}`);
      }
      const decisionCases = specification.requirements
        .flatMap(({ acceptanceCases }) => acceptanceCases)
        .filter(({ decisionBinding }) => decisionBinding?.questionId === decision.questionId)
        .map(({ id }) => id);
      lines.push(`Impacta requisitos: ${decision.requirementIds.join(', ') || 'nenhum'}; provas: ${decisionCases.join(', ') || 'nenhuma'}; invariantes: ${decision.invariantIds.join(', ') || 'nenhum'}; riscos: ${decision.riskIds.join(', ') || 'nenhum'}.`);
      if (decision.distinguishingCase !== undefined) {
        lines.push(`Caso que diferencia as opções — Dado: ${decision.distinguishingCase.given}; Quando: ${decision.distinguishingCase.when}.`);
        for (const outcome of decision.distinguishingCase.outcomes) {
          lines.push(`- ${outcome.answerId} → ${outcome.then}`);
        }
      }
    }
  }
  if (blockingUnknowns.length > 0) {
    lines.push('', '### Lacunas bloqueantes — não chegam ao Wizard');
    for (const unknown of blockingUnknowns) lines.push(`- **${unknown.id}:** ${unknown.statement}`);
  }
  if (informationalUnknowns.length > 0) {
    lines.push('', '### Lacunas informativas — não exigem decisão');
    for (const unknown of informationalUnknowns) lines.push(`- **${unknown.id}:** ${unknown.statement}`);
  }
  const currentDecisionIds = new Set(specification.decisions
    .map(({ questionId }) => questionId));
  const incorporatedResolutions = contract.humanResolutions
    .filter(({ questionId }) => !currentDecisionIds.has(questionId));
  if (incorporatedResolutions.length > 0) {
    lines.push('', '### Decisões humanas incorporadas por recompilação');
    for (const resolution of incorporatedResolutions) {
      if (resolution.kind === 'ANSWER') {
        lines.push(`- **${resolution.questionId}: ${resolution.question}** → ${resolution.label}. ${resolution.rationale}`);
        lines.push(`  - Efeito incorporado: ${resolution.contractEffect}`);
      } else {
        lines.push(`- **${resolution.questionId}: ${resolution.question}** → interpretação fornecida: ${resolution.correction}`);
      }
      lines.push(`  - Evidência: ${resolution.attestation} via ${resolution.method}; rascunho \`${resolution.sourceContractDigest}\`.`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
