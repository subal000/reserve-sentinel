// Package pythpro reads prices from Pyth Pro (formerly Pyth Lazer).
//
// Why it exists: Pyth's public Hermes host went key-only in Sept 2026, which
// zeroed the premium signal. Pyth Pro is the authenticated successor, and it is
// the one source that carries all three prices this product compares for a
// tokenized stock: the real share (Equity.US.AAPL/USD), the xStocks token
// (Crypto.AAPLX/USD) and the Ondo token (Crypto.AAPLON/USD).
//
// Two behaviours observed against the live API drive the design:
//
//  1. Entitlement is per feed, and a single feed the key can't read fails the
//     whole batch with HTTP 403 ("Not entitled: feed 922 …"). So the client
//     learns which feeds the key can actually read, batches only those, and
//     re-probes the rest on an interval — access granted mid-run is picked up
//     without a restart.
//  2. Feeds are addressed by numeric id, but humans configure symbols. The
//     symbols endpoint (a ~5MB list) maps one to the other; it's fetched once.
package pythpro

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DefaultBaseURL    = "https://pyth-lazer.dourolabs.app"
	DefaultSymbolsURL = "https://history.pyth-lazer.dourolabs.app/history/v1/symbols"

	// recheckAfter is how long a feed stays marked not-entitled before it is
	// probed again.
	recheckAfter = 10 * time.Minute
)

// ErrNotEntitled means the API key has no grant covering the requested feed.
var ErrNotEntitled = errors.New("pyth pro: key not entitled to this feed")

// ErrUnknownSymbol means the symbol isn't in Pyth Pro's symbol list.
var ErrUnknownSymbol = errors.New("pyth pro: unknown symbol")

// Quote is one feed's latest price, already scaled by its exponent.
type Quote struct {
	Price      float64
	Confidence float64 // 0 when the feed doesn't publish it
	Publishers int
	UpdatedAt  time.Time
	// Session is the market session the price belongs to, e.g. "regular".
	// For US equities this is how off-hours prices are told apart.
	Session string
}

// Client is safe for concurrent use.
type Client struct {
	baseURL    string
	symbolsURL string
	apiKey     string
	http       *http.Client

	symOnce sync.Once
	symErr  error
	symbols map[string]uint32 // "Equity.US.AAPL/USD" -> 922

	mu          sync.Mutex
	notEntitled map[uint32]time.Time // feed -> when it was last refused
}

// New returns a client. An empty apiKey yields a client whose calls all fail
// fast, so callers can fall back without special-casing configuration.
func New(baseURL, symbolsURL, apiKey string) *Client {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	if symbolsURL == "" {
		symbolsURL = DefaultSymbolsURL
	}
	return &Client{
		baseURL:     strings.TrimRight(baseURL, "/"),
		symbolsURL:  symbolsURL,
		apiKey:      apiKey,
		http:        &http.Client{Timeout: 20 * time.Second},
		notEntitled: make(map[uint32]time.Time),
	}
}

// Enabled reports whether an API key is configured.
func (c *Client) Enabled() bool { return c != nil && c.apiKey != "" }

// Resolve maps a symbol like "Equity.US.AAPL/USD" to its Pyth Pro feed id.
func (c *Client) Resolve(ctx context.Context, symbol string) (uint32, error) {
	if !c.Enabled() {
		return 0, errors.New("pyth pro: no API key configured")
	}
	c.symOnce.Do(func() { c.symErr = c.loadSymbols(ctx) })
	if c.symErr != nil {
		return 0, c.symErr
	}
	id, ok := c.symbols[symbol]
	if !ok {
		return 0, fmt.Errorf("%w: %s", ErrUnknownSymbol, symbol)
	}
	return id, nil
}

func (c *Client) loadSymbols(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.symbolsURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("pyth pro symbols: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("pyth pro symbols: status %d", resp.StatusCode)
	}
	var rows []struct {
		ID     uint32 `json:"pyth_lazer_id"`
		Symbol string `json:"symbol"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return fmt.Errorf("pyth pro symbols decode: %w", err)
	}
	m := make(map[string]uint32, len(rows))
	for _, r := range rows {
		m[r.Symbol] = r.ID
	}
	c.symbols = m
	return nil
}

// Latest returns quotes for every requested feed the key is entitled to.
// Feeds it isn't entitled to are simply absent from the result — use
// Entitled to tell "not entitled" apart from "not published yet".
func (c *Client) Latest(ctx context.Context, ids []uint32) (map[uint32]Quote, error) {
	if !c.Enabled() {
		return nil, errors.New("pyth pro: no API key configured")
	}
	out := make(map[uint32]Quote, len(ids))

	// Split into feeds believed readable and feeds due a re-probe.
	var batch, probe []uint32
	now := time.Now()
	c.mu.Lock()
	for _, id := range dedupe(ids) {
		refused, known := c.notEntitled[id]
		switch {
		case !known:
			batch = append(batch, id)
		case now.Sub(refused) >= recheckAfter:
			probe = append(probe, id)
		}
	}
	c.mu.Unlock()

	if len(batch) > 0 {
		q, err := c.fetch(ctx, batch)
		switch {
		case err == nil:
			merge(out, q)
		case errors.Is(err, ErrNotEntitled):
			// One bad feed poisons the batch; find out which, one at a time.
			probe = append(probe, batch...)
		default:
			return out, err
		}
	}

	for _, id := range probe {
		q, err := c.fetch(ctx, []uint32{id})
		c.mu.Lock()
		if errors.Is(err, ErrNotEntitled) {
			c.notEntitled[id] = time.Now()
		} else if err == nil {
			delete(c.notEntitled, id)
		}
		c.mu.Unlock()
		if err == nil {
			merge(out, q)
		} else if !errors.Is(err, ErrNotEntitled) {
			return out, err
		}
	}
	return out, nil
}

// Entitled reports whether the key was last seen able to read the feed.
// Feeds never requested are reported as entitled (unknown yet).
func (c *Client) Entitled(id uint32) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, refused := c.notEntitled[id]
	return !refused
}

type latestRequest struct {
	PriceFeedIDs       []uint32 `json:"priceFeedIds"`
	Properties         []string `json:"properties"`
	Formats            []string `json:"formats"`
	Channel            string   `json:"channel"`
	Parsed             bool     `json:"parsed"`
	JSONBinaryEncoding string   `json:"jsonBinaryEncoding"`
}

type latestResponse struct {
	Parsed struct {
		PriceFeeds []struct {
			ID              uint32  `json:"priceFeedId"`
			Price           flexInt `json:"price"`
			Exponent        int     `json:"exponent"`
			Confidence      flexInt `json:"confidence"`
			PublisherCount  int     `json:"publisherCount"`
			FeedUpdateTimeU int64   `json:"feedUpdateTimestamp"`
			MarketSession   string  `json:"marketSession"`
		} `json:"priceFeeds"`
	} `json:"parsed"`
}

func (c *Client) fetch(ctx context.Context, ids []uint32) (map[uint32]Quote, error) {
	body, _ := json.Marshal(latestRequest{
		PriceFeedIDs:       ids,
		Properties:         []string{"price", "exponent", "confidence", "publisherCount", "feedUpdateTimestamp", "marketSession"},
		Formats:            []string{},
		Channel:            "fixed_rate@200ms",
		Parsed:             true,
		JSONBinaryEncoding: "hex",
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/latest_price", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("pyth pro request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusForbidden {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("%w (%s)", ErrNotEntitled, strings.TrimSpace(string(msg)))
	}
	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("pyth pro status %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}

	var lr latestResponse
	if err := json.NewDecoder(resp.Body).Decode(&lr); err != nil {
		return nil, fmt.Errorf("pyth pro decode: %w", err)
	}
	out := make(map[uint32]Quote, len(lr.Parsed.PriceFeeds))
	for _, f := range lr.Parsed.PriceFeeds {
		if !f.Price.set { // feed exists but has nothing published right now
			continue
		}
		scale := math.Pow10(f.Exponent)
		q := Quote{
			Price:      float64(f.Price.v) * scale,
			Publishers: f.PublisherCount,
			Session:    f.MarketSession,
		}
		if f.Confidence.set {
			q.Confidence = float64(f.Confidence.v) * scale
		}
		if f.FeedUpdateTimeU > 0 {
			q.UpdatedAt = time.UnixMicro(f.FeedUpdateTimeU)
		}
		out[f.ID] = q
	}
	return out, nil
}

// flexInt decodes an integer sent either as a JSON number or a numeric string.
// The live API does both in one object: "price" arrives as a string (it can
// exceed float64 precision) while "confidence" arrives as a number.
type flexInt struct {
	v   int64
	set bool
}

func (f *flexInt) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		return nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return fmt.Errorf("not an integer: %s", b)
	}
	f.v, f.set = v, true
	return nil
}

func dedupe(ids []uint32) []uint32 {
	seen := make(map[uint32]bool, len(ids))
	out := ids[:0:0]
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func merge(dst, src map[uint32]Quote) {
	for k, v := range src {
		dst[k] = v
	}
}
