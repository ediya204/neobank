package cregis

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	BaseURL     string
	ProjectID   string
	Secret      string
	RelayURL    string
	RelaySecret string
}

type Client struct {
	projectID   int64
	secret      string
	relayURL    string
	relaySecret []byte
	httpClient  *http.Client
}

type Response struct {
	Code string          `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

type Trade struct {
	CID         int64  `json:"cid"`
	ChainID     string `json:"chain_id"`
	TokenID     string `json:"token_id"`
	ToAddress   string `json:"to_address"`
	FromAddress string `json:"from_address"`
	Amount      string `json:"amount"`
	Status      int    `json:"status"`
	TXID        string `json:"txid"`
}

func (r *Response) GetCode() string {
	if r == nil {
		return ""
	}
	return r.Code
}

func New(config Config) (*Client, error) {
	parsed, err := url.Parse(strings.TrimRight(config.BaseURL, "/"))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, errors.New("CREGIS_BASE_URL must be an https URL")
	}
	projectID, err := strconv.ParseInt(config.ProjectID, 10, 64)
	if err != nil || projectID <= 0 {
		return nil, errors.New("CREGIS_PROJECT_ID must be a positive integer")
	}
	if len(config.Secret) < 16 {
		return nil, errors.New("CREGIS_PROJECT_SECRET is required")
	}
	relayURL := strings.TrimRight(config.RelayURL, "/")
	relay, err := url.Parse(relayURL)
	if err != nil || relay.Scheme != "https" || relay.Host == "" || relay.User != nil || relay.EscapedPath() != "" || relay.RawQuery != "" || relay.Fragment != "" {
		return nil, errors.New("CREGIS_RELAY_URL must be an https origin")
	}
	if strings.EqualFold(relay.Host, parsed.Host) {
		return nil, errors.New("CREGIS_RELAY_URL must not point directly to Cregis")
	}
	if len(config.RelaySecret) < 32 {
		return nil, errors.New("CREGIS_RELAY_SECRET must contain at least 32 characters")
	}
	return &Client{
		projectID:   projectID,
		secret:      config.Secret,
		relayURL:    relayURL,
		relaySecret: []byte(config.RelaySecret),
		httpClient:  &http.Client{Timeout: 15 * time.Second},
	}, nil
}

func (c *Client) ProjectID() int64 {
	return c.projectID
}

func (c *Client) DepositTrade(ctx context.Context, cid int64, txid, chainID, tokenID string) (Trade, error) {
	response, err := c.Call(ctx, "/api/v1/trade/page", map[string]any{
		"cid":           cid,
		"tx_id":         txid,
		"trade_type":    1,
		"business_type": 3,
		"chain_id":      chainID,
		"token_id":      tokenID,
		"page_num":      1,
		"page_size":     10,
	})
	if err != nil {
		return Trade{}, err
	}
	var page struct {
		Rows []Trade `json:"rows"`
	}
	if err := json.Unmarshal(response.Data, &page); err != nil {
		return Trade{}, fmt.Errorf("decode Cregis trade page: %w", err)
	}
	var matched []Trade
	for _, trade := range page.Rows {
		if trade.CID == cid && trade.TXID == txid && trade.ChainID == chainID && trade.TokenID == tokenID {
			matched = append(matched, trade)
		}
	}
	if len(matched) != 1 {
		return Trade{}, fmt.Errorf("Cregis deposit trade match count: %d", len(matched))
	}
	return matched[0], nil
}

func (c *Client) Call(ctx context.Context, path string, business map[string]any) (*Response, error) {
	payload := make(map[string]any, len(business)+4)
	for key, value := range business {
		payload[key] = value
	}
	payload["pid"] = c.projectID
	payload["nonce"] = nonce(6)
	payload["timestamp"] = time.Now().UnixMilli()
	payload["sign"] = c.Sign(payload)
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode Cregis request: %w", err)
	}
	target := c.relayURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create Cregis request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	relayNonce := nonce(24)
	digest := sha256.Sum256(body)
	canonical := timestamp + "\n" + relayNonce + "\n" + http.MethodPost + "\n" + path + "\n" + hex.EncodeToString(digest[:])
	mac := hmac.New(sha256.New, c.relaySecret)
	_, _ = mac.Write([]byte(canonical))
	req.Header.Set("X-Neobank-Relay-Timestamp", timestamp)
	req.Header.Set("X-Neobank-Relay-Nonce", relayNonce)
	req.Header.Set("X-Neobank-Relay-Signature", hex.EncodeToString(mac.Sum(nil)))
	res, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call Cregis: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("read Cregis response: %w", err)
	}
	var decoded Response
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, fmt.Errorf("decode Cregis response: status=%d: %w", res.StatusCode, err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 || decoded.Code != "00000" {
		return &decoded, fmt.Errorf("Cregis rejected request: status=%d code=%s", res.StatusCode, decoded.Code)
	}
	return &decoded, nil
}

func (c *Client) Sign(values map[string]any) string {
	keys := make([]string, 0, len(values))
	for key, value := range values {
		if key == "sign" || empty(value) {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var canonical strings.Builder
	canonical.WriteString(c.secret)
	for _, key := range keys {
		canonical.WriteString(key)
		canonical.WriteString(format(values[key]))
	}
	digest := md5.Sum([]byte(canonical.String())) // Cregis protocol requires MD5.
	return hex.EncodeToString(digest[:])
}

func (c *Client) Verify(values map[string]any) bool {
	provided, ok := values["sign"].(string)
	if !ok || len(provided) != md5.Size*2 {
		return false
	}
	expected := c.Sign(values)
	return subtle.ConstantTimeCompare([]byte(strings.ToLower(provided)), []byte(expected)) == 1
}

func empty(value any) bool {
	if value == nil {
		return true
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text) == ""
	}
	return false
}

func format(value any) string {
	switch typed := value.(type) {
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return fmt.Sprint(value)
	}
}

func nonce(length int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	buffer := make([]byte, length)
	random := make([]byte, length)
	if _, err := rand.Read(random); err != nil {
		panic("crypto/rand unavailable")
	}
	for index := range buffer {
		buffer[index] = alphabet[int(random[index])%len(alphabet)]
	}
	return string(buffer)
}
