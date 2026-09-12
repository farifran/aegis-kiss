/* global module, require */

const vscode = require('vscode');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const requestRelPath = '.harness/runtime/user_confirmation_request.json';
const resolutionRelPath = '.harness/runtime/preflight_resolution.json';

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function validRequest(value) {
  return (value?.schema === 'aegis.preflight_finalization.v2' || value?.status === 'USER_CONFIRMATION_REQUIRED')
    && value.status === 'USER_CONFIRMATION_REQUIRED'
    && Array.isArray(value.questions);
}

let isPrompting = false;
let lastCancelledId = null;

function resetWizardState() {
  lastCancelledId = null;
  isPrompting = false;
}

function readRequest(root) {
  try {
    const fullPath = path.join(root.fsPath, requestRelPath);
    if (!fs.existsSync(fullPath)) {
      resetWizardState();
      return undefined;
    }
    const raw = fs.readFileSync(fullPath, 'utf8');
    const value = JSON.parse(raw);
    return validRequest(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isAlreadyResolved(root, request) {
  try {
    const fullPath = path.join(root.fsPath, resolutionRelPath);
    // Crucial: If resolution file does NOT physically exist on disk, it is NEVER resolved!
    if (!fs.existsSync(fullPath)) return false;
    const raw = fs.readFileSync(fullPath, 'utf8');
    const resolution = JSON.parse(raw);
    return Boolean(request.executionId && resolution?.executionId === request.executionId);
  } catch {
    return false;
  }
}

async function choose(question) {
  const choices = question.answers.map((answer) => ({
    label: answer.label,
    description: answer.recommended ? 'Recomendado' : undefined,
    detail: answer.rationale,
    answer,
  }));
  choices.push({ label: 'Outra interpretação…', detail: 'Devolve o contrato à revisão semântica.', other: true });
  const selected = await vscode.window.showQuickPick(choices, {
    title: `Aegis — ${question.id}`,
    placeHolder: question.question,
    ignoreFocusOut: true,
  });
  if (selected === undefined) return undefined;
  if (!selected.other) return { questionId: question.id, answerId: selected.answer.id };
  const correction = await vscode.window.showInputBox({
    title: `Aegis — ${question.id}`,
    prompt: 'Descreva a interpretação que o contrato deve adotar.',
    ignoreFocusOut: true,
    validateInput: (value) => value.trim().length === 0 ? 'A interpretação não pode ficar vazia.' : undefined,
  });
  return correction === undefined ? undefined : { questionId: question.id, action: 'CORRECT_INTERPRETATION', correction };
}

async function writeResolution(root, request, answers) {
  const target = path.join(root.fsPath, resolutionRelPath);
  const payload = `${JSON.stringify({
    schema: 'aegis.preflight_resolution.v2',
    executionId: request.executionId,
    answers,
  }, null, 2)}\n`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, payload, 'utf8');
}

function resume(root) {
  return new Promise((resolve, reject) => {
    const child = spawn('./aegis', ['--approve'], { cwd: root.fsPath, shell: false });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `aegis_approve_failed:${code}`)));
  });
}

async function presentPending(force = false) {
  const root = workspaceRoot();
  if (root === undefined) return;

  const request = readRequest(root);
  if (request === undefined) return;

  const reqId = request.executionId;
  if (!force && lastCancelledId === reqId) return;

  if (isPrompting) return;
  if (isAlreadyResolved(root, request)) return;

  isPrompting = true;
  try {
    if (request.questions.length === 0) {
      const choice = await vscode.window.showQuickPick([
        {
          label: 'Aprovar e Selar Contrato',
          description: 'Recomendado',
          detail: 'Nenhuma ambiguidade pendente na demanda. Selar contrato e gerar governança.',
          action: 'APPROVE',
        },
        {
          label: 'Cancelar',
          detail: 'Manter rascunho sem selar.',
          action: 'CANCEL',
        },
      ], {
        title: `Aegis — ${request.title || 'Confirmação de Contrato'}`,
        placeHolder: 'Demanda sem ambiguidades materiais. Deseja selar o contrato?',
        ignoreFocusOut: true,
      });

      if (!choice || choice.action === 'CANCEL') {
        lastCancelledId = reqId;
        return;
      }

      await writeResolution(root, request, []);
      await resume(root);
      lastCancelledId = null;
      return;
    }

    const answers = [];
    for (const question of request.questions) {
      const answer = await choose(question);
      if (answer === undefined) {
        lastCancelledId = reqId;
        return;
      }
      answers.push(answer);
    }
    await writeResolution(root, request, answers);
    await resume(root);
    lastCancelledId = null;
  } catch (error) {
    await vscode.window.showErrorMessage(`Aegis não retomou a confirmação: ${error.message}`);
  } finally {
    isPrompting = false;
  }
}

function activate(context) {
  const root = workspaceRoot();
  if (root === undefined) return;

  // 1. VSCode File System Watcher
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/' + path.basename(requestRelPath)));
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => presentPending()),
    watcher.onDidChange(() => presentPending()),
    watcher.onDidDelete(() => resetWizardState()),
  );

  context.subscriptions.push(vscode.commands.registerCommand('aegisWizard.check', () => presentPending(true)));
  void presentPending();
}

function deactivate() {}

module.exports = { activate, deactivate };
