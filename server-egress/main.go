package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	defaultListenAddress = "127.0.0.1:9080"
	defaultUpstreamURL   = "https://t-wsmbuuhb.cregis.io"
	maxRequestBody       = 1 << 20
	maxResponseBody      = 2 << 20
	maxClockSkew         = 90 * time.Second
	replayWindow         = 3 * time.Minute
)

var allowedPaths = map[string]struct{}{
	"/api/v1/address/create": {},
	"/api/v1/address/inner":  {},
	"/api/v1/address/legal":  {},
	"/api/v1/trade/page":     {},
	"/api/v2/payout":         {},
}

type relay struct {
	secret     []byte
	upstream   *url.URL
	httpClient *http.Client
	logger     *slog.Logger
	now        func() time.Time
	nonces     map[string]time.Time
	nonceMu    sync.Mutex
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	secret := os.Getenv("NEOBANK_RELAY_SECRET")
	if len(secret) < 32 {
		logger.Error("NEOBANK_RELAY_SECRET must contain at least 32 characters")
		os.Exit(1)
	}

	upstream, err := validateUpstream(envOr("CREGIS_UPSTREAM_URL", defaultUpstreamURL))
	if err != nil {
		logger.Error("invalid Cregis upstream", "error", err)
		os.Exit(1)
	}

	app := &relay{
		secret:   []byte(secret),
		upstream: upstream,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		logger: logger,
		now:    time.Now,
		nonces: make(map[string]time.Time),
	}

	server := &http.Server{
		Addr:              envOr("LISTEN_ADDR", defaultListenAddress),
		Handler:           securityHeaders(app.routes()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      25 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	go func() {
		logger.Info("neobank Cregis relay listening", "address", server.Addr, "upstream_host", upstream.Hostname())
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("relay stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("relay shutdown failed", "error", err)
		os.Exit(1)
	}
}

func (app *relay) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", app.health)
	mux.HandleFunc("POST /api/v1/address/create", app.forward)
	mux.HandleFunc("POST /api/v1/address/inner", app.forward)
	mux.HandleFunc("POST /api/v1/address/legal", app.forward)
	mux.HandleFunc("POST /api/v1/trade/page", app.forward)
	mux.HandleFunc("POST /api/v2/payout", app.forward)
	mux.HandleFunc("/", app.notFound)
	return mux
}

func validateUpstream(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimRight(raw, "/"))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "t-wsmbuuhb.cregis.io" {
		return nil, errors.New("CREGIS_UPSTREAM_URL must be https://t-wsmbuuhb.cregis.io")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.EscapedPath() != "" {
		return nil, errors.New("CREGIS_UPSTREAM_URL must not contain credentials, a path, query, or fragment")
	}
	return parsed, nil
}

func (app *relay) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"service": "neobank-cregis-egress", "status": "ok"})
}

func (app *relay) notFound(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
}

func (app *relay) forward(w http.ResponseWriter, r *http.Request) {
	started := app.now()
	if _, ok := allowedPaths[r.URL.Path]; !ok || r.URL.RawQuery != "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBody))
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request_too_large"})
		return
	}
	if !json.Valid(body) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}

	if err := app.authenticate(r, body); err != nil {
		app.logger.Warn("relay authentication rejected", "path", r.URL.Path, "error", err.Error())
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, app.upstream.String()+r.URL.Path, bytes.NewReader(body))
	if err != nil {
		app.logger.Error("create upstream request failed", "path", r.URL.Path, "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream_unavailable"})
		return
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "neobank-cregis-egress/1.0")

	response, err := app.httpClient.Do(request)
	if err != nil {
		app.logger.Error("Cregis request failed", "path", r.URL.Path, "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream_unavailable"})
		return
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBody+1))
	if err != nil || len(raw) > maxResponseBody {
		app.logger.Error("Cregis response rejected", "path", r.URL.Path, "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "invalid_upstream_response"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(raw)
	app.logger.Info("Cregis request completed", "path", r.URL.Path, "status", response.StatusCode, "duration_ms", app.now().Sub(started).Milliseconds())
}

func (app *relay) authenticate(r *http.Request, body []byte) error {
	timestampText := r.Header.Get("X-Neobank-Relay-Timestamp")
	nonce := r.Header.Get("X-Neobank-Relay-Nonce")
	provided := r.Header.Get("X-Neobank-Relay-Signature")
	if timestampText == "" || len(nonce) < 16 || len(nonce) > 128 || len(provided) != sha256.Size*2 {
		return errors.New("missing or malformed authentication headers")
	}
	timestampMillis, err := strconv.ParseInt(timestampText, 10, 64)
	if err != nil {
		return errors.New("invalid timestamp")
	}
	requestTime := time.UnixMilli(timestampMillis)
	now := app.now()
	if requestTime.Before(now.Add(-maxClockSkew)) || requestTime.After(now.Add(maxClockSkew)) {
		return errors.New("timestamp outside allowed window")
	}
	expected := relaySignature(app.secret, timestampText, nonce, r.Method, r.URL.Path, body)
	decoded, err := hex.DecodeString(provided)
	if err != nil || subtle.ConstantTimeCompare(decoded, expected) != 1 {
		return errors.New("signature mismatch")
	}

	app.nonceMu.Lock()
	defer app.nonceMu.Unlock()
	for key, expiry := range app.nonces {
		if !expiry.After(now) {
			delete(app.nonces, key)
		}
	}
	if _, exists := app.nonces[nonce]; exists {
		return errors.New("replayed nonce")
	}
	app.nonces[nonce] = now.Add(replayWindow)
	return nil
}

func relaySignature(secret []byte, timestamp, nonce, method, path string, body []byte) []byte {
	bodyDigest := sha256.Sum256(body)
	canonical := fmt.Sprintf("%s\n%s\n%s\n%s\n%s", timestamp, nonce, method, path, hex.EncodeToString(bodyDigest[:]))
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(canonical))
	return mac.Sum(nil)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
