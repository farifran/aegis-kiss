import { log } from './field_lifecycle/shared.mjs';
import { runStateAndInventoryTests } from './field_lifecycle/state_and_inventory.mjs';
import { runTotalityAndClosureTests } from './field_lifecycle/totality_and_closure.mjs';
import { runProvenanceAndDiscoveryTests } from './field_lifecycle/provenance_and_discovery.mjs';

log('[CTDD TEST] Starting Field Lifecycle & Closure Certificate traps test suite...');
await runStateAndInventoryTests();
await runTotalityAndClosureTests();
await runProvenanceAndDiscoveryTests();
log('[CTDD TEST] Structural Field Lifecycle, Closure Certificate & Gap Ledger tests passed!');
