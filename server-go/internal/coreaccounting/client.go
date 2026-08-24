package coreaccounting

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const serviceIdentity = "service:neobank-go"

var safeRecordID = regexp.MustCompile(`^[A-Za-z0-9_.:@-]{1,128}$`)

type Config struct {
	BaseURL string
	Secret  string
}

type Result struct {
	ID         string `json:"id"`
	Action     string `json:"action,omitempty"`
	Status     string `json:"status"`
	Idempotent bool   `json:"idempotent"`
}

type Client struct {
	baseURL    string
	secret     []byte
	httpClient *http.Client
}

func New(config Config) (*Client, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return nil, errors.New("CORE_ACCOUNTING_URL must be an origin")
	}
	localHTTP := parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1")
	privateHost := parsed.Hostname()
	privateHTTP := parsed.Scheme == "http" &&
		(strings.HasSuffix(privateHost, ".internal") || (!strings.Contains(privateHost, ".") && privateHost != ""))
	if parsed.Scheme != "https" && !localHTTP && !privateHTTP {
		return nil, errors.New("CORE_ACCOUNTING_URL must use HTTPS or an approved private/local HTTP origin")
	}
	if len(config.Secret) < 32 {
		return nil, errors.New("CORE_ACCOUNTING_SHARED_SECRET must be at least 32 bytes")
	}
	return &Client{
		baseURL: baseURL,
		secret:  []byte(config.Secret),
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}, nil
}

func (client *Client) PostDeposit(ctx context.Context, depositID string) (Result, error) {
	record, err := recordID(depositID)
	if err != nil {
		return Result{}, err
	}
	result, err := client.post(ctx, "/api/v1/internal/cregis/deposits/"+record+"/post")
	if err != nil {
		return Result{}, err
	}
	if result.ID != record || (result.Status != "posted" && result.Status != "exception") {
		return Result{}, errors.New("Core deposit accounting returned an invalid business result")
	}
	return result, nil
}

func (client *Client) AdvanceWithdrawal(ctx context.Context, withdrawalID, action string) (Result, error) {
	switch action {
	case "reserve", "approve", "release", "settle":
	default:
		return Result{}, errors.New("invalid Core withdrawal accounting action")
	}
	record, err := recordID(withdrawalID)
	if err != nil {
		return Result{}, err
	}
	result, err := client.post(ctx, "/api/v1/internal/cregis/withdrawals/"+record+"/"+action)
	if err != nil {
		return Result{}, err
	}
	expected := map[string]string{"reserve": "reserved", "approve": "approved", "release": "released", "settle": "settled"}[action]
	if result.ID != record || result.Action != action || (result.Status != expected && result.Status != "exception") {
		return Result{}, errors.New("Core withdrawal accounting returned an invalid business result")
	}
	return result, nil
}

func (client *Client) post(ctx context.Context, requestTarget string) (Result, error) {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	bodyHash := sha256.Sum256(nil)
	canonical := strings.Join([]string{
		timestamp,
		http.MethodPost,
		requestTarget,
		serviceIdentity,
		hex.EncodeToString(bodyHash[:]),
	}, "\n")
	mac := hmac.New(sha256.New, client.secret)
	_, _ = mac.Write([]byte(canonical))

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+requestTarget, nil)
	if err != nil {
		return Result{}, fmt.Errorf("create Core accounting request: %w", err)
	}
	request.Header.Set("X-Neobank-User", serviceIdentity)
	request.Header.Set("X-Core-Edge-Timestamp", timestamp)
	request.Header.Set("X-Core-Edge-Signature", hex.EncodeToString(mac.Sum(nil)))
	response, err := client.httpClient.Do(request)
	if err != nil {
		return Result{}, fmt.Errorf("call Core accounting: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(raw) > 64*1024 {
		return Result{}, errors.New("read Core accounting response failed")
	}
	if response.StatusCode != http.StatusCreated && response.StatusCode != http.StatusOK {
		return Result{}, fmt.Errorf("Core accounting returned HTTP %d", response.StatusCode)
	}
	var result Result
	if json.Unmarshal(raw, &result) != nil || result.ID == "" || result.Status == "" {
		return Result{}, errors.New("Core accounting returned an invalid response")
	}
	return result, nil
}

func recordID(value string) (string, error) {
	if !safeRecordID.MatchString(value) {
		return "", errors.New("invalid Core accounting record id")
	}
	return value, nil
}
