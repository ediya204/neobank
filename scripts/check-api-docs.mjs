import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');

const [guide, chineseGuide, publicGuide, publicChineseGuide, html, openApi, workerSource] =
  await Promise.all([
    fs.readFile(path.join(projectRoot, 'docs', 'PARTNER_API_GUIDE.md'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'docs', 'PARTNER_API_GUIDE.zh-CN.md'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'public', 'portal', 'api-guide.md'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'public', 'portal', 'api-guide.zh-CN.md'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'public', 'portal', 'api-guide.html'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'public', 'openapi.yaml'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'worker', 'index.ts'), 'utf8'),
  ]);
const [
  adminOperationsSource,
  portalSource,
  adminChineseLocale,
  adminEnglishLocale,
  portalChineseLocale,
  portalEnglishLocale,
] = await Promise.all([
  fs.readFile(path.join(projectRoot, 'src', 'pages', 'dashboard', 'operations.tsx'), 'utf8'),
  fs.readFile(path.join(projectRoot, 'src', 'pages', 'partner-portal.tsx'), 'utf8'),
  fs.readFile(path.join(projectRoot, 'src', 'locales', 'langs', 'operations.cn.json'), 'utf8'),
  fs.readFile(path.join(projectRoot, 'src', 'locales', 'langs', 'operations.en.json'), 'utf8'),
  fs.readFile(path.join(projectRoot, 'src', 'locales', 'langs', 'portal.cn.json'), 'utf8'),
  fs.readFile(path.join(projectRoot, 'src', 'locales', 'langs', 'portal.en.json'), 'utf8'),
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(guide === publicGuide, 'Public Markdown is stale. Run npm run docs:sync.');
assert(
  chineseGuide === publicChineseGuide,
  'Public Chinese Markdown is stale. Run npm run docs:sync.'
);
assert(
  !(await fileExists(path.join(projectRoot, 'public', 'partner-api-guide.html'))) &&
    !(await fileExists(path.join(projectRoot, 'public', 'partner-api-guide.md'))),
  'Legacy guide files still exist outside the Partner Portal Access path.'
);

const fences = guide.match(/^```/gm) ?? [];
assert(fences.length % 2 === 0, 'Partner guide contains an unclosed fenced code block.');

const openApiDocument = YAML.parseDocument(openApi, {
  prettyErrors: true,
  uniqueKeys: true,
});
assert(
  openApiDocument.errors.length === 0,
  `OpenAPI YAML is invalid:\n${openApiDocument.errors.map((item) => item.message).join('\n')}`
);
const contract = openApiDocument.toJS();
const expectedApiVersion = '1.7.0';
assert(
  contract?.openapi === '3.1.0' &&
    contract?.info?.version === expectedApiVersion &&
    contract?.servers?.[0]?.url === '/api/v1',
  'OpenAPI version or canonical Partner API server is incorrect.'
);
assert(
  workerSource.includes(`const PARTNER_API_VERSION = '${expectedApiVersion}'`) &&
    guide.includes(`Version: V${expectedApiVersion}`) &&
    chineseGuide.includes(`版本：V${expectedApiVersion}`),
  'Worker, OpenAPI, and Partner guide versions are inconsistent.'
);

const jsonBlocks = [...guide.matchAll(/```json\s*\n([\s\S]*?)```/g)];
for (const [index, match] of jsonBlocks.entries()) {
  try {
    JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`JSON example ${index + 1} is invalid: ${error.message}`);
  }
}

const requiredGuideContent = [
  'Version: V1.7.0',
  'Last updated: 2 August 2026',
  '/health',
  '/country-calling-codes',
  '/va-applications',
  '/va-applications/{applicationId}/resubmit',
  '/customers',
  '/balances',
  '/transactions',
  '/fund-transactions',
  '/fund-transactions/{transactionId}',
  '/otc-orders',
  '/otc-orders/{orderId}',
  '/api-integration',
  '/api-integration/ip-allowlist-requests',
  '/api-integration/webhook-requests',
  '/api-integration/credential-rotation-requests',
  '/api-integration/credential-rotation-requests/{requestId}',
  '/api-integration/credential-rotation-requests/{requestId}/cancel',
  '/api-integration/webhook-signing-key-requests',
  '/api-integration/webhook-signing-key-requests/{requestId}/cancel',
  '/api-integration/requests/{requestId}',
  '/api-integration/webhook-test',
  'CF-Access-Client-Id',
  'CF-Access-Client-Secret',
  'X-VA-Webhook-Id',
  'X-VA-Webhook-Timestamp',
  'X-VA-Webhook-Signature',
  'X-VA-Webhook-Key-Id',
  'X-Request-Id',
  'fund_operation_disabled',
  'manual_otc_disabled',
  'system-generated OTC conversion records',
  'Partners cannot submit a conversion',
  'type: "usdt_sweep"',
  'sweep_batch_id',
  'partner_customer_id',
  'public final class VaApiClient',
  'verifyVaWebhook',
  'Response shapes and field reference',
  'TransactionHistoryItem',
];

for (const value of requiredGuideContent) {
  assert(guide.includes(value), `Partner guide is missing required content: ${value}`);
}

const partnerCustomerIdSchema = contract?.components?.schemas?.PartnerCustomerId;
const createApplicationSchema = contract?.components?.schemas?.CreateApplication;
const applicationSchema = contract?.components?.schemas?.Application;
const actionRequiredSchema = contract?.components?.schemas?.ApplicationActionRequired;
const resubmitApplicationSchema = contract?.components?.schemas?.ResubmitApplication;
const balanceSchema = contract?.components?.schemas?.Balance;
assert(
  partnerCustomerIdSchema?.type === 'string' &&
    partnerCustomerIdSchema?.format === 'uuid' &&
    partnerCustomerIdSchema?.minLength === 36 &&
    partnerCustomerIdSchema?.maxLength === 36 &&
    partnerCustomerIdSchema?.pattern ===
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' &&
    createApplicationSchema?.required?.includes('partner_customer_id') &&
    createApplicationSchema?.additionalProperties === false &&
    applicationSchema?.required?.includes('partner_customer_id') &&
    applicationSchema?.required?.includes('application_version') &&
    applicationSchema?.required?.includes('submission_round') &&
    actionRequiredSchema?.properties?.reason_message?.maxLength === 500 &&
    resubmitApplicationSchema?.required?.includes('expected_version') &&
    resubmitApplicationSchema?.additionalProperties === false &&
    createApplicationSchema?.examples?.[0]?.partner_customer_id ===
      'eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4' &&
    applicationSchema?.examples?.[0]?.status === 'submitted' &&
    balanceSchema?.examples?.[0]?.network === 'TRON' &&
    workerSource.includes("'invalid_partner_customer_id'") &&
    workerSource.includes("'partner_customer_id_conflict'") &&
    guide.includes('canonical lowercase UUID v4 string') &&
    chineseGuide.includes('标准小写 UUID v4 字符串'),
  'Partner customer ID format or propagation contract is inconsistent.'
);
assert(
  chineseGuide.includes('public final class VaApiClient') &&
    chineseGuide.includes('verifyVaWebhook') &&
    chineseGuide.includes('原始请求体') &&
    chineseGuide.includes('返回结构与字段参考') &&
    chineseGuide.includes('TransactionHistoryItem'),
  'Chinese Partner guide is missing Java reference code or response field documentation.'
);
const forbiddenCustomerContent = [
  '/api/v1/admin',
  'operator_note',
  'settlement_reference',
  'admin@example.com',
  'partner@example.com',
];

for (const value of forbiddenCustomerContent) {
  assert(!guide.includes(value), `Partner guide exposes internal content: ${value}`);
  assert(!openApi.includes(value), `OpenAPI exposes internal content: ${value}`);
}

assert(!/\p{Script=Han}/u.test(openApi), 'Customer OpenAPI contains Chinese text.');
assert(
  html.includes('<title>Partner API Guide · VA BaaS</title>'),
  'Generated HTML is missing its customer-facing title.'
);
assert(
  html.includes('data-set-language="en"') &&
    html.includes('data-set-language="zh"') &&
    html.includes('data-language-panel="zh"') &&
    html.includes('/portal/api-guide.zh-CN.md'),
  'Generated HTML is missing bilingual guide controls or the Chinese download.'
);
assert(
  chineseGuide.includes('版本：V1.7.0') &&
    chineseGuide.includes('最后更新：2026 年 8 月 2 日') &&
    chineseGuide.includes('/api/v1') &&
    /\p{Script=Han}/u.test(chineseGuide),
  'Chinese Partner guide is missing its version, canonical API URL, or Chinese content.'
);
assert(
  html.includes('href="/portal/api-guide.md"'),
  'Generated HTML Markdown download is outside the Partner Portal Access path.'
);
assert(
  html.includes('href="/api/browser/v1/portal/openapi.yaml"'),
  'Generated HTML OpenAPI link is outside the current Portal browser API path.'
);
assert(
  !html.includes('/partner-api-guide') && !html.includes('/api/v1/portal/openapi.yaml'),
  'Generated HTML still references a legacy guide or Portal API path.'
);
const requiredOperations = new Map([
  ['GET /', 'getApiIndex'],
  ['GET /health', 'getHealth'],
  ['GET /country-calling-codes', 'listCountryCallingCodes'],
  ['GET /va-applications', 'listApplications'],
  ['POST /va-applications', 'createApplication'],
  ['GET /va-applications/{applicationId}', 'getApplication'],
  ['POST /va-applications/{applicationId}/resubmit', 'resubmitApplication'],
  ['GET /customers', 'listCustomers'],
  ['GET /customers/{applicationId}', 'getCustomerOverview'],
  ['GET /balances', 'getBalances'],
  ['GET /transactions', 'listTransactions'],
  ['GET /sweep-batches', 'listSweepBatches'],
  ['GET /sweep-batches/{batchId}', 'getSweepBatch'],
  ['GET /fund-transactions', 'listFundTransactions'],
  ['GET /fund-transactions/{transactionId}', 'getFundTransaction'],
  ['GET /otc-orders', 'listOtcOrders'],
  ['GET /otc-orders/{orderId}', 'getOtcOrder'],
  ['GET /api-integration', 'getApiIntegration'],
  ['POST /api-integration/ip-allowlist-requests', 'createIpAllowlistRequest'],
  ['POST /api-integration/webhook-requests', 'createWebhookRequest'],
  ['POST /api-integration/credential-rotation-requests', 'createCredentialRotationRequest'],
  ['GET /api-integration/credential-rotation-requests/{requestId}', 'getCredentialRotationRequest'],
  [
    'POST /api-integration/credential-rotation-requests/{requestId}/cancel',
    'cancelCredentialRotationRequest',
  ],
  ['POST /api-integration/webhook-signing-key-requests', 'createWebhookSigningKeyRequest'],
  [
    'POST /api-integration/webhook-signing-key-requests/{requestId}/cancel',
    'cancelWebhookSigningKeyRequest',
  ],
  ['GET /api-integration/requests/{requestId}', 'getApiIntegrationRequest'],
  ['POST /api-integration/requests/{requestId}/cancel', 'cancelApiIntegrationRequest'],
  ['POST /api-integration/webhook-test', 'createWebhookTest'],
]);
const operationIds = new Set();
for (const [pathName, pathItem] of Object.entries(contract.paths ?? {})) {
  assert(!pathName.startsWith('/api/v1'), `OpenAPI path repeats the server base: ${pathName}`);
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const operation = pathItem?.[method];
    if (!operation) continue;
    const operationKey = `${method.toUpperCase()} ${pathName}`;
    assert(
      requiredOperations.has(operationKey),
      `OpenAPI advertises an operation outside the verified Partner capability matrix: ${operationKey}`
    );
    assert(operation.operationId, `OpenAPI operation has no operationId: ${operationKey}`);
    assert(
      !operationIds.has(operation.operationId),
      `OpenAPI operationId is duplicated: ${operation.operationId}`
    );
    operationIds.add(operation.operationId);
    if (requiredOperations.has(operationKey)) {
      assert(
        requiredOperations.get(operationKey) === operation.operationId,
        `OpenAPI operationId mismatch for ${operationKey}`
      );
    }
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      if (!/^2\d\d$/.test(status)) continue;
      assert(
        response?.headers?.['X-Request-Id'],
        `Successful OpenAPI response omits X-Request-Id: ${operationKey} ${status}`
      );
    }
  }
}
for (const [operationKey, operationId] of requiredOperations) {
  assert(operationIds.has(operationId), `OpenAPI is missing required operation: ${operationKey}`);
}
assert(
  operationIds.size === requiredOperations.size,
  'OpenAPI operation count differs from the verified Partner capability matrix.'
);

const sweepBatchProperties = contract?.components?.schemas?.SweepBatch?.properties;
assert(
  sweepBatchProperties?.destination_address &&
    sweepBatchProperties?.tx_hash &&
    sweepBatchProperties?.items &&
    contract?.components?.schemas?.SweepBatchItem?.properties?.ledger_entry_id &&
    guide.includes('GET /sweep-batches/{batchId}') &&
    chineseGuide.includes('GET /sweep-batches/{batchId}') &&
    workerSource.includes('async function getPartnerSweepBatch') &&
    workerSource.includes('b.partner_key=?') &&
    workerSource.includes('a.partner_key=?'),
  'Partner sweep batch reconciliation is inconsistent or lacks tenant filters.'
);

const sweepListOperation = contract?.paths?.['/sweep-batches']?.get;
const sweepPageParameter = sweepListOperation?.parameters?.find(
  (parameter) => parameter?.in === 'query' && parameter?.name === 'page'
);
const sweepLimitParameter = sweepListOperation?.parameters?.find(
  (parameter) => parameter?.in === 'query' && parameter?.name === 'limit'
);
const sweepListSchema =
  sweepListOperation?.responses?.['200']?.content?.['application/json']?.schema;
const sweepListMeta = sweepListSchema?.properties?.meta;
assert(
  sweepPageParameter?.schema?.type === 'integer' &&
    sweepPageParameter.schema.minimum === 1 &&
    sweepPageParameter.schema.default === 1 &&
    sweepLimitParameter?.schema?.type === 'integer' &&
    sweepLimitParameter.schema.minimum === 1 &&
    sweepLimitParameter.schema.maximum === 100 &&
    sweepLimitParameter.schema.default === 100 &&
    sweepListSchema?.required?.includes('data') &&
    sweepListSchema.required.includes('meta') &&
    sweepListMeta?.additionalProperties === false &&
    ['total', 'page', 'limit', 'total_pages'].every((field) =>
      sweepListMeta?.required?.includes(field)
    ) &&
    sweepListMeta?.properties?.total?.minimum === 0 &&
    sweepListMeta?.properties?.page?.minimum === 1 &&
    sweepListMeta?.properties?.limit?.minimum === 1 &&
    sweepListMeta?.properties?.limit?.maximum === 100 &&
    sweepListMeta?.properties?.total_pages?.minimum === 0 &&
    guide.includes('iterate `page` from `1` through `total_pages`') &&
    chineseGuide.includes('从 `page=1`') &&
    chineseGuide.includes('遍历到 `total_pages`'),
  'Sweep list pagination is inconsistent across OpenAPI and bilingual guides.'
);

const expectedWebhookEvents = [
  'application.status_changed',
  'va_account.activated',
  'fund_transaction.status_changed',
  'otc_order.status_changed',
  'fiat_deposit.cleared_and_converted',
  'usdt_sweep.locked',
  'usdt_sweep.completed',
  'usdt_sweep.cancelled',
];
const documentedWebhookEvents = contract?.components?.schemas?.WebhookEventType?.enum ?? [];
const workerWebhookEventBlock = workerSource.match(
  /const WEBHOOK_EVENTS = \[([\s\S]*?)\] as const;/
);
const runtimeWebhookEvents = workerWebhookEventBlock
  ? [...workerWebhookEventBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  : [];
assert(
  expectedWebhookEvents.every(
    (eventType) =>
      documentedWebhookEvents.includes(eventType) &&
      runtimeWebhookEvents.includes(eventType) &&
      guide.includes(`\`${eventType}\``) &&
      chineseGuide.includes(`\`${eventType}\``)
  ) &&
    documentedWebhookEvents.length === expectedWebhookEvents.length &&
    runtimeWebhookEvents.length === expectedWebhookEvents.length &&
    !documentedWebhookEvents.includes('usdt_sweep.submitted') &&
    !runtimeWebhookEvents.includes('usdt_sweep.submitted') &&
    guide.includes('There is no `usdt_sweep.submitted` Webhook event') &&
    chineseGuide.includes('不存在 `usdt_sweep.submitted` Webhook 事件'),
  'Webhook event support is inconsistent or promises an unsupported submitted event.'
);

const vaAccountActivatedWebhook = contract?.components?.schemas?.VaAccountActivatedWebhook;
const vaAccountActivatedData = vaAccountActivatedWebhook?.properties?.data;
const kycLinkReadyWebhook = contract?.components?.schemas?.KycLinkReadyWebhook;
const kycLinkReadyData = kycLinkReadyWebhook?.properties?.data;
const fundTransactionStatusWebhook = contract?.components?.schemas?.FundTransactionStatusWebhook;
const fundTransactionStatusData = fundTransactionStatusWebhook?.properties?.data;
const fiatClearedWebhook = contract?.components?.schemas?.FiatDepositClearedAndConvertedWebhook;
const fiatClearedData = fiatClearedWebhook?.properties?.data;
assert(
  kycLinkReadyWebhook?.properties?.type?.const === 'application.status_changed' &&
    kycLinkReadyData?.properties?.status?.const === 'kyc_link_ready' &&
    kycLinkReadyData?.properties?.kyc_url?.format === 'uri' &&
    ['application_id', 'partner_customer_id', 'status', 'kyc_url'].every((field) =>
      kycLinkReadyData?.required?.includes(field)
    ) &&
    guide.includes('actionable Sumsub URL') &&
    chineseGuide.includes('可操作的 Sumsub 链接') &&
    vaAccountActivatedWebhook?.properties?.type?.const === 'va_account.activated' &&
    vaAccountActivatedData?.properties?.status?.const === 'active' &&
    vaAccountActivatedData?.properties?.va_account?.$ref === '#/components/schemas/VaAccount' &&
    ['application_id', 'partner_customer_id', 'status', 'va_account'].every((field) =>
      vaAccountActivatedData?.required?.includes(field)
    ) &&
    guide.includes('without an immediate API read') &&
    chineseGuide.includes('不必立即查询 API'),
  'Onboarding Webhook snapshots are inconsistent across OpenAPI and guides.'
);
assert(
  fundTransactionStatusWebhook?.properties?.type?.const === 'fund_transaction.status_changed' &&
    [
      'transaction_type',
      'direction',
      'asset',
      'amount',
      'fee_amount',
      'net_amount',
      'network',
      'external_reference',
      'transaction_reference',
      'settlement_status',
    ].every((field) => fundTransactionStatusData?.required?.includes(field)) &&
    guide.includes('newly recorded deposit') &&
    chineseGuide.includes('新录入的入账') &&
    guide.includes('does not mean cleared') &&
    chineseGuide.includes('不代表已经清算'),
  'Fund transaction Webhook snapshot is inconsistent across OpenAPI and guides.'
);
assert(
  fiatClearedWebhook?.properties?.type?.const === 'fiat_deposit.cleared_and_converted' &&
    fiatClearedData?.properties?.status?.const === 'completed' &&
    fiatClearedData?.properties?.settlement_status?.const === 'cleared' &&
    fiatClearedData?.properties?.usdt_network?.const === 'TRON' &&
    !['pricing_model', 'fee_rate', 'fee_amount'].some(
      (field) => field in (fiatClearedData?.properties ?? {})
    ) &&
    [
      'fiat_amount',
      'exchange_rate',
      'exchange_rate_version',
      'usdt_net_amount',
      'otc_order_id',
      'otc_status',
      'cleared_at',
    ].every((field) => fiatClearedData?.required?.includes(field)) &&
    guide.includes('complete clearing and conversion') &&
    chineseGuide.includes('完整清算与兑换结果'),
  'Fiat clearing Webhook is inconsistent across OpenAPI and bilingual guides.'
);

const webhookSignatureFormula = 'lowercase_hex(HMAC_SHA256(secret, timestamp + "." + rawBodyUtf8))';
assert(
  guide.includes(webhookSignatureFormula) &&
    chineseGuide.includes(webhookSignatureFormula) &&
    openApi.includes(webhookSignatureFormula) &&
    guide.includes('Strip the literal') &&
    chineseGuide.includes('剥离字面量 `v1=` 前缀') &&
    openApi.includes('strip the literal') &&
    workerSource.includes('encoder.encode(`${timestamp}.${rawBody}`)') &&
    workerSource.includes("byte.toString(16).padStart(2, '0')") &&
    workerSource.includes("'X-VA-Webhook-Signature': `v1=${signature}`"),
  'Webhook signature formula, lowercase hex encoding, or v1 prefix handling is inconsistent.'
);

const paddedRuntimeAmountExample =
  /"(?:total_amount|amount|fee_amount|net_amount)": "-?\d+\.\d*0+"/;
assert(
  !paddedRuntimeAmountExample.test(guide) &&
    !paddedRuntimeAmountExample.test(chineseGuide) &&
    guide.includes('"total_amount": "750.5"') &&
    guide.includes('"fee_amount": "0"') &&
    chineseGuide.includes('"total_amount": "750.5"') &&
    chineseGuide.includes('"fee_amount": "0"') &&
    workerSource.includes("replace(/0+$/, '')"),
  'Bilingual amount examples do not match runtime trailing-zero normalization.'
);
assert(
  chineseGuide.includes('数据隔离与防枚举') &&
    chineseGuide.includes('恒定时间比较') &&
    guide.includes('Data isolation and enumeration resistance') &&
    guide.includes('constant-time comparison') &&
    contract.info?.description?.includes(
      'Resource identifiers are not authorization credentials'
    ) &&
    contract.info?.description?.includes('out-of-scope IDs both return'),
  'Partner security guidance is missing tenant isolation or webhook verification requirements.'
);

assert(
  !contract.paths?.['/withdrawals'] &&
    !contract.paths?.['/withdrawal-fees'] &&
    !contract.paths?.['/fund-transactions']?.post &&
    !contract.paths?.['/otc-orders']?.post,
  'OpenAPI advertises a disabled Partner financial-write operation.'
);
for (const schemaName of [
  'CreateWithdrawal',
  'CreateFiatWithdrawal',
  'CreateUsdtWithdrawal',
  'WithdrawalFeeSetting',
  'CreateOtcOrder',
  'CreateUsdToUsdtOtcOrder',
  'CreateUsdtToUsdOtcOrder',
]) {
  assert(
    !contract.components?.schemas?.[schemaName],
    `OpenAPI retains unsupported financial-write schema: ${schemaName}`
  );
}
assert(
  !/提交 USD 或 USDT 提现申请|创建 OTC 兑换订单|OTC 双向兑换.*已测试/u.test(chineseGuide),
  'Chinese Partner guide advertises a disabled customer financial-write workflow.'
);
assert(
  workerSource.includes("'fund_operation_disabled'") &&
    workerSource.includes("'manual_otc_disabled'") &&
    guide.includes('Partners cannot submit a conversion') &&
    chineseGuide.includes('合作伙伴不能提交'),
  'Runtime and bilingual guides do not agree on the Partner financial-write boundary.'
);

const fundTransactionProperties = contract?.components?.schemas?.FundTransaction?.properties;
assert(
  fundTransactionProperties?.settlement_status && fundTransactionProperties?.conversion_otc_id,
  'FundTransaction schema omits automatic fiat settlement fields.'
);
const transactionTypes =
  contract?.components?.schemas?.TransactionHistoryItem?.properties?.type?.enum ?? [];
assert(
  transactionTypes.includes('fiat_conversion_debit') &&
    transactionTypes.includes('usdt_sweep') &&
    contract?.components?.schemas?.TransactionHistoryItem?.properties?.sweep_batch_id &&
    guide.includes('fiat_conversion_debit') &&
    guide.includes('usdt_sweep') &&
    chineseGuide.includes('usdt_sweep') &&
    workerSource.includes("type: 'usdt_sweep'") &&
    workerSource.includes('JOIN usdt_sweep_items si') &&
    workerSource.includes('JOIN usdt_sweep_batches b') &&
    adminOperationsSource.includes("usdt_sweep: t('types.usdtSweep')") &&
    portalSource.includes('<MenuItem value="usdt_sweep">') &&
    portalSource.includes("usdt_sweep: 'USDT 汇集转出'") &&
    adminChineseLocale.includes('"usdtSweep": "USDT 汇集转出"') &&
    adminEnglishLocale.includes('"usdtSweep": "USDT sweep out"') &&
    portalChineseLocale.includes('"USDT 汇集转出": "USDT 汇集转出"') &&
    portalEnglishLocale.includes('"USDT 汇集转出": "USDT Sweep Out"'),
  'Sweep transaction history is inconsistent across runtime, OpenAPI, and bilingual guides.'
);

for (const handler of [
  'function listCountryCallingCodes',
  'async function getFundById',
  'async function getOtcById',
  'async function getIntegrationRequest',
]) {
  assert(
    workerSource.includes(handler),
    `Worker source is missing the documented detail handler: ${handler}`
  );
}

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const localAnchors = [...html.matchAll(/\shref="#([^"]+)"/g)].map((match) => match[1]);
for (const anchor of localAnchors) {
  assert(ids.has(anchor), `Generated HTML contains a broken local anchor: #${anchor}`);
}

console.log(
  `API docs check passed: ${jsonBlocks.length} JSON examples, ${localAnchors.length} local links.`
);

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
