# Aegis Wizard for VS Code

This optional adapter is intentionally outside the Aegis core. It observes
only `.harness/runtime/user_confirmation_request.json`, opens native VS Code
Quick Picks, writes the signed selection into transient runtime state, and
executes `./aegis resume` without a shell.

To run it during development, open this directory in VS Code and start the
extension host with **Run Extension**. To install it locally, package this
folder as a VSIX with the VS Code extension tooling, install the VSIX, then
reload the Aegis workspace.

After activation, use **Aegis: Check Pending Confirmation** if a request was
created before the adapter started.
