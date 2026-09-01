#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"
TEST_BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${TEST_BUILD_DIR}"' EXIT
./node_modules/.bin/tsc src/tokenBucket.ts src/clearingHouse.ts --outDir "${TEST_BUILD_DIR}" --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck

AEGIS_UAAM_BUILD="${TEST_BUILD_DIR}" node --input-type=module -e '
const { ClearingHouse } = await import(`file://${process.env.AEGIS_UAAM_BUILD}/clearingHouse.js`);
const { TokenBucket } = await import(`file://${process.env.AEGIS_UAAM_BUILD}/tokenBucket.js`);

const assert = (condition, message) => { if (!condition) throw new Error(message); };

const house = new ClearingHouse();
house.registerAccount("sender", 100n, 100n, 0);
house.registerAccount("receiver", 0n, 100n, 0);
const sender = house._accounts.get("sender");
const receiver = house._accounts.get("receiver");
assert(sender && receiver, "test accounts were not registered");
const beforeSender = sender.balance;
const beforeReceiver = receiver.balance;
const beforeBucket = sender.bucket.snapshot();
sender.bucket.consume = () => false;
const result = house.processBatch([{ id: "order-1", senderId: "sender", receiverId: "receiver", amount: 10n, fee: 0n }], beforeBucket.lastUpdateMs);
assert(result.rolledBack === true, "partial commit was not aborted");
assert(sender.balance === beforeSender && receiver.balance === beforeReceiver, "account balances leaked across abort");
const afterBucket = sender.bucket.snapshot();
assert(afterBucket.tokens === beforeBucket.tokens && afterBucket.lastUpdateMs === beforeBucket.lastUpdateMs, "bucket state leaked across abort");

const reject = new TokenBucket(10n, 1, "monotonic_reject");
const t1 = reject.lastUpdateMs;
reject.update(t1 + 1n);
let rejected = false;
try { reject.update(t1); } catch { rejected = true; }
assert(rejected, "monotonic_reject accepted a backwards clock");

const clamp = new TokenBucket(10n, 1, "monotonic_clamp");
const t2 = clamp.lastUpdateMs;
clamp.update(t2 + 1n);
clamp.update(t2);
assert(clamp.lastUpdateMs === t2 + 1n, "monotonic_clamp allowed temporal regression");

console.log("[AEGIS][TEST] uaam_runtime: PASS");
' 
