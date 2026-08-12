# Partner API Guide

Version: V1.7.0<br>
Last updated: 2 August 2026<br>
API root: `https://moventra.xyz/api/v1`<br>
Audience: Partner server-side integration teams

## 1. Scope

The Partner API supports two business purposes:

1. submit and track virtual-account onboarding applications; and
2. read customer accounts, balances, transaction history, fund records, and
   system-generated OTC conversion records.

It also lets the Partner request changes to API credentials, IP allowlist rules,
and webhook settings. Those integration changes require Operations approval.

This guide describes the Partner machine API only. Admin APIs, Portal browser
session APIs, Operations settlement controls, sweep controls, ledger mutation,
and one-time Client Secret reveal are internal and are not part of this contract.

## 2. Financial operating boundary

The Partner and its customers cannot initiate deposits, withdrawals, or OTC
orders through the Partner API.

- There is no supported `/withdrawals` endpoint.
- There is no supported `/withdrawal-fees` endpoint.
- `POST /fund-transactions` is not a supported integration operation and is
  rejected with `403 fund_operation_disabled`.
- `POST /otc-orders` is not a supported integration operation and is rejected
  with `403 manual_otc_disabled`.

Operations records a fiat receipt only after the underlying bank receipt has
been verified. After the receipt is cleared and the configured backend process
is triggered, the service creates the related USD-to-USDT/TRON conversion and
ledger entries. Partners can then read the resulting fund, conversion, and OTC
records. A displayed record is evidence of system processing; it is not a
customer instruction to move money.

Historical withdrawal or OTC records can remain visible. Their presence does
not mean that the Partner can create a new withdrawal or OTC order.

## 3. Authentication and request controls

Every machine request must be sent from the Partner backend with both Cloudflare
Access headers:

```http
CF-Access-Client-Id: <service-token-client-id>
CF-Access-Client-Secret: <service-token-client-secret>
```

Never expose these values to a browser, mobile application, source repository,
ticket, screenshot, or client-side log.

### 3.1 Security responsibility boundary

- Store the Service Token only in a managed Partner backend secret store.
- Use separate production egress IPs, credentials, and webhook signing secrets per environment.
- Never place credentials, signatures, or personal data in URL query parameters.
- Log only `X-Request-Id`, resource IDs, HTTP status, and stable error codes; never auth headers.
- Stop automatic retries after `401` or `403` and investigate credentials, Access, and IP policy.
- If compromise is suspected, request rotation through the controlled Portal and retain audit evidence.

Partner API and Portal authentication are separate. Machine integrations cannot use a
browser session, and the Portal must not store the machine Service Token. Resource IDs
such as `application_id` and `batchId` are not authorization credentials; the Worker
applies Partner scope again for every resource read.

### 3.2 Data isolation and enumeration resistance

Partner sweep reads validate both batch ownership and every customer in that batch. A
batch with inconsistent scope is treated as invisible. Unknown and out-of-scope resources
both return `404 not_found`, preventing inference about another Partner's data.

Responses expose only integration-required fields. They omit internal notes, operator
identities, internal tenant keys, destination configuration versions, and backend delivery
state. Customer names, application IDs, wallet addresses, amounts, and Tx Hashes must still
be encrypted at rest and access-controlled as sensitive financial data.

Additional controls:

- the default rate limit is 120 requests per 60 seconds;
- an enabled IP allowlist restricts requests to approved public egress IPs or CIDRs;
- JSON write bodies are limited to 16 KB and reject unknown fields;
- responses use `Cache-Control: no-store` for protected API data;
- every request reaching the Worker returns `X-Request-Id`;
- HTTP 200 alone is not acceptance: validate the JSON structure and business fields.

Example environment:

```bash
export VA_API_BASE_URL="https://moventra.xyz/api/v1"
export VA_CF_ACCESS_CLIENT_ID="<service-token-client-id>"
export VA_CF_ACCESS_CLIENT_SECRET="<service-token-client-secret>"
```

Example request:

```bash
curl --silent --show-error \
  --header "CF-Access-Client-Id: ${VA_CF_ACCESS_CLIENT_ID}" \
  --header "CF-Access-Client-Secret: ${VA_CF_ACCESS_CLIENT_SECRET}" \
  "${VA_API_BASE_URL}/health"
```

### 3.3 Copyable Java reference client

This Java 17+ example uses `java.net.http.HttpClient` and Jackson. Use a currently
maintained Jackson version approved by your organization. Run this code only on
a backend server; never expose the two Access headers to a browser or mobile app.

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>${jackson.version}</version>
</dependency>
```

```java
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.stream.Collectors;

public final class VaApiClient {
  public record ApiResult(JsonNode body, String requestId) {}

  public static final class VaApiException extends RuntimeException {
    public final int status;
    public final String code;
    public final String requestId;

    VaApiException(int status, String code, String message, String requestId) {
      super(message);
      this.status = status;
      this.code = code;
      this.requestId = requestId;
    }
  }

  private final String baseUrl;
  private final String clientId;
  private final String clientSecret;
  private final HttpClient http = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(10)).build();
  private final ObjectMapper json = new ObjectMapper();

  public VaApiClient(String baseUrl, String clientId, String clientSecret) {
    this.baseUrl = baseUrl.replaceAll("/+$", "");
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  public ApiResult get(String path, Map<String, String> query)
      throws IOException, InterruptedException {
    return send("GET", path, query, null);
  }

  public ApiResult post(String path, JsonNode body)
      throws IOException, InterruptedException {
    return send("POST", path, Map.of(), json.writeValueAsString(body));
  }

  private ApiResult send(String method, String path, Map<String, String> query, String body)
      throws IOException, InterruptedException {
    String queryString = query.entrySet().stream()
        .filter(entry -> entry.getValue() != null && !entry.getValue().isBlank())
        .map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue()))
        .collect(Collectors.joining("&"));
    URI uri = URI.create(baseUrl + path + (queryString.isEmpty() ? "" : "?" + queryString));

    HttpRequest.Builder request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(30))
        .header("Accept", "application/json")
        .header("CF-Access-Client-Id", clientId)
        .header("CF-Access-Client-Secret", clientSecret);
    if (body == null) request.GET();
    else request.header("Content-Type", "application/json")
        .method(method, HttpRequest.BodyPublishers.ofString(body));

    HttpResponse<String> response = http.send(
        request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    String requestId = response.headers().firstValue("X-Request-Id").orElse(null);
    JsonNode payload = json.readTree(response.body());

    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      JsonNode error = payload.path("error");
      throw new VaApiException(
          response.statusCode(),
          error.path("code").asText("unexpected_response"),
          error.path("message").asText("VA API request failed"),
          requestId);
    }
    return new ApiResult(payload, requestId);
  }

  private static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }

  public ObjectMapper json() { return json; }
}
```

Example business calls:

```java
VaApiClient api = new VaApiClient(
    System.getenv().getOrDefault("VA_API_BASE_URL", "https://moventra.xyz/api/v1"),
    System.getenv("VA_CF_ACCESS_CLIENT_ID"),
    System.getenv("VA_CF_ACCESS_CLIENT_SECRET"));

// Keep the Partner customer ID as a canonical lowercase UUID v4 String.
String partnerCustomerId = "eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4";
var requestBody = api.json().createObjectNode()
    .put("partner_customer_id", partnerCustomerId)
    .put("phone_country_code", "+65")
    .put("phone_number", "81234567")
    .put("email", "customer@example.com")
    .put("customer_name", "Example Customer");

VaApiClient.ApiResult created = api.post("/va-applications", requestBody);
String applicationId = created.body().path("application_id").asText();

VaApiClient.ApiResult balances = api.get(
    "/balances", Map.of("partner_customer_id", partnerCustomerId));
for (JsonNode row : balances.body().path("data")) {
  java.math.BigDecimal available = new java.math.BigDecimal(
      row.path("available_balance").asText());
}

VaApiClient.ApiResult transactions = api.get("/transactions", Map.of(
    "partner_customer_id", partnerCustomerId,
    "status", "completed",
    "page", "1",
    "limit", "100"));
```

Recommended Jackson DTOs for the most common responses:

```java
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
record ApplicationResponse(
    String application_id,
    String partner_customer_id,
    String phone_country_code,
    String phone_number,
    String email,
    String customer_name,
    String status,
    String kyc_url,
    VaAccount va_account,
    String created_at,
    String updated_at) {}

@JsonIgnoreProperties(ignoreUnknown = true)
record VaAccount(
    String account_name,
    String account_number,
    String iban,
    String currency,
    String swift_bic,
    String bank_name,
    String bank_address) {}

@JsonIgnoreProperties(ignoreUnknown = true)
record Balance(
    String application_id,
    String partner_customer_id,
    String asset,
    String network,
    String ledger_balance,
    String reserved,
    String available_balance,
    Integer asset_decimals) {}

@JsonIgnoreProperties(ignoreUnknown = true)
record BalanceList(List<Balance> data) {}

ApplicationResponse application = api.json().treeToValue(
    created.body(), ApplicationResponse.class);
BalanceList balanceList = api.json().treeToValue(
    balances.body(), BalanceList.class);
```

For list endpoints, increment `page` until the returned page reaches
`meta.total_pages`. For `/customers`, whose metadata does not expose
`total_pages`, continue until `page * limit >= meta.total`. Keep all monetary
values as decimal strings and parse them with `BigDecimal`, never `double`.

## 4. Supported endpoint catalogue

All paths are relative to the API root.

### 4.1 Service and reference data

| Method | Path | Purpose |
| ------ | ------------------------ | ------------------------------------- |
| `GET` | `/` | API metadata and canonical links |
| `GET` | `/health` | Availability and server time |
| `GET` | `/openapi.yaml` | Canonical OpenAPI 3.1 contract |
| `GET` | `/country-calling-codes` | Supported calling-code reference data |

### 4.2 Onboarding

| Method | Path | Purpose |
| ------ | ---------------------------------- | ------------------------------------ |
| `POST` | `/va-applications` | Submit a customer VA application |
| `GET` | `/va-applications` | List applications |
| `GET` | `/va-applications/{applicationId}` | Read one application |
| `POST` | `/va-applications/{applicationId}/resubmit` | Correct and resubmit a returned application |
| `GET` | `/customers` | List customer summaries and balances |
| `GET` | `/customers/{applicationId}` | Read one customer overview |

### 4.3 Read-only financial data

| Method | Path | Purpose |
| ------ | ------------------------------------ | ---------------------------------------------------- |
| `GET` | `/balances?application_id=...` | Read ledger, reserved, and available balances |
| `GET` | `/transactions` | Read unified transaction history |
| `GET` | `/sweep-batches` | Read this Partner's sweep batches and current status |
| `GET` | `/sweep-batches/{batchId}` | Read one sweep batch and per-customer details |
| `GET` | `/fund-transactions` | Read deposit and historical withdrawal records |
| `GET` | `/fund-transactions/{transactionId}` | Read one fund record |
| `GET` | `/otc-orders` | Read historical and system-generated OTC conversions |
| `GET` | `/otc-orders/{orderId}` | Read one OTC conversion record |

These endpoints are read-only to the Partner. They do not create, approve,
clear, settle, or complete any financial action.

### 4.4 API integration management

| Method | Path | Purpose |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `GET` | `/api-integration` | Read approved settings, requests, credentials, and deliveries |
| `POST` | `/api-integration/ip-allowlist-requests` | Request an IP/CIDR add or removal |
| `POST` | `/api-integration/webhook-requests` | Request a webhook upsert or disable operation |
| `POST` | `/api-integration/credential-rotation-requests` | Request service-token credential rotation |
| `GET` | `/api-integration/credential-rotation-requests/{requestId}` | Read a rotation request |
| `POST` | `/api-integration/credential-rotation-requests/{requestId}/cancel` | Cancel a pending rotation request |
| `POST` | `/api-integration/webhook-signing-key-requests` | Request Webhook signing-key creation or rotation |
| `POST` | `/api-integration/webhook-signing-key-requests/{requestId}/cancel` | Cancel a pending signing-key request |
| `GET` | `/api-integration/requests/{requestId}` | Read an IP or webhook request |
| `POST` | `/api-integration/requests/{requestId}/cancel` | Cancel a pending IP or webhook request |
| `POST` | `/api-integration/webhook-test` | Queue a signed test event |

`GET /customers` supports `q` (customer name, application ID, Partner customer ID,
or email), an exact `partner_customer_id`, an
exact `status`, `balance_state=all|with_balance|with_reserved`, `page`, and
`limit` (maximum 100). Its response `meta` includes the page `count`, filtered
`total`, `page`, `limit`, and the balance `snapshot_at` timestamp.

## 5. Customer onboarding

### 5.1 Read calling codes

Refresh `GET /country-calling-codes` instead of hard-coding country codes. The
response is an operational country-level pre-screen and does not replace KYC,
beneficial-owner, sanctions, or regional screening.

### 5.2 Submit an application

`POST /va-applications` accepts exactly these fields. `partner_customer_id` is
the Partner-owned customer key and must always be sent as a canonical lowercase UUID v4 string:

```json
{
  "partner_customer_id": "eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4",
  "phone_country_code": "+65",
  "phone_number": "81234567",
  "email": "customer@example.com",
  "customer_name": "Example Customer"
}
```

The Partner customer ID must be a canonical lowercase UUID v4 and is unique within the
Partner tenant. The calling code and national phone number must be separate. Unsupported or
misspelled fields return `422`; do not silently retry validation errors.

```bash
curl --silent --show-error \
  --request POST \
  --header "Content-Type: application/json" \
  --header "CF-Access-Client-Id: ${VA_CF_ACCESS_CLIENT_ID}" \
  --header "CF-Access-Client-Secret: ${VA_CF_ACCESS_CLIENT_SECRET}" \
  --data '{
    "partner_customer_id": "eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4",
    "phone_country_code": "+65",
    "phone_number": "81234567",
    "email": "customer@example.com",
    "customer_name": "Example Customer"
  }' \
  "${VA_API_BASE_URL}/va-applications"
```

Application statuses:

| Status | Meaning |
| ---------------- | ---------------------------------------------------- |
| `submitted` | Application received; Operations review is pending |
| `kyc_link_ready` | `kyc_url` is temporarily available |
| `kyc_approved` | KYC approved |
| `va_processing` | Virtual account provisioning is in progress |
| `active` | Virtual account is active; `va_account` is available |
| `changes_requested` | Operations returned the application for correction; read `action_required` and resubmit |

`kyc_url` is actionable only while the status is `kyc_link_ready`; otherwise it
is `null`. The matching `application.status_changed` webhook also carries this URL
for immediate customer handoff. Re-read the application for missed-event recovery,
expired-link handling, or reconciliation.

### 5.3 Correct and resubmit

While status is `changes_requested`, read `action_required.reason_message` and
`required_fields`, correct the customer details, then call:

```http
POST /va-applications/{applicationId}/resubmit
Idempotency-Key: <stable-unique-key-for-this-resubmission>
```

```json
{
  "phone_country_code": "+65",
  "phone_number": "81234568",
  "email": "customer@example.com",
  "customer_name": "Example Customer",
  "expected_version": 5,
  "response_note": "Phone number corrected"
}
```

The application keeps the same `application_id` and `partner_customer_id`, increments
`submission_round`, and returns to `submitted` for a complete re-review. Send the latest
`application_version`; a stale value returns `409 application_version_conflict`. Repeating
the same normalized request with the same `Idempotency-Key` returns the current application;
reusing the key for different content returns `409 idempotency_conflict`.

## 6. Customers and balances

`GET /customers` returns customer summaries. `GET
/customers/{applicationId}` returns the customer, balances, recent fund records,
and OTC records. The detail path accepts either the generated `application_id` or
the lowercase UUID v4 `partner_customer_id`.

For exact Partner-key lookup, send `partner_customer_id` to `/customers`,
`/balances`, `/transactions`, `/fund-transactions`, `/otc-orders`, or
`/sweep-batches`. Do not send it together with `application_id`. Application,
customer, fund, OTC, transaction-history, sweep-item, and Webhook payloads return
both identifiers; legacy customers may return `partner_customer_id: null` until
the Partner supplies a mapping.

`GET /balances?application_id=...` or
`GET /balances?partner_customer_id=...` returns balance buckets:

- USD uses a fiat row with `network: null`;
- USDT uses an independent row per network;
- `ledger_balance` is the posted ledger total;
- `reserved` is the amount currently held by existing processing records;
- `available_balance = ledger_balance - reserved`.

All monetary values are decimal strings. Do not parse them with binary floating
point. Use a decimal library and the returned asset precision.

## 7. Transaction history

### 7.1 Unified history

`GET /transactions` is the recommended customer-visible history endpoint. It
supports filters including `application_id` or `partner_customer_id`, `category`, `status`, `type`,
`wallet`, `network`, `date_from`, `date_to`, `page`, and `limit`.

Rows can represent:

- verified fiat or USDT deposits;
- historical withdrawals;
- system-generated OTC conversion records;
- fiat conversion debit and crypto conversion credit ledger projections.
- completed per-customer USDT/TRON sweep debits.

The corresponding machine `type` values include `fiat_conversion_debit` and
`crypto_conversion_credit`. A completed sweep uses `type: "usdt_sweep"`.

Use record IDs and relationship fields such as `source_fund_transaction_id`,
`conversion_otc_id`, and `otc_order_id` to reconcile related records. Do not
infer a new customer action from the presence of these rows.

### 7.2 Fund records

`GET /fund-transactions` and `GET /fund-transactions/{transactionId}` expose
deposit and historical withdrawal records. Relevant fields include
`settlement_status`, `conversion_otc_id`, `transaction_reference`, `network`,
and timestamps.

Settlement states:

| State | Meaning |
| ----------- | ------------------------------------------------- |
| `pending` | Not yet cleared |
| `cleared` | Underlying receipt or movement has been confirmed |
| `exception` | Operations review is required |

Only Operations can record or update the underlying financial event.

### 7.3 USDT sweep records

Sweeps are initiated only by the platform backend. The Partner cannot create,
submit, complete, or cancel a batch. Webhooks provide real-time notification;
these read-only endpoints support reconciliation, gap recovery, and backfills:

```http
GET /sweep-batches?status=submitted&application_id=app_customer_001&page=1&limit=100
GET /sweep-batches/{batchId}
```

The list endpoint accepts a one-based `page` and a `limit` from 1 through 100;
the defaults are 1 and 100. Every response includes `meta.total`, `meta.page`,
`meta.limit`, and `meta.total_pages`. An empty result has `total_pages: 0`.
For a complete reconciliation, iterate `page` from `1` through `total_pages`
instead of assuming the first response contains every batch.

The detail endpoint returns one batch in this shape:

```json
{
  "data": {
    "batch_id": "swp_example",
    "status": "submitted",
    "network": "TRON",
    "asset": "USDT",
    "total_amount": "750.5",
    "destination_address": "TExampleDestinationAddress",
    "tx_hash": "7de8c2b2f0192e0987bc34c8ad9e091111111111111111111111111111111111",
    "created_at": "2026-08-02T08:30:00.000Z",
    "submitted_at": "2026-08-02T08:35:00.000Z",
    "completed_at": null,
    "cancelled_at": null,
    "items": [
      {
        "application_id": "app_customer_001",
        "customer_name": "Example Customer",
        "amount": "750.5",
        "ledger_entry_id": null
      }
    ]
  }
}
```

- `locked`: the amount is reserved and reduces `available_balance`; no Tx Hash exists yet;
- `submitted`: the chain transaction is submitted; the amount stays reserved and is not posted;
- `completed`: each customer debit is posted, `ledger_entry_id` is populated, and the reservation is released;
- `cancelled`: an unsubmitted locked batch is cancelled without a debit and its reservation is released.

Only batches and customers owned by the current Partner are returned. An unknown
batch ID and another Partner's batch ID both return `404 not_found`, preventing ID
probing. Responses omit internal notes, operator identities, destination setting
versions, internal webhook delivery state, and every other Partner's details.

Recommended secure recovery flow:

1. Deduplicate by webhook event ID and treat the event only as a signal to re-read state.
2. Use its `batch_id` with `GET /sweep-batches/{batchId}` to obtain current state.
3. Store batches by `batch_id` and per-customer allocations by `application_id`.
4. After `completed`, reconcile each `ledger_entry_id` with the final `/transactions` debit.
5. Poll every `/sweep-batches` page through `meta.total_pages` periodically to recover lost,
   delayed, or failed webhook handling.

Webhooks may be duplicated or arrive out of order. Never move local state backwards based
on delivery order; the sweep batch query is authoritative.

After Operations completes a TRON sweep, each affected customer receives one
read-only transaction-history row. Query all completed sweep debits for a
customer with:

```http
GET /transactions?application_id=<application-id>&type=usdt_sweep
```

Sweep rows are returned only after the batch reaches `completed`; `locked` and
`submitted` reservations affect balances but are not transaction-history rows.
There is no `usdt_sweep.submitted` Webhook event. Observe `submitted` by reading
`GET /sweep-batches/{batchId}` or by polling every page of `GET /sweep-batches`;
`usdt_sweep.locked` is the available early-state notification.

```json
{
  "data": [
    {
      "id": "led_example",
      "ledger_entry_id": "led_example",
      "application_id": "app_customer_001",
      "customer_name": "Example Customer",
      "category": "fund",
      "type": "usdt_sweep",
      "direction": "debit",
      "asset": "USDT",
      "network": "TRON",
      "amount": "750.5",
      "fee_amount": "0",
      "net_amount": "750.5",
      "status": "completed",
      "sweep_batch_id": "swp_example",
      "reference": "7de8c2b2f0192e0987bc34c8ad9e091111111111111111111111111111111111",
      "transaction_reference": "7de8c2b2f0192e0987bc34c8ad9e091111111111111111111111111111111111",
      "created_at": "2026-08-02T08:40:00.000Z",
      "updated_at": "2026-08-02T08:40:00.000Z",
      "completed_at": "2026-08-02T08:40:00.000Z"
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 200,
    "total_pages": 1
  }
}
```

`amount` is the USDT deducted from this customer in the batch.
`sweep_batch_id` links customers included in the same backend batch, and
`transaction_reference` is the shared TRON Tx Hash. The Partner response does
not expose the sweep operator or internal note.

These records also appear in an unfiltered `GET /transactions` response and in
`category=fund`, `wallet=crypto`, and `network=TRON` results. A network filter
other than `TRON` excludes sweep rows.

### 7.4 OTC conversion records

`GET /otc-orders` and `GET /otc-orders/{orderId}` are query endpoints only.
Partners cannot submit a conversion.

For the current automatic USD-to-USDT/TRON flow:

1. Operations verifies the fiat receipt;
2. Operations clears the receipt and triggers the configured backend flow;
3. the service creates the OTC conversion and ledger entries atomically; and
4. the Partner reads the resulting records through the query APIs.

The response can include the rate snapshot, gross buy amount, fee rate, fee
amount, net buy amount, network, status, and timestamps. These fields describe
the completed or recorded backend event; they are not a quote or order form.

## 8. API integration management

### 8.1 IP allowlist requests

An add request supplies `action: "add"`, a public `cidr`, `label`, `environment`,
and `reason`. A removal request supplies `action: "remove"`, the
`target_entry_id`, and `reason`. Pending requests do not change live traffic.

### 8.2 Webhook requests

Webhook changes use an approval workflow. Only public HTTPS destinations on
port 443 are accepted. URLs with credentials, query strings, fragments, IP
literals, local/reserved hosts, or unsupported DNS results are rejected.

Supported event types:

- `application.status_changed`;
- `va_account.activated`;
- `fund_transaction.status_changed`;
- `fiat_deposit.cleared_and_converted`;
- `usdt_sweep.locked`;
- `usdt_sweep.completed`;
- `usdt_sweep.cancelled`;
- `otc_order.status_changed`.

There is no `usdt_sweep.submitted` Webhook event. Use the sweep detail endpoint
or the paginated sweep list to observe the `submitted` state.

Webhook deliveries include:

```http
X-VA-Webhook-Id: <event-id>
X-VA-Webhook-Timestamp: <unix-seconds>
X-VA-Webhook-Signature: v1=<hex-hmac-sha256>
X-VA-Webhook-Key-Id: <managed-key-id-or-v1>
```

Verify the signature over the exact raw body, reject stale timestamps, and
deduplicate event IDs. Most `application.status_changed` deliveries remain compact
state signals. When the status is `kyc_link_ready`, the event additionally carries the
actionable Sumsub URL so the receiver can hand KYC to the customer without an immediate
API read:

```json
{
  "event_id": "evt_kyc0123456789abcdef",
  "type": "application.status_changed",
  "occurred_at": "2026-08-02T10:30:00.000Z",
  "data": {
    "resource_type": "va_application",
    "resource_id": "va_app_0123456789abcdef",
    "application_id": "va_app_0123456789abcdef",
    "partner_customer_id": "eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4",
    "status": "kyc_link_ready",
    "kyc_url": "https://in.sumsub.com/idensic/l/example-session"
  }
}
```

When Operations requests corrections, the same event type contains the safe Partner-visible
reason. `internal_note` and reviewer identity are never included:

```json
{
  "event_id": "evt_changes0123456789abcdef",
  "type": "application.status_changed",
  "occurred_at": "2026-08-03T10:30:00.000Z",
  "data": {
    "resource_type": "va_application",
    "resource_id": "va_app_0123456789abcdef",
    "application_id": "va_app_0123456789abcdef",
    "partner_customer_id": "eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4",
    "status": "changes_requested",
    "onboarding_stage": "kyc_link_ready",
    "submission_round": 1,
    "application_version": 5,
    "action_required": {
      "type": "resubmit",
      "reason_code": "phone_unverifiable",
      "reason_message": "The phone number could not be verified. Correct it and resubmit.",
      "required_fields": ["phone_country_code", "phone_number"],
      "requested_at": "2026-08-03T10:30:00.000Z"
    }
  }
}
```

`va_account.activated` carries the activated VA account snapshot so the receiver can
persist the completed onboarding result without an immediate API read:

```json
{
  "event_id": "evt_0123456789abcdef",
  "type": "va_account.activated",
  "occurred_at": "2026-08-02T11:00:00.000Z",
  "data": {
    "resource_type": "va_account",
    "resource_id": "va_app_0123456789abcdef",
    "application_id": "va_app_0123456789abcdef",
    "partner_customer_id": "eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4",
    "status": "active",
    "va_account": {
      "account_name": "Example Company Ltd",
      "account_number": "1234567890",
      "iban": null,
      "currency": "USD",
      "swift_bic": "ABCDEF12",
      "bank_name": "Example Bank",
      "bank_address": "Singapore"
    }
  }
}
```

Treat these payloads as signed point-in-time onboarding results. Query the matching
resource API for missed-event recovery, periodic reconciliation, expired-link handling,
or conflict resolution; the query API remains the source of truth.

`fund_transaction.status_changed` carries the customer-visible transaction snapshot.
For example, a newly recorded deposit is delivered as follows:

```json
{
  "event_id": "evt_fund0123456789abcdef",
  "type": "fund_transaction.status_changed",
  "occurred_at": "2026-08-02T12:00:00.000Z",
  "data": {
    "resource_type": "fund_transaction",
    "resource_id": "txn_0123456789abcdef",
    "application_id": "va_app_0123456789abcdef",
    "partner_customer_id": "eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4",
    "status": "submitted",
    "transaction_type": "fiat_deposit",
    "direction": "deposit",
    "asset": "USD",
    "amount": "1000",
    "fee_amount": "0",
    "net_amount": "1000",
    "network": null,
    "external_reference": "BANK-IN-20260802-001",
    "transaction_reference": null,
    "settlement_status": "pending"
  }
}
```

An Admin record with `status: "submitted"` and `settlement_status: "pending"` confirms
that Operations recorded the receipt for processing; it does not mean cleared and does
not post the amount to the customer's ledger balance. Clearing is notified separately by
`fiat_deposit.cleared_and_converted`, which includes the complete clearing and conversion
result:

```json
{
  "event_id": "evt_cleared0123456789abcdef",
  "type": "fiat_deposit.cleared_and_converted",
  "occurred_at": "2026-08-02T12:05:00.000Z",
  "data": {
    "resource_type": "fund_transaction",
    "resource_id": "txn_0123456789abcdef",
    "application_id": "va_app_0123456789abcdef",
    "partner_customer_id": "eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4",
    "status": "completed",
    "transaction_type": "fiat_deposit",
    "direction": "deposit",
    "external_reference": "BANK-IN-20260802-001",
    "transaction_reference": "BANK-IN-20260802-001",
    "settlement_status": "cleared",
    "cleared_at": "2026-08-02T12:05:00.000Z",
    "fiat_asset": "USD",
    "fiat_amount": "111111",
    "exchange_rate": "0.995",
    "exchange_rate_version": 3,
    "usdt_amount": "110555.445",
    "usdt_net_amount": "110555.445",
    "usdt_network": "TRON",
    "otc_order_id": "otc_0123456789abcdef",
    "otc_status": "completed"
  }
}
```

The Partner must include `fiat_deposit.cleared_and_converted` in its approved Webhook
subscription; subscribing only to `fund_transaction.status_changed` does not enable this
clearing event. The payload contains no operator note or internal staff identity.

Secure processing order: enforce a short receiver-defined timestamp window. Using the
exact UTF-8 bytes received for the body, compute
`lowercase_hex(HMAC_SHA256(secret, timestamp + "." + rawBodyUtf8))`. Strip the literal
`v1=` prefix from `X-VA-Webhook-Signature`, then compare the supplied lowercase hex with
the computed value using a constant-time comparison. Parse JSON only after verification.
Return `2xx` after durably accepting the event into a queue, then retry business failures
from the internal queue. Never verify a proxy-reformatted JSON body.

The endpoint must remain public HTTPS on port 443. Do not redirect delivery to an unknown
destination or send signatures, raw payloads, or customer data to public error tracking.
Audit signature failures, stale timestamps, and duplicates without sensitive payload text.

Signing keys are generated on the server. After Operations approval, a Portal user with
`credentials.reveal` permission can retrieve the secret once with TOTP. The Partner configures
the receiver and then activates the key explicitly. The previous key continues signing until
activation and then enters the requested overlap window. Use `X-VA-Webhook-Key-Id` to select
the matching secret; legacy Worker Secret deliveries use `v1`. Activation is blocked while the
current key still has pending, retry-scheduled, delivering, or dead-lettered deliveries so that
older events are not suppressed or lost during the key-version change.

Java 17+ verification reference (the controller must receive the unmodified raw
request body as `byte[]` before any JSON deserialization runs):

```java
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class VaWebhookVerifier {
  public record VerifiedWebhook(String eventId, JsonNode event) {}

  public static VerifiedWebhook verifyVaWebhook(
    byte[] rawBody,
    String eventId,
    String timestamp,
    String signatureHeader,
    String secret,
    ObjectMapper json) throws Exception {
  if (eventId == null || timestamp == null || signatureHeader == null
      || !signatureHeader.startsWith("v1=")) {
    throw new SecurityException("Missing VA webhook headers");
  }

  long sentAt;
  try { sentAt = Long.parseLong(timestamp); }
  catch (NumberFormatException error) { throw new SecurityException("Invalid timestamp"); }
  if (Math.abs(Instant.now().getEpochSecond() - sentAt) > 300) {
    throw new SecurityException("Stale VA webhook timestamp");
  }

  String receivedHex = signatureHeader.substring(3);
  if (!receivedHex.matches("^[0-9a-f]{64}$")) {
    throw new SecurityException("Invalid VA webhook signature format");
  }

  Mac mac = Mac.getInstance("HmacSHA256");
  mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
  mac.update((timestamp + ".").getBytes(StandardCharsets.UTF_8));
  byte[] expected = mac.doFinal(rawBody);
  byte[] received = HexFormat.of().parseHex(receivedHex);
  if (!MessageDigest.isEqual(received, expected)) {
    throw new SecurityException("Invalid VA webhook signature");
  }

    return new VerifiedWebhook(eventId, json.readTree(rawBody));
  }
}
```

After verification, insert `eventId` into a durable table or queue with a unique
constraint. A duplicate insert should return `2xx` without processing the event
again. The KYC handoff and VA activation snapshots may be persisted directly after
verification; financial and reconciliation state must still be confirmed through the
resource APIs.

### 8.3 Credential rotation

Credential rotation requires Operations approval. The machine API never returns
the new Client Secret. After approval, an authenticated Partner Portal user uses
TOTP step-up to reveal it once. Store it immediately in a managed secret store.

`GET /api-integration` returns non-secret credential metadata, approved IP and
webhook state, pending requests, and recent delivery records. `payload_json` is
stored JSON text for a delivery and can contain customer, Sumsub-link, transaction, or VA
bank-account data; treat it as sensitive operational data, avoid logging KYC links, and
redact account numbers in logs.

## 9. Errors and retries

Error responses use a stable machine-readable code:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed"
  }
}
```

Branch on `error.code`, not localized message text.

| HTTP | Meaning | Client action |
| ----- | ---------------------------------------------- | ------------------------------------- |
| `400` | Malformed JSON or request | Fix the request |
| `401` | Invalid or expired authentication | Replace credentials; do not loop |
| `403` | Access, IP, role, or business operation denied | Stop and investigate |
| `404` | Resource or path not found | Verify the ID and endpoint |
| `409` | State or identity conflict | Read current state before deciding |
| `413` | Body exceeds the limit | Reduce the request body |
| `422` | Validation or unknown fields | Correct the payload |
| `429` | Rate limit exceeded | Respect `Retry-After` |
| `5xx` | Service unavailable or internal failure | Retry safe reads with bounded backoff |

Do not automatically retry validation failures or disabled financial writes.
For write retries, preserve the original request identity and body where the
endpoint defines idempotency behavior.

## 10. Response shapes and field reference

### 10.1 HTTP status, headers, and envelopes

Read `X-Request-Id` from every response that reaches the Partner API. Use it for
support and tracing without sending credentials or complete customer data. A
successful application creation also returns a `Location` header.

| Endpoint type                         |        Success | JSON response shape                                             |
| ------------------------------------- | -------------: | --------------------------------------------------------------- |
| `GET /health`                         |          `200` | `{ "status", "service", "time" }`                               |
| `GET /country-calling-codes`          |          `200` | `{ "data": [...], "meta": {...} }`                              |
| `POST /va-applications`               |          `201` | Direct `Application` object, without a `data` envelope          |
| Single application, fund, or OTC read |          `200` | Direct resource object, without a `data` envelope               |
| Normal list read                      |          `200` | `{ "data": [...] }`; paginated endpoints also return `meta`     |
| `GET /customers/{id}`                 |          `200` | `{ "customer", "balances", "fund_transactions", "otc_orders" }` |
| `GET /sweep-batches/{batchId}`        |          `200` | `{ "data": SweepBatch }`                                        |
| Integration-management request        | `200` or `201` | `{ "data": IntegrationRequest }`                                |
| Webhook test                          |          `202` | `{ "data": WebhookDelivery }`                                   |

Every error uses these fields:

| Field                 | Java type          | Meaning                                                  |
| --------------------- | ------------------ | -------------------------------------------------------- |
| `error.code`          | `String`           | Stable machine code; branch on this value                |
| `error.message`       | `String`           | Human message that may be localized; do not branch on it |
| header `X-Request-Id` | `String`           | Request trace ID for redacted logs                       |
| header `Retry-After`  | `String` / seconds | Recommended delay after `429`                            |

### 10.2 Application response fields

The `Application` shape is returned by `POST /va-applications`, resubmission, application
reads, and the `customer` field in a customer overview.

| Field                 | Java type            |              Nullable | Meaning                                                                     |
| --------------------- | -------------------- | --------------------: | --------------------------------------------------------------------------- |
| `application_id`      | `String`             |                    No | Platform-generated application ID                                           |
| `partner_customer_id` | `String`             | Legacy customers only | Partner-owned canonical lowercase UUID v4                                  |
| `phone_country_code`  | `String`             |                    No | E.164 calling code                                                          |
| `phone_number`        | `String`             |                    No | National number without calling code                                        |
| `email`               | `String`             |                    No | Customer email                                                              |
| `customer_name`       | `String`             |                    No | Customer name                                                               |
| `status`              | `String`             |                    No | Existing onboarding status, or `changes_requested` while correction is required |
| `onboarding_stage`    | `String`             |                    No | Actual onboarding stage retained while review is blocked                    |
| `submission_round`    | `Integer`            |                    No | Current submission round, starting at `1`                                   |
| `application_version` | `Integer`            |                    No | Optimistic concurrency version required for resubmission                    |
| `last_submitted_at`   | `String` / `Instant` |                    No | Most recent initial submission or resubmission time                         |
| `action_required`     | `Object`             |                   Yes | Safe reason and required fields for `changes_requested`; otherwise `null`   |
| `kyc_url`             | `String`             |                   Yes | Actionable only for `kyc_link_ready`; otherwise `null`                      |
| `va_account`          | `VaAccount`          |                   Yes | `null` before VA activation                                                 |
| `created_at`          | `String` / `Instant` |                    No | ISO 8601 creation time                                                      |
| `updated_at`          | `String` / `Instant` |                    No | ISO 8601 update time                                                        |

When `va_account` is present it contains:

| Field            | Java type | Nullable | Meaning                     |
| ---------------- | --------- | -------: | --------------------------- |
| `account_name`   | `String`  |       No | Registered beneficiary name |
| `account_number` | `String`  |       No | Virtual-account number      |
| `iban`           | `String`  |      Yes | Optional IBAN               |
| `currency`       | `String`  |       No | Currently `USD`             |
| `swift_bic`      | `String`  |       No | Receiving-bank SWIFT/BIC    |
| `bank_name`      | `String`  |       No | Bank name                   |
| `bank_address`   | `String`  |       No | Bank address                |

### 10.3 Customer, balance, and pagination fields

Each `GET /customers` item extends the `Application` fields with a `balances`
array. `GET /customers/{id}` returns four top-level fields:

| Field               | Java type               | Meaning                             |
| ------------------- | ----------------------- | ----------------------------------- |
| `customer`          | `ApplicationResponse`   | Customer and onboarding state       |
| `balances`          | `List<Balance>`         | Balances split by asset and network |
| `fund_transactions` | `List<FundTransaction>` | Recent fund records                 |
| `otc_orders`        | `List<OtcOrder>`        | Recent system conversion records    |

`Balance` fields:

| Field                 | Java type |                          Nullable | Meaning                                         |
| --------------------- | --------- | --------------------------------: | ----------------------------------------------- |
| `application_id`      | `String`  |                                No | Platform application ID                         |
| `partner_customer_id` | `String`  |             Legacy customers only | Partner customer ID                             |
| `asset`               | `String`  |                                No | For example `USD` or `USDT`                     |
| `network`             | `String`  |                         Fiat only | `TRON`, `ETHEREUM`, `SOLANA`, or `BSC` for USDT |
| `ledger_balance`      | `String`  |                                No | Posted balance; parse with `BigDecimal`         |
| `reserved`            | `String`  |                                No | Amount reserved by processing records           |
| `available_balance`   | `String`  |                                No | Posted balance less reserved amount             |
| `asset_decimals`      | `Integer` | May be absent in legacy responses | Asset precision                                 |

Common `meta` fields:

| Field         | Java type            | Meaning                                                        |
| ------------- | -------------------- | -------------------------------------------------------------- |
| `count`       | `Integer`            | Current-page count, where returned                             |
| `total`       | `Integer`            | Total records matching the filter                              |
| `page`        | `Integer`            | One-based current page                                         |
| `limit`       | `Integer`            | Page size                                                      |
| `total_pages` | `Integer`            | Total pages; zero for an empty result; omitted by `/customers` |
| `snapshot_at` | `String` / `Instant` | Balance snapshot time returned by `/customers`                 |

### 10.4 Unified transaction fields

`GET /transactions` returns `{ "data": [...], "meta": {...} }`. Each row is a
`TransactionHistoryItem`. One shape
covers fund, conversion-projection, OTC, and sweep rows. Fields that do not apply
to a row can be `null` or absent.

| Field                                                           | Java type            | Meaning                                                                                                                                           |
| --------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                            | `String`             | Display-row ID                                                                                                                                    |
| `application_id`, `partner_customer_id`                         | `String`             | Both customer IDs; Partner ID may be `null` for legacy customers                                                                                  |
| `customer_name`                                                 | `String`             | Customer name                                                                                                                                     |
| `category`                                                      | `String`             | `fund` or `otc`                                                                                                                                   |
| `type`                                                          | `String`             | `fiat_deposit`, `usdt_deposit`, `fiat_withdrawal`, `usdt_withdrawal`, `fiat_conversion_debit`, `crypto_conversion_credit`, `usdt_sweep`, or `otc` |
| `direction`                                                     | `String`             | `credit`, `debit`, or `exchange`                                                                                                                  |
| `asset`, `amount`                                               | `String`             | Primary asset and decimal amount                                                                                                                  |
| `counter_asset`, `counter_amount`                               | `String`             | Conversion counter asset and amount                                                                                                               |
| `buy_amount`, `net_buy_amount`                                  | `String`             | Gross and post-fee OTC buy amounts                                                                                                                |
| `fee_amount`, `fee_rate`, `exchange_rate`                       | `String`             | Fee and rate snapshots                                                                                                                            |
| `net_amount`                                                    | `String`             | Net delivered amount when applicable                                                                                                              |
| `status`                                                        | `String`             | `submitted`, `processing`, `completed`, `rejected`, or `cancelled`                                                                                |
| `settlement_status`                                             | `String`             | `pending`, `cleared`, `exception`, or `null`                                                                                                      |
| `network`, `counter_network`                                    | `String`             | Primary and counter-asset networks                                                                                                                |
| `reference`                                                     | `String`             | Customer-visible execution reference; completed sweep uses the TRON Tx Hash                                                                       |
| `external_reference`, `transaction_reference`                   | `String`             | External request and bank/chain execution references                                                                                              |
| `conversion_otc_id`, `otc_order_id`                             | `String`             | Related OTC IDs                                                                                                                                   |
| `source_fund_transaction_id`                                    | `String`             | Original fund record related to automatic conversion                                                                                              |
| `ledger_entry_id`                                               | `String`             | Posted ledger-entry ID                                                                                                                            |
| `sweep_batch_id`                                                | `String`             | Related completed sweep batch                                                                                                                     |
| `destination`                                                   | `String`             | Wallet destination when applicable                                                                                                                |
| `beneficiary_name`, `beneficiary_address`                       | `String`             | Historical bank beneficiary fields                                                                                                                |
| `bank_name`, `bank_account_number`, `swift_bic`, `bank_address` | `String`             | Historical bank fields                                                                                                                            |
| `note`                                                          | `String`             | Partner-visible note; not an internal state signal                                                                                                |
| `created_at`, `updated_at`, `completed_at`                      | `String` / `Instant` | Lifecycle times; completion time can be `null`                                                                                                    |

### 10.5 Fund, OTC, and sweep fields

`FundTransaction`:

| Field                                                                                                      | Java type            | Meaning                                                                 |
| ---------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| `id`, `application_id`, `partner_customer_id`                                                              | `String`             | Fund record ID and both customer IDs                                    |
| `customer_name`                                                                                            | `String`             | Customer name                                                           |
| `type`                                                                                                     | `String`             | `fiat_deposit`, `usdt_deposit`, `fiat_withdrawal`, or `usdt_withdrawal` |
| `asset`, `amount`, `fee_amount`, `net_amount`                                                              | `String`             | Asset and decimal amounts                                               |
| `status`                                                                                                   | `String`             | Processing status                                                       |
| `settlement_status`                                                                                        | `String`             | `pending`, `cleared`, or `exception`                                    |
| `external_reference`, `transaction_reference`                                                              | `String`             | External and bank/chain references                                      |
| `conversion_otc_id`                                                                                        | `String`             | OTC ID created by cleared automatic conversion                          |
| `network`, `destination`                                                                                   | `String`             | Digital-asset network and destination                                   |
| `beneficiary_name`, `beneficiary_address`, `bank_name`, `bank_account_number`, `swift_bic`, `bank_address` | `String`             | Historical fiat bank fields                                             |
| `note`                                                                                                     | `String`             | Partner-visible note                                                    |
| `created_at`, `updated_at`, `completed_at`                                                                 | `String` / `Instant` | Lifecycle times                                                         |

`OtcOrder`:

| Field                                         | Java type            | Meaning                      |
| --------------------------------------------- | -------------------- | ---------------------------- |
| `id`, `application_id`, `partner_customer_id` | `String`             | OTC ID and both customer IDs |
| `customer_name`                               | `String`             | Customer name                |
| `sell_asset`, `sell_network`, `sell_amount`   | `String`             | Sell side                    |
| `buy_asset`, `buy_network`, `buy_amount`      | `String`             | Gross buy side               |
| `exchange_rate`                               | `String`             | Rate snapshot                |
| `fee_rate`, `fee_amount`                      | `String`             | Fee rate and amount          |
| `net_buy_amount`                              | `String`             | Post-fee buy amount          |
| `status`                                      | `String`             | OTC processing status        |
| `note`                                        | `String`             | Partner-visible note         |
| `created_at`, `updated_at`, `completed_at`    | `String` / `Instant` | Lifecycle times              |

`SweepBatch`:

| Field                                                        | Java type              |               Nullable | Meaning                                            |
| ------------------------------------------------------------ | ---------------------- | ---------------------: | -------------------------------------------------- |
| `batch_id`                                                   | `String`               |                     No | Sweep batch ID                                     |
| `status`                                                     | `String`               |                     No | `locked`, `submitted`, `completed`, or `cancelled` |
| `network`, `asset`                                           | `String`               |                     No | Currently `TRON` and `USDT`                        |
| `total_amount`                                               | `String`               |                     No | Total batch amount                                 |
| `destination_address`                                        | `String`               |                     No | Destination snapshot fixed at lock time            |
| `tx_hash`                                                    | `String`               |                    Yes | `null` before chain submission                     |
| `created_at`, `submitted_at`, `completed_at`, `cancelled_at` | `String` / `Instant`   | Last three can be null | Lifecycle times                                    |
| `items`                                                      | `List<SweepBatchItem>` |                     No | Per-customer rows visible to this Partner          |

Each `items[]` row contains `application_id`, `partner_customer_id`,
`customer_name`, `amount`, and `ledger_entry_id`. `ledger_entry_id` is populated
only after completion and posting.

### 10.6 API integration-management fields

`GET /api-integration` returns `{ "data": {...} }` with:

| `data` field                   | Java type                         | Meaning                                                                                                    |
| ------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `summary`                      | `Object`                          | Counts for `pending`, `approved_ip_rules`, `webhook_endpoints`, `api_credentials`, and `failed_deliveries` |
| `requests`                     | `List<IntegrationRequest>`        | IP and Webhook requests                                                                                    |
| `credentials`                  | `List<ApiCredential>`             | Credential metadata without Secrets                                                                        |
| `credential_rotation_requests` | `List<CredentialRotationRequest>` | Rotation requests                                                                                          |
| `webhook_signing_keys`          | `List<WebhookSigningKey>`          | Non-secret key IDs and lifecycle metadata                                                                  |
| `webhook_signing_key_requests`  | `List<WebhookSigningKeyRequest>`   | Signing-key creation and rotation requests                                                                 |
| `ip_allowlist`                 | `List<IpAllowlistRule>`           | Approved IP/CIDR rules                                                                                     |
| `webhooks`                     | `List<WebhookEndpoint>`           | Approved Webhook endpoints                                                                                 |
| `deliveries`                   | `List<WebhookDelivery>`           | Recent delivery records                                                                                    |
| `security`                     | `Object`                          | Access, allowlist, rate-limit, and credential-management state                                             |

Request responses primarily return `id`, `kind`, `action`, `status`, `reason`,
`review_note`, target-setting fields, `requested_by`, `requested_via`,
`created_at`, `updated_at`, and `reviewed_at`. `status` is `pending`, `approved`,
`rejected`, or `cancelled`. Credential-rotation responses also include
`migration_window_hours`; the machine API never returns a Secret.

`WebhookDelivery` contains `id`, `endpoint_url`, `event_type`, `resource_type`,
`resource_id`, `application_id`, `resource_status`, `status`, `response_status`,
`payload_json`, `attempt_count`, `next_attempt_at`, `last_attempt_at`,
`created_at`, `updated_at`, and `delivered_at`. `payload_json` is itself a JSON
string that must be parsed again and treated as sensitive operational data.

## 11. Production acceptance checklist

- [ ] Service Token is stored only in the Partner backend secret store.
- [ ] Production and disaster-recovery egress IPs are approved.
- [ ] `/health` returns expected JSON and `X-Request-Id` with valid credentials.
- [ ] OpenAPI parses and the application request matches its schema.
- [ ] Application creation and status polling are validated with real business fields.
- [ ] Customer, balance, transaction, fund, and OTC query responses are validated.
- [ ] The integration contains no customer-facing deposit, withdrawal, or OTC submit action.
- [ ] Webhook raw-body signature, timestamp, deduplication, and API re-read are tested.
- [ ] `401`, `403`, `409`, `422`, `429`, and `5xx` paths are handled explicitly.
- [ ] Logs redact credentials, customer data, bank data, wallet addresses, and payload bodies.

Passing this checklist means the Partner integration is ready for controlled
testing. It does not authorize or prove completion of any underlying bank,
blockchain, settlement, sweep, or conversion operation.
