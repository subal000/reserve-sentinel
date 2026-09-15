package pythpro

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// fakeLazer mimics the live API: any batch containing a feed not in `allowed`
// is refused with 403, exactly as observed against pyth-lazer.dourolabs.app.
func fakeLazer(t *testing.T, allowed map[uint32]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/symbols":
			fmt.Fprint(w, `[{"pyth_lazer_id":922,"symbol":"Equity.US.AAPL/USD"},{"pyth_lazer_id":1792,"symbol":"Crypto.AAPLX/USD"}]`)
		case "/v1/latest_price":
			var req latestRequest
			b, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(b, &req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			var feeds []string
			for _, id := range req.PriceFeedIDs {
				price, ok := allowed[id]
				if !ok {
					w.WriteHeader(http.StatusForbidden)
					fmt.Fprintf(w, "Not entitled: feed %d", id)
					return
				}
				feeds = append(feeds, fmt.Sprintf(`{"priceFeedId":%d,"price":"%s","exponent":-5,"confidence":2000,"publisherCount":7,"feedUpdateTimestamp":1789500999000000,"marketSession":"regular"}`, id, price))
			}
			fmt.Fprintf(w, `{"parsed":{"priceFeeds":[%s]}}`, strings.Join(feeds, ","))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestLatestScalesExponentAndParsesFields(t *testing.T) {
	srv := fakeLazer(t, map[uint32]string{922: "32806000"})
	defer srv.Close()
	c := New(srv.URL, srv.URL+"/symbols", "test-key")

	q, err := c.Latest(context.Background(), []uint32{922})
	if err != nil {
		t.Fatal(err)
	}
	got := q[922]
	if got.Price != 328.06 || got.Confidence != 0.02 || got.Publishers != 7 || got.Session != "regular" || got.UpdatedAt.IsZero() {
		t.Fatalf("unexpected quote: %+v", got)
	}
}

func TestOneUnentitledFeedDoesNotHideTheOthers(t *testing.T) {
	// 922 readable, 1792 not: the combined request 403s, but 922 must still come back.
	srv := fakeLazer(t, map[uint32]string{922: "32806000"})
	defer srv.Close()
	c := New(srv.URL, srv.URL+"/symbols", "test-key")

	q, err := c.Latest(context.Background(), []uint32{922, 1792})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := q[922]; !ok {
		t.Fatal("entitled feed was dropped because a sibling feed was refused")
	}
	if _, ok := q[1792]; ok {
		t.Fatal("un-entitled feed should be absent")
	}
	if c.Entitled(1792) || !c.Entitled(922) {
		t.Fatal("entitlement not recorded correctly")
	}
}

func TestResolveSymbol(t *testing.T) {
	srv := fakeLazer(t, nil)
	defer srv.Close()
	c := New(srv.URL, srv.URL+"/symbols", "test-key")

	if id, err := c.Resolve(context.Background(), "Crypto.AAPLX/USD"); err != nil || id != 1792 {
		t.Fatalf("got %d, %v", id, err)
	}
	if _, err := c.Resolve(context.Background(), "Equity.US.NOPE/USD"); err == nil {
		t.Fatal("expected unknown symbol error")
	}
}

func TestNoKeyFailsFast(t *testing.T) {
	c := New("", "", "")
	if c.Enabled() {
		t.Fatal("client without key must report disabled")
	}
	if _, err := c.Latest(context.Background(), []uint32{1}); err == nil {
		t.Fatal("expected error without key")
	}
}

// TestLiveBTC hits the real API with the key's baseline entitlement.
// Run with: PYTH_PRO_API_KEY=… go test ./internal/pythpro -run Live -v
func TestLiveBTC(t *testing.T) {
	key := os.Getenv("PYTH_PRO_API_KEY")
	if key == "" {
		t.Skip("PYTH_PRO_API_KEY not set")
	}
	c := New("", "", key)
	ctx := context.Background()
	id, err := c.Resolve(ctx, "Crypto.BTC/USD")
	if err != nil {
		t.Fatal(err)
	}
	stock, _ := c.Resolve(ctx, "Equity.US.AAPL/USD")
	q, err := c.Latest(ctx, []uint32{id, stock})
	if err != nil {
		t.Fatal(err)
	}
	btc, ok := q[id]
	if !ok || btc.Price < 1000 {
		t.Fatalf("expected a BTC price, got %+v", q)
	}
	t.Logf("BTC/USD %.2f (%s, %d publishers)", btc.Price, btc.Session, btc.Publishers)
	t.Logf("Equity.US.AAPL/USD entitled: %v", c.Entitled(stock))
}
