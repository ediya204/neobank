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
const currencies: Currency[] = ['USD', 'SGD', 'HKD', 'EUR', 'GBP'];

async function main() {
  const organization = await db.organization.upsert({
    where: { slug: 'moventra-demo' },
    update: { name: 'Moventra Demo Partner' },
    create: { id: 'org_demo', slug: 'moventra-demo', name: 'Moventra Demo Partner' },
  });

  const users: Array<[string, string, string, UserRole]> = [
    ['usr_maker', 'maker@moventra.local', '提交人 Maker', 'MAKER'],
    ['usr_checker', 'checker@moventra.local', '复核人 Checker', 'CHECKER'],
    ['usr_operator', 'operator@moventra.local', '出款操作员', 'OPERATOR'],
    ['usr_admin', 'admin@moventra.local', '平台管理员', 'ADMIN'],
  ];
  for (const [id, email, displayName, role] of users) {
    await db.user.upsert({
      where: { email },
      update: { displayName, role, organizationId: organization.id },
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
      displayName: 'Northstar Trading Pte. Ltd.',
      legalName: 'Northstar Trading Pte. Ltd.',
      email: 'finance@northstar.example',
      phone: '+65 6123 4567',
      countryCode: 'SG',
      creatorId: 'usr_maker',
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
      displayName: '陈思远',
      legalName: '陈思远',
      email: 'siyuan.chen@example.local',
      phone: '+65 8123 6677',
      countryCode: 'SG',
      creatorId: 'usr_maker',
    },
  });

  for (const currency of currencies) {
    await upsertAccount({
      accountNumber: `WALLET-${customer.id}-${currency}`,
      customerId: customer.id,
      kind: 'SYSTEM_WALLET',
      currency,
      name: `${currency} 法币钱包`,
      availableBalance: currency === 'USD' ? 125000 : currency === 'SGD' ? 68000 : 25000,
    });
    await upsertAccount({
      accountNumber: `WALLET-${individualCustomer.id}-${currency}`,
      customerId: individualCustomer.id,
      kind: 'SYSTEM_WALLET',
      currency,
      name: `${currency} 余额账户`,
      availableBalance: currency === 'USD' ? 12850 : currency === 'SGD' ? 8600 : 1500,
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
    accountNumber: 'VA-SG-001-88392001',
    customerId: customer.id,
    kind: 'VIRTUAL_ACCOUNT',
    currency: 'SGD',
    name: 'SGD 独立 VA',
    bankName: 'DBS Bank Ltd.',
    swiftBic: 'DBSSSGSG',
    availableBalance: 35600,
  });
  await upsertAccount({
    accountNumber: 'VA-SG-IND-66820119',
    customerId: individualCustomer.id,
    kind: 'VIRTUAL_ACCOUNT',
    currency: 'SGD',
    name: '我的 SGD 收款账户',
    bankName: 'DBS Bank Ltd.',
    swiftBic: 'DBSSSGSG',
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
  });

  await seedCryptoWallets(customer.id, {
    tron: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
    bsc: '0x795bd3739cd1b843313d949fc719659f48faa056',
    ethereum: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    balances: [18420.5, 6320.75, 2150.25],
    prefix: 'BIZ',
  });
  await seedCryptoWallets(individualCustomer.id, {
    tron: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
    bsc: '0x8ba1f109551bd432803012645ac136ddd64dba72',
    ethereum: '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae',
    balances: [2680.4, 850.25, 320.1],
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
  });
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
    ['VA-PAYOUT-01', 'VA 独立账户出款', 'VA_PAYOUT'],
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
      currency: 'SGD',
      bankName: 'OCBC Bank',
      accountNumber: '501-882910-3',
      swiftBic: 'OCBCSGSG',
      countryCode: 'SG',
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
    bsc: string;
    ethereum: string;
    balances: [number, number, number];
    prefix: string;
  }
) {
  const definitions = [
    ['TRON', 'Tron', 'TRC20', input.tron, input.balances[0], 1, 20],
    ['BSC', 'BNB Smart Chain', 'BEP20', input.bsc, input.balances[1], 0.8, 15],
    ['ETHEREUM', 'Ethereum', 'ERC20', input.ethereum, input.balances[2], 5, 12],
  ] as const;
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
        makerId: 'usr_operator',
        checkerId: 'usr_checker',
        operatorId: 'usr_operator',
        approvedAt: new Date('2026-07-30T10:20:00Z'),
        completedAt: new Date('2026-07-30T10:25:00Z'),
        createdAt: new Date('2026-07-30T10:20:00Z'),
      },
    });
  }
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
