// Package config loads the shared asset registry (config/assets.json) and
// runtime settings from the environment. Both the indexer and (indirectly) the
// init script consume the same JSON, so the shapes here mirror assets.json.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Issuer codes must match the on-chain AssetScore.issuer encoding.
const (
	IssuerXStocks         uint8 = 0
	IssuerOndo            uint8 = 1
	IssuerBackpackSunrise uint8 = 2
	IssuerOther           uint8 = 3
)

// Asset is one tracked tokenized-stock, as declared in config/assets.json.
type Asset struct {
	Symbol           string `json:"symbol"`
	Mint             string `json:"mint"`
	Issuer           uint8  `json:"issuer"`
	IssuerName       string `json:"issuer_name"`
	UnderlyingTicker string `json:"underlying_ticker"`
	TrustTier        uint8  `json:"trust_tier"`
	// PythFeedID is the Hermes feed id (0x… hex). Empty means no reference price
	// exists (e.g. SPCX — SpaceX is private), so the premium component is skipped.
	PythFeedID string `json:"pyth_feed_id"`
	// PythFeedKind is "xstock_crypto" (24/7), "equity" (US market hours), or "none".
	PythFeedKind string `json:"pyth_feed_kind"`
	// PrimaryDex selects the liquidity data path; "jupiter" derives price + 1%
	// depth from Jupiter quotes keyed by Mint (no single pool address needed).
	PrimaryDex string `json:"primary_dex"`
	Notes      string `json:"notes"`
}

// HasPriceFeed reports whether a usable reference price feed is configured.
func (a Asset) HasPriceFeed() bool {
	return a.PythFeedID != "" && a.PythFeedKind != "none"
}

// TickerBytes returns the underlying ticker right-padded to the on-chain
// [u8; 8] layout. Errors if the ticker is longer than 8 bytes.
func (a Asset) TickerBytes() ([8]byte, error) {
	var out [8]byte
	t := strings.ToUpper(a.UnderlyingTicker)
	if len(t) > 8 {
		return out, fmt.Errorf("ticker %q exceeds 8 bytes", t)
	}
	copy(out[:], t)
	for i := len(t); i < 8; i++ {
		out[i] = ' '
	}
	return out, nil
}

// HasTODO reports whether any required field still carries a placeholder.
// The indexer uses this to skip (with a warning) assets that aren't ready.
// A null/empty PythFeedID is NOT a TODO — it's a valid "no reference" state.
func (a Asset) HasTODO() bool {
	for _, v := range []string{a.Mint, a.PythFeedID, a.PrimaryDex, a.Symbol, a.UnderlyingTicker} {
		if strings.HasPrefix(v, "TODO") {
			return true
		}
	}
	return false
}

// AssetRegistry is the top-level shape of config/assets.json.
type AssetRegistry struct {
	Cluster string  `json:"cluster"`
	Assets  []Asset `json:"assets"`
}

// Config is the fully-resolved runtime configuration.
type Config struct {
	// RPCURL is the cluster where the PROGRAM lives and where scores are WRITTEN
	// and mints verified (mainnet in production; devnet for the staging demo).
	RPCURL string
	// DataRPCURL reads token market data (pool decimals). Always a mainnet RPC,
	// since that's where the real mints/liquidity live. Defaults to RPCURL.
	DataRPCURL string
	// HermesURL is the Pyth Hermes base URL for pull-model price fetches.
	HermesURL string
	// HeliusWebhookSecret authenticates inbound webhook POSTs (optional but recommended).
	HeliusWebhookSecret string
	// ListenAddr is where the webhook HTTP server binds, e.g. ":8080".
	ListenAddr string
	// AuthorityKeypairPath is the backend hot keypair permitted to call update_score.
	AuthorityKeypairPath string
	// ProgramID is the deployed reserve_sentinel program ID.
	ProgramID string
	// ClickHouse connection settings.
	ClickHouseDSN string
	// Registry is the parsed asset list.
	Registry AssetRegistry
	// ScoreChangeThreshold: only push on-chain if |new-old| score exceeds this.
	ScoreChangeThreshold uint8
	// RefreshIntervalSecs: ticker cadence for price+liquidity refresh.
	RefreshIntervalSecs int
}

// Load reads assets.json from assetsPath and overlays environment variables.
func Load(assetsPath string) (*Config, error) {
	raw, err := os.ReadFile(assetsPath)
	if err != nil {
		return nil, fmt.Errorf("read assets.json: %w", err)
	}

	var reg AssetRegistry
	if err := json.Unmarshal(raw, &reg); err != nil {
		return nil, fmt.Errorf("parse assets.json: %w", err)
	}
	if len(reg.Assets) == 0 {
		return nil, fmt.Errorf("assets.json contains no assets")
	}

	cfg := &Config{
		RPCURL:               envOr("SOLANA_RPC_URL", ""),
		DataRPCURL:           envOr("DATA_RPC_URL", envOr("SOLANA_RPC_URL", "")),
		HermesURL:            envOr("HERMES_URL", "https://hermes.pyth.network"),
		HeliusWebhookSecret:  envOr("HELIUS_WEBHOOK_SECRET", ""),
		ListenAddr:           envOr("LISTEN_ADDR", ":8080"),
		AuthorityKeypairPath: envOr("AUTHORITY_KEYPAIR", ""),
		ProgramID:            envOr("PROGRAM_ID", "BVkkMMqDuFRgzNtwy9Uc87cJu574YDU6j4us9i7EYMba"),
		ClickHouseDSN:        envOr("CLICKHOUSE_DSN", ""),
		Registry:             reg,
		ScoreChangeThreshold: 2,
		RefreshIntervalSecs:  envInt("REFRESH_SECS", 60),
	}

	if cfg.RPCURL == "" {
		return nil, fmt.Errorf("SOLANA_RPC_URL is required")
	}
	return cfg, nil
}

func envOr(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}
