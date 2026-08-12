import { m } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Drawer from '@mui/material/Drawer';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useBoolean } from 'src/hooks/use-boolean';
import { useResponsive } from 'src/hooks/use-responsive';
import { usePathname } from 'src/routes/hooks';
import Iconify from 'src/components/iconify';
import { varHover } from 'src/components/animate';
import { browserApiFetch } from 'src/utils/browser-api';
import NotificationItem, { PortalNotification } from './notification-item';

const NOTIFICATIONS_API = '/api/browser/v1/portal/notifications';

export default function NotificationsPopover() {
  const { t } = useTranslation('common');
  const drawer = useBoolean();
  const smUp = useResponsive('up', 'sm');
  const pathname = usePathname();
  const router = useNavigate();
  const isPortal = pathname.startsWith('/portal');
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadNotifications = useCallback(async () => {
    if (!isPortal) return;
    setLoading(true);
    setError('');
    try {
      const response = await browserApiFetch(`${NOTIFICATIONS_API}?limit=50`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('request_failed');
      const value = await response.json();
      setNotifications(value.data || []);
      setUnread(Number(value.meta?.unread || 0));
    } catch {
      setError(t('header.notifications_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [isPortal, t]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    if (drawer.value) loadNotifications();
  }, [drawer.value, loadNotifications]);

  const markRead = async (notification: PortalNotification) => {
    if (!notification.is_read) {
      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, is_read: true } : item))
      );
      setUnread((current) => Math.max(0, current - 1));
      try {
        await browserApiFetch(`${NOTIFICATIONS_API}/${encodeURIComponent(notification.id)}/read`, {
          method: 'POST',
          credentials: 'same-origin',
        });
      } catch {
        loadNotifications();
      }
    }
    drawer.onFalse();
    router(`/portal/messages/${encodeURIComponent(notification.id)}`);
  };

  const markAllRead = async () => {
    const previous = notifications;
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
    setUnread(0);
    try {
      const response = await browserApiFetch(`${NOTIFICATIONS_API}/read-all`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('request_failed');
    } catch {
      setNotifications(previous);
      setUnread(previous.filter((item) => !item.is_read).length);
      setError(t('header.notifications_update_failed'));
    }
  };

  const renderHead = (
    <Stack direction="row" alignItems="center" sx={{ py: 2, pl: 2.5, pr: 1, minHeight: 68 }}>
      <Box sx={{ flexGrow: 1 }}>
        <Typography variant="h6">{t('header.notifications')}</Typography>
        {unread > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t('header.unread_count', { count: unread })}
          </Typography>
        )}
      </Box>
      {unread > 0 && (
        <Button size="small" onClick={markAllRead}>
          {t('header.mark_all_read')}
        </Button>
      )}
      {!smUp && (
        <IconButton aria-label={t('header.close_notifications')} onClick={drawer.onFalse}>
          <Iconify icon="solar:close-circle-linear" />
        </IconButton>
      )}
    </Stack>
  );

  const renderEmpty = (
    <Box sx={{ px: 3, py: 10, textAlign: 'center' }}>
      <Box
        sx={{
          width: 64,
          height: 64,
          mx: 'auto',
          mb: 2,
          display: 'grid',
          placeItems: 'center',
          borderRadius: '50%',
          bgcolor: 'background.neutral',
          color: 'text.disabled',
        }}
      >
        <Iconify icon="solar:bell-off-bold-duotone" width={32} />
      </Box>
      <Typography variant="subtitle1">{t('header.no_notifications')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
        {isPortal ? t('header.notifications_empty_detail') : t('header.notifications_not_connected')}
      </Typography>
    </Box>
  );

  let renderBody = renderEmpty;
  if (loading && !notifications.length) {
    renderBody = (
      <Stack alignItems="center" sx={{ py: 10 }}>
        <CircularProgress size={32} />
      </Stack>
    );
  } else if (error && !notifications.length) {
    renderBody = (
      <Stack alignItems="center" spacing={1.5} sx={{ px: 3, py: 10, textAlign: 'center' }}>
        <Typography variant="body2" color="error">{error}</Typography>
        <Button size="small" onClick={loadNotifications}>{t('header.retry')}</Button>
      </Stack>
    );
  } else if (notifications.length) {
    renderBody = (
      <Box sx={{ overflowY: 'auto' }}>
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onClick={() => markRead(notification)}
          />
        ))}
      </Box>
    );
  }

  return (
    <>
      <IconButton
        aria-label={t('header.notifications')}
        component={m.button}
        whileTap="tap"
        whileHover="hover"
        variants={varHover(1.05)}
        color={drawer.value ? 'primary' : 'default'}
        onClick={drawer.onTrue}
      >
        <Badge color="error" badgeContent={unread} max={99} invisible={!unread}>
          <Iconify icon="solar:bell-bing-bold-duotone" width={24} />
        </Badge>
      </IconButton>

      <Drawer
        open={drawer.value}
        onClose={drawer.onFalse}
        anchor="right"
        slotProps={{ backdrop: { invisible: true } }}
        PaperProps={{ sx: { width: 1, maxWidth: 420 } }}
      >
        {renderHead}
        <Divider />
        {renderBody}
      </Drawer>
    </>
  );
}
