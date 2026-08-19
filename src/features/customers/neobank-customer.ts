import {
  Customer,
  demoOrganizationId,
  neobankApi,
} from 'src/features/finance/core-api';

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
