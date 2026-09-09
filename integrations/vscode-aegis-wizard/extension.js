/* global Buffer, module, process, require */

const vscode = require('vscode');
const { spawn } = require('node:child_process');

const requestPath = '.harness/runtime/user_confirmation_request.json';
const resolutionPath = '.harness/runtime/preflight_resolution.json';
let activeConfirmationId;

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function validRequest(value) {
  return (value?.schema === 'aegis.preflight_finalization.v2' || value?.status === 'USER_CONFIRMATION_REQUIRED')
    && value.status === 'USER_CONFIRMATION_REQUIRED'
    && Array.isArray(value.questions)
    && value.questions.length > 0;
}

async function readRequest(root) {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, requestPath));
    const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return validRequest(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function isAlreadyResolved(root, request) {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, resolutionPath));
    const resolution = JSON.parse(Buffer.from(bytes).toString('utf8'));
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
  const target = vscode.Uri.joinPath(root, resolutionPath);
  const temporary = vscode.Uri.joinPath(root, `${resolutionPath}.${process.pid}.tmp`);
  const confirmationId = request.confirmation?.confirmationId || request.executionId || request.decisionDigest || 'aegis-conf';
  const payload = Buffer.from(`${JSON.stringify({
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
  }, null, 2)}\n`);
  await vscode.workspace.fs.writeFile(temporary, payload);
  await vscode.workspace.fs.rename(temporary, target, { overwrite: true });
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

async function presentPending() {
  const root = workspaceRoot();
  if (root === undefined) return;
  const request = await readRequest(root);
  const confirmationId = request?.confirmation?.confirmationId || request?.executionId || request?.decisionDigest;
  if (
    request === undefined
    || activeConfirmationId === confirmationId
    || await isAlreadyResolved(root, request)
  ) return;
  activeConfirmationId = confirmationId;
  const answers = [];
  for (const question of request.questions) {
    const answer = await choose(question);
    if (answer === undefined) {
      activeConfirmationId = undefined;
      return;
    }
    answers.push(answer);
  }
  try {
    await writeResolution(root, request, answers);
    await resume(root);
  } catch (error) {
    activeConfirmationId = undefined;
    await vscode.window.showErrorMessage(`Aegis não retomou a confirmação: ${error.message}`);
  }
}

function activate(context) {
  const root = workspaceRoot();
  if (root === undefined) return;
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, requestPath));
  context.subscriptions.push(watcher, watcher.onDidCreate(presentPending), watcher.onDidChange(presentPending));
  context.subscriptions.push(vscode.commands.registerCommand('aegisWizard.check', presentPending));
  void presentPending();
}

function deactivate() {}

module.exports = { activate, deactivate };
