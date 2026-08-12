package d1

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewRejectsUnsafeConfiguration(t *testing.T) {
	t.Parallel()
	secret := "0123456789abcdef0123456789abcdef"
	for _, target := range []string{"http://example.com", "https://example.com/path", "not-a-url"} {
		if _, err := New(target, secret); err == nil {
			t.Fatalf("New(%q) accepted an unsafe gateway URL", target)
		}
	}
	if _, err := New("https://example.com", "short"); err == nil {
		t.Fatal("New accepted a weak gateway secret")
	}
}

func TestBatchSignsExactBody(t *testing.T) {
	t.Parallel()
	secret := "0123456789abcdef0123456789abcdef"
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/d1/query" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var payload json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		canonicalBody, _ := json.Marshal(map[string]any{"statements": []Statement{{SQL: "SELECT 1 AS ok"}}})
		timestamp := r.Header.Get("X-Neobank-Timestamp")
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write([]byte(timestamp + "."))
		_, _ = mac.Write(canonicalBody)
		if r.Header.Get("X-Neobank-Signature") != hex.EncodeToString(mac.Sum(nil)) {
			t.Fatal("gateway signature did not match the exact JSON body")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[{"results":[{"ok":1}],"success":true,"meta":{"changes":0}}]}`))
	}))
	defer server.Close()

	client, err := New(server.URL, secret)
	if err != nil {
		t.Fatal(err)
	}
	client.httpClient = server.Client()
	results, err := client.Query(t.Context(), "SELECT 1 AS ok")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0]["ok"] != float64(1) {
		t.Fatalf("unexpected results: %#v", results)
	}
}
