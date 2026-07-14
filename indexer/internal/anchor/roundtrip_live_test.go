package anchor

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/gagliardetto/solana-go"
)

// Full on-chain round-trip against a local validator with the program deployed.
// Opt-in and requires setup (see scripts / README):
//
//	RS_LOCALNET=1 \
//	LOCALNET_RPC=http://localhost:8899 \
//	PROGRAM_ID=<deployed id> \
//	AUTHORITY_KEYPAIR=<funded keypair> \
//	go test ./internal/anchor -run RoundTrip -v
func TestRoundTripLive(t *testing.T) {
	if os.Getenv("RS_LOCALNET") != "1" {
		t.Skip("set RS_LOCALNET=1 (needs a local validator + deployed program) to run")
	}
	rpcURL := envOr("LOCALNET_RPC", "http://localhost:8899")
	programID := envOr("PROGRAM_ID", "BVkkMMqDuFRgzNtwy9Uc87cJu574YDU6j4us9i7EYMba")
	keypairPath := os.Getenv("AUTHORITY_KEYPAIR")
	if keypairPath == "" {
		t.Fatal("AUTHORITY_KEYPAIR is required")
	}

	c := NewClient(rpcURL, programID, keypairPath)
	auth, err := solana.PrivateKeyFromSolanaKeygenFile(keypairPath)
	if err != nil {
		t.Fatalf("load authority: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	// Fresh random "mint" pubkey — initialize_asset treats it as an unchecked
	// seed, so it need not be a real mint for this lifecycle test.
	mintKp, _ := solana.NewRandomPrivateKey()
	mint := mintKp.PublicKey().String()

	// 1) initialize_asset (payer == authority for the test).
	var ticker [8]byte
	copy(ticker[:], "CRCL    ")
	sig, err := c.InitializeAsset(ctx, auth, mint, 1 /*Ondo*/, ticker, 3 /*tier*/, auth.PublicKey())
	if err != nil {
		t.Fatalf("InitializeAsset: %v", err)
	}
	t.Logf("initialize_asset sig=%s", sig)

	// wait for the account to exist
	acct := waitForAccount(ctx, t, c, mint, func(a *AssetScore) bool { return true })
	if acct.Issuer != 1 || acct.TrustTier != 3 || acct.Ticker() != "CRCL" {
		t.Fatalf("init state wrong: issuer=%d tier=%d ticker=%q", acct.Issuer, acct.TrustTier, acct.Ticker())
	}
	if !acct.Authority.Equals(auth.PublicKey()) {
		t.Fatalf("authority mismatch: %s", acct.Authority)
	}
	if acct.Score != 0 || acct.LastUpdated != 0 {
		t.Fatalf("expected zeroed score fields after init, got score=%d ts=%d", acct.Score, acct.LastUpdated)
	}

	// 2) update_score.
	sig, err = c.UpdateScore(ctx, ScoreUpdate{
		Mint: mint, Score: 72, PremiumBps: -85, LiquidityDepthUSD: 1_250_000, MintBurnZ: 240,
	})
	if err != nil {
		t.Fatalf("UpdateScore: %v", err)
	}
	t.Logf("update_score sig=%s", sig)

	// 3) read back and assert.
	acct = waitForAccount(ctx, t, c, mint, func(a *AssetScore) bool { return a.Score == 72 })
	if acct.Score != 72 || acct.PremiumBps != -85 || acct.LiquidityDepthUSD != 1_250_000 || acct.MintBurnZ != 240 {
		t.Fatalf("update state wrong: %+v", acct)
	}
	if acct.LastUpdated == 0 {
		t.Fatalf("expected non-zero last_updated after update")
	}
	t.Logf("round-trip OK: score=%d premium=%d depth=%d z=%d ts=%d",
		acct.Score, acct.PremiumBps, acct.LiquidityDepthUSD, acct.MintBurnZ, acct.LastUpdated)
}

func waitForAccount(ctx context.Context, t *testing.T, c *Client, mint string, pred func(*AssetScore) bool) *AssetScore {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		a, err := c.ReadAssetScore(ctx, mint)
		if err == nil && pred(a) {
			return a
		}
		if time.Now().After(deadline) {
			t.Fatalf("waitForAccount timed out (lastErr=%v)", err)
		}
		time.Sleep(1 * time.Second)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
