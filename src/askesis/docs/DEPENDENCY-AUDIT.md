# Dependency Audit: Vite advisory

Date: 2026-04-07

Resumo:

- O comando `npm audit` reportou uma vulnerabilidade de alta severidade em `vite` (7.0.0 - 7.3.1) que afeta o servidor de desenvolvimento. No projeto atual, a versão vulnerável aparece como dependência transitiva de `vitest` (ex.: `node_modules/vitest/node_modules/vite`).

Impacto:

- A vulnerabilidade permite path traversal / file read via dev server/WebSocket, o que representa risco apenas se o dev server estiver exposto a usuários não confiáveis (por exemplo em CI público sem isolamento ou em máquinas com portas encaminhadas).

Recomendações imediatas:

1. Investigar a árvore de dependências localmente: execute `npm ls vite --all` para ver exatamente quais pacotes estão trazendo `vite` e em que versões.
2. Verificar se há uma versão do `vitest` que dependa de uma versão corrigida de `vite`. Se disponível, atualizar `devDependencies` para essa versão e regenerar o lockfile.
3. Se não for possível atualizar upstream rapidamente, mitigar o risco operacionalmente: garantir que o dev server (Vite) não seja exposto publicamente em CI ou máquinas de desenvolvimento; aplicar regras de firewall/ACL; e manter o passo de guardrails em CI (warnings/monitoramento) ativo.
4. Como último recurso temporário, considerar `patch-package` para aplicar um hotfix em `node_modules/vitest/node_modules/vite` — isso é arriscado e deveria ser usado apenas como stopgap até a correção upstream.

Procedimento sugerido (local):

- ver onde vite aparece: `npm ls vite --all`
- verificar versão mais recente do vitest: `npm view vitest version`
- tentar atualizar vitest e regenerar lockfile: `npm install -D vitest@latest` ; `npm install` ; `npm audit fix`

Registro das ações neste repositório:

- Adicionado um script `scripts/check-vite.sh` e um script npm `check:deps` para facilitar investigação local.
- Não aplicar upgrades automaticamente sem rodar testes de integração; prefer abrir um branch com a atualização e validar em CI.

Contato/next steps:

- Se desejar, posso abrir um branch que atualize `vitest` e gerar um PR com as alterações e um plano de rollback, ou posso só orientar os comandos para você executar localmente.
