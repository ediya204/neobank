package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ediya204/neobank/server-go/internal/fastforex"
)

type marketDataStub struct {
	quote fastforex.Quote
	err   error
}

func (stub marketDataStub) FetchOne(context.Context, string, string) (fastforex.Quote, error) {
	return stub.quote, stub.err
}

type countingMarketDataStub struct {
	calls int
}

func (stub *countingMarketDataStub) FetchOne(context.Context, string, string) (fastforex.Quote, error) {
	stub.calls++
	return fastforex.Quote{}, nil
}

func TestCustomerMarketRateRequiresCustomerSession(t *testing.T) {
	marketData := &countingMarketDataStub{}
	app := &application{
		marketData: marketData,
		logger:     slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/customer/market-rate?base=HKD&quote=USD", nil)
	response := httptest.NewRecorder()
	if !app.routeCustomerAPI(response, request) {
		t.Fatal("expected customer market-rate route to be handled")
	}
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "session_expired") {
		t.Fatalf("unexpected response %d: %s", response.Code, response.Body.String())
	}
	if marketData.calls != 0 {
		t.Fatal("provider must not be called without an authenticated customer session")
	}
}

func TestMarketRateReturnsReferenceQuote(t *testing.T) {
	app := &application{
		marketData: marketDataStub{quote: fastforex.Quote{
			Provider: "fastforex", BaseCurrency: "USD", QuoteCurrency: "HKD",
			Rate: "7.8", UpdatedAt: "2026-08-15T01:02:03Z", ReferenceOnly: true,
		}},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/market-rate?base=USD&quote=HKD", nil)
	response := httptest.NewRecorder()
	app.marketRate(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"referenceOnly":true`) {
		t.Fatalf("unexpected response %d: %s", response.Code, response.Body.String())
	}
}

func TestMarketRateRejectsUnsupportedPairWithoutCallingProvider(t *testing.T) {
	app := &application{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/market-rate?base=EUR&quote=JPY", nil)
	response := httptest.NewRecorder()
	app.marketRate(response, request)
	if response.Code != http.StatusUnprocessableEntity || !strings.Contains(response.Body.String(), "unsupported_market_pair") {
		t.Fatalf("unexpected response %d: %s", response.Code, response.Body.String())
	}
}
