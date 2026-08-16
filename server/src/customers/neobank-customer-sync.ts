import { CustomerStatus, CustomerType, KycStatus, PrismaClient } from '@prisma/client';

type NeobankCustomer = {
  account_type: string | null;
  activated_at: string | null;
  contact_name: string | null;
  created_at: string;
  customer_id: string;
  date_of_birth: string | null;
  display_name: string;
  email: string;
  full_name: string | null;
  incorporation_country: string | null;
  kyc_review_note: string | null;
  kyc_reviewed_at: string | null;
  kyc_status: string;
  legal_name: string | null;
  nationality: string | null;
  operations_status: string;
  phone: string | null;
  phone_country_code: string | null;
  residence_country: string | null;
  status: string;
};

function date(value: string | null | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function coreStatus(row: NeobankCustomer): CustomerStatus {
  if (
    row.status === 'closed' ||
    row.status === 'suspended' ||
    row.operations_status === 'suspended'
  ) {
    return 'SUSPENDED';
  }
  if (row.kyc_status === 'rejected') return 'REJECTED';
  if (row.status === 'active' && row.operations_status === 'active') return 'ACTIVE';
  return 'PENDING_REVIEW';
}

function coreKycStatus(value: string): KycStatus {
  if (value === 'approved') return 'APPROVED';
  if (value === 'rejected') return 'REJECTED';
  return 'PENDING';
}

export async function syncNeobankCustomers(
  db: PrismaClient,
  input: { adminUserId: string; organizationId: string; tenantId: string }
) {
  const customers = await db.$queryRaw<NeobankCustomer[]>`
    SELECT
      c.id AS customer_id,
      c.email,
      c.display_name,
      c.status,
      c.kyc_status,
      c.operations_status,
      c.kyc_reviewed_at,
      c.kyc_review_note,
      c.activated_at,
      c.created_at,
      a.account_type,
      a.phone_country_code,
      a.phone,
      a.residence_country,
      a.full_name,
      a.date_of_birth,
      a.nationality,
      a.legal_name,
      a.incorporation_country,
      a.contact_name
    FROM customers c
    LEFT JOIN customer_applications a
      ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
    WHERE c.tenant_id = ${input.tenantId}
    ORDER BY c.created_at ASC
  `;

  for (const row of customers) {
    const type: CustomerType = row.account_type === 'business' ? 'BUSINESS' : 'INDIVIDUAL';
    const data = {
      contactName: row.contact_name,
      countryCode: row.incorporation_country || row.residence_country || 'ZZ',
      creatorId: input.adminUserId,
      dateOfBirth: date(row.date_of_birth),
      displayName: row.display_name,
      email: row.email,
      externalId: row.customer_id,
      kycReviewNote: row.kyc_review_note,
      kycReviewedAt: date(row.kyc_reviewed_at),
      kycReviewerId: row.kyc_status === 'pending' ? null : input.adminUserId,
      kycStatus: coreKycStatus(row.kyc_status),
      legalName: row.legal_name || row.full_name || row.display_name,
      nationality: row.nationality,
      organizationId: input.organizationId,
      phone: row.phone,
      phoneCountryCode: row.phone_country_code,
      reviewedAt: date(row.activated_at),
      reviewerId: row.status === 'active' ? input.adminUserId : null,
      status: coreStatus(row),
      type,
    };
    await db.customer.upsert({
      where: { id: row.customer_id },
      update: data,
      create: { id: row.customer_id, ...data },
    });
  }

  return customers.length;
}
