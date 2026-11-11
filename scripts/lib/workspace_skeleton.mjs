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

import ts from 'typescript';
import { extname } from 'node:path';
import { canonicalDigest, compareCodeUnits } from './canonical_json.mjs';

const tsExtensions = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
]);

const maxSignatureLength = 4096;
const maxDocCommentLength = 1024;
const skeletonSchema = 'aegis.workspace_skeleton.v1';

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

  function visit(node) {
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text ?? 'default';
      const isExported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
      const startLine = getLine(sourceFile, node.getStart(sourceFile));
      const endLine = getLine(sourceFile, node.getEnd());
      const bodyStart = node.body ? node.body.getStart(sourceFile) : node.getEnd();
      const signature = text.slice(node.getStart(sourceFile), bodyStart).trim().slice(0, maxSignatureLength);
      const docComment = extractLeadingDocComment(node, sourceFile);

      symbols.push({
        path,
        name: name.slice(0, 128),
        kind: 'FUNCTION',
        startLine,
        endLine,
        exported: isExported,
        signature,
        ...(docComment ? { docComment } : {}),
      });
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      const isExported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
      const startLine = getLine(sourceFile, node.getStart(sourceFile));
      const endLine = getLine(sourceFile, node.getEnd());
      const signature = node.getText(sourceFile).trim().slice(0, maxSignatureLength);
      const docComment = extractLeadingDocComment(node, sourceFile);

      symbols.push({
        path,
        name: name.slice(0, 128),
        kind: 'INTERFACE',
        startLine,
        endLine,
        exported: isExported,
        signature,
        ...(docComment ? { docComment } : {}),
      });
      return;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      const isExported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
      const startLine = getLine(sourceFile, node.getStart(sourceFile));
      const endLine = getLine(sourceFile, node.getEnd());
      const signature = node.getText(sourceFile).trim().slice(0, maxSignatureLength);
      const docComment = extractLeadingDocComment(node, sourceFile);

      symbols.push({
        path,
        name: name.slice(0, 128),
        kind: 'TYPE_ALIAS',
        startLine,
        endLine,
        exported: isExported,
        signature,
        ...(docComment ? { docComment } : {}),
      });
      return;
    }

    if (ts.isEnumDeclaration(node)) {
      const name = node.name.text;
      const isExported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
      const startLine = getLine(sourceFile, node.getStart(sourceFile));
      const endLine = getLine(sourceFile, node.getEnd());
      const signature = node.getText(sourceFile).trim().slice(0, maxSignatureLength);
      const docComment = extractLeadingDocComment(node, sourceFile);

      symbols.push({
        path,
        name: name.slice(0, 128),
        kind: 'ENUM',
        startLine,
        endLine,
        exported: isExported,
        signature,
        ...(docComment ? { docComment } : {}),
      });
      return;
    }

    if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? 'default';
      const isExported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
      const startLine = getLine(sourceFile, node.getStart(sourceFile));
      const endLine = getLine(sourceFile, node.getEnd());
      const signature = extractClassSignature(node, sourceFile);
      const docComment = extractLeadingDocComment(node, sourceFile);

      symbols.push({
        path,
        name: name.slice(0, 128),
        kind: 'CLASS',
        startLine,
        endLine,
        exported: isExported,
        signature,
        ...(docComment ? { docComment } : {}),
      });
      return;
    }

    if (ts.isVariableStatement(node)) {
      const isExported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      const docComment = extractLeadingDocComment(node, sourceFile);

      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const name = declaration.name.text;
          const startLine = getLine(sourceFile, declaration.getStart(sourceFile));
          const endLine = getLine(sourceFile, declaration.getEnd());
          const isArrowOrFn = declaration.initializer
            && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer));

          if (isArrowOrFn) {
            const bodyStart = declaration.initializer.body ? declaration.initializer.body.getStart(sourceFile) : declaration.initializer.getEnd();
            const fnSig = text.slice(declaration.getStart(sourceFile), bodyStart).trim();
            const prefix = isExported ? `export ${isConst ? 'const' : 'let'} ` : `${isConst ? 'const' : 'let'} `;
            symbols.push({
              path,
              name: name.slice(0, 128),
              kind: 'FUNCTION',
              startLine,
              endLine,
              exported: isExported,
              signature: `${prefix}${fnSig}`.slice(0, maxSignatureLength),
              ...(docComment ? { docComment } : {}),
            });
          } else {
            const prefix = isExported ? `export ${isConst ? 'const' : 'let'} ` : `${isConst ? 'const' : 'let'} `;
            const rawDecl = declaration.getText(sourceFile).trim();
            symbols.push({
              path,
              name: name.slice(0, 128),
              kind: isConst ? 'CONST' : 'VARIABLE',
              startLine,
              endLine,
              exported: isExported,
              signature: `${prefix}${rawDecl}`.slice(0, maxSignatureLength),
              ...(docComment ? { docComment } : {}),
            });
          }
        }
      }
      return;
    }

    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        const startLine = getLine(sourceFile, node.getStart(sourceFile));
        const endLine = getLine(sourceFile, node.getEnd());
        const moduleSpec = node.moduleSpecifier ? node.moduleSpecifier.getText(sourceFile) : '';

        for (const specifier of node.exportClause.elements) {
          const exportedName = specifier.name.text;
          symbols.push({
            path,
            name: exportedName.slice(0, 128),
            kind: 'CONST',
            startLine,
            endLine,
            exported: true,
            signature: `export { ${specifier.getText(sourceFile)} }${moduleSpec ? ` from ${moduleSpec}` : ''}`.slice(0, maxSignatureLength),
          });
        }
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
