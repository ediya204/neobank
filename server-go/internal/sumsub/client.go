package sumsub

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
	"strings"
	"time"
)

const maxResponseBytes = 1024 * 1024

type Config struct {
	BaseURL  string
	AppToken string
	Secret   string
	Level    string
}

type Client struct {
	baseURL    *url.URL
	appToken   string
	secret     []byte
	level      string
	httpClient *http.Client
	now        func() time.Time
}

type APIError struct {
	StatusCode int
	ErrorName  string
}

func (err *APIError) Error() string {
	return fmt.Sprintf("sumsub api request failed: status=%d error=%s", err.StatusCode, err.ErrorName)
}

type ApplicantInput struct {
	ExternalUserID string
	Email          string
	Phone          string
	Country        string
}

type Applicant struct {
	ID             string `json:"id"`
	ExternalUserID string `json:"externalUserId"`
}

type SDKToken struct {
	Token  string `json:"token"`
	UserID string `json:"userId"`
}

type ReviewResult struct {
	ReviewAnswer      string   `json:"reviewAnswer"`
	ReviewRejectType  string   `json:"reviewRejectType"`
	RejectLabels      []string `json:"rejectLabels"`
	ModerationComment string   `json:"moderationComment"`
	ClientComment     string   `json:"clientComment"`
}

type ReviewStatus struct {
	LevelName    string       `json:"levelName"`
	CreateDate   string       `json:"createDate"`
	ReviewDate   string       `json:"reviewDate"`
	ReviewStatus string       `json:"reviewStatus"`
	ReviewResult ReviewResult `json:"reviewResult"`
}

type StepStatus struct {
	ReviewResult ReviewResult `json:"reviewResult"`
	Country      string       `json:"country"`
	IDDocType    string       `json:"idDocType"`
}

type RequiredSteps map[string]StepStatus

func New(config Config) (*Client, error) {
	baseURL, err := url.Parse(strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"))
	if err != nil || baseURL.Scheme != "https" || baseURL.Host == "" || baseURL.Path != "" || baseURL.RawQuery != "" || baseURL.Fragment != "" || baseURL.User != nil {
		return nil, errors.New("SUMSUB_BASE_URL must be an HTTPS origin")
	}
	if strings.TrimSpace(config.AppToken) == "" || len(config.Secret) < 16 || strings.TrimSpace(config.Level) == "" {
		return nil, errors.New("Sumsub app token, secret, and level are required")
	}
	return &Client{
		baseURL: baseURL, appToken: strings.TrimSpace(config.AppToken), secret: []byte(config.Secret),
		level: strings.TrimSpace(config.Level), httpClient: &http.Client{
			Timeout: 8 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return errors.New("sumsub redirects are not allowed")
			},
		}, now: time.Now,
	}, nil
}

func (client *Client) LevelName() string {
	return client.level
}

func (client *Client) EnsureApplicant(ctx context.Context, input ApplicantInput) (Applicant, error) {
	applicant, err := client.createApplicant(ctx, input)
	if err == nil {
		return applicant, nil
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusConflict {
		return Applicant{}, err
	}
	return client.applicantByExternalUserID(ctx, input.ExternalUserID)
}

func (client *Client) createApplicant(ctx context.Context, input ApplicantInput) (Applicant, error) {
	query := url.Values{"levelName": []string{client.level}}
	payload := map[string]any{
		"externalUserId": input.ExternalUserID,
		"email":          input.Email,
		"phone":          input.Phone,
		"fixedInfo":      map[string]string{"country": input.Country},
	}
	var applicant Applicant
	err := client.doJSON(ctx, http.MethodPost, "/resources/applicants?"+query.Encode(), payload, &applicant)
	if err != nil {
		return Applicant{}, err
	}
	if applicant.ID == "" {
		return Applicant{}, errors.New("sumsub create applicant response is missing id")
	}
	return applicant, nil
}

func (client *Client) applicantByExternalUserID(ctx context.Context, externalUserID string) (Applicant, error) {
	requestPath := "/resources/applicants/-;externalUserId=" + url.PathEscape(externalUserID) + "/one"
	var applicant Applicant
	if err := client.doJSON(ctx, http.MethodGet, requestPath, nil, &applicant); err != nil {
		return Applicant{}, err
	}
	if applicant.ID == "" || applicant.ExternalUserID != externalUserID {
		return Applicant{}, errors.New("sumsub applicant identity mismatch")
	}
	return applicant, nil
}

func (client *Client) CreateSDKToken(ctx context.Context, input ApplicantInput, ttlSeconds int) (SDKToken, error) {
	if ttlSeconds < 60 || ttlSeconds > 600 {
		return SDKToken{}, errors.New("sumsub SDK token TTL must be between 60 and 600 seconds")
	}
	payload := map[string]any{
		"userId":    input.ExternalUserID,
		"levelName": client.level,
		"ttlInSecs": ttlSeconds,
		"applicantIdentifiers": map[string]string{
			"email": input.Email,
			"phone": input.Phone,
		},
	}
	var token SDKToken
	if err := client.doJSON(ctx, http.MethodPost, "/resources/accessTokens/sdk", payload, &token); err != nil {
		return SDKToken{}, err
	}
	if token.Token == "" || len(token.Token) > 1024 || token.UserID != input.ExternalUserID {
		return SDKToken{}, errors.New("sumsub SDK token response is invalid")
	}
	return token, nil
}

func (client *Client) GetReviewStatus(ctx context.Context, applicantID string) (ReviewStatus, error) {
	var status ReviewStatus
	err := client.doJSON(ctx, http.MethodGet, "/resources/applicants/"+url.PathEscape(applicantID)+"/status", nil, &status)
	return status, err
}

func (client *Client) GetRequiredSteps(ctx context.Context, applicantID string) (RequiredSteps, error) {
	var steps RequiredSteps
	err := client.doJSON(ctx, http.MethodGet, "/resources/applicants/"+url.PathEscape(applicantID)+"/requiredIdDocsStatus", nil, &steps)
	return steps, err
}

func (client *Client) doJSON(ctx context.Context, method, requestPath string, payload any, target any) error {
	var body []byte
	var err error
	if payload != nil {
		body, err = json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode sumsub request: %w", err)
		}
	}
	timestamp := strconv.FormatInt(client.now().UTC().Unix(), 10)
	mac := hmac.New(sha256.New, client.secret)
	_, _ = mac.Write([]byte(timestamp + method + requestPath))
	_, _ = mac.Write(body)
	signature := hex.EncodeToString(mac.Sum(nil))

	requestURL := *client.baseURL
	requestURL.Path = ""
	requestURL.RawPath = ""
	fullURL := requestURL.String() + requestPath
	request, err := http.NewRequestWithContext(ctx, method, fullURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create sumsub request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-App-Token", client.appToken)
	request.Header.Set("X-App-Access-Ts", timestamp)
	request.Header.Set("X-App-Access-Sig", signature)
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("send sumsub request: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(responseBody) > maxResponseBytes {
		return errors.New("sumsub response could not be read safely")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var envelope struct {
			ErrorName string `json:"errorName"`
		}
		_ = json.Unmarshal(responseBody, &envelope)
		if envelope.ErrorName == "" {
			envelope.ErrorName = "provider_error"
		}
		return &APIError{StatusCode: response.StatusCode, ErrorName: envelope.ErrorName}
	}
	if target == nil || len(responseBody) == 0 {
		return nil
	}
	if err := json.Unmarshal(responseBody, target); err != nil {
		return fmt.Errorf("decode sumsub response: %w", err)
	}
	return nil
}
