package prestocks

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestMarksKeyedByMint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `[
			{"symbol":"SPACEX","contract_address":"PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh","markPrice":143.35,"tokenPrice":114.37,"supply":43712.58},
			{"symbol":"NOMARK","contract_address":"MintWithoutMark","markPrice":0},
			{"symbol":"NOMINT","contract_address":"","markPrice":10}
		]`)
	}))
	defer srv.Close()

	marks, err := New(srv.URL).Marks(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(marks) != 1 {
		t.Fatalf("got %d marks, want only the priced one: %+v", len(marks), marks)
	}
	m := marks["PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh"]
	if m.Symbol != "SPACEX" || m.MarkPrice != 143.35 || m.TokenPrice != 114.37 {
		t.Fatalf("unexpected mark %+v", m)
	}
}

func TestMarksBadStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	if _, err := New(srv.URL).Marks(context.Background()); err == nil {
		t.Fatal("want error on 503")
	}
}

func TestLiveMarks(t *testing.T) {
	if os.Getenv("LIVE") == "" {
		t.Skip("set LIVE=1 to hit prestocks.com")
	}
	marks, err := New("").Marks(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range marks {
		t.Logf("%-10s mark $%.2f token $%.2f", m.Symbol, m.MarkPrice, m.TokenPrice)
	}
	if len(marks) == 0 {
		t.Fatal("no marks returned")
	}
}
