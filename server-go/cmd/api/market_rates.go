package main

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/fastforex"
)

var supportedMarketPairs = map[string]struct{}{
	"USD/HKD":  {},
	"HKD/USD":  {},
	"USD/USDT": {},
	"USDT/USD": {},
	"HKD/USDT": {},
	"USDT/HKD": {},
}

type marketDataClient interface {
	FetchOne(context.Context, string, string) (fastforex.Quote, error)
}

func (app *application) customerMarketRate(w http.ResponseWriter, r *http.Request) {
	if _, _, err := app.loadCustomerSession(r); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": map[string]string{"code": "session_expired"},
		})
		return
	}
	app.marketRate(w, r)
}

func (app *application) marketRate(w http.ResponseWriter, r *http.Request) {
	baseCurrency := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("base")))
	quoteCurrency := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("quote")))
	if baseCurrency == "" {
		baseCurrency = "USD"
	}
	if quoteCurrency == "" {
		quoteCurrency = "HKD"
	}
	pair := baseCurrency + "/" + quoteCurrency
	if _, ok := supportedMarketPairs[pair]; !ok {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error": map[string]string{"code": "unsupported_market_pair"},
		})
		return
	}
	if app.marketData == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": map[string]string{"code": "market_data_not_configured"},
		})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	quote, err := app.marketData.FetchOne(ctx, baseCurrency, quoteCurrency)
	if err != nil {
		app.logger.Warn("market data request failed", "provider", "fastforex", "pair", pair)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": map[string]string{"code": "market_data_unavailable"},
		})
		return
	}
	writeJSON(w, http.StatusOK, quote)
}
