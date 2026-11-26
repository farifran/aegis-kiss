/**
 * Aegis Workspace Skeleton AST Extractor
 *
 * Fronteira do Ecossistema (ARCH-STRICT-EXPLICIT-MODULES / ARCH-PARSIMONY / CONST-KISS):
 * 1. Suporte de 1ª Classe (Nativo): TypeScript e JavaScript (.ts, .tsx, .js, .jsx, .mjs, .cjs)
 *    operam via analisador sintático oficial da linguagem (TypeScript Compiler API).
 *    Extrai contratos públicos completos: interfaces com generics/herança, type aliases,
 *    enums, assinaturas de funções com tipos de retorno, assinaturas públicas de classes
 *    e docstrings JSDoc, com corpos despojados (stripped bodies).
 *
 * 2. Suporte Auxiliar (Melhor Esforço): Scripts de suporte (.py, .sh) utilizam extração
 *    leve restrita a declarações de nível superior (funções, classes e constantes de topo).
 *
 * 3. Vedação de Compiladores Concorrentes: Em obediência ao princípio CONST-KISS, o Harness
 *    rejeita a criação de parsers manuais ou expansão de regexes artesanais para múltiplas
 *    linguagens. Caso o repositório adote formalmente outro ecossistema como núcleo de
 *    produto (ex: microsserviço Python), o suporte deverá delegar exclusivamente ao parser
 *    oficial daquela linguagem (ex: subprocesso nativo com 'import ast'), garantindo
 *    falsificabilidade e pureza sem inflar a complexidade do Harness.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, posix, resolve } from 'node:path';
import ts from 'typescript';
import { canonicalDigest, compareCodeUnits } from './canonical_json.mjs';

const tsExtensions = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
]);

const maxSignatureLength = 4096;
const maxConstDeclLength = 200;
const maxDocCommentLength = 1024;
const skeletonSchema = 'aegis.workspace_skeleton.v1';

function compactVariableDeclaration(declaration, sourceFile) {
  const rawDecl = declaration.getText(sourceFile).trim();
  if (rawDecl.length <= maxConstDeclLength) return rawDecl;
  const nameText = declaration.name.getText(sourceFile);
  const typeText = declaration.type ? `: ${declaration.type.getText(sourceFile)}` : '';
  const initText = declaration.initializer ? declaration.initializer.getText(sourceFile).trim() : '';
  const compactInit = initText.replace(/\s+/gu, ' ');
  const previewBudget = Math.max(40, maxConstDeclLength - nameText.length - typeText.length - 24);
  const preview = compactInit.length > previewBudget
    ? `${compactInit.slice(0, previewBudget)}… /* ${initText.length} chars */`
    : compactInit;
  return `${nameText}${typeText} = ${preview}`;
}

function getLine(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function extractLeadingDocComment(node, sourceFile) {
  const fullText = sourceFile.text;
  const ranges = ts.getLeadingCommentRanges(fullText, node.pos);
  if (!ranges || ranges.length === 0) return undefined;
  const lastRange = ranges[ranges.length - 1];
  const commentText = fullText.slice(lastRange.pos, lastRange.end).trim();
  if (commentText.startsWith('/**')) {
    return commentText.slice(0, maxDocCommentLength);
  }
  return undefined;
}

function extractClassSignature(node, sourceFile) {
  const className = node.name?.text ?? 'AnonymousClass';
  const heritage = node.heritageClauses
    ? ` ${node.heritageClauses.map((c) => c.getText(sourceFile)).join(' ')}`
    : '';
  const memberSignatures = [];

  for (const member of node.members) {
    const isPublic = (ts.getCombinedModifierFlags(member) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0;
    if (!isPublic) continue;

    if (ts.isConstructorDeclaration(member)) {
      const bodyStart = member.body ? member.body.getStart(sourceFile) : member.getEnd();
      const ctorSig = sourceFile.text.slice(member.getStart(sourceFile), bodyStart).trim();
      memberSignatures.push(`  ${ctorSig};`);
    } else if (ts.isMethodDeclaration(member)) {
      const bodyStart = member.body ? member.body.getStart(sourceFile) : member.getEnd();
      const methodSig = sourceFile.text.slice(member.getStart(sourceFile), bodyStart).trim();
      memberSignatures.push(`  ${methodSig};`);
    } else if (ts.isPropertyDeclaration(member)) {
      const propSig = member.getText(sourceFile).trim();
      memberSignatures.push(`  ${propSig}`);
    }
  }

  const isExported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
  const isDefault = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default) !== 0;
  const prefix = isExported ? (isDefault ? 'export default class ' : 'export class ') : 'class ';
  const bodyText = memberSignatures.length > 0 ? `\n${memberSignatures.join('\n')}\n` : ' ';
  return `${prefix}${className}${heritage} {${bodyText}}`.slice(0, maxSignatureLength);
}

function extractTypeScriptSymbols(path, text) {
  const symbols = [];
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

  function pushSymbol(node, kind, name, signature, {
    exported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0,
    docNode = node,
  } = {}) {
    const docComment = docNode ? extractLeadingDocComment(docNode, sourceFile) : undefined;
    symbols.push({
      path,
      name: name.slice(0, 128),
      kind,
      startLine: getLine(sourceFile, node.getStart(sourceFile)),
      endLine: getLine(sourceFile, node.getEnd()),
      exported,
      signature: signature.slice(0, maxSignatureLength),
      ...(docComment ? { docComment } : {}),
    });
  }

  function visit(node) {
    if (ts.isFunctionDeclaration(node)) {
      const bodyStart = node.body ? node.body.getStart(sourceFile) : node.getEnd();
      const sig = text.slice(node.getStart(sourceFile), bodyStart).trim();
      pushSymbol(node, 'FUNCTION', node.name?.text ?? 'default', sig);
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      pushSymbol(node, 'INTERFACE', node.name.text, node.getText(sourceFile).trim());
      return;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      pushSymbol(node, 'TYPE_ALIAS', node.name.text, node.getText(sourceFile).trim());
      return;
    }

    if (ts.isEnumDeclaration(node)) {
      pushSymbol(node, 'ENUM', node.name.text, node.getText(sourceFile).trim());
      return;
    }

    if (ts.isClassDeclaration(node)) {
      pushSymbol(node, 'CLASS', node.name?.text ?? 'default', extractClassSignature(node, sourceFile));
      return;
    }

    if (ts.isVariableStatement(node)) {
      const exported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      const prefix = exported ? `export ${isConst ? 'const' : 'let'} ` : `${isConst ? 'const' : 'let'} `;

      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const isArrowOrFn = declaration.initializer
          && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer));
        if (isArrowOrFn) {
          const bodyStart = declaration.initializer.body ? declaration.initializer.body.getStart(sourceFile) : declaration.initializer.getEnd();
          const fnSig = text.slice(declaration.getStart(sourceFile), bodyStart).trim();
          pushSymbol(declaration, 'FUNCTION', declaration.name.text, `${prefix}${fnSig}`, { exported, docNode: node });
        } else {
          const rawDecl = compactVariableDeclaration(declaration, sourceFile);
          pushSymbol(declaration, isConst ? 'CONST' : 'VARIABLE', declaration.name.text, `${prefix}${rawDecl}`, { exported, docNode: node });
        }
      }
      return;
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      const moduleSpec = node.moduleSpecifier ? node.moduleSpecifier.getText(sourceFile) : '';
      for (const specifier of node.exportClause.elements) {
        const sig = `export { ${specifier.getText(sourceFile)} }${moduleSpec ? ` from ${moduleSpec}` : ''}`;
        pushSymbol(node, 'CONST', specifier.name.text, sig, { exported: true, docNode: null });
      }
    }
  }

  ts.forEachChild(sourceFile, visit);
  return symbols;
}

function extractGenericSymbols(path, text) {
  const symbols = [];
  const lines = text.split('\n');

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    const isTopLevel = lineText.length > 0 && lineText[0] !== ' ' && lineText[0] !== '\t';
    const trimmed = lineText.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('//')) return;

    if (isTopLevel) {
      // Python function
      const pyFnMatch = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\((.*?)\)(?:\s*->\s*[^:]+)?:/);
      if (pyFnMatch) {
        symbols.push({
          path,
          name: pyFnMatch[1].slice(0, 128),
          kind: 'FUNCTION',
          startLine: lineNum,
          endLine: lineNum,
          exported: !pyFnMatch[1].startsWith('_'),
          signature: trimmed.slice(0, maxSignatureLength),
        });
        return;
      }

      // Python class
      const pyClassMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)(?:\(.*?\))?:/);
      if (pyClassMatch) {
        symbols.push({
          path,
          name: pyClassMatch[1].slice(0, 128),
          kind: 'CLASS',
          startLine: lineNum,
          endLine: lineNum,
          exported: !pyClassMatch[1].startsWith('_'),
          signature: trimmed.slice(0, maxSignatureLength),
        });
        return;
      }
    }

    // Shell function
    const shFnMatch = trimmed.match(/^(?:function\s+)?([a-zA-Z0-9_]+)\s*\(\)\s*\{/);
    if (shFnMatch) {
      symbols.push({
        path,
        name: shFnMatch[1].slice(0, 128),
        kind: 'FUNCTION',
        startLine: lineNum,
        endLine: lineNum,
        exported: true,
        signature: `${shFnMatch[1]}()`.slice(0, maxSignatureLength),
      });
      return;
    }

    // Shell/generic constant: e.g. EXECUTAR_OPERACAO=1
    const shConstMatch = trimmed.match(/^([A-Z][A-Z0-9_]{2,})=(.*)/);
    if (shConstMatch && !trimmed.startsWith('#')) {
      symbols.push({
        path,
        name: shConstMatch[1].slice(0, 128),
        kind: 'CONST',
        startLine: lineNum,
        endLine: lineNum,
        exported: true,
        signature: `${shConstMatch[1]}=...`.slice(0, maxSignatureLength),
      });
    }
  });

  return symbols;
}

export function extractFileSymbols(path, text) {
  const ext = extname(path).toLowerCase();
  if (tsExtensions.has(ext)) {
    return extractTypeScriptSymbols(path, text);
  }
  return extractGenericSymbols(path, text);
}

/**
 * Lê compilerOptions.paths + baseUrl de tsconfig.json usando o parser JSONC oficial do TypeScript.
 */
export function loadTsconfigPathAliases(repositoryRoot) {
  if (!repositoryRoot) return [];
  const tsconfigPath = resolve(repositoryRoot, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return [];
  try {
    const parsed = ts.readConfigFile(tsconfigPath, (p) => readFileSync(p, 'utf8'));
    if (parsed.error || !parsed.config?.compilerOptions?.paths) return [];
    const baseUrl = String(parsed.config.compilerOptions.baseUrl ?? '.').replace(/^\.\//u, '').replace(/\/+$/u, '');
    const aliases = [];
    for (const [pattern, targets] of Object.entries(parsed.config.compilerOptions.paths)) {
      if (!Array.isArray(targets) || targets.length === 0) continue;
      const starIdx = pattern.indexOf('*');
      const prefix = starIdx >= 0 ? pattern.slice(0, starIdx) : pattern;
      const suffix = starIdx >= 0 ? pattern.slice(starIdx + 1) : '';
      const mappedTargets = targets
        .filter((t) => typeof t === 'string')
        .map((t) => {
          const clean = t.replace(/^\.\//u, '');
          return baseUrl && baseUrl !== '.' ? posix.join(baseUrl, clean) : clean;
        });
      if (mappedTargets.length > 0) {
        aliases.push({ prefix, suffix, hasWildcard: starIdx >= 0, targets: mappedTargets });
      }
    }
    return aliases;
  } catch {
    return [];
  }
}

/**
 * Extrai declarações de import/re-export estáticos e import()/require() reais via AST TypeScript
 * (sem regex sobre comentários/strings). Retorna [{ specifier, names }].
 */
export function extractAstImports(path, text) {
  const ext = extname(path).toLowerCase();
  if (!tsExtensions.has(ext)) return [];
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports = [];

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const specifier = stmt.moduleSpecifier.text;
      const names = [];
      const clause = stmt.importClause;
      if (clause?.name) names.push(clause.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          names.push((el.propertyName ?? el.name).text);
        }
      }
      imports.push({ specifier, names });
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const specifier = stmt.moduleSpecifier.text;
      const names = [];
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          names.push((el.propertyName ?? el.name).text);
        }
      }
      imports.push({ specifier, names });
    }
  }

  function visitDynamic(node) {
    if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const firstArg = node.arguments[0];
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequireCall) && (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))) {
        imports.push({ specifier: firstArg.text, names: [] });
      }
    }
    ts.forEachChild(node, visitDynamic);
  }
  visitDynamic(sourceFile);

  return imports;
}

function hasDisabledTestOption(optionsArg) {
  if (!optionsArg || !ts.isObjectLiteralExpression(optionsArg)) return false;
  for (const prop of optionsArg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) ? prop.name.text : (ts.isStringLiteral(prop.name) ? prop.name.text : '');
    if (key !== 'skip' && key !== 'todo') continue;
    const init = prop.initializer;
    if (init.kind === ts.SyntaxKind.FalseKeyword
      || init.kind === ts.SyntaxKind.NullKeyword
      || (ts.isIdentifier(init) && init.text === 'undefined')
      || (ts.isNumericLiteral(init) && init.text === '0')
      || (ts.isStringLiteral(init) && init.text.length === 0)) {
      continue;
    }
    return true;
  }
  return false;
}

function isEmptyCallbackBody(callbackArg) {
  if (!callbackArg) return true;
  if (ts.isArrowFunction(callbackArg) || ts.isFunctionExpression(callbackArg)) {
    return ts.isBlock(callbackArg.body) && callbackArg.body.statements.length === 0;
  }
  return false;
}

/**
 * Extrai casos de teste ativos (`test('...', fn)`, `it('...', fn)`, `t.test('...', fn)`)
 * herdando títulos de `describe('...', fn)` apenas quando houver casos ativos dentro.
 * Ignora comentários, `.skip`/`.todo`, opções `{ skip/todo: truthy }`, callbacks vazios e chamadas sem callback.
 */
export function extractActiveTestCases(path, text) {
  const ext = extname(path).toLowerCase();
  if (!tsExtensions.has(ext)) return { caseCount: 0, titles: [] };
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  let caseCount = 0;
  const titles = [];
  const describeStack = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      // Ignora subárvore inteira de describe.skip / test.skip / it.todo etc.
      if (ts.isPropertyAccessExpression(expr) && (expr.name.text === 'skip' || expr.name.text === 'todo')) {
        return;
      }

      const isDirectCallee = ts.isIdentifier(expr)
        && (expr.text === 'test' || expr.text === 'it' || expr.text === 'describe');
      const isSubtestCallee = ts.isPropertyAccessExpression(expr)
        && ts.isIdentifier(expr.expression)
        && expr.name.text === 'test';

      if (isDirectCallee || isSubtestCallee) {
        const args = node.arguments;
        const firstArg = args[0];
        const hasTitle = firstArg && (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg));
        const optionsArg = args.length >= 3 && ts.isObjectLiteralExpression(args[1]) ? args[1] : null;
        const callbackArg = optionsArg ? args[2] : (args.length >= 2 && !ts.isObjectLiteralExpression(args[1]) ? args[1] : null);

        if (hasDisabledTestOption(optionsArg) || !callbackArg || isEmptyCallbackBody(callbackArg)) {
          return;
        }
        const calleeName = isDirectCallee ? expr.text : 'test';
        if (calleeName === 'describe') {
          if (hasTitle) describeStack.push(firstArg.text);
          ts.forEachChild(callbackArg, visit);
          if (hasTitle) describeStack.pop();
          return;
        }
        if (hasTitle) {
          caseCount += 1;
          const fullTitle = describeStack.length > 0
            ? `${describeStack.join(' > ')} > ${firstArg.text}`
            : firstArg.text;
          titles.push(fullTitle);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { caseCount, titles };
}

/**
 * Coleta linhas onde cada identificador aparece como nó Identifier real na AST
 * (ignora comentários e strings literais).
 */
export function extractAstIdentifierLines(path, text) {
  const byName = new Map();
  const ext = extname(path).toLowerCase();
  if (!tsExtensions.has(ext)) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
      for (const m of lines[i].matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]{3,})\b/gu)) {
        const name = m[1];
        if (!byName.has(name)) byName.set(name, []);
        const list = byName.get(name);
        if (list[list.length - 1] !== i + 1) list.push(i + 1);
      }
    }
    return byName;
  }

  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isIdentifier(node) && node.text.length >= 4) {
      const line = getLine(sourceFile, node.getStart(sourceFile));
      if (!byName.has(node.text)) byName.set(node.text, []);
      const list = byName.get(node.text);
      if (list[list.length - 1] !== line) list.push(line);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return byName;
}

export function buildWorkspaceSkeleton(sourceRecords) {
  const allSymbols = [];

  for (const { path, text } of sourceRecords) {
    const fileSymbols = extractFileSymbols(path, text);
    allSymbols.push(...fileSymbols);
  }

  // Deterministic sorting: by path, then startLine, then name
  allSymbols.sort((left, right) =>
    compareCodeUnits(left.path, right.path)
    || left.startLine - right.startLine
    || compareCodeUnits(left.name, right.name)
  );

  const unsigned = {
    schema: skeletonSchema,
    symbolCount: allSymbols.length,
    symbols: allSymbols,
  };

  return {
    ...unsigned,
    digest: canonicalDigest(unsigned),
  };
}
