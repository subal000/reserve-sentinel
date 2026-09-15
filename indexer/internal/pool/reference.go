package pool

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Reference price sourcing.
//
// RESEARCH FINDING (2026-09): Pyth's public Hermes host began requiring auth —
// https://hermes.pyth.network returns 401 on /v2/updates/price/latest and on
// /api/latest_price_feeds, and hermes-beta does the same. That killed the
// premium signal for every asset with a configured feed.
//
// Jupiter's price API v3 carries the underlying stock's price alongside the
// token's own, in one unauthenticated call, and covers every asset we track —
// including the Ondo/equity-feed ones Pyth was serving. So it stands in as the
// reference when Hermes is unavailable, which keeps the premium component
// alive without a paid key.
//
// This is a *reference* price only: the executable token price still comes from
// a real Jupiter quote (see ReadMarket), because on a thin market the quote and
// the quoted "price" are very different numbers, and the quote is the honest one.

// priceV3Entry is the subset of GET /price/v3 we consume.
type priceV3Entry struct {
	UsdPrice  float64 `json:"usdPrice"`
	Liquidity float64 `json:"liquidity"`
	// StockData is present for tokenized equities and carries the underlying
	// share price. Absent (nil) for ordinary SPL tokens.
	StockData *struct {
		Price     float64 `json:"price"`
		UpdatedAt string  `json:"updatedAt"`
	} `json:"stockData"`
}

// ReferencePricesUSD returns underlying stock prices for many mints in ONE
// call. Batching matters: /price/v3 takes a comma-separated id list, and doing
// it per-asset instead pushed the refresh loop over Jupiter's free-tier rate
// limit (observed 429s). Mints without a stock reference are simply absent from
// the returned map — callers must check presence, not a zero value.
func (r *Reader) ReferencePricesUSD(ctx context.Context, mints []string) (map[string]float64, error) {
	out := make(map[string]float64, len(mints))
	if len(mints) == 0 {
		return out, nil
	}
	r.throttle()
	endpoint := fmt.Sprintf("%s/price/v3?ids=%s", r.jupiterURL, strings.Join(mints, ","))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := r.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("jupiter price v3: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jupiter price v3 status %d", resp.StatusCode)
	}

	var body map[string]priceV3Entry
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("jupiter price v3 decode: %w", err)
	}
	for mint, e := range body {
		if e.StockData != nil && e.StockData.Price > 0 {
			out[mint] = e.StockData.Price
		}
	}
	return out, nil
}
