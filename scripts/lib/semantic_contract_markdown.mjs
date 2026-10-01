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
    ...(specification.closureCertificate ? [
      `> **Certificado de Fechamento:** ${specification.closureCertificate.status} (inventário pendente: ${specification.closureCertificate.unresolvedInventorySlots ?? 0}, campos não resolvidos: ${specification.closureCertificate.unresolvedStateFields}, transições abertas: ${specification.closureCertificate.unresolvedTransitions}, lacunas ativas: ${specification.closureCertificate.gapLedger?.length ?? 0})`,
    ] : []),
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
      : ['- Nenhum caminho pré-existente observado no workspace (repositório greenfield).']),
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
  lines.push(`- **Evidência neutra:** ${contract.intentEvidence.fragments.length} fragmento(s), ${contract.intentEvidence.literalFacts.length} fato(s) literal(is).`);
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
  for (const coverage of specification.determinismReview.coverage) {
    const dimensions = coverage.dimensions.length === 0
      ? 'nenhuma dimensão aplicável'
      : coverage.dimensions.map(({ kind, subjectId }) => `${kind}/${subjectId}`).join(', ');
    lines.push(`- **Cobertura ${coverage.claimId}/${coverage.disposition}:** ${dimensions}. ${coverage.rationale}`);
  }
  for (const dimension of specification.determinismReview.dimensions) {
    lines.push(`- **${dimension.kind}/${dimension.subjectId}/${dimension.status}:** ${dimension.rationale}${dimension.targetIds.length === 0 ? '' : ` → ${dimension.targetIds.join(', ')}`}`);
    lines.push(`  - Base: ${renderBasis(dimension.basis)}.`);
    lines.push(`  - Autoridade de fechamento: ${dimension.closureAuthority}.`);
    lines.push(`  - Cenário de revisão semântica: ${dimension.counterexampleWitness.id}/${dimension.counterexampleWitness.inputClass}.`);
    lines.push(`    - Base proposta: ${dimension.counterexampleWitness.baseline}`);
    lines.push(`    - Variação proposta: ${dimension.counterexampleWitness.variation}`);
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

  const hasStateModel = Boolean(specification.stateModel);
  if (hasStateModel) {
    lines.push('', '## 6. Inventário Semântico Auditável (State Model & Totalidade de Transição)');

    if (specification.stateModel.entities?.length > 0) {
      lines.push('', '### 6.2 Entidades de Estado e Ciclo de Vida dos Campos');
      for (const entity of specification.stateModel.entities) {
        lines.push(
          '',
          `#### Entidade: \`${entity.name}\``,
          `- **Descrição:** ${entity.description ?? 'Sem descrição'}`,
          `- **Topologia:** ${entity.isCollection ? 'Coleção dinâmica (instâncias múltiplas)' : 'Instância estática única (Singleton)'}`,
          `- **Política de Admissão:** \`${entity.admissionPolicy ?? 'N/A'}\``,
          `- **Política de Capacidade:** ${entity.capacityPolicy ? `Máx ${entity.capacityPolicy.maxEntries} entradas (overflow: \`${entity.capacityPolicy.overflowPolicy}\`${entity.capacityPolicy.provenance ? ` [Base: ${renderBasis(entity.capacityPolicy.provenance)}]` : ''})` : 'N/A'}`,
          '',
          '| Campo | Tipo | Limites (Bounds) | Inicialização | Reset | Mutações | Leitores |',
          '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
        );
        for (const field of entity.fields) {
          const typeStr = field.isCounter ? `${field.type} (Contador)` : field.type;
          const boundsStr = field.bounds
            ? `[${field.bounds.lowerBound ?? '-∞'}, ${field.bounds.upperBound ?? '+∞'}] (${field.bounds.boundaryBehavior}${field.bounds.provenance ? `; ${renderBasis(field.bounds.provenance)}` : ''})`
            : 'N/A';
          const initStr = `${field.initialization.kind}: \`${field.initialization.value ?? 'null'}\`<br>*${field.initialization.rationale}*${field.derivation ? `<br>**Fórmula Total:** \`${field.derivation.formula}\`` : ''}`;
          const resetStr = field.reset.allowed
            ? `\`${field.reset.resetValue}\` (gatilho: \`${field.reset.trigger}\`)`
            : 'Proibido (preservado)';
          const mutsStr = field.mutations.length > 0
            ? field.mutations.map((m) => `\`${m.operation}\`: ${m.effect} \`${m.targetValue ?? ''}\` se \`${m.condition}\``).join('<br>')
            : 'Nenhuma (imutável pós-init)';
          const readersStr = field.readBy.length > 0
            ? field.readBy.map((r) => `\`${r}\``).join(', ')
            : 'Nenhum';
          lines.push(`| \`${field.name}\` | ${typeStr} | ${boundsStr} | ${initStr} | ${resetStr} | ${mutsStr} | ${readersStr} |`);
        }
      }
    }

    if (specification.stateModel.operations?.length > 0) {
      lines.push('', '### 6.3 Operações, Precedência Linear de Guardas e Efeitos de Transição');
      for (const op of specification.stateModel.operations) {
        lines.push(
          '',
          `#### Operação: \`${op.name}\``,
          `- **Descrição:** ${op.description ?? 'Sem descrição'}`,
          `- **Precedência Linear Estrita de Guardas (Curto-Circuito):** ${op.guardPrecedence.map((g, idx) => `${idx + 1}. \`${g}\``).join(' → ')}`,
        );
        if (op.executionPipeline?.length > 0) {
          lines.push(`- **Pipeline Determinístico de Execução:** ${op.executionPipeline.map((p, idx) => `${idx + 1}. [${p.stage}] \`${p.id}\``).join(' → ')}`);
        }
        if (op.parameters?.length > 0) {
          lines.push(
            '',
            '##### Contrato Público de Entrada (Public Input Contract):',
            '',
            '| Parâmetro | Tipo | Domínio | Limites (Bounds) | Nulabilidade | Produtor | Tratamento Inválido (onInvalid) |',
            '| :--- | :--- | :--- | :--- | :---: | :--- | :--- |',
          );
          for (const p of op.parameters) {
            const pBoundsStr = p.bounds
              ? `[${p.bounds.lowerBound ?? '-∞'}, ${p.bounds.upperBound ?? '+∞'}] (${p.bounds.boundaryBehavior})`
              : 'N/A';
            const onInvalidStr = p.onInvalid
              ? `${p.onInvalid.outcomeKind} (\`${p.onInvalid.error}\`)`
              : 'N/A';
            lines.push(
              `| \`${p.name}\` | \`${p.type}\` | \`${p.domain ?? 'N/A'}\` | ${pBoundsStr} | \`${p.nullability ?? 'NOT_NULL'}\` | \`${p.producer ?? 'N/A'}\` | ${onInvalidStr} |`,
            );
          }
        }
        lines.push(
          '',
          '| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |',
          '| :--- | :--- | :--- | :--- | :--- | :---: |',
        );
        for (const branch of op.branches) {
          const effectsStr = branch.stateEffects.length > 0
            ? branch.stateEffects.map((e) => `\`${e.field}\` := ${e.effect} ${e.value ? `\`${e.value}\`` : ''}`).join('<br>')
            : 'Nenhum efeito colateral';
          lines.push(
            `| \`${branch.branchId}\` | \`${branch.condition ?? branch.branchId}\` | \`${branch.outcomeKind}\` | \`${branch.statusOrError ?? 'N/A'}\` | ${effectsStr} | ${branch.defaultPreservation ? 'Sim' : 'Não'} |`,
          );
        }
      }
    }

    if (specification.stateModel.observables?.length > 0) {
      lines.push('', '### 6.4 Observáveis Públicos e Mapeamento de Bits');
      for (const obs of specification.stateModel.observables) {
        lines.push(
          '',
          `#### Observável: \`${obs.name}\``,
          `- **Representação:** \`${obs.representation}\``,
          `- **Derivado de:** ${obs.derivedFrom.map((d) => `\`${d}\``).join(', ')}`,
          `- **Comportamento quando Vazio:** \`${obs.emptyBehavior ?? 'N/A'}\``,
        );
        if (obs.bitAllocation?.length > 0) {
          lines.push(
            '',
            '| Slice / Intervalo de Bits | Campo de Origem | Largura | Mapeamento Semântico |',
            '| :--- | :--- | :---: | :--- |',
          );
          for (const slice of obs.bitAllocation) {
            lines.push(`| Bits \`${slice.slice}\` | \`${slice.field}\` | ${slice.bitWidth} bit(s) | \`${slice.mapping ?? 'Direto'}\` |`);
          }
        }
      }
    }

    if (specification.stateModel.canonicalSerializations?.length > 0) {
      lines.push('', '### 6.5 Perfis de Serialização Canônica');
      for (const profile of specification.stateModel.canonicalSerializations) {
        lines.push(
          '',
          `#### Alvo de Integridade: \`${profile.target}\``,
          `- **Chave de Ordenação Canônica:** \`${profile.recordOrderingKey}\``,
          `- **Digest de Coleção Vazia:** \`${profile.emptyStateDigest}\``,
          '',
          '| Campo Incluído | Formato de Encoding Canônico |',
          '| :--- | :--- |',
        );
        for (const fe of profile.fieldEncodings) {
          lines.push(`| \`${fe.field}\` | \`${fe.encoding}\` |`);
        }
      }
    }

    if (specification.stateModel.aggregations?.length > 0) {
      lines.push('', '### 6.6 Agregações de Coleção e Visões Derivadas');
      lines.push(
        '',
        '| Nome da Agregação | Coleção de Origem | Tipo de Agregação | Predicado de Filtro | Limite de Saturação | Proveniência |',
        '| :--- | :--- | :---: | :--- | :---: | :--- |',
      );
      for (const agg of specification.stateModel.aggregations) {
        lines.push(
          `| \`${agg.name}\` | \`${agg.sourceCollection}\` | \`${agg.aggregationKind}\` | \`${agg.filterPredicate}\` | \`${agg.saturationLimit ?? 'Sem saturação'}\` | ${agg.provenance ? renderBasis(agg.provenance) : 'N/A'} |`,
        );
      }
    }

    if (specification.stateModel.producerConsumerBoundaries?.length > 0) {
      lines.push('', '### 6.7 Fronteiras Producer / Consumer e Ownership de Sinais');
      lines.push(
        '',
        '| Sinal | Produtor (Origem) | Consumidor (Destino) | Ownership | Recomputável pelo Consumidor | Proveniência |',
        '| :--- | :--- | :--- | :---: | :---: | :--- |',
      );
      for (const bnd of specification.stateModel.producerConsumerBoundaries) {
        lines.push(
          `| \`${bnd.signalName}\` | \`${bnd.producer}\` | \`${bnd.consumer}\` | \`${bnd.ownership}\` | ${bnd.recomputableByConsumer ? 'Sim' : 'Não'} | ${bnd.provenance ? renderBasis(bnd.provenance) : 'N/A'} |`,
        );
      }
    }

    if (specification.stateModel.categories?.length > 0) {
      lines.push('', '### 6.8 Categorias Abstratas e Taxonomia Fechada de Conjuntos');
      lines.push(
        '',
        '| Categoria | Descrição | Membros Pertencentes (Set Membership) | Proveniência |',
        '| :--- | :--- | :--- | :--- |',
      );
      for (const cat of specification.stateModel.categories) {
        lines.push(
          `| \`${cat.name}\` | ${cat.description} | ${cat.members.map((m) => `\`${m}\``).join(', ')} | ${cat.provenance ? renderBasis(cat.provenance) : 'N/A'} |`,
        );
      }
    }

    if (specification.closureCertificate?.gapLedger?.length > 0) {
      lines.push(
        '',
        '### 6.9 Gap Ledger (Lacunas Falsificáveis Bloqueantes)',
        '',
        '| GAP-ID | Camada | Testemunho / Witness Falsificável | Autoridade Necessária |',
        '| :--- | :--- | :--- | :---: |',
      );
      for (const gap of specification.closureCertificate.gapLedger) {
        lines.push(`| \`${gap.gapId}\` | **${gap.layer}** | ${gap.witness} | \`${gap.requiredAuthority}\` |`);
      }
    }
  }

  const invSectionNum = hasStateModel ? '7' : '6';
  const riskSectionNum = hasStateModel ? '8' : '7';
  const advSectionNum = hasStateModel ? '9' : '8';
  const decSectionNum = hasStateModel ? '10' : '9';

  lines.push('', `## ${invSectionNum}. Invariantes`);
  for (const invariant of specification.invariants) {
    lines.push(`- **${invariant.id}:** ${invariant.statement}`);
    lines.push(`  - Falsificado se: ${invariant.falsification}`);
  }

  lines.push('', `## ${riskSectionNum}. Riscos e vulnerabilidades`);
  lines.push(`- **Revisão ${specification.riskReview.status}:** ${specification.riskReview.rationale}`);
  if (specification.risks.length === 0) lines.push('- Nenhum risco material identificado.');
  for (const risk of specification.risks) {
    lines.push(`- **${risk.id} — ${risk.kind}/${risk.level}:** ${risk.statement}`);
    lines.push(`  - Mitigação: ${risk.mitigation}`);
    lines.push(`  - Base: ${renderBasis(risk.basis)}`);
  }

  lines.push('', `## ${advSectionNum}. Parecer adversarial`);
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

  lines.push('', governed ? `## ${decSectionNum}. Decisões humanas seladas` : `## ${decSectionNum}. Decisões aguardando escolha humana`);
  if (specification.decisions.length === 0) {
    lines.push(blockingUnknowns.length === 0
      ? 'Nenhuma ambiguidade material detectada.'
      : 'Nenhuma decisão madura está disponível enquanto existirem lacunas bloqueantes.');
  } else {
    for (const decision of specification.decisions) {
      lines.push('', `### ${decision.questionId}: ${decision.question}`);
      if (decision.semanticKey) {
        lines.push(`**Chave Semântica:** \`${decision.semanticKey}\``);
      }
      lines.push(
        `**Contexto:** ${decision.presentation.context}`,
        `**Por que exige decisão humana:** ${decision.presentation.whyHumanDecision}`,
        `**Impacto observável:** ${decision.presentation.observableImpact}`,
        `**Justificativa da recomendação:** ${decision.presentation.recommendationReasoning}`,
      );
      if (decision.presentation.glossary.length > 0) {
        lines.push('**Glossário:**');
        for (const { term, meaning } of decision.presentation.glossary) {
          lines.push(`- **${term}:** ${meaning}`);
        }
      }
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
