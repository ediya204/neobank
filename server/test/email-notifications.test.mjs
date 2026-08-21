import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailTemplateKey } from '@prisma/client';
import { renderEmailTemplate } from '../dist/src/email/email-templates.js';
import { EmailOutboxService } from '../dist/src/email/email-outbox.service.js';
import { ZohoMailClient } from '../dist/src/email/zoho-mail.client.js';

test('outbox remains inert while email notifications are disabled', async () => {
  const previous = process.env.EMAIL_NOTIFICATIONS_ENABLED;
  let writes = 0;
  process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
  try {
    const service = new EmailOutboxService();
    const result = await service.enqueue(
      {
        emailOutbox: {
          upsert: async () => {
            writes += 1;
          },
        },
      },
      {
        organizationId: 'org-1',
        customerId: 'customer-1',
        dedupeKey: 'test-disabled',
        templateKey: EmailTemplateKey.CUSTOMER_ACTIVATED,
        recipient: 'recipient@example.com',
        payload: { displayName: 'Test Customer' },
      }
    );
    assert.equal(result, null);
    assert.equal(writes, 0);
  } finally {
    if (previous === undefined) delete process.env.EMAIL_NOTIFICATIONS_ENABLED;
    else process.env.EMAIL_NOTIFICATIONS_ENABLED = previous;
  }
});

test('email templates escape customer content and do not expose financial details', () => {
  const rendered = renderEmailTemplate(
    EmailTemplateKey.CUSTOMER_ACTIVATED,
    { displayName: '<script>alert(1)</script>' },
    'https://portal.example.com'
  );
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /https:\/\/portal\.example\.com\/customer\/login/);
  assert.doesNotMatch(rendered.html, /balance|wallet address|account number/i);
});

test('Zoho client exchanges the refresh token and sends through the Mail REST API', async () => {
  const previousEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const calls = [];
  Object.assign(process.env, {
    ZOHO_OAUTH_CLIENT_ID: 'test-client-id',
    ZOHO_OAUTH_CLIENT_SECRET: 'test-client-secret',
    ZOHO_OAUTH_REFRESH_TOKEN: 'test-refresh-token',
    ZOHO_MAIL_ACCOUNT_ID: '12345',
    ZOHO_MAIL_FROM_ADDRESS: 'sender@example.com',
    ZOHO_ACCOUNTS_BASE_URL: 'https://accounts.zoho.test',
    ZOHO_MAIL_API_BASE_URL: 'https://mail.zoho.test/api',
    PORTAL_BASE_URL: 'https://portal.example.com',
    CUSTOMER_PASSWORD_RESET_SECRET: 'test-password-reset-secret-at-least-32-bytes',
  });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/oauth/v2/token')) {
      return Response.json({ access_token: 'access-token', expires_in: 3600 });
    }
    return Response.json({ data: { messageId: 'message-1' } });
  };
  try {
    const client = new ZohoMailClient();
    const result = await client.send({
      id: 'email-1',
      organizationId: 'org-1',
      customerId: 'customer-1',
      dedupeKey: 'customer:customer-1:activated',
      templateKey: EmailTemplateKey.CUSTOMER_ACTIVATED,
      recipient: 'recipient@example.com',
      payload: { displayName: 'Test Customer' },
      status: 'PROCESSING',
      attemptCount: 0,
      maxAttempts: 5,
      nextAttemptAt: new Date(),
      lockedAt: new Date(),
      sentAt: null,
      providerMessageId: null,
      lastErrorCode: null,
      lastErrorAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.equal(result.providerMessageId, 'message-1');
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /accounts\.zoho\.test\/oauth\/v2\/token$/);
    assert.match(String(calls[0].init.body), /grant_type=refresh_token/);
    assert.match(calls[1].url, /mail\.zoho\.test\/api\/accounts\/12345\/messages$/);
    assert.equal(calls[1].init.headers.authorization, 'Zoho-oauthtoken access-token');
    const mail = JSON.parse(calls[1].init.body);
    assert.equal(mail.toAddress, 'recipient@example.com');
    assert.equal(mail.fromAddress, 'sender@example.com');
  } finally {
    globalThis.fetch = originalFetch;
    process.env = previousEnv;
  }
});

test('password reset template derives a fragment token without storing it in the payload', () => {
  const rendered = renderEmailTemplate(
    EmailTemplateKey.CUSTOMER_PASSWORD_RESET_REQUESTED,
    {
      displayName: 'Test Customer',
      resetRequestId: 'password_reset_0123456789abcdef0123456789abcdef',
    },
    'https://portal.example.com',
    'test-password-reset-secret-at-least-32-bytes'
  );
  assert.match(
    rendered.html,
    /https:\/\/portal\.example\.com\/customer\/reset-password#reset_token=password_reset_0123456789abcdef0123456789abcdef\./
  );
  assert.doesNotMatch(
    JSON.stringify({
      displayName: 'Test Customer',
      resetRequestId: 'password_reset_0123456789abcdef0123456789abcdef',
    }),
    /reset_token/
  );
});

test('email change verification derives a purpose-bound fragment token', () => {
  const rendered = renderEmailTemplate(
    EmailTemplateKey.CUSTOMER_EMAIL_CHANGE_VERIFICATION,
    {
      displayName: 'Test Customer',
      emailChangeRequestId: 'email_change_0123456789abcdef0123456789abcdef',
    },
    'https://portal.example.com',
    'test-password-reset-secret-at-least-32-bytes'
  );
  assert.match(
    rendered.html,
    /\/customer\/confirm-email-change#email_change_token=email_change_0123456789abcdef0123456789abcdef\./
  );
});

test('security alerts accept allowlisted events and reject arbitrary copy', () => {
  const rendered = renderEmailTemplate(
    EmailTemplateKey.CUSTOMER_SECURITY_ALERT,
    { displayName: 'Test Customer', securityEvent: 'totp_replaced' },
    'https://portal.example.com'
  );
  assert.match(rendered.subject, /Authenticator replaced/);
  assert.throws(
    () => renderEmailTemplate(
      EmailTemplateKey.CUSTOMER_SECURITY_ALERT,
      { displayName: 'Test Customer', securityEvent: '<script>unsafe</script>' },
      'https://portal.example.com'
    ),
    /invalid_email_template_security_event/
  );
});
