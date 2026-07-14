package helius

import "testing"

// sample mirrors a Helius enhanced payload: a mint (+1000), a burn (-500 across
// the burn accounting), and a plain transfer that nets to zero for its mint.
const sample = `[
  {
    "signature": "sigMint",
    "timestamp": 1700000000,
    "accountData": [
      {"tokenBalanceChanges": [
        {"mint": "MINTED", "rawTokenAmount": {"tokenAmount": "1000000000", "decimals": 6}}
      ]}
    ]
  },
  {
    "signature": "sigBurn",
    "timestamp": 1700000001,
    "accountData": [
      {"tokenBalanceChanges": [
        {"mint": "BURNED", "rawTokenAmount": {"tokenAmount": "-500000000", "decimals": 6}}
      ]}
    ]
  },
  {
    "signature": "sigTransfer",
    "timestamp": 1700000002,
    "accountData": [
      {"tokenBalanceChanges": [
        {"mint": "XFER", "rawTokenAmount": {"tokenAmount": "-250000000", "decimals": 6}}
      ]},
      {"tokenBalanceChanges": [
        {"mint": "XFER", "rawTokenAmount": {"tokenAmount": "250000000", "decimals": 6}}
      ]}
    ]
  }
]`

func TestParse(t *testing.T) {
	s := &WebhookServer{}
	events, err := s.parse([]byte(sample))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 events (mint+burn, transfer nets to zero), got %d: %+v", len(events), events)
	}

	byMint := map[string]Event{}
	for _, e := range events {
		byMint[e.Mint] = e
	}

	if m := byMint["MINTED"]; m.Kind != KindMint || m.Amount != 1000 {
		t.Fatalf("MINTED: got kind=%s amount=%v", m.Kind, m.Amount)
	}
	if b := byMint["BURNED"]; b.Kind != KindBurn || b.Amount != 500 {
		t.Fatalf("BURNED: got kind=%s amount=%v", b.Kind, b.Amount)
	}
	if _, ok := byMint["XFER"]; ok {
		t.Fatalf("XFER should net to zero and be ignored")
	}
}
