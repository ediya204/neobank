import { Customer, demoOrganizationId, neobankApi } from 'src/features/finance/core-api';

export type NeobankCustomerRecord = {
  id: string;
  email: string;
  display_name: string;
  status: string;
  kyc_status: string;
  operations_status: string;
  account_type?: 'individual' | 'business';
  phone_country_code?: string;
  phone?: string;
  residence_country?: string;
  full_name?: string;
  date_of_birth?: string;
  nationality?: string;
  legal_name?: string;
  registration_number?: string;
  incorporation_country?: string;
  contact_name?: string;
  contact_role?: string;
  beneficial_owner_name?: string;
  beneficial_owner_ownership?: string;
  wallet_count?: number;
  wallet_status?: string | null;
  created_at?: string;
  activated_at?: string | null;
  activated_by?: string | null;
  kyc_reviewed_at?: string | null;
  kyc_reviewed_by?: string | null;
  kyc_review_note?: string | null;
  kyc_consent_at?: string | null;
  terms_accepted_at?: string | null;
  application_reference?: string | null;
  application_submitted_at?: string | null;
};

export type NeobankKycReviewResult = NeobankCustomerRecord & {
  wallet?: { id: string };
  wallet_provisioning?: {
    status: 'retry_required';
    error_code: string;
  };
};

export type NeobankSumsubStep = {
  step_type: 'IDENTITY' | 'SELFIE' | 'PROOF_OF_RESIDENCE';
  review_answer?: string | null;
  review_reject_type?: string | null;
  document_type?: string | null;
  document_country?: string | null;
  reject_labels?: string[];
  moderation_comment?: string | null;
  client_comment?: string | null;
  updated_at?: string | null;
};

export type NeobankSumsubVerification = {
  id: string;
  provider: 'sumsub';
  external_user_id: string;
  applicant_id?: string | null;
  level_name: string;
  environment: 'sandbox' | 'production';
  status:
    | 'initializing'
    | 'awaiting_applicant'
    | 'provider_reviewing'
    | 'resubmission_required'
    | 'provider_rejected'
    | 'ready_for_admin_review'
    | 'provider_error';
  review_status?: string | null;
  review_answer?: string | null;
  review_reject_type?: string | null;
  reject_labels?: string[];
  moderation_comment?: string | null;
  client_comment?: string | null;
  provider_created_at?: string | null;
  provider_reviewed_at?: string | null;
  last_event_at?: string | null;
  last_synced_at?: string | null;
  updated_at?: string | null;
  steps: NeobankSumsubStep[];
  events: Array<{ event_type: string; occurred_at?: string | null; received_at: string }>;
};

export function mapNeobankCustomer(row: NeobankCustomerRecord): Customer {
  let status: Customer['status'] = 'PENDING_REVIEW';
  let kycStatus: Customer['kycStatus'] = 'PENDING';
  if (row.kyc_status === 'rejected') status = 'REJECTED';
  if (row.kyc_status === 'rejected') kycStatus = 'REJECTED';
  if (row.kyc_status === 'approved') kycStatus = 'APPROVED';
  if (row.status === 'suspended' || row.status === 'closed') status = 'SUSPENDED';
  if (row.status === 'active' && row.operations_status === 'active') status = 'ACTIVE';
  return {
    id: row.id,
    organizationId: demoOrganizationId,
    type: row.account_type === 'business' ? 'BUSINESS' : 'INDIVIDUAL',
    status,
    displayName: row.display_name,
    legalName: row.legal_name || row.full_name || row.display_name,
    email: row.email,
    phone: row.phone,
    phoneCountryCode: row.phone_country_code,
    countryCode: row.incorporation_country || row.residence_country || '--',
    registrationNo: row.registration_number,
    dateOfBirth: row.date_of_birth,
    nationality: row.nationality,
    contactName: row.contact_name,
    contactRole: row.contact_role,
    beneficialOwnerName: row.beneficial_owner_name,
    beneficialOwnerOwnership: row.beneficial_owner_ownership,
    kycStatus,
    kycReviewerId: row.kyc_reviewed_by || undefined,
    kycReviewedAt: row.kyc_reviewed_at || undefined,
    kycReviewNote: row.kyc_review_note || undefined,
    accounts: [],
    walletCount: Number(row.wallet_count) || 0,
    walletStatus: row.wallet_status || undefined,
    reviewerId: row.activated_by || undefined,
    reviewedAt: row.activated_at || undefined,
    createdAt: row.created_at || row.application_submitted_at || undefined,
  };
}

export async function loadNeobankCustomerRecords(userId = 'usr_admin') {
  const payload = await neobankApi<{ data: NeobankCustomerRecord[] }>('/admin/customers', {
    userId,
  });
  return payload.data;
}

export async function loadNeobankSumsubVerification(customerId: string, userId = 'usr_admin') {
  try {
    return await neobankApi<NeobankSumsubVerification>(
      `/admin/customers/${customerId}/kyc-verification`,
      { userId }
    );
  } catch (caught) {
    if (caught instanceof Error && caught.message === 'sumsub_verification_not_found') return null;
    throw caught;
  }
}

export async function syncNeobankSumsubVerification(customerId: string, userId = 'usr_admin') {
  return neobankApi<{ status: 'sync_queued' }>(`/admin/customers/${customerId}/kyc/sync`, {
    method: 'POST',
    userId,
    body: '{}',
  });
}
