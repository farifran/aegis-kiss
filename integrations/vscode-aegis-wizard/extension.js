/* global Buffer, module, process, require */

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
    && Array.isArray(value.questions)
    && value.questions.length > 0;
}

function readRequest(root) {
  try {
    const fullPath = path.join(root.fsPath, requestRelPath);
    if (!fs.existsSync(fullPath)) return undefined;
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
    const reqId = request.confirmation?.confirmationId || request.executionId || request.decisionDigest;
    const resId = resolution?.confirmation?.confirmationId || resolution?.executionId || resolution?.decisionDigest;
    return Boolean(reqId && resId && reqId === resId);
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
  if (!selected.other) return { questionId: question.id, action: 'SELECT_ANSWER', answerId: selected.answer.id };
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
  const confirmationId = request.confirmation?.confirmationId || request.executionId || request.decisionDigest || 'aegis-conf';
  const payload = `${JSON.stringify({
    schema: 'aegis.preflight_resolution.v2',
    executionId: confirmationId,
    decisionDigest: confirmationId,
    preflightPromptDigest: confirmationId,
    confirmation: {
      channel: 'IDE_NATIVE_SELECTOR',
      confirmationId,
      selectedAtEpochMs: Date.now(),
    },
    answers,
  }, null, 2)}\n`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, payload, 'utf8');
}

function resume(root) {
  return new Promise((resolve, reject) => {
    const child = spawn('./aegis', ['approve'], { cwd: root.fsPath, shell: false });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `aegis_approve_failed:${code}`)));
  });
}

let isPrompting = false;

function logWizard(msg) {
  try {
    fs.appendFileSync('/tmp/aegis-wizard.log', `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

async function presentPending() {
  const root = workspaceRoot();
  if (root === undefined) return;

  const request = readRequest(root);
  if (request === undefined) return;

  if (isPrompting) return;
  if (isAlreadyResolved(root, request)) return;

  isPrompting = true;
  logWizard(`presentPending: initiating confirmation for ${request.executionId}`);
  try {
    const answers = [];
    for (const question of request.questions) {
      const answer = await choose(question);
      if (answer === undefined) {
        logWizard(`presentPending: user cancelled question ${question.id}`);
        return;
      }
      answers.push(answer);
    }
    logWizard('presentPending: writing resolution');
    await writeResolution(root, request, answers);
    logWizard('presentPending: resuming ./aegis approve');
    await resume(root);
    logWizard('presentPending: approved successfully');
  } catch (error) {
    logWizard(`presentPending: error ${error.message}`);
    await vscode.window.showErrorMessage(`Aegis não retomou a confirmação: ${error.message}`);
  } finally {
    isPrompting = false;
  }
}

function activate(context) {
  logWizard('activate: wizard extension active');
  const root = workspaceRoot();
  if (root === undefined) return;

  // 1. VSCode File System Watcher
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/' + path.basename(requestRelPath)));
  context.subscriptions.push(watcher, watcher.onDidCreate(presentPending), watcher.onDidChange(presentPending));

  // 2. Node.js native fs.watch on .harness (survives rm -rf .harness/runtime)
  try {
    const harnessDir = path.join(root.fsPath, '.harness');
    if (fs.existsSync(harnessDir)) {
      const fsWatcher = fs.watch(harnessDir, { recursive: true }, (_eventType, filename) => {
        if (filename && filename.includes('user_confirmation_request.json')) {
          void presentPending();
        }
      });
      context.subscriptions.push({ dispose: () => fsWatcher.close() });
    }
  } catch {}

  // 3. Polling check every 1.0 second (guaranteed fallback)
  const interval = setInterval(() => {
    void presentPending();
  }, 1000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  context.subscriptions.push(vscode.commands.registerCommand('aegisWizard.check', presentPending));
  void presentPending();
}

function deactivate() {}

module.exports = { activate, deactivate };
