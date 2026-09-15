// Package prestocks reads PreStocks' published marks for its private-company
// tokens (SpaceX, OpenAI, Anthropic, …).
//
// RESEARCH FINDING (2026-09): the companies behind PreStocks tokens are private,
// so no oracle (Pyth, Jupiter stockData) prices the underlying share. PreStocks
// publishes one unauthenticated list at /api/prestocks carrying, per token, the
// mint (contract_address) and a markPrice: the issuer's own valuation of one
// underlying share, derived from secondary-market rounds. That is the only
// reference that exists, so the indexer uses it for the premium signal.
//
// CAVEAT: markPrice is the issuer valuing its own SPV exposure, not an
// independent market price. A token trading under its mark means holders can't
// realize the value the issuer claims, which is exactly what the premium
// signal should surface, but a stale or generous mark would read as a discount
// too. Sources must be labeled accordingly wherever the premium is shown.
package prestocks

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// DefaultURL is PreStocks' public token list.
const DefaultURL = "https://prestocks.com/api/prestocks"

// Mark is one token's entry from the PreStocks list.
type Mark struct {
	Symbol string
	Mint   string
	// MarkPrice is PreStocks' valuation of one underlying share, in USD.
	MarkPrice float64
	// TokenPrice is PreStocks' own reading of the token's traded price.
	TokenPrice float64
	Supply     float64
}

// Client fetches the PreStocks list.
type Client struct {
	url  string
	http *http.Client
}

// New returns a client for the list at url (DefaultURL when empty).
func New(url string) *Client {
	if url == "" {
		url = DefaultURL
	}
	return &Client{url: url, http: &http.Client{Timeout: 15 * time.Second}}
}

type entry struct {
	Symbol          string  `json:"symbol"`
	ContractAddress string  `json:"contract_address"`
	MarkPrice       float64 `json:"markPrice"`
	TokenPrice      float64 `json:"tokenPrice"`
	Supply          float64 `json:"supply"`
}

// Marks returns every listed token keyed by mint. Entries without a mint or a
// positive mark are dropped, so callers can treat presence as a usable price.
func (c *Client) Marks(ctx context.Context) (map[string]Mark, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "unwind-indexer")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("prestocks: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("prestocks: status %d", resp.StatusCode)
	}

	var list []entry
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return nil, fmt.Errorf("prestocks decode: %w", err)
	}
	out := make(map[string]Mark, len(list))
	for _, e := range list {
		if e.ContractAddress == "" || e.MarkPrice <= 0 {
			continue
		}
		out[e.ContractAddress] = Mark{
			Symbol:     e.Symbol,
			Mint:       e.ContractAddress,
			MarkPrice:  e.MarkPrice,
			TokenPrice: e.TokenPrice,
			Supply:     e.Supply,
		}
	}
	return out, nil
}
