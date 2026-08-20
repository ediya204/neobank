import { Injectable } from '@nestjs/common';
import type { EmailOutbox } from '@prisma/client';
import { renderEmailTemplate } from './email-templates';

type CachedToken = {
  value: string;
  expiresAt: number;
};

export class EmailDeliveryError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean
  ) {
    super(code);
  }
}

@Injectable()
export class ZohoMailClient {
  private cachedToken?: CachedToken;
  private refreshPromise?: Promise<CachedToken>;

  assertConfigured() {
    this.config();
  }

  async send(row: EmailOutbox): Promise<{ providerMessageId: string | null }> {
    const config = this.config();
    const rendered = renderEmailTemplate(
      row.templateKey,
      row.payload,
      config.portalBaseUrl,
      config.passwordResetSecret
    );
    let token = await this.accessToken();
    let response = await this.sendRequest(config, token, row.recipient, rendered);
    if (response.status === 401) {
      this.cachedToken = undefined;
      token = await this.accessToken(true);
      response = await this.sendRequest(config, token, row.recipient, rendered);
    }
    if (!response.ok) {
      throw new EmailDeliveryError(
        `zoho_mail_http_${response.status}`,
        response.status === 401 ||
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
      );
    }
    const body = await response.json().catch(() => null);
    return { providerMessageId: this.messageId(body) };
  }

  private sendRequest(
    config: ReturnType<ZohoMailClient['config']>,
    token: string,
    recipient: string,
    rendered: { subject: string; html: string }
  ) {
    return fetch(
      `${config.mailApiBaseUrl}/accounts/${encodeURIComponent(config.accountId)}/messages`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Zoho-oauthtoken ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          fromAddress: config.fromAddress,
          toAddress: recipient,
          subject: rendered.subject,
          content: rendered.html,
          mailFormat: 'html',
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
  }

  private async accessToken(force = false) {
    if (!force && this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.value;
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = undefined;
      });
    }
    this.cachedToken = await this.refreshPromise;
    return this.cachedToken.value;
  }

  private async refreshAccessToken(): Promise<CachedToken> {
    const config = this.config();
    const response = await fetch(`${config.accountsBaseUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: config.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new EmailDeliveryError('zoho_token_network_error', true);
    });
    if (!response.ok) {
      throw new EmailDeliveryError(
        `zoho_token_http_${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('access_token' in body)) {
      throw new EmailDeliveryError('zoho_token_invalid_response', false);
    }
    const accessToken = body.access_token;
    const expiresIn = 'expires_in' in body ? Number(body.expires_in) : 3600;
    if (typeof accessToken !== 'string' || !accessToken || !Number.isFinite(expiresIn)) {
      throw new EmailDeliveryError('zoho_token_invalid_response', false);
    }
    return { value: accessToken, expiresAt: Date.now() + Math.max(300, expiresIn) * 1000 };
  }

  private config() {
    const required = {
      clientId: process.env.ZOHO_OAUTH_CLIENT_ID?.trim(),
      clientSecret: process.env.ZOHO_OAUTH_CLIENT_SECRET?.trim(),
      refreshToken: process.env.ZOHO_OAUTH_REFRESH_TOKEN?.trim(),
      accountId: process.env.ZOHO_MAIL_ACCOUNT_ID?.trim(),
      fromAddress: process.env.ZOHO_MAIL_FROM_ADDRESS?.trim(),
      portalBaseUrl: process.env.PORTAL_BASE_URL?.trim(),
      passwordResetSecret: process.env.CUSTOMER_PASSWORD_RESET_SECRET?.trim(),
    };
    for (const [key, value] of Object.entries(required)) {
      if (!value) throw new EmailDeliveryError(`missing_${key}`, false);
    }
    const accountsBaseUrl = this.validHttpsBaseUrl(
      process.env.ZOHO_ACCOUNTS_BASE_URL || 'https://accounts.zoho.com',
      'invalid_zoho_accounts_base_url'
    );
    const mailApiBaseUrl = this.validHttpsBaseUrl(
      process.env.ZOHO_MAIL_API_BASE_URL || 'https://mail.zoho.com/api',
      'invalid_zoho_mail_api_base_url'
    );
    const portalBaseUrl = this.validBaseUrl(required.portalBaseUrl!, 'invalid_portal_base_url');
    return {
      clientId: required.clientId!,
      clientSecret: required.clientSecret!,
      refreshToken: required.refreshToken!,
      accountId: required.accountId!,
      fromAddress: required.fromAddress!,
      portalBaseUrl,
      passwordResetSecret: required.passwordResetSecret!,
      accountsBaseUrl,
      mailApiBaseUrl,
    };
  }

  private validHttpsBaseUrl(value: string, code: string) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new EmailDeliveryError(code, false);
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new EmailDeliveryError(code, false);
    }
    return parsed.toString().replace(/\/$/, '');
  }

  private validBaseUrl(value: string, code: string) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new EmailDeliveryError(code, false);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new EmailDeliveryError(code, false);
    }
    return parsed.toString();
  }

  private messageId(body: unknown) {
    if (!body || typeof body !== 'object') return null;
    const record = body as Record<string, unknown>;
    if (typeof record.messageId === 'string') return record.messageId;
    if (typeof record.mailId === 'string') return record.mailId;
    if (record.data && typeof record.data === 'object') {
      const data = record.data as Record<string, unknown>;
      if (typeof data.messageId === 'string') return data.messageId;
      if (typeof data.mailId === 'string') return data.mailId;
    }
    return null;
  }
}
