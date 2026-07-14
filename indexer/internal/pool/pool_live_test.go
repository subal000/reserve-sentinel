package pool

import (
	"context"
	"os"
	"testing"
	"time"
)

// Live test against real Jupiter + a mainnet RPC. Opt-in: RS_LIVE=1.
func TestReadMarketLive(t *testing.T) {
	if os.Getenv("RS_LIVE") != "1" {
		t.Skip("set RS_LIVE=1 to run live Jupiter test")
	}
	rpcURL := os.Getenv("SOLANA_RPC_URL")
	if rpcURL == "" {
		rpcURL = "https://api.mainnet-beta.solana.com"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	r := NewReader(rpcURL)
	// AAPLx mint.
	snap, err := r.ReadMarket(ctx, "jupiter", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp")
	if err != nil {
		t.Fatalf("ReadMarket: %v", err)
	}
	if snap.TokenPriceUSD <= 0 {
		t.Fatalf("expected positive price, got %v", snap.TokenPriceUSD)
	}
	t.Logf("AAPLx price=$%.2f  1%%-depth=$%d", snap.TokenPriceUSD, snap.DepthUSD)
}
