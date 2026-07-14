package pyth

import (
	"context"
	"os"
	"testing"
	"time"
)

// Live test against the real Hermes API. Opt-in: RS_LIVE=1 go test ./...
func TestGetPriceLive(t *testing.T) {
	if os.Getenv("RS_LIVE") != "1" {
		t.Skip("set RS_LIVE=1 to run live Hermes test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	c := NewClient("")
	// AAPL equity feed id.
	p, err := c.GetPrice(ctx, "0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688")
	if err != nil {
		t.Fatalf("GetPrice: %v", err)
	}
	if p.Price <= 0 {
		t.Fatalf("expected positive price, got %v", p.Price)
	}
	t.Logf("AAPL reference price=$%.2f conf=$%.4f confRatio=%.5f publishTime=%d",
		p.Price, p.Conf, p.ConfRatio(), p.PublishTime)
}
