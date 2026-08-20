import { EmailTemplateKey, Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';

export type RenderedEmail = {
  subject: string;
  html: string;
};

type TemplatePayload = {
  displayName: string;
  currency?: string;
  resetRequestId?: string;
  verificationRequestId?: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function payloadFromJson(value: Prisma.JsonValue): TemplatePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_email_template_payload');
  }
  const displayName = value.displayName;
  const currency = value.currency;
  const resetRequestId = value.resetRequestId;
  const verificationRequestId = value.verificationRequestId;
  if (typeof displayName !== 'string' || !displayName.trim()) {
    throw new Error('invalid_email_template_display_name');
  }
  if (currency !== undefined && typeof currency !== 'string') {
    throw new Error('invalid_email_template_currency');
  }
  if (resetRequestId !== undefined && typeof resetRequestId !== 'string') {
    throw new Error('invalid_email_template_reset_request_id');
  }
  if (verificationRequestId !== undefined && typeof verificationRequestId !== 'string') {
    throw new Error('invalid_email_template_verification_request_id');
  }
  return {
    displayName: displayName.trim(),
    currency: currency?.trim(),
    resetRequestId: resetRequestId?.trim(),
    verificationRequestId: verificationRequestId?.trim(),
  };
}

function layout(
  displayName: string,
  title: string,
  message: string,
  portalBaseUrl: string,
  action?: { label: string; url: string }
) {
  const safeName = escapeHtml(displayName);
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const portalUrl = action?.url || new URL('/customer/login', portalBaseUrl).toString();
  const actionLabel = action?.label || '登录客户网上银行';
  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#172033">
    <div style="max-width:600px;margin:0 auto;padding:32px 20px">
      <div style="background:#ffffff;border:1px solid #e1e6ef;border-radius:12px;padding:28px">
        <div style="font-size:13px;color:#657089;margin-bottom:18px">SSC Digital Bank</div>
        <h1 style="font-size:22px;line-height:1.35;margin:0 0 16px">${safeTitle}</h1>
        <p style="font-size:15px;line-height:1.7;margin:0 0 12px">您好 ${safeName}，</p>
        <p style="font-size:15px;line-height:1.7;margin:0 0 24px">${safeMessage}</p>
        <a href="${escapeHtml(
          portalUrl
        )}" style="display:inline-block;background:#173f8a;color:#ffffff;text-decoration:none;border-radius:8px;padding:11px 18px">${escapeHtml(actionLabel)}</a>
        <p style="font-size:12px;line-height:1.6;color:#7a8499;margin:24px 0 0">为保护账户安全，本邮件不包含余额、完整账号、钱包地址或操作凭据。如非本人操作，请通过官方渠道联系支持团队。</p>
      </div>
    </div>
  </body>
</html>`;
}

function recoveryUrl(
  portalBaseUrl: string,
  route: string,
  parameter: string,
  purpose: string,
  requestId: string | undefined,
  passwordResetSecret: string | undefined
) {
  if (!requestId || !/^(password_reset|email_verify)_[a-f0-9]{32}$/.test(requestId)) {
    throw new Error('invalid_email_template_recovery_request_id');
  }
  if (!passwordResetSecret || Buffer.byteLength(passwordResetSecret) < 32) {
    throw new Error('missing_customer_password_reset_secret');
  }
  const signature = createHmac('sha256', passwordResetSecret)
    .update(`neobank-customer-${purpose}\0${requestId}`)
    .digest('base64url');
  const target = new URL(route, portalBaseUrl);
  target.hash = new URLSearchParams({ [parameter]: `${requestId}.${signature}` }).toString();
  return target.toString();
}

export function renderEmailTemplate(
  templateKey: EmailTemplateKey,
  payloadValue: Prisma.JsonValue,
  portalBaseUrl: string,
  passwordResetSecret?: string
): RenderedEmail {
  const payload = payloadFromJson(payloadValue);
  switch (templateKey) {
    case EmailTemplateKey.CUSTOMER_KYC_APPROVED:
      return {
        subject: '身份验证已通过 | KYC approved',
        html: layout(
          payload.displayName,
          '身份验证已通过',
          '您的身份验证已经通过。账户仍需完成最终业务审核，当前通知不代表账户已经激活。',
          portalBaseUrl
        ),
      };
    case EmailTemplateKey.CUSTOMER_KYC_REJECTED:
      return {
        subject: '身份验证状态更新 | KYC status updated',
        html: layout(
          payload.displayName,
          '身份验证状态已更新',
          '您的身份验证未通过。为避免泄露审核信息，请登录客户门户查看下一步安排或联系支持团队。',
          portalBaseUrl
        ),
      };
    case EmailTemplateKey.CUSTOMER_ACTIVATED:
      return {
        subject: '账户已激活 | Account activated',
        html: layout(
          payload.displayName,
          '账户已激活',
          '您的账户已完成审核并激活。请登录客户门户查看当前可用服务。',
          portalBaseUrl
        ),
      };
    case EmailTemplateKey.CUSTOMER_EMAIL_VERIFICATION:
      return {
        subject: '验证您的客户邮箱 | Verify your email',
        html: layout(
          payload.displayName,
          '验证您的客户邮箱',
          '请验证此邮箱属于您本人。验证完成后，您可重新发起密码重置。此链接将在 30 分钟后失效，并且只能使用一次。',
          portalBaseUrl,
          {
            label: '验证邮箱',
            url: recoveryUrl(
              portalBaseUrl,
              '/customer/verify-email',
              'verification_token',
              'email-verification-v1',
              payload.verificationRequestId,
              passwordResetSecret
            ),
          }
        ),
      };
    case EmailTemplateKey.CUSTOMER_PASSWORD_RESET_REQUESTED:
      return {
        subject: '重置客户网上银行密码 | Reset your password',
        html: layout(
          payload.displayName,
          '重置您的密码',
          '我们收到了密码重置请求。请使用下方安全链接设置新密码。此链接将在 30 分钟后失效，并且只能使用一次。',
          portalBaseUrl,
          {
            label: '重置密码',
            url: recoveryUrl(
              portalBaseUrl,
              '/customer/reset-password',
              'reset_token',
              'password-reset-v1',
              payload.resetRequestId,
              passwordResetSecret
            ),
          }
        ),
      };
    case EmailTemplateKey.CUSTOMER_PASSWORD_RESET_COMPLETED:
      return {
        subject: '客户密码已重置 | Password reset completed',
        html: layout(
          payload.displayName,
          '密码已重置',
          '您的客户网上银行密码已成功重置，所有旧会话均已退出。如非本人操作，请立即通过官方渠道联系支持团队。',
          portalBaseUrl
        ),
      };
    case EmailTemplateKey.VIRTUAL_ACCOUNT_APPROVED:
      return {
        subject: '虚拟账户申请已通过 | Virtual account approved',
        html: layout(
          payload.displayName,
          '虚拟账户申请已通过',
          `您的 ${payload.currency || ''} 虚拟账户申请已通过。完整账户资料仅在客户门户中显示。`,
          portalBaseUrl
        ),
      };
    case EmailTemplateKey.VIRTUAL_ACCOUNT_REJECTED:
      return {
        subject: '虚拟账户申请状态更新 | Virtual account status updated',
        html: layout(
          payload.displayName,
          '虚拟账户申请状态已更新',
          `您的 ${payload.currency || ''} 虚拟账户申请未通过。请登录客户门户查看后续安排。`,
          portalBaseUrl
        ),
      };
  }
}
