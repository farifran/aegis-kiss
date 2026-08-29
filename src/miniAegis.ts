// src/miniAegis.ts

export interface TargetEvidence {
  readonly path: string;
  readonly exists: boolean;
  readonly sizeBytes: number;
  readonly exports: readonly string[];
  readonly snippet: string;
  readonly truncated: boolean;
  readonly tokenEstimate: number;
}

export interface GovernanceContext {
  readonly agentsDoc: string;
  readonly architectureDoc: string;
  readonly briefingSkillDoc: string;
}

export interface ForensicReport {
  readonly workspaceStatus: 'clean' | 'has_targets' | 'partial';
  readonly existingCount: number;
  readonly missingCount: number;
  readonly totalBytes: number;
  readonly estimatedTokens: number;
  readonly notes: readonly string[];
}

export interface EpistemicPromptPayload {
  readonly systemDirective: string;
  readonly governance: GovernanceContext;
  readonly report: ForensicReport;
  readonly evidence: readonly TargetEvidence[];
  readonly demandText: string;
  readonly promptMarkdown: string;
}

export interface FileStat {
  readonly size: number;
}

export interface FileSystemReader {
  existsSync(filePath: string): boolean;
  statSync(filePath: string): FileStat;
  readFileSync(filePath: string, encoding: string): string;
}

export interface MiniAegisOptions {
  readonly workspaceRoot?: string | undefined;
  readonly maxSnippetBytes?: number | undefined;
  readonly maxContextTokens?: number | undefined;
  readonly fsReader?: FileSystemReader | undefined;
}

export class MiniAegis {
  private readonly _workspaceRoot: string;
  private readonly _maxSnippetBytes: number;
  private readonly _maxContextTokens: number;
  private readonly _fsReader: FileSystemReader | null;

  constructor(options: MiniAegisOptions = {}) {
    this._workspaceRoot = options.workspaceRoot ?? '.';
    this._maxSnippetBytes = options.maxSnippetBytes ?? 4096;
    this._maxContextTokens = options.maxContextTokens ?? 32768;
    this._fsReader = options.fsReader ?? null;
  }

  get workspaceRoot(): string {
    return this._workspaceRoot;
  }

  get maxSnippetBytes(): number {
    return this._maxSnippetBytes;
  }

  get maxContextTokens(): number {
    return this._maxContextTokens;
  }

  discoverTargets(targetPaths: readonly string[]): TargetEvidence[] {
    const results: TargetEvidence[] = [];
    for (const targetPath of targetPaths) {
      results.push(this._inspectSingleFile(targetPath));
    }
    return results;
  }

  loadGovernance(): GovernanceContext {
    return {
      agentsDoc: this._readOptionalFile('AGENTS.md'),
      architectureDoc: this._readOptionalFile('ARCHITECTURE.md'),
      briefingSkillDoc: this._readOptionalFile('.skills/briefing.md'),
    };
  }

  runForensics(targetPaths: readonly string[], demandText: string): EpistemicPromptPayload {
    const evidence = this.discoverTargets(targetPaths);
    const governance = this.loadGovernance();
    const report = this._buildForensicReport(evidence);
    const promptMarkdown = this._renderMarkdownPrompt(governance, report, evidence, demandText);

    return {
      systemDirective: 'AEGIS EPISTEMIC PROTOCOL: Reason strictly from provided evidence and domain invariants.',
      governance,
      report,
      evidence,
      demandText,
      promptMarkdown,
    };
  }

  formatPromptForLLM(payload: EpistemicPromptPayload): string {
    return payload.promptMarkdown;
  }

  compileForensicMask(evidence: readonly TargetEvidence[]): number {
    let mask = 0;
    const targetCount = evidence.length;
    let existCount = 0;

    for (let i = 0; i < targetCount; i++) {
      const item = evidence[i];
      if (item !== undefined && item.exists) {
        existCount++;
        if (i < 8) {
          mask = mask | (1 << i);
        }
      }
    }

    if (existCount === targetCount && targetCount > 0) {
      mask = mask | (1 << 8);
    } else if (existCount > 0) {
      mask = mask | (1 << 9);
    } else {
      mask = mask | (1 << 10);
    }

    let clampedCount = targetCount;
    if (clampedCount > 15) {
      clampedCount = 15;
    }
    mask = mask | ((clampedCount & 0xF) << 12);

    return mask >>> 0;
  }

  private _inspectSingleFile(relativePath: string): TargetEvidence {
    if (this._fsReader === null) {
      return {
        path: relativePath,
        exists: false,
        sizeBytes: 0,
        exports: [],
        snippet: '',
        truncated: false,
        tokenEstimate: 0,
      };
    }

    const fullPath = this._resolvePath(this._workspaceRoot, relativePath);
    if (!this._fsReader.existsSync(fullPath)) {
      return {
        path: relativePath,
        exists: false,
        sizeBytes: 0,
        exports: [],
        snippet: '',
        truncated: false,
        tokenEstimate: 0,
      };
    }

    try {
      const stat = this._fsReader.statSync(fullPath);
      const content = this._fsReader.readFileSync(fullPath, 'utf8');
      const sizeBytes = stat.size;
      const exportsList = this._extractExports(content);
      const isTruncated = sizeBytes > this._maxSnippetBytes;
      const snippet = isTruncated ? content.slice(0, this._maxSnippetBytes) : content;
      const tokenEstimate = Math.ceil(sizeBytes / 4);

      return {
        path: relativePath,
        exists: true,
        sizeBytes,
        exports: exportsList,
        snippet,
        truncated: isTruncated,
        tokenEstimate,
      };
    } catch {
      return {
        path: relativePath,
        exists: false,
        sizeBytes: 0,
        exports: [],
        snippet: '',
        truncated: false,
        tokenEstimate: 0,
      };
    }
  }

  private _resolvePath(root: string, relativePath: string): string {
    if (root.endsWith('/')) {
      return root + relativePath;
    }
    return root + '/' + relativePath;
  }

  private _extractExports(content: string): string[] {
    const exportsFound: string[] = [];
    const exportRegex = /export\s+(?:class|function|interface|type|const|enum)\s+([a-zA-Z0-9_$]+)/g;
    let match = exportRegex.exec(content);
    while (match !== null) {
      const name = match[1];
      if (name !== undefined) {
        exportsFound.push(name);
      }
      match = exportRegex.exec(content);
    }
    return exportsFound;
  }

  private _readOptionalFile(relativePath: string): string {
    if (this._fsReader === null) {
      return '';
    }
    const fullPath = this._resolvePath(this._workspaceRoot, relativePath);
    if (!this._fsReader.existsSync(fullPath)) {
      return '';
    }
    try {
      return this._fsReader.readFileSync(fullPath, 'utf8');
    } catch {
      return '';
    }
  }

  private _buildForensicReport(evidence: readonly TargetEvidence[]): ForensicReport {
    let existingCount = 0;
    let missingCount = 0;
    let totalBytes = 0;
    let totalTokens = 0;
    const notes: string[] = [];

    for (const item of evidence) {
      if (item.exists) {
        existingCount++;
        totalBytes += item.sizeBytes;
        totalTokens += item.tokenEstimate;
        if (item.exports.length > 0) {
          notes.push(`[TARGET-EXISTING] ${item.path} (exports: ${item.exports.join(', ')})`);
        } else {
          notes.push(`[TARGET-EMPTY] ${item.path} exists but has no exports`);
        }
      } else {
        missingCount++;
        notes.push(`[TARGET-MISSING] ${item.path} does not exist in workspace`);
      }
    }

    let workspaceStatus: 'clean' | 'has_targets' | 'partial' = 'clean';
    if (existingCount > 0 && missingCount === 0) {
      workspaceStatus = 'has_targets';
    } else if (existingCount > 0 && missingCount > 0) {
      workspaceStatus = 'partial';
    }

    return {
      workspaceStatus,
      existingCount,
      missingCount,
      totalBytes,
      estimatedTokens: totalTokens,
      notes,
    };
  }

  private _renderMarkdownPrompt(
    gov: GovernanceContext,
    report: ForensicReport,
    evidence: readonly TargetEvidence[],
    demandText: string
  ): string {
    const sections: string[] = [];

    sections.push('# AEGIS COGNITIVE HANDOVER\n');
    sections.push('## 1. System & Cognitive Governance\n');
    sections.push('### AGENTS.md');
    sections.push(gov.agentsDoc.length > 0 ? gov.agentsDoc : '(empty / not found)');
    sections.push('\n### ARCHITECTURE.md');
    sections.push(gov.architectureDoc.length > 0 ? gov.architectureDoc : '(empty / not found)');
    sections.push('\n### .skills/briefing.md');
    sections.push(gov.briefingSkillDoc.length > 0 ? gov.briefingSkillDoc : '(empty / not found)');

    sections.push('\n## 2. Workspace Forensics & Evidence\n');
    sections.push(`- Status: **${report.workspaceStatus.toUpperCase()}**`);
    sections.push(`- Existing targets: ${report.existingCount} | Missing targets: ${report.missingCount}`);
    sections.push(`- Total Target Bytes: ${report.totalBytes} (~${report.estimatedTokens} tokens)`);
    sections.push('- Findings:');
    for (const note of report.notes) {
      sections.push(`  * ${note}`);
    }

    sections.push('\n### Target Files Deep Inspection');
    for (const item of evidence) {
      sections.push(`\n#### \`${item.path}\``);
      sections.push(`- Exists: ${item.exists} | Size: ${item.sizeBytes} bytes | Truncated: ${item.truncated}`);
      sections.push(`- Exports: [${item.exports.join(', ')}]`);
      if (item.snippet.length > 0) {
        sections.push('```ts\n' + item.snippet + '\n```');
      }
    }

    sections.push('\n## 3. Received Software Demand\n');
    sections.push(demandText);

    return sections.join('\n');
  }
}

export function createMiniAegis(options?: MiniAegisOptions): MiniAegis {
  return new MiniAegis(options);
}
