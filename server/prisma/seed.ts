import 'dotenv/config';
import {
  AccountKind,
  AccountStatus,
  ChannelType,
  Currency,
  PrismaClient,
  RateType,
  UserRole,
} from '@prisma/client';

const db = new PrismaClient();
const currencies: Currency[] = ['USD', 'HKD'];

async function main() {
  const organization = await db.organization.upsert({
    where: { id: 'org_demo' },
    update: { slug: 'ssc-digital-bank-demo', name: 'SSC Digital Bank Demo Partner' },
    create: {
      id: 'org_demo',
      slug: 'ssc-digital-bank-demo',
      name: 'SSC Digital Bank Demo Partner',
    },
  });

  const users: Array<[string, string, string, UserRole]> = [
    ['usr_admin', 'admin@ssc-digital-bank.local', '平台管理员', 'ADMIN'],
  ];
  for (const [id, email, displayName, role] of users) {
    await db.user.upsert({
      where: { id },
      update: { email, displayName, role, organizationId: organization.id },
      create: { id, email, displayName, role, organizationId: organization.id },
    });
  }

  const customer = await db.customer.upsert({
    where: { id: 'cus_demo_business' },
    update: {},
    create: {
      id: 'cus_demo_business',
      organizationId: organization.id,
      externalId: 'CUST-10001',
      type: 'BUSINESS',
      status: 'ACTIVE',
      kycStatus: 'APPROVED',
      kycReviewedAt: new Date('2026-07-30T09:00:00Z'),
      kycReviewNote: 'Demo KYC approved before Operations activation',
      displayName: 'Northstar Trading Pte. Ltd.',
      legalName: 'Northstar Trading Pte. Ltd.',
      email: 'finance@northstar.example',
      phone: '+65 6123 4567',
      countryCode: 'SG',
      creatorId: 'usr_admin',
      registrationNo: '202612345N',
    },
  });

  const individualCustomer = await db.customer.upsert({
    where: { id: 'cus_demo_individual' },
    update: {},
    create: {
      id: 'cus_demo_individual',
      organizationId: organization.id,
      externalId: 'CUST-10002',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      kycStatus: 'APPROVED',
      kycReviewedAt: new Date('2026-07-30T09:05:00Z'),
      kycReviewNote: 'Demo KYC approved before Operations activation',
      displayName: '陈思远',
      legalName: '陈思远',
      email: 'siyuan.chen@example.local',
      phone: '+65 8123 6677',
      countryCode: 'SG',
      creatorId: 'usr_admin',
    },
  });

  for (const currency of currencies) {
    await upsertAccount({
      accountNumber: `WALLET-${customer.id}-${currency}`,
      customerId: customer.id,
      kind: 'SYSTEM_WALLET',
      currency,
      name: `${currency} 法币钱包`,
      availableBalance: currency === 'USD' ? 125000 : 25000,
    });
    await upsertAccount({
      accountNumber: `WALLET-${individualCustomer.id}-${currency}`,
      customerId: individualCustomer.id,
      kind: 'SYSTEM_WALLET',
      currency,
      name: `${currency} 余额账户`,
      availableBalance: currency === 'USD' ? 12850 : 1500,
    });
    await upsertAccount({
      accountNumber: `CLEARING-${currency}`,
      kind: 'PLATFORM_CLEARING',
      currency,
      name: `${currency} 平台清算账户`,
    });
    await upsertAccount({
      accountNumber: `FEES-${currency}`,
      kind: 'FEE_REVENUE',
      currency,
      name: `${currency} 手续费收入`,
    });
  }

  await upsertAccount({
    accountNumber: 'VA-US-001-88392001',
    customerId: customer.id,
    kind: 'VIRTUAL_ACCOUNT',
    currency: 'USD',
    name: 'USD 独立 VA',
    bankName: 'Citibank N.A.',
    swiftBic: 'CITIUS33',
    availableBalance: 35600,
  });
  await upsertAccount({
    accountNumber: 'VA-US-IND-66820119',
    customerId: individualCustomer.id,
    kind: 'VIRTUAL_ACCOUNT',
    currency: 'USD',
    name: '我的 USD 收款账户',
    bankName: 'Citibank N.A.',
    swiftBic: 'CITIUS33',
    availableBalance: 3200,
  });
  await upsertAccount({
    accountNumber: 'VA-HK-001-72811002',
    customerId: customer.id,
    kind: 'VIRTUAL_ACCOUNT',
    currency: 'HKD',
    name: 'HKD 独立 VA',
    bankName: 'Bank of China (Hong Kong)',
    swiftBic: 'BKCHHKHH',
    availableBalance: 148000,
  });
  await upsertAccount({
    accountNumber: 'CRYPTO-DEMO-USDT',
    customerId: customer.id,
    kind: 'CRYPTO_WALLET',
    currency: 'USDT',
    name: 'USDT 钱包（Cregis 第二阶段）',
    network: 'TRON',
    status: 'ACTIVE',
    availableBalance: 18420.5,
  });

  await seedCryptoWallets(customer.id, {
    tron: 'CREGIS_UNASSIGNED_BIZ_TRON',
    balance: 18420.5,
    prefix: 'BIZ',
  });
  await seedCryptoWallets(individualCustomer.id, {
    tron: 'CREGIS_UNASSIGNED_IND_TRON',
    balance: 2680.4,
    prefix: 'IND',
  });
  await upsertAccount({
    accountNumber: 'CRYPTO-DEMO-IND-USDT',
    customerId: individualCustomer.id,
    kind: 'CRYPTO_WALLET',
    currency: 'USDT',
    name: 'USDT 钱包（等待 Cregis）',
    network: 'TRON',
    status: 'ACTIVE',
    availableBalance: 2680.4,
  });
  await syncCryptoAccountMirror(customer.id);
  await syncCryptoAccountMirror(individualCustomer.id);
  await upsertAccount({
    accountNumber: 'CLEARING-USDT',
    kind: 'PLATFORM_CLEARING',
    currency: 'USDT',
    name: 'USDT 平台清算账户',
  });
  await upsertAccount({
    accountNumber: 'FEES-USDT',
    kind: 'FEE_REVENUE',
    currency: 'USDT',
    name: 'USDT 手续费收入',
  });

  const channelDefinitions: Array<[string, string, ChannelType]> = [
    ['FIAT-IN-01', '法币入账通道', 'FIAT_INBOUND'],
    ['POBO-PAYOUT-01', 'POBO 客户名义出款', 'POBO_PAYOUT'],
    ['PLATFORM-PAYOUT-01', '平台母账户代付', 'PLATFORM_PAYOUT'],
  ];
  for (const [code, name, type] of channelDefinitions) {
    await db.fundingChannel.upsert({
      where: { organizationId_code: { organizationId: organization.id, code } },
      update: { name, type, active: true, supportedCurrencies: currencies },
      create: {
        organizationId: organization.id,
        code,
        name,
        type,
        supportedCurrencies: currencies,
        settlementBankName: type === 'FIAT_INBOUND' ? 'DBS Bank Ltd.' : undefined,
        settlementAccount: type === 'FIAT_INBOUND' ? '001-882991-8' : undefined,
        swiftBic: type === 'FIAT_INBOUND' ? 'DBSSSGSG' : undefined,
      },
    });
  }
  const citiVaChannel = await db.fundingChannel.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: 'VA-CITI-US' } },
    update: {
      name: 'Citibank 美国 VA',
      type: 'VIRTUAL_ACCOUNT',
      active: true,
      supportedCurrencies: ['USD'],
      settlementBankName: 'Citibank N.A.',
      swiftBic: 'CITIUS33',
      bankCountry: 'US',
      bankAddress: '388 Greenwich Street, New York, NY 10013, United States',
    },
    create: {
      organizationId: organization.id,
      code: 'VA-CITI-US',
      name: 'Citibank 美国 VA',
      type: 'VIRTUAL_ACCOUNT',
      active: true,
      supportedCurrencies: ['USD'],
      settlementBankName: 'Citibank N.A.',
      swiftBic: 'CITIUS33',
      bankCountry: 'US',
      bankAddress: '388 Greenwich Street, New York, NY 10013, United States',
    },
  });
  const bochkVaChannel = await db.fundingChannel.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: 'VA-BOCHK-HK' } },
    update: {
      name: '中银香港 VA',
      type: 'VIRTUAL_ACCOUNT',
      active: true,
      supportedCurrencies: ['HKD'],
      settlementBankName: 'Bank of China (Hong Kong)',
      swiftBic: 'BKCHHKHH',
      bankCountry: 'HK',
      bankAddress: '1 Garden Road, Hong Kong',
    },
    create: {
      organizationId: organization.id,
      code: 'VA-BOCHK-HK',
      name: '中银香港 VA',
      type: 'VIRTUAL_ACCOUNT',
      active: true,
      supportedCurrencies: ['HKD'],
      settlementBankName: 'Bank of China (Hong Kong)',
      swiftBic: 'BKCHHKHH',
      bankCountry: 'HK',
      bankAddress: '1 Garden Road, Hong Kong',
    },
  });
  await db.fundingChannel.updateMany({
    where: { organizationId: organization.id, type: 'VA_PAYOUT' },
    data: { active: false },
  });
  await db.account.updateMany({
    where: { accountNumber: { in: ['VA-US-001-88392001', 'VA-US-IND-66820119'] } },
    data: { fundingChannelId: citiVaChannel.id },
  });
  await db.account.updateMany({
    where: { accountNumber: 'VA-HK-001-72811002' },
    data: { fundingChannelId: bochkVaChannel.id },
  });
  const feeChannels = await db.fundingChannel.findMany({
    where: {
      organizationId: organization.id,
      type: { in: ['VIRTUAL_ACCOUNT', 'POBO_PAYOUT', 'PLATFORM_PAYOUT'] },
    },
  });
  for (const channel of feeChannels) {
    const method =
      channel.type === 'VIRTUAL_ACCOUNT'
        ? 'VA'
        : channel.type === 'POBO_PAYOUT'
        ? 'POBO'
        : 'PLATFORM';
    for (const currency of channel.supportedCurrencies.filter((value) => currencies.includes(value))) {
      await db.withdrawalFeeRule.upsert({
        where: {
          scopeId_assetClass_currency_method_channelCode_network: {
            scopeId: organization.id,
            assetClass: 'FIAT',
            currency,
            method,
            channelCode: channel.code,
            network: '',
          },
        },
        update: {},
        create: {
          scopeId: organization.id,
          organizationId: organization.id,
          assetClass: 'FIAT',
          currency,
          method,
          channelCode: channel.code,
          network: '',
          feeAmountMinor: 0n,
          feeDecimals: 2,
          createdBy: 'usr_admin',
          updatedBy: 'usr_admin',
        },
      });
    }
  }
  await db.withdrawalFeeRule.upsert({
    where: {
      scopeId_assetClass_currency_method_channelCode_network: {
        scopeId: process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || organization.id,
        assetClass: 'CRYPTO',
        currency: 'USDT',
        method: 'ON_CHAIN',
        channelCode: 'CREGIS',
        network: 'TRON',
      },
    },
    update: {},
    create: {
      scopeId: process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || organization.id,
      organizationId: organization.id,
      assetClass: 'CRYPTO',
      currency: 'USDT',
      method: 'ON_CHAIN',
      channelCode: 'CREGIS',
      network: 'TRON',
      feeAmountMinor: 1_000_000n,
      feeDecimals: 6,
      createdBy: 'usr_admin',
      updatedBy: 'usr_admin',
    },
  });

  await db.beneficiary.upsert({
    where: { id: 'ben_demo_supplier' },
    update: {},
    create: {
      id: 'ben_demo_supplier',
      customerId: customer.id,
      name: 'Harbour Supply Limited',
      currency: 'HKD',
      bankName: 'HSBC Hong Kong',
      accountNumber: '808-882991-001',
      swiftBic: 'HSBCHKHHHKH',
      countryCode: 'HK',
    },
  });
  await db.beneficiary.upsert({
    where: { id: 'ben_demo_individual' },
    update: {},
    create: {
      id: 'ben_demo_individual',
      customerId: individualCustomer.id,
      name: '陈思远',
      currency: 'USD',
      bankName: 'Citibank N.A.',
      accountNumber: '501-882910-3',
      swiftBic: 'CITIUS33',
      countryCode: 'US',
    },
  });

  for (const baseCurrency of currencies) {
    for (const quoteCurrency of currencies) {
      if (baseCurrency === quoteCurrency) continue;
      const existing = await db.rateVersion.findFirst({
        where: { type: 'FX', baseCurrency, quoteCurrency, active: true },
      });
      if (!existing) {
        await db.rateVersion.create({
          data: {
            type: 'FX',
            baseCurrency,
            quoteCurrency,
            buyRate: demoRate(baseCurrency, quoteCurrency) * 0.998,
            sellRate: demoRate(baseCurrency, quoteCurrency),
            feeBps: 20,
            effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          },
        });
      }
    }
  }
  for (const fiat of currencies) {
    const existing = await db.rateVersion.findFirst({
      where: { type: 'OTC', baseCurrency: fiat, quoteCurrency: 'USDT', active: true },
    });
    if (!existing) {
      await db.rateVersion.create({
        data: {
          type: RateType.OTC,
          baseCurrency: fiat,
          quoteCurrency: 'USDT',
          buyRate: demoRate(fiat, 'USD') * 0.997,
          sellRate: demoRate(fiat, 'USD') * 0.995,
          feeBps: 30,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        },
      });
    }
    const reverse = await db.rateVersion.findFirst({
      where: { type: 'OTC', baseCurrency: 'USDT', quoteCurrency: fiat, active: true },
    });
    if (!reverse) {
      await db.rateVersion.create({
        data: {
          type: RateType.OTC,
          baseCurrency: 'USDT',
          quoteCurrency: fiat,
          buyRate: (1 / demoRate(fiat, 'USD')) * 0.997,
          sellRate: (1 / demoRate(fiat, 'USD')) * 0.995,
          feeBps: 30,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        },
      });
    }
  }
}

async function upsertAccount(input: {
  accountNumber: string;
  customerId?: string;
  kind: AccountKind;
  currency: Currency;
  name: string;
  bankName?: string;
  swiftBic?: string;
  status?: AccountStatus;
  network?: string;
  availableBalance?: number;
}) {
  await db.account.upsert({
    where: { accountNumber: input.accountNumber },
    update: { status: input.status || 'ACTIVE' },
    create: {
      ...input,
      status: input.status || 'ACTIVE',
      availableBalance: input.availableBalance || 0,
    },
  });
}

async function seedCryptoWallets(
  customerId: string,
  input: {
    tron: string;
    balance: number;
    prefix: string;
  }
) {
  const definitions = [['TRON', 'Tron', 'TRC20', input.tron, input.balance, 1, 20]] as const;
  for (const [
    network,
    networkLabel,
    tokenStandard,
    walletAddress,
    balance,
    fee,
    confirmations,
  ] of definitions) {
    const wallet = await db.cryptoWallet.upsert({
      where: { customerId_asset_network: { customerId, asset: 'USDT', network } },
      update: { networkLabel, tokenStandard, walletAddress, status: 'ACTIVE', withdrawalFee: fee },
      create: {
        id: `cw_${input.prefix.toLowerCase()}_${network.toLowerCase()}`,
        customerId,
        asset: 'USDT',
        network,
        networkLabel,
        tokenStandard,
        walletAddress,
        availableBalance: balance,
        withdrawalFee: fee,
        confirmationsRequired: confirmations,
      },
    });
    const depositReference = `CWD-DEMO-${input.prefix}-${network}`;
    await db.cryptoTransfer.upsert({
      where: { reference: depositReference },
      update: {},
      create: {
        reference: depositReference,
        customerId,
        walletId: wallet.id,
        asset: 'USDT',
        network,
        direction: 'DEPOSIT',
        status: 'COMPLETED',
        amount: network === 'TRON' ? 2000 : 1000,
        feeAmount: 0,
        netAmount: network === 'TRON' ? 2000 : 1000,
        fromAddress:
          network === 'TRON'
            ? 'TM2tm7GQ5WGe5m5xUxL4ZrX8wYzvMWDMV'
            : '0x1111111111111111111111111111111111111111',
        toAddress: wallet.walletAddress,
        txHash: `0x${network === 'TRON' ? 'a' : network === 'BSC' ? 'b' : 'c'}${'1'.repeat(63)}`,
        confirmations,
        makerId: 'usr_admin',
        checkerId: 'usr_admin',
        operatorId: 'usr_admin',
        approvedAt: new Date('2026-07-30T10:20:00Z'),
        completedAt: new Date('2026-07-30T10:25:00Z'),
        createdAt: new Date('2026-07-30T10:20:00Z'),
      },
    });
  }
}

async function syncCryptoAccountMirror(customerId: string) {
  const wallet = await db.cryptoWallet.findUnique({
    where: { customerId_asset_network: { customerId, asset: 'USDT', network: 'TRON' } },
  });
  if (!wallet) return;
  await db.account.updateMany({
    where: {
      customerId,
      kind: 'CRYPTO_WALLET',
      currency: 'USDT',
      network: 'TRON',
      availableBalance: 0,
      frozenBalance: 0,
    },
    data: { availableBalance: wallet.availableBalance, frozenBalance: wallet.frozenBalance },
  });
}

function demoRate(base: Currency, quote: Currency) {
  const usdValue: Record<Currency, number> = {
    USD: 1,
    SGD: 0.78,
    HKD: 0.128,
    EUR: 1.16,
    GBP: 1.34,
    USDT: 1,
  };
  return usdValue[base] / usdValue[quote];
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
