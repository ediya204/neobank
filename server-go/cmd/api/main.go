package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/cregis"
	"github.com/ediya204/neobank/server-go/internal/d1"
)

type application struct {
	db                     databaseClient
	cregis                 *cregis.Client
	cregisLive             bool
	edgeSecret             []byte
	customerPasswordPepper []byte
	customerTOTPKey        []byte
	customerRecoveryPepper []byte
	publicURL              string
	portalURL              string
	tenantID               string
	logger                 *slog.Logger
}

type databaseClient interface {
	Batch(context.Context, ...d1.Statement) ([]d1.Result, error)
	Query(context.Context, string, ...any) ([]map[string]any, error)
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	db, err := d1.New(os.Getenv("D1_GATEWAY_URL"), os.Getenv("D1_GATEWAY_SECRET"))
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	cregisLive := strings.EqualFold(os.Getenv("CREGIS_ENABLED"), "true")
	var cregisClient *cregis.Client
	if cregisLive {
		cregisClient, err = cregis.New(cregis.Config{
			BaseURL:     envOr("CREGIS_BASE_URL", "https://t-wsmbuuhb.cregis.io"),
			ProjectID:   os.Getenv("CREGIS_PROJECT_ID"),
			Secret:      os.Getenv("CREGIS_PROJECT_SECRET"),
			RelayURL:    os.Getenv("CREGIS_RELAY_URL"),
			RelaySecret: os.Getenv("CREGIS_RELAY_SECRET"),
		})
		if err != nil {
			logger.Error("invalid Cregis configuration", "error", err)
			os.Exit(1)
		}
	}
	edgeSecret := os.Getenv("EDGE_SHARED_SECRET")
	if edgeSecret == "" {
		logger.Error("invalid configuration", "error", "EDGE_SHARED_SECRET is required")
		os.Exit(1)
	}
	publicURL := strings.TrimRight(os.Getenv("PUBLIC_BASE_URL"), "/")
	if !validConfiguredOrigin(publicURL, false) {
		logger.Error("invalid configuration", "error", "PUBLIC_BASE_URL must be an HTTPS origin")
		os.Exit(1)
	}
	portalURL := strings.TrimRight(os.Getenv("CUSTOMER_PORTAL_BASE_URL"), "/")
	if !validConfiguredOrigin(portalURL, true) {
		logger.Error("invalid configuration", "error", "CUSTOMER_PORTAL_BASE_URL must be an origin")
		os.Exit(1)
	}
	passwordPepper, err := requiredSecret("CUSTOMER_PASSWORD_PEPPER", 32)
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	totpKey, err := requiredKey32("CUSTOMER_TOTP_KEY")
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	recoveryPepper, err := requiredSecret("CUSTOMER_RECOVERY_PEPPER", 32)
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	app := &application{
		db: db, cregis: cregisClient, cregisLive: cregisLive, edgeSecret: []byte(edgeSecret),
		customerPasswordPepper: passwordPepper, customerTOTPKey: totpKey, customerRecoveryPepper: recoveryPepper,
		publicURL: publicURL, portalURL: portalURL, tenantID: envOr("TENANT_ID", "neobank"), logger: logger,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", app.health)
	mux.HandleFunc("POST /api/v1/callbacks/cregis/deposit", app.cregisDepositCallback)
	mux.HandleFunc("POST /api/v1/callbacks/cregis/payout", app.cregisPayoutCallback)
	mux.Handle("/api/auth/", app.authenticateEdge(http.HandlerFunc(app.auth)))
	mux.Handle("/api/v1/", app.authenticateEdge(http.HandlerFunc(app.api)))

	port := os.Getenv("PORT")
	if port == "" {
		port = "10000"
	}
	server := &http.Server{
		Addr:              "0.0.0.0:" + port,
		Handler:           requestLog(logger, securityHeaders(mux)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	logger.Info("starting neobank API", "port", port)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func validConfiguredOrigin(value string, allowLocalHTTP bool) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return false
	}
	if parsed.Scheme == "https" {
		return true
	}
	return allowLocalHTTP && parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "::1")
}

func (app *application) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := contextWithTimeout(r, 3*time.Second)
	defer cancel()
	rows, err := app.db.Query(ctx, "SELECT 1 AS ok")
	if err != nil || len(rows) != 1 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status": "degraded", "service": "neobank-go-api", "database": "unavailable",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "service": "neobank-go-api", "database": "d1",
		"cregis": map[bool]string{true: "enabled", false: "disabled"}[app.cregisLive],
	})
}

func (app *application) api(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api/v1/health" && r.Method == http.MethodGet {
		app.health(w, r)
		return
	}
	if app.routeCustomerAPI(w, r) {
		return
	}
	if app.routeCregis(w, r) {
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "not_found"}})
}

func (app *application) auth(w http.ResponseWriter, r *http.Request) {
	if app.routeCustomerAuth(w, r) {
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "not_found"}})
}

func (app *application) authenticateEdge(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 128*1024+1))
		if err != nil || len(body) > 128*1024 {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": map[string]string{"code": "payload_too_large"}})
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		bodyDigest := sha256.Sum256(body)
		bodyHash := hex.EncodeToString(bodyDigest[:])
		timestampValue := r.Header.Get("X-Neobank-Edge-Timestamp")
		signatureValue := r.Header.Get("X-Neobank-Edge-Signature")
		timestamp, err := strconv.ParseInt(timestampValue, 10, 64)
		provided, decodeErr := hex.DecodeString(signatureValue)
		if err != nil || decodeErr != nil || len(provided) != sha256.Size || abs(time.Now().Unix()-timestamp) > 60 {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "unauthorized"}})
			return
		}
		canonical := strings.Join([]string{timestampValue, r.Method, r.URL.RequestURI(), r.Header.Get("X-Neobank-User"), bodyHash}, "\n")
		mac := hmac.New(sha256.New, app.edgeSecret)
		_, _ = mac.Write([]byte(canonical))
		if !hmac.Equal(provided, mac.Sum(nil)) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "unauthorized"}})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requestLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		logger.Info("request", "method", r.Method, "path", r.URL.Path, "duration_ms", time.Since(started).Milliseconds())
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func abs(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func contextWithTimeout(r *http.Request, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), timeout)
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
