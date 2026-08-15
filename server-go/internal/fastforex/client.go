package fastforex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const productionBaseURL = "https://api.fastforex.io"

var currencyCodePattern = regexp.MustCompile(`^[A-Z0-9]{3,6}$`)

type Config struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
	CacheTTL   time.Duration
}

type Quote struct {
	Provider      string `json:"provider"`
	BaseCurrency  string `json:"baseCurrency"`
	QuoteCurrency string `json:"quoteCurrency"`
	Rate          string `json:"rate"`
	UpdatedAt     string `json:"updatedAt"`
	FetchedAt     string `json:"fetchedAt"`
	PriceType     string `json:"priceType"`
	ReferenceOnly bool   `json:"referenceOnly"`
}

type cachedQuote struct {
	quote     Quote
	expiresAt time.Time
}

type Client struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
	cacheTTL   time.Duration
	mu         sync.Mutex
	cache      map[string]cachedQuote
}

func New(config Config) (*Client, error) {
	apiKey := strings.TrimSpace(config.APIKey)
	if apiKey == "" {
		return nil, errors.New("FastForex API key is required")
	}
	baseURL := strings.TrimRight(config.BaseURL, "/")
	if baseURL == "" {
		baseURL = productionBaseURL
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return nil, errors.New("FastForex base URL must be an origin")
	}
	if baseURL == productionBaseURL && parsed.Scheme != "https" {
		return nil, errors.New("FastForex production base URL must use HTTPS")
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	cacheTTL := config.CacheTTL
	if cacheTTL <= 0 {
		cacheTTL = 30 * time.Second
	}
	return &Client{
		apiKey: apiKey, baseURL: baseURL, httpClient: httpClient, cacheTTL: cacheTTL,
		cache: make(map[string]cachedQuote),
	}, nil
}

func (client *Client) FetchOne(ctx context.Context, baseCurrency, quoteCurrency string) (Quote, error) {
	baseCurrency = strings.ToUpper(strings.TrimSpace(baseCurrency))
	quoteCurrency = strings.ToUpper(strings.TrimSpace(quoteCurrency))
	if !currencyCodePattern.MatchString(baseCurrency) || !currencyCodePattern.MatchString(quoteCurrency) || baseCurrency == quoteCurrency {
		return Quote{}, errors.New("invalid currency pair")
	}
	cacheKey := baseCurrency + "/" + quoteCurrency
	now := time.Now().UTC()
	client.mu.Lock()
	entry, ok := client.cache[cacheKey]
	client.mu.Unlock()
	if ok && entry.expiresAt.After(now) {
		return entry.quote, nil
	}

	endpoint, err := url.Parse(client.baseURL + "/fetch-one")
	if err != nil {
		return Quote{}, errors.New("invalid FastForex endpoint")
	}
	query := endpoint.Query()
	query.Set("from", baseCurrency)
	query.Set("to", quoteCurrency)
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return Quote{}, fmt.Errorf("create FastForex request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-API-Key", client.apiKey)

	response, err := client.httpClient.Do(request)
	if err != nil {
		return Quote{}, fmt.Errorf("FastForex request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Quote{}, fmt.Errorf("FastForex returned status %d", response.StatusCode)
	}

	var payload struct {
		Base    string                 `json:"base"`
		Updated json.RawMessage        `json:"updated"`
		Result  map[string]json.Number `json:"result"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 64*1024))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return Quote{}, fmt.Errorf("decode FastForex response: %w", err)
	}
	if strings.ToUpper(payload.Base) != baseCurrency {
		return Quote{}, errors.New("FastForex response base currency mismatch")
	}
	rateNumber, ok := payload.Result[quoteCurrency]
	if !ok {
		return Quote{}, errors.New("FastForex response is missing the requested quote")
	}
	rateFloat, err := strconv.ParseFloat(rateNumber.String(), 64)
	if err != nil || rateFloat <= 0 {
		return Quote{}, errors.New("FastForex response contains an invalid rate")
	}
	updatedAt, err := normalizeUpdatedAt(payload.Updated)
	if err != nil {
		return Quote{}, err
	}
	quote := Quote{
		Provider: "fastforex", BaseCurrency: baseCurrency, QuoteCurrency: quoteCurrency,
		Rate: strconv.FormatFloat(rateFloat, 'f', -1, 64), UpdatedAt: updatedAt,
		FetchedAt: now.Format(time.RFC3339), PriceType: "midpoint_spot", ReferenceOnly: true,
	}
	client.mu.Lock()
	client.cache[cacheKey] = cachedQuote{quote: quote, expiresAt: now.Add(client.cacheTTL)}
	client.mu.Unlock()
	return quote, nil
}

func normalizeUpdatedAt(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", errors.New("FastForex response is missing updated time")
	}
	var value string
	if raw[0] == '"' {
		if err := json.Unmarshal(raw, &value); err != nil {
			return "", errors.New("FastForex response contains an invalid updated time")
		}
		for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05"} {
			if parsed, err := time.Parse(layout, value); err == nil {
				return parsed.UTC().Format(time.RFC3339), nil
			}
		}
		return "", errors.New("FastForex response contains an invalid updated time")
	}
	milliseconds, err := strconv.ParseInt(string(raw), 10, 64)
	if err != nil || milliseconds <= 0 {
		return "", errors.New("FastForex response contains an invalid updated time")
	}
	return time.UnixMilli(milliseconds).UTC().Format(time.RFC3339), nil
}
