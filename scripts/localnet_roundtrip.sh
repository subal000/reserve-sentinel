#!/usr/bin/env bash
# Runs the full on-chain round-trip of the Go update_score sender against a
# fresh local validator:
#   start validator -> deploy program -> fund authority -> Go init+update+read.
#
# Usage: ./scripts/localnet_roundtrip.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="http://localhost:8899"
LEDGER="/tmp/rs-ledger"
AUTH_KP="/tmp/rs-authority.json"
PROGRAM_ID="$(solana address -k "$ROOT/target/deploy/reserve_sentinel-keypair.json")"

cleanup() { pkill -f "solana-test-validator --ledger $LEDGER" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> building program"
( cd "$ROOT" && anchor build --no-idl >/dev/null )

echo "==> starting validator"
pkill -f solana-test-validator 2>/dev/null || true; sleep 1
rm -rf "$LEDGER"
solana-test-validator --reset --ledger "$LEDGER" --quiet &
for i in $(seq 1 30); do
  solana cluster-version --url "$URL" >/dev/null 2>&1 && break || sleep 1
done

echo "==> airdrop + deploy ($PROGRAM_ID)"
solana airdrop 100 --url "$URL" >/dev/null
solana program deploy "$ROOT/target/deploy/reserve_sentinel.so" \
  --program-id "$ROOT/target/deploy/reserve_sentinel-keypair.json" --url "$URL"

echo "==> fund authority"
solana-keygen new --no-bip39-passphrase --force --silent -o "$AUTH_KP"
solana airdrop 10 "$(solana address -k "$AUTH_KP")" --url "$URL" >/dev/null

echo "==> running Go round-trip test"
cd "$ROOT/indexer"
RS_LOCALNET=1 LOCALNET_RPC="$URL" PROGRAM_ID="$PROGRAM_ID" AUTHORITY_KEYPAIR="$AUTH_KP" \
  go test ./internal/anchor -run RoundTrip -v
