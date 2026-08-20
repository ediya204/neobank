package fastforex

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestFetchOneUsesHeaderAndCachesValidatedQuote(t *testing.T) {
	var calls atomic.Int32
	updatedAt := time.Now().UTC().Truncate(time.Second).Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("X-API-Key") != "test-key" {
			t.Fatalf("expected API key header")
		}
		if r.URL.Query().Get("from") != "USD" || r.URL.Query().Get("to") != "HKD" {
			t.Fatalf("unexpected pair query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"base":"USD","result":{"HKD":7.81234},"updated":"` + updatedAt + `"}`))
	}))
	defer server.Close()

	client, err := New(Config{
		APIKey: "test-key", BaseURL: server.URL, HTTPClient: server.Client(), CacheTTL: time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	first, err := client.FetchOne(context.Background(), "usd", "hkd")
	if err != nil {
		t.Fatal(err)
	}
	second, err := client.FetchOne(context.Background(), "USD", "HKD")
	if err != nil {
		t.Fatal(err)
	}
	if first.Rate != "7.81234" || first.UpdatedAt != updatedAt || !first.ReferenceOnly {
		t.Fatalf("unexpected quote: %#v", first)
	}
	if second != first || calls.Load() != 1 {
		t.Fatalf("expected cached quote, calls=%d second=%#v", calls.Load(), second)
	}
}

func TestFetchOneRejectsStaleProviderTimestamp(t *testing.T) {
	stale := time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"base":"USD","result":{"HKD":7.8},"updated":"` + stale + `"}`))
	}))
	defer server.Close()
	client, err := New(Config{APIKey: "test-key", BaseURL: server.URL, HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.FetchOne(context.Background(), "USD", "HKD"); err == nil {
		t.Fatal("expected stale provider timestamp rejection")
	}
}

func TestFetchOneRejectsInvalidPairAndResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"base":"EUR","result":{"HKD":0},"updated":0}`))
	}))
	defer server.Close()
	client, err := New(Config{APIKey: "test-key", BaseURL: server.URL, HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.FetchOne(context.Background(), "USD&api_key=leak", "HKD"); err == nil {
		t.Fatal("expected invalid pair rejection")
	}
	if _, err := client.FetchOne(context.Background(), "USD", "HKD"); err == nil {
		t.Fatal("expected response validation failure")
	}
}
