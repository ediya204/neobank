import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import Iconify from 'src/components/iconify';

type TotpEnrollmentLabels = {
  qrAlt: string;
  qrGenerating: string;
  qrUnavailable: string;
  manualKey: string;
  copyManualKey: string;
  account?: string;
  period?: string;
  localOnlyNotice?: string;
};

type Props = {
  secret: string;
  otpauthUri?: string | null;
  qrCodeDataUri?: string | null;
  issuer?: string | null;
  accountName?: string | null;
  labels: TotpEnrollmentLabels;
  onCopy: (value: string) => void | Promise<void>;
  layout?: 'compact' | 'wide';
};

export default function TotpEnrollmentPanel({
  secret,
  otpauthUri,
  qrCodeDataUri,
  issuer,
  accountName,
  labels,
  onCopy,
  layout = 'compact',
}: Props) {
  const [qrCode, setQrCode] = useState('');
  const [qrCodeFailed, setQrCodeFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setQrCode('');
    setQrCodeFailed(false);

    if (qrCodeDataUri) {
      setQrCode(qrCodeDataUri);
      return () => {
        active = false;
      };
    }

    if (!otpauthUri) {
      setQrCodeFailed(true);
      return () => {
        active = false;
      };
    }

    QRCode.toDataURL(otpauthUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: { dark: '#111827', light: '#FFFFFF' },
    })
      .then((value) => {
        if (active) setQrCode(value);
      })
      .catch(() => {
        if (active) setQrCodeFailed(true);
      });

    return () => {
      active = false;
    };
  }, [otpauthUri, qrCodeDataUri]);

  return (
    <Stack spacing={2}>
      <Stack
        direction={layout === 'wide' ? { xs: 'column', md: 'row' } : 'column'}
        spacing={3}
        alignItems={layout === 'wide' ? { xs: 'center', md: 'flex-start' } : 'stretch'}
      >
        <Box
          role="status"
          aria-live="polite"
          sx={{
            width: { xs: 196, sm: 220 },
            height: { xs: 196, sm: 220 },
            mx: layout === 'compact' ? 'auto' : { xs: 'auto', md: 0 },
            borderRadius: 1.5,
            border: (theme) => `1px solid ${theme.palette.divider}`,
            bgcolor: 'common.white',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {qrCode ? (
            <Box
              component="img"
              src={qrCode}
              alt={labels.qrAlt}
              sx={{ width: 1, height: 1, objectFit: 'contain' }}
            />
          ) : (
            <Typography
              variant="caption"
              sx={{ px: 2, color: 'text.secondary', textAlign: 'center' }}
            >
              {qrCodeFailed ? labels.qrUnavailable : labels.qrGenerating}
            </Typography>
          )}
        </Box>

        <Stack spacing={1.5} sx={{ width: 1, minWidth: 0 }}>
          {(issuer || accountName) && (
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
              {issuer && (
                <Chip
                  size="small"
                  icon={<Iconify icon="solar:shield-check-bold-duotone" />}
                  label={issuer}
                />
              )}
              {accountName && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  {labels.account ? `${labels.account} ` : ''}
                  {accountName}
                  {labels.period ? ` ${labels.period}` : ''}
                </Typography>
              )}
            </Stack>
          )}

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {labels.manualKey}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.75 }}>
              <Typography
                variant="subtitle1"
                sx={{
                  flexGrow: 1,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  overflowWrap: 'anywhere',
                }}
              >
                {secret}
              </Typography>
              <IconButton aria-label={labels.copyManualKey} onClick={() => onCopy(secret)}>
                <Iconify icon="solar:copy-linear" />
              </IconButton>
            </Stack>
          </Paper>
        </Stack>
      </Stack>

      {qrCodeFailed && <Alert severity="warning">{labels.qrUnavailable}</Alert>}
      {labels.localOnlyNotice && <Alert severity="info">{labels.localOnlyNotice}</Alert>}
    </Stack>
  );
}
