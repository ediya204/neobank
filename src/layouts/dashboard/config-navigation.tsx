import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { paths } from 'src/routes/paths';
import { usePathname } from 'src/routes/hooks';
import { useAuthContext } from 'src/auth/hooks';
import { hasPortalPermission } from 'src/auth/permissions';
import Iconify from 'src/components/iconify';
import { ACTION_ICONS } from 'src/theme/iconography';

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
                        title: '收付与兑换',
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
              subheader: t('navigation.customerAccounts'),
              items: [
                {
                  title: t('navigation.customerManagement'),
                  path: paths.dashboard.customers.root,
                  icon: <Iconify icon="solar:users-group-rounded-bold-duotone" />,
                },
                {
                  title: t('navigation.onboardingKyc'),
                  path: paths.dashboard.onboarding,
                  icon: <Iconify icon="solar:user-plus-bold-duotone" />,
                },
                {
                  title: t('navigation.vaApplications'),
                  path: paths.dashboard.fundOperations.virtualAccounts,
                  icon: <Iconify icon={ACTION_ICONS.bankAccount} />,
                },
                {
                  title: t('navigation.customerAccountsEntry'),
                  path: paths.dashboard.accounts,
                  icon: <Iconify icon="solar:wallet-money-bold-duotone" />,
                },
                {
                  title: t('navigation.beneficiaries'),
                  path: paths.dashboard.fundOperations.beneficiaries,
                  icon: <Iconify icon="solar:user-id-bold-duotone" />,
                },
              ],
            },
            {
              subheader: t('navigation.fundProcessing'),
              items: [
                {
                  title: t('navigation.depositProcessing'),
                  path: paths.dashboard.fundOperations.deposits,
                  icon: <Iconify icon="solar:download-minimalistic-bold-duotone" />,
                },
                {
                  title: t('navigation.fiatPayouts'),
                  path: paths.dashboard.fundOperations.withdrawals,
                  icon: <Iconify icon="solar:upload-minimalistic-bold-duotone" />,
                },
                {
                  title: t('navigation.usdtPayouts'),
                  path: paths.dashboard.fundOperations.cryptoWallets,
                  icon: <Iconify icon="solar:wallet-2-bold-duotone" />,
                },
                {
                  title: t('navigation.adjustmentProcessing'),
                  path: paths.dashboard.fundOperations.adjustments,
                  icon: <Iconify icon="solar:tuning-square-2-bold-duotone" />,
                },
                {
                  title: t('navigation.fundingChannels'),
                  path: paths.dashboard.fundingChannels,
                  icon: <Iconify icon={ACTION_ICONS.fundingChannel} />,
                },
              ],
            },
            {
              subheader: t('navigation.fxManagement'),
              items: [
                {
                  title: t('navigation.fiatExchange'),
                  path: paths.dashboard.fundOperations.fx,
                  icon: <Iconify icon="solar:refresh-square-bold-duotone" />,
                },
                {
                  title: t('navigation.automaticConversion'),
                  path: paths.dashboard.fundOperations.otc,
                  icon: <Iconify icon="solar:hand-money-bold-duotone" />,
                },
                {
                  title: t('navigation.ratesAndQuotes'),
                  path: paths.dashboard.settings.rates,
                  icon: <Iconify icon="solar:graph-new-up-bold-duotone" />,
                },
              ],
            },
            {
              subheader: t('navigation.accountingQueries'),
              items: [
                {
                  title: t('navigation.reconciliation'),
                  path: paths.dashboard.fundOperations.reconciliation,
                  icon: <Iconify icon="solar:chart-square-bold-duotone" />,
                },
                {
                  title: t('navigation.transactionRecords'),
                  path: paths.dashboard.fundOperations.transactions,
                  icon: <Iconify icon="solar:history-bold-duotone" />,
                },
                {
                  title: t('navigation.ledgerEntries'),
                  path: paths.dashboard.fundOperations.ledger,
                  icon: <Iconify icon="solar:notebook-bold-duotone" />,
                },
              ],
            },
          ],
    [isPartnerPortal, t, user]
  );
}
