#!/usr/bin/env bash
# Local dev: run a ClickHouse container and start the indexer writing the score
# time series into it (reading mainnet market data, writing scores to the
# devnet program). The frontend's sparklines read from this ClickHouse.
#
# Usage: ./scripts/dev_clickhouse.sh
# Stop ClickHouse later with: docker rm -f rs-clickhouse
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> starting ClickHouse (rs-clickhouse)"
docker rm -f rs-clickhouse >/dev/null 2>&1 || true
docker run -d --name rs-clickhouse \
  -p 8123:8123 -p 9000:9000 \
  -e CLICKHOUSE_USER=rs -e CLICKHOUSE_PASSWORD=rs -e CLICKHOUSE_DB=default \
  -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
  --ulimit nofile=262144:262144 \
  clickhouse/clickhouse-server:24.8 >/dev/null
for _ in $(seq 1 60); do
  [ "$(curl -s http://localhost:8123/ping 2>/dev/null)" = "Ok." ] && break || sleep 1
done
echo "    ClickHouse up on :8123 (http) / :9000 (native)"

echo "==> starting indexer (Ctrl-C to stop)"
cd "$ROOT/indexer"
SOLANA_RPC_URL=https://api.devnet.solana.com \
DATA_RPC_URL=https://api.mainnet-beta.solana.com \
AUTHORITY_KEYPAIR="$HOME/.config/solana/id.json" \
CLICKHOUSE_DSN="clickhouse://rs:rs@localhost:9000/default" \
REFRESH_SECS=60 \
  go run ./cmd/indexer --assets ../config/assets.json
