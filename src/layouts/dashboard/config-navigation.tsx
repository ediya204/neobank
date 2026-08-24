import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { paths } from 'src/routes/paths';
import { useAuthContext } from 'src/auth/hooks';
import { hasAdminPermission } from 'src/auth/permissions';
import { requiredAdminPermissionForPath } from 'src/auth/admin-access';
import { AuthSessionUser } from 'src/auth/types';
import Iconify from 'src/components/iconify';
import AssetIcon from 'src/components/asset-icon';
import { ACTION_ICONS } from 'src/theme/iconography';

export function useNavData() {
  const { t } = useTranslation('admin');
  const { user } = useAuthContext();

  return useMemo(
    () =>
      filterAdminNavigation(
        [
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
                title: t('navigation.usdtInbound'),
                path: paths.dashboard.fundOperations.usdtInbound,
                icon: <AssetIcon asset="USDT" network="TRON" size={24} />,
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
          ...(hasAdminPermission(user, 'admin_users.manage')
            ? [
                {
                  subheader: t('navigation.systemManagement'),
                  items: [
                    {
                      title: t('navigation.adminUsers'),
                      path: paths.dashboard.adminUsers,
                      icon: <Iconify icon="solar:shield-user-bold-duotone" />,
                    },
                  ],
                },
              ]
            : []),
        ],
        user
      ),
    [t, user]
  );
}

function filterAdminNavigation<T extends { items: Array<{ path: string }>; subheader: string }>(
  sections: T[],
  user: AuthSessionUser | null | undefined
): T[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        hasAdminPermission(user, requiredAdminPermissionForPath(item.path))
      ),
    }))
    .filter((section) => section.items.length > 0) as T[];
}
