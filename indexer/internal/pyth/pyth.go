// Package pyth fetches the reference price for each tracked asset's underlying
// equity from Pyth.
//
// RESEARCH FINDING (2026-07): Pyth publishes NO sponsored on-chain price
// accounts for US equities on Solana mainnet, so there is no fresh account to
// read directly. We therefore use the PULL model: fetch the latest price from
// the Hermes HTTP API keyed by feed ID. For the tokenized xStocks there are
// 24/7 `Crypto.<T>X/USD` feeds; for the rest, market-hours `Equity.US.<T>/USD`
// feeds (whose confidence widens sharply when US markets are closed).
package pyth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// ErrNoFeed means the asset has no reference feed (e.g. SPCX — SpaceX private).
var ErrNoFeed = errors.New("pyth: no reference feed for asset")

// Price is a single reference-price observation.
type Price struct {
	Price       float64 // equity price in USD (Pyth exponent applied)
	Conf        float64 // confidence interval in USD; wide => stale/uncertain
	PublishTime int64   // feed publish unix timestamp (staleness check)
}

// ConfRatio is conf/price — a cheap "how trustworthy" gauge. US-equity feeds
// blow this out when markets are closed.
func (p Price) ConfRatio() float64 {
	if p.Price == 0 {
		return math.Inf(1)
	}
	return p.Conf / math.Abs(p.Price)
}

// AgeSecs is how stale the observation is relative to now.
func (p Price) AgeSecs(now int64) int64 { return now - p.PublishTime }

// Client pulls prices from Hermes.
type Client struct {
	hermesURL string
	http      *http.Client
}

// NewClient takes the Hermes base URL, e.g. "https://hermes.pyth.network".
func NewClient(hermesURL string) *Client {
	if hermesURL == "" {
		hermesURL = "https://hermes.pyth.network"
	}
	return &Client{
		hermesURL: hermesURL,
		http:      &http.Client{Timeout: 15 * time.Second},
	}
}

// hermesResponse mirrors GET /v2/updates/price/latest.
type hermesResponse struct {
	Parsed []struct {
		ID    string `json:"id"`
		Price struct {
			Price       string `json:"price"`
			Conf        string `json:"conf"`
			Expo        int    `json:"expo"`
			PublishTime int64  `json:"publish_time"`
		} `json:"price"`
	} `json:"parsed"`
}

// GetPrice fetches the latest price for a Hermes feed ID (0x… hex accepted).
func (c *Client) GetPrice(ctx context.Context, feedID string) (Price, error) {
	if feedID == "" {
		return Price{}, ErrNoFeed
	}

	endpoint := fmt.Sprintf("%s/v2/updates/price/latest", c.hermesURL)
	q := url.Values{}
	q.Add("ids[]", feedID)
	q.Set("encoding", "hex")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+q.Encode(), nil)
	if err != nil {
		return Price{}, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return Price{}, fmt.Errorf("hermes request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("hermes status %d", resp.StatusCode)
	}

	var hr hermesResponse
	if err := json.NewDecoder(resp.Body).Decode(&hr); err != nil {
		return Price{}, fmt.Errorf("hermes decode: %w", err)
	}
	if len(hr.Parsed) == 0 {
		return Price{}, fmt.Errorf("hermes: no feed returned for %s", feedID)
	}

	p := hr.Parsed[0].Price
	priceI, err := strconv.ParseInt(p.Price, 10, 64)
	if err != nil {
		return Price{}, fmt.Errorf("parse price: %w", err)
	}
	confI, err := strconv.ParseInt(p.Conf, 10, 64)
	if err != nil {
		return Price{}, fmt.Errorf("parse conf: %w", err)
	}

	scale := math.Pow(10, float64(p.Expo)) // expo is negative, e.g. -5
	return Price{
		Price:       float64(priceI) * scale,
		Conf:        float64(confI) * scale,
		PublishTime: p.PublishTime,
	}, nil
}

// PremiumBps computes the signed premium of the on-chain token price vs the
// Pyth reference, in basis points. Positive => token trades above the stock.
func PremiumBps(tokenPriceUSD, referencePriceUSD float64) int32 {
	if referencePriceUSD <= 0 {
		return 0
	}
	return int32((tokenPriceUSD - referencePriceUSD) / referencePriceUSD * 10_000)
}
