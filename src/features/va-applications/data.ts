import { getLocalizedApiError } from 'src/locales/api-error';
import { browserApiFetch } from 'src/utils/browser-api';

export type ApplicationStatus =
  | 'submitted'
  | 'kyc_link_ready'
  | 'kyc_approved'
  | 'va_processing'
  | 'active'
  | 'changes_requested';

export type ApplicationStage = Exclude<ApplicationStatus, 'changes_requested'>;

export type ApplicationActionRequired = {
  type: 'resubmit';
  reasonCode: string;
  reasonMessage: string;
  requiredFields: string[];
  requestedAt: string;
  internalNote?: string;
  reviewedBy?: string;
};

export type VaAccount = {
  accountName: string;
  accountNumber: string;
  iban: string;
  currency: string;
  swiftBic: string;
  bankName: string;
  bankAddress: string;
};

export type VaApplication = {
  id: string;
  partnerCustomerId: string | null;
  customerName: string;
  phoneCountryCode: string;
  phoneNumber: string;
  email: string;
  status: ApplicationStatus;
  onboardingStage: ApplicationStage;
  submissionRound: number;
  applicationVersion: number;
  lastSubmittedAt: string;
  actionRequired?: ApplicationActionRequired;
  kycUrl?: string;
  vaAccount?: VaAccount;
  createdAt: string;
  updatedAt: string;
};

export type VaApplicationProfile = Pick<
  VaApplication,
  'partnerCustomerId' | 'customerName' | 'phoneCountryCode' | 'phoneNumber' | 'email'
>;

export const STATUS_META: Record<
  ApplicationStatus,
  { color: 'default' | 'info' | 'warning' | 'success' | 'error' }
> = {
  submitted: { color: 'warning' },
  kyc_link_ready: { color: 'info' },
  kyc_approved: { color: 'success' },
  va_processing: { color: 'warning' },
  active: { color: 'success' },
  changes_requested: { color: 'error' },
};

type ApiApplication = {
  application_id: string;
  partner_customer_id: string | null;
  customer_name: string;
  phone_country_code: string;
  phone_number: string;
  email: string;
  status: ApplicationStatus;
  onboarding_stage: ApplicationStage;
  submission_round: number;
  application_version: number;
  last_submitted_at: string;
  action_required: null | {
    type: 'resubmit';
    reason_code: string;
    reason_message: string;
    required_fields: string[];
    requested_at: string;
    internal_note?: string;
    reviewed_by?: string;
  };
  kyc_url: string | null;
  va_account: null | {
    account_name: string;
    account_number: string;
    iban: string | null;
    currency: string;
    swift_bic: string;
    bank_name: string;
    bank_address: string;
  };
  created_at: string;
  updated_at: string;
};

function fromApi(value: ApiApplication): VaApplication {
  return {
    id: value.application_id,
    partnerCustomerId: value.partner_customer_id,
    customerName: value.customer_name,
    phoneCountryCode: value.phone_country_code,
    phoneNumber: value.phone_number,
    email: value.email,
    status: value.status,
    onboardingStage: value.onboarding_stage,
    submissionRound: value.submission_round,
    applicationVersion: value.application_version,
    lastSubmittedAt: value.last_submitted_at,
    actionRequired: value.action_required
      ? {
          type: value.action_required.type,
          reasonCode: value.action_required.reason_code,
          reasonMessage: value.action_required.reason_message,
          requiredFields: value.action_required.required_fields,
          requestedAt: value.action_required.requested_at,
          internalNote: value.action_required.internal_note,
          reviewedBy: value.action_required.reviewed_by,
        }
      : undefined,
    kycUrl: value.kyc_url || undefined,
    vaAccount: value.va_account
      ? {
          accountName: value.va_account.account_name,
          accountNumber: value.va_account.account_number,
          iban: value.va_account.iban || '',
          currency: value.va_account.currency,
          swiftBic: value.va_account.swift_bic,
          bankName: value.va_account.bank_name,
          bankAddress: value.va_account.bank_address,
        }
      : undefined,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await browserApiFetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(getLocalizedApiError(body));
  }
  return body as T;
}

const ADMIN_API = '/api/browser/v1/admin/va-applications';

export async function getApplications(): Promise<VaApplication[]> {
  const response = await request<{ data: ApiApplication[] }>(ADMIN_API);
  return response.data.map(fromApi);
}

export async function getApplication(id: string): Promise<VaApplication> {
  return fromApi(await request<ApiApplication>(`${ADMIN_API}/${id}`));
}

export async function createApplication(data: VaApplicationProfile) {
  const response = await request<ApiApplication>(ADMIN_API, {
    method: 'POST',
    body: JSON.stringify({
      partner_customer_id: data.partnerCustomerId,
      customer_name: data.customerName,
      phone_country_code: data.phoneCountryCode,
      phone_number: data.phoneNumber,
      email: data.email,
    }),
  });
  return fromApi(response);
}

export async function updateApplicationProfile(id: string, profile: VaApplicationProfile) {
  return fromApi(
    await request<ApiApplication>(`${ADMIN_API}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        profile: {
          partner_customer_id: profile.partnerCustomerId,
          customer_name: profile.customerName,
          phone_country_code: profile.phoneCountryCode,
          phone_number: profile.phoneNumber,
          email: profile.email,
        },
      }),
    })
  );
}

export async function updateApplication(id: string, patch: Partial<VaApplication>) {
  const body = {
    ...(patch.kycUrl ? { kyc_url: patch.kycUrl } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.vaAccount
      ? {
          va_account: {
            account_name: patch.vaAccount.accountName,
            account_number: patch.vaAccount.accountNumber,
            iban: patch.vaAccount.iban.trim() || null,
            currency: patch.vaAccount.currency,
            swift_bic: patch.vaAccount.swiftBic,
            bank_name: patch.vaAccount.bankName,
            bank_address: patch.vaAccount.bankAddress,
          },
        }
      : {}),
  };
  return fromApi(
    await request<ApiApplication>(`${ADMIN_API}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  );
}

export type RequestApplicationChangesInput = {
  reasonCode: string;
  reasonText: string;
  requiredFields: string[];
  internalNote?: string;
  expectedVersion: number;
};

export async function requestApplicationChanges(id: string, input: RequestApplicationChangesInput) {
  return fromApi(
    await request<ApiApplication>(`${ADMIN_API}/${id}/request-changes`, {
      method: 'POST',
      body: JSON.stringify({
        reason_code: input.reasonCode,
        reason_text: input.reasonText,
        required_fields: input.requiredFields,
        internal_note: input.internalNote?.trim() || null,
        expected_version: input.expectedVersion,
      }),
    })
  );
}
