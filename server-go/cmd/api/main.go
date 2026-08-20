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
	"github.com/ediya204/neobank/server-go/internal/fastforex"
	postgresdb "github.com/ediya204/neobank/server-go/internal/postgres"
	sumsubapi "github.com/ediya204/neobank/server-go/internal/sumsub"
)

type application struct {
	db                     databaseClient
	cregis                 *cregis.Client
	cregisLive             bool
	edgeSecret             []byte
	customerPasswordPepper []byte
	customerTOTPKey        []byte
	customerRecoveryPepper []byte
	adminPasswordPepper    []byte
	adminTOTPKey           []byte
	adminBootstrapSecret   []byte
	publicURL              string
	portalURL              string
	tenantID               string
	coreOrganizationID     string
	databaseBackend        string
	marketData             marketDataClient
	sumsub                 sumsubProvider
	sumsubSchemaReady      bool
	sumsubEnvironment      string
	sumsubWebhookSecret    []byte
	logger                 *slog.Logger
}

type databaseClient interface {
	Batch(context.Context, ...d1.Statement) ([]d1.Result, error)
	Query(context.Context, string, ...any) ([]map[string]any, error)
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	databaseBackend := strings.ToLower(envOr("DATABASE_BACKEND", "postgres"))
	if databaseBackend != "postgres" {
		logger.Error("invalid database configuration", "error", "runtime DATABASE_BACKEND must be postgres; D1 is historical migration input only")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	db, err := postgresdb.New(ctx, os.Getenv("DATABASE_URL"))
	cancel()
	var closeDatabase func()
	if postgresClient, ok := any(db).(*postgresdb.Client); ok {
		closeDatabase = postgresClient.Close
	}
	if err != nil || db == nil || closeDatabase == nil {
		logger.Error("invalid database configuration", "backend", databaseBackend, "error", err)
		os.Exit(1)
	}
	defer closeDatabase()
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
	adminPasswordPepper, err := requiredSecret("ADMIN_PASSWORD_PEPPER", 32)
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	adminTOTPKey, err := requiredKey32("ADMIN_TOTP_KEY")
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	adminBootstrapSecret, err := requiredSecret("ADMIN_BOOTSTRAP_SECRET", 32)
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	var marketData marketDataClient
	if fastForexKey := strings.TrimSpace(os.Getenv("FASTFOREX_API_KEY")); fastForexKey != "" {
		marketData, err = fastforex.New(fastforex.Config{APIKey: fastForexKey})
		if err != nil {
			logger.Error("invalid FastForex configuration", "error", err)
			os.Exit(1)
		}
	} else {
		logger.Warn("FastForex market data is disabled because FASTFOREX_API_KEY is not configured")
	}
	var sumsubClient *sumsubapi.Client
	sumsubEnabled := strings.EqualFold(os.Getenv("SUMSUB_ENABLED"), "true") &&
		strings.EqualFold(os.Getenv("SUMSUB_ACTIVATION_APPROVED"), "true")
	schemaContext, cancelSchemaCheck := context.WithTimeout(context.Background(), 3*time.Second)
	sumsubMigrationRows, schemaErr := db.Query(schemaContext,
		`SELECT version FROM neobank_schema_migrations WHERE version='0008_sumsub_individual_kyc'`)
	cancelSchemaCheck()
	if schemaErr != nil {
		logger.Error("could not read Sumsub migration state", "error", schemaErr)
		os.Exit(1)
	}
	sumsubSchemaReady := len(sumsubMigrationRows) == 1
	sumsubEnvironment := strings.ToLower(strings.TrimSpace(envOr("SUMSUB_MODE", "sandbox")))
	if sumsubEnvironment != "sandbox" && sumsubEnvironment != "production" {
		logger.Error("invalid Sumsub configuration", "error", "SUMSUB_MODE must be sandbox or production")
		os.Exit(1)
	}
	sumsubWebhookSecret := []byte(strings.TrimSpace(os.Getenv("SUMSUB_WEBHOOK_SECRET")))
	if sumsubEnabled {
		if !sumsubSchemaReady {
			logger.Error("invalid Sumsub configuration", "error", "PostgreSQL migration 0008_sumsub_individual_kyc is required")
			os.Exit(1)
		}
		if len(sumsubWebhookSecret) < 16 {
			logger.Error("invalid Sumsub configuration", "error", "SUMSUB_WEBHOOK_SECRET must be at least 16 characters")
			os.Exit(1)
		}
		sumsubClient, err = sumsubapi.New(sumsubapi.Config{
			BaseURL: envOr("SUMSUB_BASE_URL", "https://api.sumsub.com"), AppToken: os.Getenv("SUMSUB_APP_TOKEN"),
			Secret: os.Getenv("SUMSUB_SECRET_KEY"), Level: os.Getenv("SUMSUB_LEVEL_NAME"),
		})
		if err != nil {
			logger.Error("invalid Sumsub configuration", "error", err)
			os.Exit(1)
		}
	}
	app := &application{
		db: db, cregis: cregisClient, cregisLive: cregisLive, edgeSecret: []byte(edgeSecret),
		customerPasswordPepper: passwordPepper, customerTOTPKey: totpKey, customerRecoveryPepper: recoveryPepper,
		adminPasswordPepper: adminPasswordPepper, adminTOTPKey: adminTOTPKey, adminBootstrapSecret: adminBootstrapSecret,
		publicURL: publicURL, portalURL: portalURL, tenantID: envOr("TENANT_ID", "neobank"),
		coreOrganizationID: envOr("CORE_ORGANIZATION_ID", "org_neobank"),
		databaseBackend:    databaseBackend, marketData: marketData, sumsub: sumsubProviderOrNil(sumsubClient),
		sumsubSchemaReady: sumsubSchemaReady,
		sumsubEnvironment: sumsubEnvironment, sumsubWebhookSecret: sumsubWebhookSecret, logger: logger,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", app.health)
	mux.HandleFunc("POST /api/v1/callbacks/cregis/deposit", app.cregisDepositCallback)
	mux.HandleFunc("POST /api/v1/callbacks/cregis/payout", app.cregisPayoutCallback)
	mux.Handle("POST /api/webhooks/sumsub", app.authenticateEdge(http.HandlerFunc(app.sumsubWebhook)))
	mux.Handle("/api/auth/", app.authenticateEdge(http.HandlerFunc(app.auth)))
	mux.Handle("/api/v1/", app.authenticateEdge(http.HandlerFunc(app.api)))
	workerContext, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	go app.runSumsubSyncWorker(workerContext)

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

func sumsubProviderOrNil(client *sumsubapi.Client) sumsubProvider {
	if client == nil {
		return nil
	}
	return client
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
		"status": "ok", "service": "neobank-go-api", "database": app.databaseBackend,
		"cregis": map[bool]string{true: "enabled", false: "disabled"}[app.cregisLive],
		"sumsub": map[bool]string{true: "enabled", false: "disabled"}[app.sumsub != nil],
	})
}

func (app *application) api(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api/v1/health" && r.Method == http.MethodGet {
		app.health(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/v1/customer/") && app.routeCustomerAPI(w, r) {
		return
	}
	adminSession, err := app.requireAdminRequest(r)
	if err != nil {
		app.logger.Warn("admin request rejected",
			"method", r.Method,
			"path", r.URL.Path,
			"reason", err.Error(),
		)
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	r.Header.Set("X-Neobank-User", adminSession.Email)
	if app.routeAdminUsers(w, r, adminSession) {
		return
	}
	if !adminRequestPermitted(adminSession, r.Method, r.URL.Path) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"code": "admin_permission_required"}})
		return
	}
	if r.URL.Path == "/api/v1/admin/market-rate" && r.Method == http.MethodGet {
		app.marketRate(w, r)
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
	if app.routeAdminAuth(w, r) {
		return
	}
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
