// Package helius handles inbound Helius webhook events and extracts mint/burn
// activity for the tracked assets.
package helius

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
)

// Event is the normalized mint/burn signal we care about, distilled from
// whatever shape Helius sends.
type Event struct {
	Mint      string  // token mint address
	Kind      Kind    // Mint or Burn
	Amount    float64 // UI amount (decimals applied)
	Signature string  // tx signature, for dedupe/audit
	Timestamp int64   // unix seconds
}

type Kind string

const (
	KindMint Kind = "mint"
	KindBurn Kind = "burn"
)

// Handler processes decoded events. The scoring engine implements this.
type Handler interface {
	HandleMintBurn(ev Event)
}

// WebhookServer receives Helius POSTs, authenticates them, parses token
// transfer/mint events, and forwards normalized Events to the Handler.
type WebhookServer struct {
	secret  string
	handler Handler
	// tracked maps mint address -> true, so we ignore noise for untracked mints.
	tracked map[string]bool
}

func NewWebhookServer(secret string, handler Handler, trackedMints []string) *WebhookServer {
	tracked := make(map[string]bool, len(trackedMints))
	for _, m := range trackedMints {
		tracked[m] = true
	}
	return &WebhookServer{secret: secret, handler: handler, tracked: tracked}
}

// ServeHTTP implements http.Handler so it can mount on any mux/route.
func (s *WebhookServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Helius sends the configured auth header on each webhook. Constant-time
	// compare to avoid leaking the secret via timing.
	if s.secret != "" {
		got := r.Header.Get("Authorization")
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.secret)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20)) // 8 MiB cap
	if err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}

	events, err := s.parse(body)
	if err != nil {
		// Log but 200 anyway — a parse failure shouldn't make Helius retry forever.
		log.Printf("helius: parse error: %v", err)
		w.WriteHeader(http.StatusOK)
		return
	}

	for _, ev := range events {
		if !s.tracked[ev.Mint] {
			continue
		}
		s.handler.HandleMintBurn(ev)
	}

	w.WriteHeader(http.StatusOK)
}

// heliusTx is the subset of the Helius "Enhanced Transactions" webhook schema
// we need. The payload is a top-level JSON array of these.
type heliusTx struct {
	Signature   string `json:"signature"`
	Timestamp   int64  `json:"timestamp"`
	AccountData []struct {
		TokenBalanceChanges []struct {
			Mint           string `json:"mint"`
			RawTokenAmount struct {
				TokenAmount string `json:"tokenAmount"` // base units, signed
				Decimals    int    `json:"decimals"`
			} `json:"rawTokenAmount"`
		} `json:"tokenBalanceChanges"`
	} `json:"accountData"`
}

// parse converts a Helius enhanced-webhook payload into normalized Events.
//
// Rather than trust the payload's coarse `type` string, we sum the signed
// `tokenBalanceChanges` per mint across ALL accounts in each transaction. The
// net per-mint delta IS the supply change: a mint nets positive (created with
// no offsetting account), a burn nets negative, and a plain wallet-to-wallet
// transfer nets to ~zero (one account -X, another +X) and is correctly ignored.
// That net is exactly the mint/burn velocity signal the scoring engine wants.
func (s *WebhookServer) parse(body []byte) ([]Event, error) {
	var txs []heliusTx
	if err := json.Unmarshal(body, &txs); err != nil {
		return nil, err
	}

	var out []Event
	for _, tx := range txs {
		netByMint := make(map[string]float64)
		for _, ad := range tx.AccountData {
			for _, tbc := range ad.TokenBalanceChanges {
				raw, err := strconv.ParseFloat(tbc.RawTokenAmount.TokenAmount, 64)
				if err != nil {
					continue
				}
				ui := raw / math.Pow(10, float64(tbc.RawTokenAmount.Decimals))
				netByMint[tbc.Mint] += ui
			}
		}

		for mint, net := range netByMint {
			// Ignore dust / net-zero transfers.
			if math.Abs(net) < 1e-9 {
				continue
			}
			kind := KindMint
			amount := net
			if net < 0 {
				kind = KindBurn
				amount = -net
			}
			out = append(out, Event{
				Mint:      mint,
				Kind:      kind,
				Amount:    amount,
				Signature: tx.Signature,
				Timestamp: tx.Timestamp,
			})
		}
	}
	return out, nil
}
