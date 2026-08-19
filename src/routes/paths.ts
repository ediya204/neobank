const DASHBOARD_ROOT = '/dashboard';

export const paths = {
  faqs: '/faqs',
  minimalUI: 'https://mui.com/store/items/minimal-dashboard/',
  product: {
    root: '/product',
    checkout: '/product/checkout',
  },
  auth: {
    admin: {
      login: '/admin/login',
      setup: '/admin/setup',
    },
    customer: {
      login: '/customer/login',
      setup: '/customer/setup',
      register: '/customer/register',
    },
    portal: {
      login: '/portal/login',
      setup: '/portal/setup',
      register: '/portal/register',
    },
    jwt: {
      login: '/auth/jwt/login',
      register: '/auth/jwt/register',
    },
    auth0: {
      login: '/auth/auth0/login',
    },
    amplify: {
      login: '/auth/amplify/login',
      verify: '/auth/amplify/verify',
      register: '/auth/amplify/register',
      newPassword: '/auth/amplify/new-password',
      forgotPassword: '/auth/amplify/forgot-password',
    },
    firebase: {
      login: '/auth/firebase/login',
      verify: '/auth/firebase/verify',
      register: '/auth/firebase/register',
      forgotPassword: '/auth/firebase/forgot-password',
    },
  },
  dashboard: {
    root: DASHBOARD_ROOT,
    notFound: `${DASHBOARD_ROOT}/404`,
    serverError: `${DASHBOARD_ROOT}/500`,
    overview: `${DASHBOARD_ROOT}/overview`,
    operations: `${DASHBOARD_ROOT}/operations`,
    customers: {
      root: `${DASHBOARD_ROOT}/customers`,
      details: (id: string) => `${DASHBOARD_ROOT}/customers/${id}`,
    },
    customerDemo: (variant: string) => `${DASHBOARD_ROOT}/customers/demo/${variant}`,
    onboarding: `${DASHBOARD_ROOT}/onboarding`,
    onboardingReview: (id: string) => `${DASHBOARD_ROOT}/onboarding/${id}/review`,
    fundOperations: {
      reconciliation: `${DASHBOARD_ROOT}/operations/reconciliation`,
      deposits: `${DASHBOARD_ROOT}/operations/deposits`,
      withdrawals: `${DASHBOARD_ROOT}/operations/withdrawals`,
      transfers: `${DASHBOARD_ROOT}/operations/transfers`,
      fx: `${DASHBOARD_ROOT}/operations/fx`,
      otc: `${DASHBOARD_ROOT}/operations/otc`,
      adjustments: `${DASHBOARD_ROOT}/operations/adjustments`,
      balances: `${DASHBOARD_ROOT}/operations/balances`,
      transactions: `${DASHBOARD_ROOT}/operations/transactions`,
      ledger: `${DASHBOARD_ROOT}/operations/ledger`,
      beneficiaries: `${DASHBOARD_ROOT}/operations/beneficiaries`,
      virtualAccounts: `${DASHBOARD_ROOT}/operations/virtual-accounts`,
      virtualAccountDetails: (id: string) => `${DASHBOARD_ROOT}/operations/virtual-accounts/${id}`,
      cryptoWallets: `${DASHBOARD_ROOT}/operations/crypto-wallets`,
    },
    accounts: `${DASHBOARD_ROOT}/accounts`,
    fundingChannels: `${DASHBOARD_ROOT}/funding-channels`,
    usdtSweeps: `${DASHBOARD_ROOT}/usdt-sweeps`,
    settings: {
      root: `${DASHBOARD_ROOT}/settings`,
      fees: `${DASHBOARD_ROOT}/settings/fees`,
      apiIntegration: `${DASHBOARD_ROOT}/settings/api-integration`,
      apiSecurity: `${DASHBOARD_ROOT}/settings/api-security`,
      rates: `${DASHBOARD_ROOT}/settings/rates`,
    },
    auditLogs: `${DASHBOARD_ROOT}/audit-logs`,
    user: {
      profile: `${DASHBOARD_ROOT}/user/profile`,
      account: `${DASHBOARD_ROOT}/user/account`,
    },
    vaApplications: {
      root: `${DASHBOARD_ROOT}/va-applications`,
      new: `${DASHBOARD_ROOT}/va-applications/new`,
      details: (id: string) => `${DASHBOARD_ROOT}/va-applications/${id}`,
    },
  },
};
