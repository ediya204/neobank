import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';
import { useTranslation } from 'react-i18next';
import Iconify from 'src/components/iconify';
import { fToNow } from 'src/utils/format-time';

export type PortalNotification = {
  id: string;
  application_id: string | null;
  customer_name: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
  is_read: boolean;
};

const ACTION_PRESENTATION: Record<string, { icon: string; color: string; title: string }> = {
  'application.created': {
    icon: 'solar:user-plus-bold-duotone',
    color: 'info.main',
    title: 'header.notification_application_created',
  },
  'application.status_changed': {
    icon: 'solar:verified-check-bold-duotone',
    color: 'success.main',
    title: 'header.notification_application_status',
  },
  'application.changes_requested': {
    icon: 'solar:danger-triangle-bold-duotone',
    color: 'error.main',
    title: 'header.notification_application_changes_requested',
  },
  'application.resubmitted': {
    icon: 'solar:restart-bold-duotone',
    color: 'info.main',
    title: 'header.notification_application_resubmitted',
  },
  'fund_transaction.created': {
    icon: 'solar:wallet-money-bold-duotone',
    color: 'warning.main',
    title: 'header.notification_transaction_created',
  },
  'fund_transaction.status_changed': {
    icon: 'solar:card-transfer-bold-duotone',
    color: 'primary.main',
    title: 'header.notification_transaction_status',
  },
  'fiat_deposit.cleared_and_converted': {
    icon: 'solar:refresh-circle-bold-duotone',
    color: 'success.main',
    title: 'header.notification_conversion_completed',
  },
};

function statusValue(metadata: Record<string, unknown>) {
  const value = metadata.status || metadata.to_status || metadata.next_status;
  return typeof value === 'string' ? value : '';
}

export default function NotificationItem({
  notification,
  onClick,
}: {
  notification: PortalNotification;
  onClick: VoidFunction;
}) {
  const { t } = useTranslation('common');
  const presentation = ACTION_PRESENTATION[notification.action] || {
    icon: 'solar:bell-bing-bold-duotone',
    color: 'text.secondary',
    title: 'header.notification_account_update',
  };
  const customer = notification.customer_name || notification.application_id || '';
  const status = statusValue(notification.metadata);

  return (
    <ListItemButton
      onClick={onClick}
      sx={{
        px: 2.5,
        py: 2,
        alignItems: 'flex-start',
        borderBottom: (theme) => `dashed 1px ${theme.palette.divider}`,
        bgcolor: notification.is_read ? 'transparent' : 'action.hover',
      }}
    >
      <ListItemAvatar sx={{ minWidth: 52 }}>
        <Stack
          alignItems="center"
          justifyContent="center"
          sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: 'background.neutral' }}
        >
          <Iconify icon={presentation.icon} width={24} sx={{ color: presentation.color }} />
        </Stack>
      </ListItemAvatar>

      <ListItemText
        disableTypography
        primary={
          <Typography variant="subtitle2" sx={{ pr: 2 }}>
            {t(presentation.title)}
          </Typography>
        }
        secondary={
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {customer
                ? t('header.notification_customer_detail', { customer, status: status || '—' })
                : t('header.notification_integration_detail', { status: status || '—' })}
            </Typography>
            <Typography variant="caption" color="text.disabled">
              {fToNow(new Date(notification.created_at))}
            </Typography>
          </Stack>
        }
      />

      {!notification.is_read && (
        <Box
          aria-label={t('header.unread')}
          sx={{ width: 8, height: 8, mt: 1, borderRadius: '50%', bgcolor: 'info.main' }}
        />
      )}
    </ListItemButton>
  );
}
