// Package clickhouse persists the score time series so the frontend can render
// sparklines and the backtest can replay history.
package clickhouse

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

// ScoreRow is one time-series datapoint per asset per update.
type ScoreRow struct {
	Timestamp         time.Time
	Mint              string
	Symbol            string
	Score             uint8
	PremiumBps        int32
	LiquidityDepthUSD uint64
	MintBurnZ         int32
	PriceComponent    float64
	LiquidityComp     float64
	ProcurementComp   float64
	TrustTierComp     float64
}

// DDL is the table definition. Applied by Connect().
const DDL = `
CREATE TABLE IF NOT EXISTS asset_scores (
    ts               DateTime64(3, 'UTC'),
    mint             String,
    symbol           String,
    score            UInt8,
    premium_bps      Int32,
    liquidity_usd    UInt64,
    mint_burn_z      Int32,
    price_comp       Float64,
    liquidity_comp   Float64,
    procurement_comp Float64,
    trust_comp       Float64
) ENGINE = MergeTree
ORDER BY (mint, ts)`

const insertStmt = `INSERT INTO asset_scores`

// Writer appends score rows to ClickHouse. A nil/empty DSN yields a no-op
// writer so the indexer still runs without a configured ClickHouse.
type Writer struct {
	dsn string

	mu      sync.Mutex
	conn    driver.Conn
	enabled bool
}

func NewWriter(dsn string) *Writer {
	return &Writer{dsn: dsn, enabled: dsn != ""}
}

// Connect opens the connection, pings it, and ensures the table exists.
// Safe to call once at startup; no-op if no DSN was configured.
func (w *Writer) Connect(ctx context.Context) error {
	if !w.enabled {
		return nil
	}
	opts, err := clickhouse.ParseDSN(w.dsn)
	if err != nil {
		return fmt.Errorf("parse DSN: %w", err)
	}
	conn, err := clickhouse.Open(opts)
	if err != nil {
		return fmt.Errorf("open: %w", err)
	}
	if err := conn.Ping(ctx); err != nil {
		return fmt.Errorf("ping: %w", err)
	}
	if err := conn.Exec(ctx, DDL); err != nil {
		return fmt.Errorf("create table: %w", err)
	}

	w.mu.Lock()
	w.conn = conn
	w.mu.Unlock()
	return nil
}

// Write appends a single score observation. No-op if ClickHouse is disabled or
// not yet connected (so a transient outage doesn't crash the engine).
func (w *Writer) Write(ctx context.Context, row ScoreRow) error {
	w.mu.Lock()
	conn := w.conn
	w.mu.Unlock()
	if !w.enabled || conn == nil {
		return nil
	}

	batch, err := conn.PrepareBatch(ctx, insertStmt)
	if err != nil {
		return fmt.Errorf("prepare batch: %w", err)
	}
	// Column order must match the DDL above.
	if err := batch.Append(
		row.Timestamp,
		row.Mint,
		row.Symbol,
		row.Score,
		row.PremiumBps,
		row.LiquidityDepthUSD,
		row.MintBurnZ,
		row.PriceComponent,
		row.LiquidityComp,
		row.ProcurementComp,
		row.TrustTierComp,
	); err != nil {
		return fmt.Errorf("append: %w", err)
	}
	return batch.Send()
}

// Close releases the connection.
func (w *Writer) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.conn != nil {
		return w.conn.Close()
	}
	return nil
}
