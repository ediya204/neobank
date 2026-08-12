import { Box, ButtonBase, Card, Divider, Stack, Typography } from '@mui/material';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';

export type FundsActionItem = {
  title: string;
  description: string;
  path: string;
  icon: string;
  tone: string;
  badge?: string;
  badgeColor?: 'default' | 'primary' | 'info' | 'success' | 'warning';
};

export default function FundsActionList({
  title,
  subtitle,
  actions,
  onOpen,
}: {
  title: string;
  subtitle: string;
  actions: FundsActionItem[];
  onOpen: (path: string) => void;
}) {
  return (
    <Card sx={{ overflow: 'hidden' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2.5 }}>
        <Typography variant="h6">{title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {subtitle}
        </Typography>
      </Stack>
      <Divider />
      {actions.map((action, index) => (
        <ButtonBase
          key={action.path}
          onClick={() => onOpen(action.path)}
          sx={{
            width: 1,
            px: { xs: 2, md: 3 },
            py: 2,
            textAlign: 'left',
            borderBottom: index < actions.length - 1 ? '1px solid' : 0,
            borderColor: 'divider',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Stack direction="row" alignItems="center" spacing={2} sx={{ width: 1 }}>
            <Box
              sx={{
                width: 46,
                height: 46,
                flexShrink: 0,
                borderRadius: 1.5,
                bgcolor: action.tone,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Iconify icon={action.icon} width={26} color="primary.main" />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="subtitle1">{action.title}</Typography>
                {action.badge && (
                  <Label color={action.badgeColor || 'default'}>{action.badge}</Label>
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {action.description}
              </Typography>
            </Box>
            <Iconify icon="solar:alt-arrow-right-linear" color="text.disabled" width={20} />
          </Stack>
        </ButtonBase>
      ))}
    </Card>
  );
}
