import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { paths } from 'src/routes/paths';
import { usePathname } from 'src/routes/hooks';
import { useAuthContext } from 'src/auth/hooks';
import { hasPortalPermission } from 'src/auth/permissions';
import Iconify from 'src/components/iconify';

export function useNavData() {
  const { t } = useTranslation('admin');
  const pathname = usePathname();
  const { user } = useAuthContext();
  const isPartnerPortal = pathname.startsWith('/portal');

  return useMemo(
    () =>
      isPartnerPortal
        ? [
            ...(hasPortalPermission(user, 'customers.read') &&
            hasPortalPermission(user, 'balances.read') &&
            hasPortalPermission(user, 'transactions.read')
              ? [
                  {
                    subheader: t('navigation.workspace'),
                    items: [
                      {
                        title: t('navigation.portalHome'),
                        path: '/portal/home',
                        icon: <Iconify icon="solar:home-2-bold-duotone" />,
                      },
                    ],
                  },
                ]
              : []),
            {
              subheader: t('navigation.customerManagement'),
              items: [
                ...(hasPortalPermission(user, 'customers.read')
                  ? [
                      {
                        title: t('navigation.customerOverview'),
                        path: '/portal/customers',
                        icon: <Iconify icon="solar:users-group-rounded-bold-duotone" />,
                      },
                    ]
                  : []),
                ...(hasPortalPermission(user, 'customers.read') &&
                hasPortalPermission(user, 'customers.create')
                  ? [
                      {
                        title: t('navigation.startOnboarding'),
                        path: '/portal/onboarding',
                        icon: <Iconify icon="solar:user-plus-bold-duotone" />,
                      },
                    ]
                  : []),
              ],
            },
            {
              subheader: t('navigation.assetManagement'),
              items: [
                ...(hasPortalPermission(user, 'customers.read') &&
                hasPortalPermission(user, 'balances.read') &&
                hasPortalPermission(user, 'transactions.read')
                  ? [
                      {
                        title: t('navigation.reconciliation'),
                        path: '/portal/reconciliation',
                        icon: <Iconify icon="solar:chart-square-bold-duotone" />,
                      },
                    ]
                  : []),
                ...(hasPortalPermission(user, 'customers.read') &&
                hasPortalPermission(user, 'balances.read')
                  ? [
                      {
                        title: t('navigation.customerBalances'),
                        path: '/portal/balances',
                        icon: <Iconify icon="solar:wallet-money-bold-duotone" />,
                      },
                    ]
                  : []),
                ...(hasPortalPermission(user, 'customers.read') &&
                hasPortalPermission(user, 'balances.read') &&
                hasPortalPermission(user, 'transactions.read')
                  ? [
                      {
                        title: t('navigation.fiatWallet'),
                        path: '/portal/fiat-wallet',
                        icon: <Iconify icon="solar:dollar-minimalistic-bold-duotone" />,
                      },
                      {
                        title: t('navigation.cryptoWallet'),
                        path: '/portal/crypto-wallet',
                        icon: <Iconify icon="solar:wallet-2-bold-duotone" />,
                      },
                      {
                        title: '钱包与 VA',
                        path: '/portal/money/accounts',
                        icon: <Iconify icon="solar:wallet-money-bold-duotone" />,
                      },
                      {
                        title: '内部转账',
                        path: '/portal/money/transfers',
                        icon: <Iconify icon="solar:transfer-horizontal-bold-duotone" />,
                      },
                      {
                        title: '法币换汇',
                        path: '/portal/money/fx',
                        icon: <Iconify icon="solar:refresh-square-bold-duotone" />,
                      },
                      {
                        title: 'OTC',
                        path: '/portal/money/otc',
                        icon: <Iconify icon="solar:hand-money-bold-duotone" />,
                      },
                      {
                        title: '发起出款',
                        path: '/portal/money/payouts',
                        icon: <Iconify icon="solar:upload-minimalistic-bold-duotone" />,
                      },
                      {
                        title: '收款人管理',
                        path: '/portal/money/beneficiaries',
                        icon: <Iconify icon="solar:user-id-bold-duotone" />,
                      },
                    ]
                  : []),
                ...(hasPortalPermission(user, 'customers.read') &&
                hasPortalPermission(user, 'transactions.read')
                  ? [
                      {
                        title: t('navigation.transactionHistory'),
                        path: '/portal/transactions',
                        icon: <Iconify icon="solar:history-bold-duotone" />,
                      },
                    ]
                  : []),
              ],
            },
            {
              subheader: t('navigation.developer'),
              items: [
                ...(hasPortalPermission(user, 'integrations.read')
                  ? [
                      {
                        title: t('navigation.apiIntegration'),
                        path: '/portal/api',
                        icon: <Iconify icon="solar:code-square-bold-duotone" />,
                      },
                    ]
                  : []),
              ],
            },
            {
              subheader: t('navigation.account'),
              items: [
                ...(hasPortalPermission(user, 'team.read')
                  ? [
                      {
                        title: t('navigation.team'),
                        path: '/portal/team',
                        icon: <Iconify icon="solar:users-group-two-rounded-bold-duotone" />,
                      },
                    ]
                  : []),
                ...(hasPortalPermission(user, 'notifications.read')
                  ? [
                      {
                        title: t('navigation.messages'),
                        path: '/portal/messages',
                        icon: <Iconify icon="solar:chat-round-dots-bold-duotone" />,
                      },
                    ]
                  : []),
                {
                  title: t('navigation.settings'),
                  path: '/portal/settings',
                  icon: <Iconify icon="solar:settings-bold-duotone" />,
                },
              ],
            },
          ]
        : [
            {
              subheader: t('navigation.workspace'),
              items: [
                {
                  title: t('navigation.operationsOverview'),
                  path: paths.dashboard.overview,
                  icon: <Iconify icon="solar:home-2-bold-duotone" />,
                },
              ],
            },
            {
              subheader: t('navigation.customersAndOnboarding'),
              items: [
                {
                  title: t('navigation.customerManagement'),
                  path: paths.dashboard.customers.root,
                  icon: <Iconify icon="solar:users-group-rounded-bold-duotone" />,
                },
                {
                  title: t('navigation.onboardingApplications'),
                  path: paths.dashboard.onboarding,
                  icon: <Iconify icon="solar:user-plus-bold-duotone" />,
                },
              ],
            },
            {
              subheader: t('navigation.fundOperations'),
              items: [
                {
                  title: t('navigation.reconciliation'),
                  path: paths.dashboard.fundOperations.reconciliation,
                  icon: <Iconify icon="solar:chart-square-bold-duotone" />,
                },
                {
                  title: t('navigation.depositEntry'),
                  path: paths.dashboard.fundOperations.deposits,
                  icon: <Iconify icon="solar:download-minimalistic-bold-duotone" />,
                },
                {
                  title: '出款管理',
                  path: paths.dashboard.fundOperations.withdrawals,
                  icon: <Iconify icon="solar:upload-minimalistic-bold-duotone" />,
                },
                {
                  title: '内部转账',
                  path: paths.dashboard.fundOperations.transfers,
                  icon: <Iconify icon="solar:transfer-horizontal-bold-duotone" />,
                },
                {
                  title: '法币换汇',
                  path: paths.dashboard.fundOperations.fx,
                  icon: <Iconify icon="solar:refresh-square-bold-duotone" />,
                },
                {
                  title: t('navigation.otcProcessing'),
                  path: paths.dashboard.fundOperations.otc,
                  icon: <Iconify icon="solar:hand-money-bold-duotone" />,
                },
                {
                  title: '数字钱包复核',
                  path: '/dashboard/operations/crypto-wallets',
                  icon: <Iconify icon="solar:wallet-2-bold-duotone" />,
                },
                {
                  title: '调账管理',
                  path: paths.dashboard.fundOperations.adjustments,
                  icon: <Iconify icon="solar:tuning-square-2-bold-duotone" />,
                },
                {
                  title: '复核中心',
                  path: paths.dashboard.fundOperations.approvals,
                  icon: <Iconify icon="solar:clipboard-check-bold-duotone" />,
                },
                {
                  title: t('navigation.customerBalances'),
                  path: paths.dashboard.fundOperations.balances,
                  icon: <Iconify icon="solar:wallet-money-bold-duotone" />,
                },
                {
                  title: t('navigation.transactionHistory'),
                  path: paths.dashboard.fundOperations.transactions,
                  icon: <Iconify icon="solar:history-bold-duotone" />,
                },
                {
                  title: t('navigation.ledger'),
                  path: paths.dashboard.fundOperations.ledger,
                  icon: <Iconify icon="solar:notebook-bold-duotone" />,
                },
                {
                  title: '收款人管理',
                  path: paths.dashboard.fundOperations.beneficiaries,
                  icon: <Iconify icon="solar:user-id-bold-duotone" />,
                },
              ],
            },
            {
              subheader: '账户与通道',
              items: [
                {
                  title: '客户钱包与 VA',
                  path: paths.dashboard.accounts,
                  icon: <Iconify icon="solar:wallet-money-bold-duotone" />,
                },
                {
                  title: '资金通道',
                  path: paths.dashboard.fundingChannels,
                  icon: <Iconify icon="solar:bank-bold-duotone" />,
                },
              ],
            },
            {
              subheader: t('navigation.usdtSweepDirectory'),
              items: [
                {
                  title: t('navigation.usdtSweeps'),
                  path: paths.dashboard.usdtSweeps,
                  icon: <Iconify icon="solar:transfer-horizontal-bold-duotone" />,
                },
              ],
            },
            {
              subheader: t('navigation.systemSettings'),
              items: [
                {
                  title: t('navigation.apiIntegrationApprovals'),
                  path: paths.dashboard.settings.apiIntegration,
                  icon: <Iconify icon="solar:code-square-bold-duotone" />,
                },
                {
                  title: '汇率与报价',
                  path: paths.dashboard.settings.rates,
                  icon: <Iconify icon="solar:graph-new-up-bold-duotone" />,
                },
                {
                  title: t('navigation.apiSecurity'),
                  path: paths.dashboard.settings.apiSecurity,
                  icon: <Iconify icon="solar:shield-keyhole-bold-duotone" />,
                },
                {
                  title: t('navigation.auditLogs'),
                  path: paths.dashboard.auditLogs,
                  icon: <Iconify icon="solar:clipboard-list-bold-duotone" />,
                },
              ],
            },
          ],
    [isPartnerPortal, t, user]
  );
}
