package d1

import (
	"bytes"
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
	"strconv"
	"time"
)

type Statement struct {
	SQL    string `json:"sql"`
	Params []any  `json:"params,omitempty"`
}

type Result struct {
	Results []map[string]any `json:"results"`
	Success bool             `json:"success"`
	Meta    map[string]any   `json:"meta"`
}

type gatewayResponse struct {
	Results []Result `json:"results"`
	Error   *struct {
		Code string `json:"code"`
	} `json:"error,omitempty"`
}

type Client struct {
	baseURL    string
	secret     []byte
	httpClient *http.Client
}

func New(baseURL, secret string) (*Client, error) {
	parsed, err := url.Parse(baseURL)
	localHTTP := parsed != nil && parsed.Scheme == "http" &&
		(parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost")
	if err != nil || (parsed.Scheme != "https" && !localHTTP) || parsed.Host == "" || parsed.Path != "" {
		return nil, errors.New("D1_GATEWAY_URL must be an https origin or a local http origin without a path")
	}
	if len(secret) < 32 {
		return nil, errors.New("D1_GATEWAY_URL and D1_GATEWAY_SECRET are required")
	}
	return &Client{
		baseURL: parsed.String(),
		secret:  []byte(secret),
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}, nil
}

func (c *Client) Batch(ctx context.Context, statements ...Statement) ([]Result, error) {
	body, err := json.Marshal(map[string]any{"statements": statements})
	if err != nil {
		return nil, fmt.Errorf("encode D1 request: %w", err)
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, c.secret)
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(body)

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/internal/d1/query",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create D1 request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Neobank-Timestamp", timestamp)
	req.Header.Set("X-Neobank-Signature", hex.EncodeToString(mac.Sum(nil)))

	response, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call D1 gateway: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("read D1 response: %w", err)
	}
	var payload gatewayResponse
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode D1 response: status=%d: %w", response.StatusCode, err)
	}
	if response.StatusCode != http.StatusOK {
		code := "gateway_error"
		if payload.Error != nil && payload.Error.Code != "" {
			code = payload.Error.Code
		}
		return nil, fmt.Errorf("D1 gateway returned %d: %s", response.StatusCode, code)
	}
	return payload.Results, nil
}

func (c *Client) Query(ctx context.Context, sql string, params ...any) ([]map[string]any, error) {
	results, err := c.Batch(ctx, Statement{SQL: sql, Params: params})
	if err != nil {
		return nil, err
	}
	if len(results) != 1 || !results[0].Success {
		return nil, errors.New("D1 query did not succeed")
	}
	return results[0].Results, nil
}
