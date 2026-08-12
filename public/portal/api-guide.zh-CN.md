# Partner API 中文指南

版本：V1.7.0<br>
最后更新：2026 年 8 月 2 日<br>
API 根地址：`https://moventra.xyz/api/v1`<br>
适用对象：合作伙伴服务端集成团队

## 1. 文档范围

Partner API 只服务于两类业务用途：

1. 提交并查询虚拟账户开户申请；
2. 查询客户账户、余额、交易历史、资金记录，以及系统生成的 OTC 兑换记录。

合作伙伴还可以提交 API 凭证轮换、IP 白名单和 Webhook 配置申请。这些接入配置
必须经过运营后台审批后才会生效。

本文只描述 Partner 机器 API。Admin API、Portal 浏览器会话 API、运营清算、
归集控制、账本修改和一次性 Client Secret 领取均属于内部能力，不在本文契约内。

## 2. 资金业务边界

合作伙伴及其客户不能通过 Partner API 主动发起入金、提现或 OTC 订单。

- 不提供可用的 `/withdrawals` 接口；
- 不提供可用的 `/withdrawal-fees` 接口；
- `POST /fund-transactions` 不是可用的集成操作，调用会返回
  `403 fund_operation_disabled`；
- `POST /otc-orders` 不是可用的集成操作，调用会返回
  `403 manual_otc_disabled`。

后台只有在核实底层银行入账后才会记录法币入金。入金完成清算并触发后台配置的
处理流程后，系统创建相应的 USD→USDT/TRON 兑换和账本记录。合作伙伴随后只能
通过查询接口读取资金、兑换和 OTC 结果。页面或 API 中出现一条记录，只代表系统
已经记录或处理该事件，不代表客户能够据此主动发起资金操作。

历史提现或 OTC 记录仍可能出现在查询结果中，但这不表示合作伙伴能够创建新的
提现或 OTC 订单。

## 3. 认证与请求控制

所有机器请求必须从合作伙伴后端发送，并同时携带以下 Cloudflare Access 请求头：

```http
CF-Access-Client-Id: <service-token-client-id>
CF-Access-Client-Secret: <service-token-client-secret>
```

不得将这些值暴露到浏览器、移动端、代码仓库、工单、截图或客户端日志中。

### 3.1 安全责任边界

- Service Token 只允许保存在 Partner 服务端的受管密钥系统；
- 每个生产环境使用独立出口 IP、独立凭证和独立 Webhook 签名密钥；
- 不要在 URL 查询参数中传递凭证、签名或个人资料；URL 可能进入代理和访问日志；
- 日志只保存 `X-Request-Id`、资源 ID、HTTP 状态和稳定错误码，禁止记录认证请求头；
- 收到 `401` 或 `403` 时停止自动重试，先排查凭证、Access 策略和 IP 白名单；
- 怀疑凭证泄露时，立即从受控 Portal 提交轮换申请，并保留审计记录。

Partner API 与 Portal 登录是两套认证体系。机器集成不能使用浏览器 Session，Portal
也不应保存机器 Service Token。`application_id`、`batchId` 等资源 ID 不是授权凭证；
Worker 会再次执行 Partner 范围过滤。

### 3.2 数据隔离与防枚举

Partner 归集读取同时校验批次归属和批次内客户归属。范围不一致的批次按不可见处理。
不存在或不属于当前 Partner 的资源统一返回 `404 not_found`，不得据此推断其他
Partner 的数据。

响应只包含集成所需业务字段，不返回内部备注、操作员身份、租户内部键、地址配置版本
或后台投递状态。客户姓名、申请 ID、钱包地址、金额和 Tx Hash 仍属于敏感财务数据，
Partner 应加密保存并限制访问。

其他控制要求：

- 默认限流为每 60 秒 120 次请求；
- 启用 IP 白名单后，请求必须来自已批准的公网出口 IP 或 CIDR；
- JSON 写请求最大 16 KB，未知字段会被拒绝；
- 受保护 API 数据使用 `Cache-Control: no-store`；
- 到达 Worker 的每个请求都会返回 `X-Request-Id`；
- HTTP 200 本身不代表业务验收通过，必须校验 JSON 结构和业务字段。

环境变量示例：

```bash
export VA_API_BASE_URL="https://moventra.xyz/api/v1"
export VA_CF_ACCESS_CLIENT_ID="<service-token-client-id>"
export VA_CF_ACCESS_CLIENT_SECRET="<service-token-client-secret>"
```

请求示例：

```bash
curl --silent --show-error \
  --header "CF-Access-Client-Id: ${VA_CF_ACCESS_CLIENT_ID}" \
  --header "CF-Access-Client-Secret: ${VA_CF_ACCESS_CLIENT_SECRET}" \
  "${VA_API_BASE_URL}/health"
```

### 3.3 可复制的 Java 参考客户端

以下示例适用于 Java 17+，使用 `java.net.http.HttpClient` 和 Jackson。Jackson 请使用
团队批准且仍在维护的版本。代码只能运行在后端服务器，两个 Access 请求头绝不能
暴露到浏览器或移动端。

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

业务调用示例：

```java
VaApiClient api = new VaApiClient(
    System.getenv().getOrDefault("VA_API_BASE_URL", "https://moventra.xyz/api/v1"),
    System.getenv("VA_CF_ACCESS_CLIENT_ID"),
    System.getenv("VA_CF_ACCESS_CLIENT_SECRET"));

// Partner 客户 ID 必须使用标准小写 UUID v4 String。
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

常用响应建议使用以下 Jackson DTO；`ignoreUnknown = true` 可以让服务端增加兼容字段时
不影响旧客户端，但程序仍应明确读取业务所需字段：

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

列表接口应递增 `page`，直到当前页到达返回的 `meta.total_pages`。`/customers` 的
元数据不返回 `total_pages`，应在 `page * limit >= meta.total` 时停止。金额字段必须
一直保持十进制字符串，在 Java 中使用 `BigDecimal` 解析，不能使用 `double`。

## 4. 可用接口目录

下列路径均相对于 API 根地址。

### 4.1 服务与参考数据

| 方法 | 路径 | 用途 |
| ----- | ------------------------ | ---------------------- |
| `GET` | `/` | API 元数据和标准入口 |
| `GET` | `/health` | 可用性和服务端时间 |
| `GET` | `/openapi.yaml` | 标准 OpenAPI 3.1 契约 |
| `GET` | `/country-calling-codes` | 可用电话国家或地区区号 |

### 4.2 开户

| 方法 | 路径 | 用途 |
| ------ | ---------------------------------- | ------------------------ |
| `POST` | `/va-applications` | 提交客户虚拟账户开户申请 |
| `GET` | `/va-applications` | 查询开户申请列表 |
| `GET` | `/va-applications/{applicationId}` | 查询单笔开户申请 |
| `POST` | `/va-applications/{applicationId}/resubmit` | 修改资料并重新提交已驳回申请 |
| `GET` | `/customers` | 查询客户摘要和余额 |
| `GET` | `/customers/{applicationId}` | 查询单个客户总览 |

### 4.3 只读资金数据

| 方法 | 路径 | 用途 |
| ----- | ------------------------------------ | ----------------------------------- |
| `GET` | `/balances?application_id=...` | 查询账本、冻结和可用余额 |
| `GET` | `/transactions` | 查询统一交易历史 |
| `GET` | `/sweep-batches` | 查询本 Partner 的归集批次及当前状态 |
| `GET` | `/sweep-batches/{batchId}` | 查询单个归集批次和逐客户明细 |
| `GET` | `/fund-transactions` | 查询入金和历史提现记录 |
| `GET` | `/fund-transactions/{transactionId}` | 查询单条资金记录 |
| `GET` | `/otc-orders` | 查询历史和系统生成的 OTC 兑换 |
| `GET` | `/otc-orders/{orderId}` | 查询单条 OTC 兑换记录 |

这些接口对合作伙伴均为只读。调用它们不会创建、批准、清算、结算或完成任何
资金操作。

### 4.4 API 接入管理

| 方法 | 路径 | 用途 |
| ------ | ------------------------------------------------------------------ | ------------------------------------ |
| `GET` | `/api-integration` | 查询配置、申请、凭证元数据和投递记录 |
| `POST` | `/api-integration/ip-allowlist-requests` | 申请新增或移除 IP/CIDR |
| `POST` | `/api-integration/webhook-requests` | 申请新增、修改或停用 Webhook |
| `POST` | `/api-integration/credential-rotation-requests` | 申请轮换服务令牌凭证 |
| `GET` | `/api-integration/credential-rotation-requests/{requestId}` | 查询轮换申请 |
| `POST` | `/api-integration/credential-rotation-requests/{requestId}/cancel` | 撤回待审批轮换申请 |
| `POST` | `/api-integration/webhook-signing-key-requests` | 申请创建或轮换 Webhook 签名密钥 |
| `POST` | `/api-integration/webhook-signing-key-requests/{requestId}/cancel` | 撤回待审批签名密钥申请 |
| `GET` | `/api-integration/requests/{requestId}` | 查询 IP 或 Webhook 申请 |
| `POST` | `/api-integration/requests/{requestId}/cancel` | 撤回待审批 IP 或 Webhook 申请 |
| `POST` | `/api-integration/webhook-test` | 创建签名测试事件 |

## 5. 客户开户

### 5.1 读取电话区号

客户端应定期读取 `GET /country-calling-codes`，不要硬编码区号。该列表只是国家或
地区层面的运营预筛选，不能替代 KYC、受益所有人、制裁或区域合规筛查。

### 5.2 提交开户申请

`POST /va-applications` 只接受以下字段。`partner_customer_id` 是合作方自己的
客户标识，必须始终作为标准小写 UUID v4 字符串传输：

```json
{
  "partner_customer_id": "eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4",
  "phone_country_code": "+65",
  "phone_number": "81234567",
  "email": "customer@example.com",
  "customer_name": "Example Customer"
}
```

客户方客户 ID 必须是标准小写 UUID v4，并且在同一个 Partner 下唯一。国家或地区区号与
本地号码必须分开传递。不支持或拼写错误的字段返回 `422`，
客户端不应自动重试校验错误。

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

开户状态：

| 状态 | 含义 |
| ---------------- | --------------------------------- |
| `submitted` | 已收到申请，等待运营审核 |
| `kyc_link_ready` | `kyc_url` 暂时可用 |
| `kyc_approved` | KYC 已通过 |
| `va_processing` | 正在开立虚拟账户 |
| `active` | 虚拟账户已激活，`va_account` 可用 |
| `changes_requested` | 运营已驳回并要求补正；读取 `action_required` 后重新提交 |

`kyc_url` 只在状态为 `kyc_link_ready` 时可操作，其他状态返回 `null`。对应的
`application.status_changed` Webhook 也会携带该链接，供接收方立即交给客户；事件
遗漏恢复、链接失效处理或对账时再重新查询申请。

### 5.3 修改并重新提交

当状态为 `changes_requested` 时，根据 `action_required.reason_message` 和
`required_fields` 完成补正，再调用：

```http
POST /va-applications/{applicationId}/resubmit
Idempotency-Key: <本次重新提交的稳定唯一键>
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

重提沿用原 `application_id` 和 `partner_customer_id`，增加 `submission_round`，并回到
`submitted` 重新审核。必须提交最新 `application_version`；版本冲突返回
`409 application_version_conflict`。相同幂等键和相同内容返回当前申请，同一键用于
不同内容返回 `409 idempotency_conflict`。

## 6. 客户与余额

`GET /customers` 返回客户摘要。`GET /customers/{applicationId}` 返回客户、余额、
近期资金记录和 OTC 记录。详情路径既可以使用系统生成的 `application_id`，也可以
使用小写 UUID v4 `partner_customer_id`。

需要按客户方 ID 精确查询时，可向 `/customers`、`/balances`、`/transactions`、
`/fund-transactions`、`/otc-orders` 或 `/sweep-batches` 传递
`partner_customer_id`，但不能与 `application_id` 同时传递。开户、客户、资金、
OTC、交易历史、归集明细和 Webhook 负载都会返回两个 ID；历史客户在合作方提供
映射前可能返回 `partner_customer_id: null`。

`GET /balances?application_id=...` 或
`GET /balances?partner_customer_id=...` 返回余额桶：

- USD 使用 `network: null` 的法币行；
- USDT 按网络返回相互独立的余额行；
- `ledger_balance` 是已记账总额；
- `reserved` 是现有处理中记录占用的金额；
- `available_balance = ledger_balance - reserved`。

所有金额都是十进制字符串。不要使用二进制浮点数解析，应使用十进制计算库和
接口返回的资产精度。

## 7. 交易历史

### 7.1 统一交易历史

`GET /transactions` 是推荐的客户交易历史接口。它支持 `application_id` 或
`partner_customer_id`、
`category`、`status`、`type`、`wallet`、`network`、`date_from`、`date_to`、
`page` 和 `limit` 等筛选参数。

记录可能表示：

- 已核实的法币或 USDT 入金；
- 历史提现；
- 系统生成的 OTC 兑换；
- 法币兑换扣账和数字资产兑换入账投影。
- 已完成的逐客户 USDT/TRON 归集扣账。

对应的机器 `type` 值包括 `fiat_conversion_debit` 和
`crypto_conversion_credit`。归集完成记录使用 `type: "usdt_sweep"`。

使用 `source_fund_transaction_id`、`conversion_otc_id` 和 `otc_order_id` 等关联
字段核对相关记录。不得因为出现这些记录就推断客户可以发起新的资金操作。

### 7.2 资金记录

`GET /fund-transactions` 和 `GET /fund-transactions/{transactionId}` 用于查询入金
和历史提现记录。重要字段包括 `settlement_status`、`conversion_otc_id`、
`transaction_reference`、`network` 和时间戳。

清算状态：

| 状态 | 含义 |
| ----------- | -------------------------- |
| `pending` | 尚未清算 |
| `cleared` | 底层入账或资金动作已经确认 |
| `exception` | 需要运营人工处理 |

只有运营后台能够记录或修改底层资金事件。

### 7.3 USDT 归集记录

归集由平台后台统一发起，Partner 不能创建、提交、完成或取消批次。Webhook 用于实时
通知；以下只读批次接口用于主动对账、补漏和恢复：

```http
GET /sweep-batches?status=submitted&application_id=app_customer_001&page=1&limit=100
GET /sweep-batches/{batchId}
```

列表接口的 `page` 从 1 开始，`limit` 允许 1 至 100；默认值分别为 1 和 100。
每次响应都包含 `meta.total`、`meta.page`、`meta.limit` 和
`meta.total_pages`；空结果的 `total_pages` 为 0。完整对账时，应从 `page=1`
遍历到 `total_pages`，不能假设第一页包含全部批次。

详情接口返回以下单个批次结构：

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

- `locked`：金额进入 `reserved`，`available_balance` 相应减少；尚无 Tx Hash；
- `submitted`：链上交易已提交，金额继续保留在 `reserved`，尚未正式记账；
- `completed`：逐客户扣账已写入账本，`ledger_entry_id` 有值，预留解除；
- `cancelled`：未提交的锁定批次已取消，不产生扣账，预留解除。

接口只返回当前 Partner 的批次及客户。不存在的批次 ID 与其他 Partner 的批次 ID
均返回 `404 not_found`，防止猜测 ID。响应不包含内部备注、操作员身份、
地址配置版本、Webhook 内部投递状态或其他 Partner 明细。

建议的安全补漏流程：

1. 以 Webhook 事件 ID 做幂等去重，只把事件当作“需要重新读取”的信号；
2. 使用事件中的 `batch_id` 调用 `GET /sweep-batches/{batchId}` 获取当前状态；
3. 以 `batch_id` 保存批次，以 `application_id` 保存逐客户金额；
4. 批次 `completed` 后，以 `ledger_entry_id` 对账 `/transactions` 的最终扣账；
5. 定时查询 `/sweep-batches` 并遍历至 `meta.total_pages`，补偿丢失、延迟或处理失败的
   Webhook。

Webhook 可能重复或乱序。Partner 不应根据事件到达顺序回退本地状态，应始终以批次
查询结果为准。

运营后台完成 TRON 归集后，受影响的每个客户都会产生一条只读交易历史记录。
查询指定客户全部已完成的归集扣账：

```http
GET /transactions?application_id=<application-id>&type=usdt_sweep
```

只有状态达到 `completed` 的批次才会出现在交易历史。`locked` 和 `submitted`
阶段会影响余额和 `reserved`，但不会生成交易历史行。不存在
`usdt_sweep.submitted` Webhook 事件；应通过 `GET /sweep-batches/{batchId}` 或遍历
`GET /sweep-batches` 的所有分页观察 `submitted`，可用的早期状态通知是
`usdt_sweep.locked`。

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

`amount` 是本批次从该客户扣除的 USDT 金额。`sweep_batch_id` 用于关联同一后台
批次内的客户记录，`transaction_reference` 是共享的 TRON Tx Hash。Partner
响应不会返回归集操作员或内部备注。

不带筛选的 `GET /transactions` 也会包含这些记录；`category=fund`、
`wallet=crypto` 和 `network=TRON` 同样包含归集记录。其他网络筛选会排除归集记录。

### 7.4 OTC 兑换记录

`GET /otc-orders` 和 `GET /otc-orders/{orderId}` 仅用于查询。合作伙伴不能提交
兑换申请。

当前 USD→USDT/TRON 自动兑换流程为：

1. 运营后台核实法币入账；
2. 运营后台完成清算并触发配置好的后台处理流程；
3. 系统原子创建 OTC 兑换及账本记录；
4. 合作伙伴通过查询接口读取处理结果。

响应可能包含汇率快照、买入总额、费率、费用、净买入额、网络、状态和时间戳。
这些字段描述后台已经记录或完成的事件，不是报价单或客户下单表单。

## 8. API 接入管理

### 8.1 IP 白名单申请

新增申请提交 `action: "add"`、公网 `cidr`、`label`、`environment` 和 `reason`。
移除申请提交 `action: "remove"`、`target_entry_id` 和 `reason`。待审批申请不会
改变当前生产流量。

### 8.2 Webhook 申请

Webhook 配置必须审批。只接受标准 443 端口的公网 HTTPS 地址。包含凭证、查询
参数、片段、IP 字面量、本地或保留主机名，或 DNS 结果不符合要求的地址会被拒绝。

支持的事件：

- `application.status_changed`；
- `va_account.activated`；
- `fund_transaction.status_changed`；
- `fiat_deposit.cleared_and_converted`；
- `usdt_sweep.locked`；
- `usdt_sweep.completed`；
- `usdt_sweep.cancelled`；
- `otc_order.status_changed`。

不存在 `usdt_sweep.submitted` Webhook 事件。请通过归集详情接口或带分页的归集列表
观察 `submitted` 状态。

Webhook 投递包含：

```http
X-VA-Webhook-Id: <event-id>
X-VA-Webhook-Timestamp: <unix-seconds>
X-VA-Webhook-Signature: v1=<hex-hmac-sha256>
X-VA-Webhook-Key-Id: <managed-key-id-or-v1>
```

必须针对原始请求体验证签名、拒绝过期时间戳并按事件 ID 去重。
大多数 `application.status_changed` 仍是精简状态通知；当状态为 `kyc_link_ready`
时，事件会额外携带可操作的 Sumsub 链接，接收方不必立即查询 API 即可把 KYC
交给客户：

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

当运营要求补正时，同一事件类型会发送 Partner 可见且已经过安全筛选的原因；
`internal_note` 和审核员身份不会进入报文：

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
      "reason_message": "电话号码无法完成验证，请确认后重新提交。",
      "required_fields": ["phone_country_code", "phone_number"],
      "requested_at": "2026-08-03T10:30:00.000Z"
    }
  }
}
```

`va_account.activated` 会携带已激活 VA 账户快照，接收方不必立即查询 API 即可保存
完整开户结果：

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

这些报文是签名保护的开户时点快照。事件遗漏恢复、定期对账、链接失效处理或数据
冲突处理仍应查询对应资源 API，查询结果继续作为最终事实来源。

`fund_transaction.status_changed` 会携带客户可见的资金记录快照。例如，新录入的入账
会发送：

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

管理员录入后出现 `status: "submitted"` 和 `settlement_status: "pending"`，只表示运营
已记录这笔待处理入账，不代表已经清算，也不会把金额计入客户账本余额。清算完成后
另行发送 `fiat_deposit.cleared_and_converted`，其中包含完整清算与兑换结果：

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

Partner 必须在已审批的 Webhook 订阅中勾选
`fiat_deposit.cleared_and_converted`；只订阅 `fund_transaction.status_changed` 不会收到
该清算事件。报文不包含运营备注或内部员工身份。

安全处理顺序：先检查时间戳是否在接收方设置的短时间窗口内。使用收到的原始请求体
UTF-8 字节精确计算
`lowercase_hex(HMAC_SHA256(secret, timestamp + "." + rawBodyUtf8))`。从
`X-VA-Webhook-Signature` 中剥离字面量 `v1=` 前缀，再将收到的小写十六进制值与计算值
做恒定时间比较；验证成功后才解析 JSON。接收端应在事件可靠写入队列后快速返回
`2xx`，业务处理失败再由内部队列重试。禁止使用代理重新序列化后的 JSON 验签。

Webhook 端点必须是公网 HTTPS 443，不应跳转到未知地址，也不应把签名、原始请求体或
客户数据发送到公开错误跟踪系统。签名失败、时间戳过期和重复事件应留下不含敏感正文
的安全审计记录。

签名密钥由后台安全生成。申请经运营审批后，具有 `credentials.reveal` 权限的 Portal
用户通过 TOTP 只能领取一次；接收端保存完成后再显式启用。启用前旧密钥继续签名，
新密钥启用后旧密钥进入申请中约定的过渡期。`X-VA-Webhook-Key-Id` 用于选择对应密钥；
兼容旧 Worker Secret 的投递使用 `v1`。如果当前密钥仍有等待、重试或死信投递，系统会
阻止切换，避免旧事件因密钥版本变化被抑制或丢失。

Java 17+ 验签参考（Controller 必须在任何 JSON 反序列化之前取得未经修改的原始请求体
`byte[]`）：

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

验签通过后，应把 `eventId` 写入带唯一约束的持久化表或队列。重复写入时直接返回
`2xx`，不要再次处理事件。KYC 交接和 VA 激活快照可在验签后直接保存；资金及对账
状态仍必须通过资源 API 确认。

### 8.3 凭证轮换

凭证轮换需要运营审批。机器 API 永远不会返回新的 Client Secret。审批后，已登录
Partner Portal 的用户通过 TOTP 二次验证领取一次，并立即保存到受管密钥系统。

`GET /api-integration` 返回非敏感凭证元数据、已批准 IP 与 Webhook 状态、待处理
申请和近期投递记录。`payload_json` 是投递时保存的 JSON 文本，可能含客户、
Sumsub 链接、交易或 VA 银行账户数据，应按敏感运营数据处理，禁止记录 KYC 链接，
并在日志中对账户号码脱敏。

## 9. 错误与重试

错误响应包含稳定的机器错误码：

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed"
  }
}
```

客户端应根据 `error.code` 分支，不应依赖可能本地化的提示文本。

| HTTP | 含义 | 客户端操作 |
| ----- | -------------------------------- | ---------------------------- |
| `400` | JSON 或请求格式错误 | 修正请求 |
| `401` | 认证无效或过期 | 更换凭证，不要循环重试 |
| `403` | Access、IP、角色或业务操作被拒绝 | 停止并检查原因 |
| `404` | 资源或路径不存在 | 检查 ID 和接口 |
| `409` | 状态或身份冲突 | 读取当前状态后再处理 |
| `413` | 请求体超限 | 缩小请求体 |
| `422` | 校验失败或未知字段 | 修正负载 |
| `429` | 超过限流 | 遵守 `Retry-After` |
| `5xx` | 服务不可用或内部错误 | 对安全读请求进行有限退避重试 |

不要自动重试校验失败或被禁用的资金写操作。写请求需要重试时，应遵守该接口定义的
幂等规则，并保留原请求标识和请求体。

## 10. 返回结构与字段参考

### 10.1 HTTP 状态、响应头和外层结构

所有到达 Partner API 的响应都应读取 `X-Request-Id`，发生问题时用它定位请求，
不要提交凭证或完整客户数据。创建开户申请成功时还会返回 `Location` 响应头。

| 接口类型                       |       成功状态 | JSON 外层结构                                                   |
| ------------------------------ | -------------: | --------------------------------------------------------------- |
| `GET /health`                  |          `200` | `{ "status", "service", "time" }`                               |
| `GET /country-calling-codes`   |          `200` | `{ "data": [...], "meta": {...} }`                              |
| `POST /va-applications`        |          `201` | 直接返回 `Application` 对象，不包含 `data` 外层                 |
| 单条申请、资金或 OTC 查询      |          `200` | 直接返回对应资源对象，不包含 `data` 外层                        |
| 普通列表查询                   |          `200` | `{ "data": [...] }`，支持分页的接口另有 `meta`                  |
| `GET /customers/{id}`          |          `200` | `{ "customer", "balances", "fund_transactions", "otc_orders" }` |
| `GET /sweep-batches/{batchId}` |          `200` | `{ "data": SweepBatch }`                                        |
| 接入管理申请                   | `200` 或 `201` | `{ "data": IntegrationRequest }`                                |
| Webhook 测试                   |          `202` | `{ "data": WebhookDelivery }`                                   |

失败响应统一读取：

| 字段                  | Java 类型       | 含义                                       |
| --------------------- | --------------- | ------------------------------------------ |
| `error.code`          | `String`        | 稳定机器错误码，程序必须根据该字段分支     |
| `error.message`       | `String`        | 人类提示，可能本地化，不能作为程序判断依据 |
| 响应头 `X-Request-Id` | `String`        | 请求追踪 ID，应写入脱敏日志                |
| 响应头 `Retry-After`  | `String` / 秒数 | `429` 时建议等待的时间                     |

### 10.2 开户申请 `Application` 返回字段

适用于 `POST /va-applications`、`POST /va-applications/{applicationId}/resubmit`、`GET /va-applications`、
`GET /va-applications/{applicationId}` 以及客户对象中的 `customer`。

| 字段                  | Java 类型            |    可为 `null` | 含义                                                                       |
| --------------------- | -------------------- | -------------: | -------------------------------------------------------------------------- |
| `application_id`      | `String`             |             否 | 平台生成的申请 ID                                                          |
| `partner_customer_id` | `String`             | 历史客户可为空 | Partner 的标准小写 UUID v4 客户 ID                                         |
| `phone_country_code`  | `String`             |             否 | E.164 国家或地区区号                                                       |
| `phone_number`        | `String`             |             否 | 不含区号的本地号码                                                         |
| `email`               | `String`             |             否 | 客户邮箱                                                                   |
| `customer_name`       | `String`             |             否 | 客户名称                                                                   |
| `status`              | `String`             |             否 | 原有开户状态，或需要补正时为 `changes_requested`                           |
| `onboarding_stage`    | `String`             |             否 | 被驳回前保留的实际开户阶段                                                  |
| `submission_round`    | `Integer`            |             否 | 当前提交轮次，从 `1` 开始                                                   |
| `application_version` | `Integer`            |             否 | 乐观并发版本；重提时必须回传                                                |
| `last_submitted_at`   | `String` / `Instant` |             否 | 最近一次提交或重新提交时间                                                  |
| `action_required`     | `Object`             |             是 | `changes_requested` 时提供安全原因和需补正字段，否则为 `null`              |
| `kyc_url`             | `String`             |             是 | 仅 `kyc_link_ready` 阶段可用，其他状态为 `null`                            |
| `va_account`          | `VaAccount`          |             是 | VA 激活前为 `null`                                                         |
| `created_at`          | `String` / `Instant` |             否 | ISO 8601 创建时间                                                          |
| `updated_at`          | `String` / `Instant` |             否 | ISO 8601 更新时间                                                          |

`va_account` 非空时包含：

| 字段             | Java 类型 | 可为 `null` | 含义               |
| ---------------- | --------- | ----------: | ------------------ |
| `account_name`   | `String`  |          否 | 收款账户名称       |
| `account_number` | `String`  |          否 | 虚拟账户号码       |
| `iban`           | `String`  |          是 | 可选 IBAN          |
| `currency`       | `String`  |          否 | 当前为 `USD`       |
| `swift_bic`      | `String`  |          否 | 收款银行 SWIFT/BIC |
| `bank_name`      | `String`  |          否 | 银行名称           |
| `bank_address`   | `String`  |          否 | 银行地址           |

### 10.3 客户、余额和分页字段

`GET /customers` 的每个 `data[]` 元素是在 `Application` 字段基础上增加
`balances` 数组。`GET /customers/{id}` 返回四个顶层字段：

| 字段                | Java 类型               | 含义                   |
| ------------------- | ----------------------- | ---------------------- |
| `customer`          | `ApplicationResponse`   | 客户与开户状态         |
| `balances`          | `List<Balance>`         | 按资产和网络拆分的余额 |
| `fund_transactions` | `List<FundTransaction>` | 近期资金记录           |
| `otc_orders`        | `List<OtcOrder>`        | 近期系统兑换记录       |

`Balance` 字段：

| 字段                  | Java 类型 |          可为 `null` | 含义                                             |
| --------------------- | --------- | -------------------: | ------------------------------------------------ |
| `application_id`      | `String`  |                   否 | 平台申请 ID                                      |
| `partner_customer_id` | `String`  |       历史客户可为空 | Partner 客户 ID                                  |
| `asset`               | `String`  |                   否 | 例如 `USD`、`USDT`                               |
| `network`             | `String`  |             法币为空 | USDT 网络：`TRON`、`ETHEREUM`、`SOLANA` 或 `BSC` |
| `ledger_balance`      | `String`  |                   否 | 已记账余额，Java 使用 `BigDecimal`               |
| `reserved`            | `String`  |                   否 | 处理中预留金额                                   |
| `available_balance`   | `String`  |                   否 | 可用余额，等于已记账余额减预留                   |
| `asset_decimals`      | `Integer` | 兼容旧响应时可能缺少 | 资产小数精度                                     |

通用分页 `meta`：

| 字段          | Java 类型            | 含义                                          |
| ------------- | -------------------- | --------------------------------------------- |
| `count`       | `Integer`            | 当前页记录数，部分列表返回                    |
| `total`       | `Integer`            | 符合筛选条件的总记录数                        |
| `page`        | `Integer`            | 当前页，从 1 开始                             |
| `limit`       | `Integer`            | 每页数量                                      |
| `total_pages` | `Integer`            | 总页数；空结果为 0，`/customers` 不返回此字段 |
| `snapshot_at` | `String` / `Instant` | `/customers` 余额快照时间                     |

### 10.4 统一交易 `TransactionHistoryItem` 返回字段

`GET /transactions` 返回 `{ "data": [...], "meta": {...} }`。同一个结构覆盖资金、
兑换投影和归集，因此不适用字段可能为 `null` 或不返回；客户端不能假设每种交易都
具有银行、钱包或兑换字段。

| 字段                                                            | Java 类型            | 含义                                                                                                                                             |
| --------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                            | `String`             | 交易展示行 ID                                                                                                                                    |
| `application_id`、`partner_customer_id`                         | `String`             | 两套客户标识；历史客户的 Partner ID 可为 `null`                                                                                                  |
| `customer_name`                                                 | `String`             | 客户名称                                                                                                                                         |
| `category`                                                      | `String`             | `fund` 或 `otc`                                                                                                                                  |
| `type`                                                          | `String`             | `fiat_deposit`、`usdt_deposit`、`fiat_withdrawal`、`usdt_withdrawal`、`fiat_conversion_debit`、`crypto_conversion_credit`、`usdt_sweep` 或 `otc` |
| `direction`                                                     | `String`             | `credit`、`debit` 或 `exchange`                                                                                                                  |
| `asset`、`amount`                                               | `String`             | 主资产与金额；金额用 `BigDecimal`                                                                                                                |
| `counter_asset`、`counter_amount`                               | `String`             | 兑换对手资产与金额，不适用时为空                                                                                                                 |
| `buy_amount`、`net_buy_amount`                                  | `String`             | OTC 买入总额与扣费后金额                                                                                                                         |
| `fee_amount`、`fee_rate`、`exchange_rate`                       | `String`             | 费用、费率和汇率快照                                                                                                                             |
| `net_amount`                                                    | `String`             | 净交付金额，不适用时为空                                                                                                                         |
| `status`                                                        | `String`             | `submitted`、`processing`、`completed`、`rejected` 或 `cancelled`                                                                                |
| `settlement_status`                                             | `String`             | `pending`、`cleared`、`exception` 或 `null`                                                                                                      |
| `network`、`counter_network`                                    | `String`             | 主资产和对手资产网络                                                                                                                             |
| `reference`                                                     | `String`             | 客户可见执行参考；已完成归集为 TRON Tx Hash                                                                                                      |
| `external_reference`、`transaction_reference`                   | `String`             | 外部请求参考及银行/链上执行参考                                                                                                                  |
| `conversion_otc_id`、`otc_order_id`                             | `String`             | 关联 OTC 记录 ID                                                                                                                                 |
| `source_fund_transaction_id`                                    | `String`             | 自动兑换关联的原始资金记录 ID                                                                                                                    |
| `ledger_entry_id`                                               | `String`             | 已入账账本记录 ID                                                                                                                                |
| `sweep_batch_id`                                                | `String`             | 已完成归集关联的批次 ID                                                                                                                          |
| `destination`                                                   | `String`             | 钱包目标地址，不适用时为空                                                                                                                       |
| `beneficiary_name`、`beneficiary_address`                       | `String`             | 历史银行交易收款人信息                                                                                                                           |
| `bank_name`、`bank_account_number`、`swift_bic`、`bank_address` | `String`             | 历史银行交易字段                                                                                                                                 |
| `note`                                                          | `String`             | Partner 可见备注；不得用于推断内部操作状态                                                                                                       |
| `created_at`、`updated_at`、`completed_at`                      | `String` / `Instant` | 创建、更新和完成时间；未完成时 `completed_at` 为空                                                                                               |

### 10.5 资金、OTC 和归集返回字段

`FundTransaction`：

| 字段                                                                                                       | Java 类型            | 含义                                                                   |
| ---------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `id`、`application_id`、`partner_customer_id`                                                              | `String`             | 资金记录 ID 与两套客户 ID                                              |
| `customer_name`                                                                                            | `String`             | 客户名称                                                               |
| `type`                                                                                                     | `String`             | `fiat_deposit`、`usdt_deposit`、`fiat_withdrawal` 或 `usdt_withdrawal` |
| `asset`、`amount`、`fee_amount`、`net_amount`                                                              | `String`             | 资产及十进制金额                                                       |
| `status`                                                                                                   | `String`             | 处理状态                                                               |
| `settlement_status`                                                                                        | `String`             | `pending`、`cleared` 或 `exception`                                    |
| `external_reference`、`transaction_reference`                                                              | `String`             | 外部参考及银行/链上执行参考                                            |
| `conversion_otc_id`                                                                                        | `String`             | 清算后自动兑换产生的 OTC ID                                            |
| `network`、`destination`                                                                                   | `String`             | 数字资产网络及目标地址                                                 |
| `beneficiary_name`、`beneficiary_address`、`bank_name`、`bank_account_number`、`swift_bic`、`bank_address` | `String`             | 历史法币交易银行字段                                                   |
| `note`                                                                                                     | `String`             | Partner 可见备注                                                       |
| `created_at`、`updated_at`、`completed_at`                                                                 | `String` / `Instant` | 生命周期时间；未完成时完成时间为空                                     |

`OtcOrder`：

| 字段                                          | Java 类型            | 含义                 |
| --------------------------------------------- | -------------------- | -------------------- |
| `id`、`application_id`、`partner_customer_id` | `String`             | OTC ID 与两套客户 ID |
| `customer_name`                               | `String`             | 客户名称             |
| `sell_asset`、`sell_network`、`sell_amount`   | `String`             | 卖出资产、网络和金额 |
| `buy_asset`、`buy_network`、`buy_amount`      | `String`             | 买入资产、网络和总额 |
| `exchange_rate`                               | `String`             | 使用的汇率快照       |
| `fee_rate`、`fee_amount`                      | `String`             | 费率与费用           |
| `net_buy_amount`                              | `String`             | 扣费后的买入金额     |
| `status`                                      | `String`             | OTC 处理状态         |
| `note`                                        | `String`             | Partner 可见备注     |
| `created_at`、`updated_at`、`completed_at`    | `String` / `Instant` | 生命周期时间         |

`SweepBatch`：

| 字段                                                         | Java 类型              |  可为 `null` | 含义                                              |
| ------------------------------------------------------------ | ---------------------- | -----------: | ------------------------------------------------- |
| `batch_id`                                                   | `String`               |           否 | 归集批次 ID                                       |
| `status`                                                     | `String`               |           否 | `locked`、`submitted`、`completed` 或 `cancelled` |
| `network`、`asset`                                           | `String`               |           否 | 当前为 `TRON` 和 `USDT`                           |
| `total_amount`                                               | `String`               |           否 | 批次总额                                          |
| `destination_address`                                        | `String`               |           否 | 锁定时固定的目标地址快照                          |
| `tx_hash`                                                    | `String`               |           是 | 提交链上交易前为空                                |
| `created_at`、`submitted_at`、`completed_at`、`cancelled_at` | `String` / `Instant`   | 后三个可为空 | 批次生命周期时间                                  |
| `items`                                                      | `List<SweepBatchItem>` |           否 | 当前 Partner 的逐客户明细                         |

`items[]` 包含 `application_id`、`partner_customer_id`、`customer_name`、`amount` 和
`ledger_entry_id`；`ledger_entry_id` 只在批次完成并记账后有值。

### 10.6 API 接入管理返回字段

`GET /api-integration` 返回 `{ "data": {...} }`，其中：

| `data` 字段                    | Java 类型                         | 含义                                                                                             |
| ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `summary`                      | `Object`                          | `pending`、`approved_ip_rules`、`webhook_endpoints`、`api_credentials`、`failed_deliveries` 计数 |
| `requests`                     | `List<IntegrationRequest>`        | IP 与 Webhook 申请                                                                               |
| `credentials`                  | `List<ApiCredential>`             | 不含 Secret 的凭证元数据                                                                         |
| `credential_rotation_requests` | `List<CredentialRotationRequest>` | 凭证轮换申请                                                                                     |
| `webhook_signing_keys`          | `List<WebhookSigningKey>`          | 不含明文的 Key ID 与生命周期元数据                                                               |
| `webhook_signing_key_requests`  | `List<WebhookSigningKeyRequest>`   | 签名密钥创建与轮换申请                                                                           |
| `ip_allowlist`                 | `List<IpAllowlistRule>`           | 已批准 IP/CIDR 规则                                                                              |
| `webhooks`                     | `List<WebhookEndpoint>`           | 已批准 Webhook 配置                                                                              |
| `deliveries`                   | `List<WebhookDelivery>`           | 近期投递记录                                                                                     |
| `security`                     | `Object`                          | Access、IP 白名单、限流和凭证管理状态                                                            |

申请类响应的 `data` 主要包含 `id`、`kind`、`action`、`status`、`reason`、
`review_note`、目标配置字段、`requested_by`、`requested_via`、`created_at`、
`updated_at` 和 `reviewed_at`。`status` 为 `pending`、`approved`、`rejected` 或
`cancelled`。凭证轮换响应另含 `migration_window_hours`，机器 API 永远不返回 Secret。

`WebhookDelivery` 包含 `id`、`endpoint_url`、`event_type`、`resource_type`、
`resource_id`、`application_id`、`resource_status`、`status`、`response_status`、
`payload_json`、`attempt_count`、`next_attempt_at`、`last_attempt_at`、`created_at`、
`updated_at` 和 `delivered_at`。`payload_json` 本身是 JSON 字符串，需要再次解析，且应
按敏感运营数据处理。

## 11. 生产验收清单

- [ ] Service Token 只保存在合作伙伴后端密钥系统；
- [ ] 生产和灾备出口 IP 已审批；
- [ ] 使用有效凭证请求 `/health`，并校验 JSON 和 `X-Request-Id`；
- [ ] OpenAPI 可以解析，开户请求符合 Schema；
- [ ] 使用真实业务字段验证开户创建和状态查询；
- [ ] 验证客户、余额、交易、资金和 OTC 查询响应；
- [ ] 集成界面不存在客户主动入金、提现或 OTC 提交入口；
- [ ] 已验证 Webhook 原始请求体签名、时间戳、去重和 API 回查；
- [ ] 明确处理 `401`、`403`、`409`、`422`、`429` 和 `5xx`；
- [ ] 日志对凭证、客户资料、银行资料、钱包地址和负载正文进行脱敏。

完成以上检查只代表 Partner 集成可以进入受控测试，不代表任何底层银行、区块链、
清算、归集或兑换动作已经完成或获得授权。
