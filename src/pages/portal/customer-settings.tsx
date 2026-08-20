import { FormEvent, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import QRCode from 'qrcode';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import LoadingButton from '@mui/lab/LoadingButton';
import { APP_DISPLAY_NAME } from 'src/config-global';
import { useAuthContext } from 'src/auth/hooks';
import { getCsrfToken } from 'src/auth/csrf-token';
import {
  AuthApiError,
  beginCustomerTotpEnrollment,
  verifyCustomerTotpEnrollment,
} from 'src/auth/context/jwt/auth-api';
import { CustomerTotpEnrollmentResult } from 'src/auth/types';
import Iconify from 'src/components/iconify';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import { portalText } from 'src/locales/portal-text';

function enrollmentError(error: unknown) {
  if (!(error instanceof AuthApiError)) return portalText('暂时无法完成两步验证设置，请稍后重试。');
  if (error.code === 'invalid_current_password') return portalText('当前密码不正确。');
  if (error.code === 'invalid_totp_code')
    return portalText('动态码无效、已过期或已使用，请输入当前动态码。');
  if (error.code === 'invalid_enrollment_token')
    return portalText('本次设置已过期，请重新开始绑定。');
  if (error.code === 'totp_already_enrolled') return portalText('当前账户已经绑定验证器。');
  if (error.code === 'session_expired') return portalText('登录会话已失效，请重新登录后再设置。');
  return portalText('暂时无法完成两步验证设置，请稍后重试。');
}

export default function CustomerSettings() {
  const { customer } = usePortalCustomer();
  const { user, refreshSession } = useAuthContext();
  const [currentPassword, setCurrentPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [enrollment, setEnrollment] = useState<CustomerTotpEnrollmentResult | null>(null);
  const [qrCode, setQrCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const totpEnabled = Boolean(user?.totpEnabled || recoveryCodes.length);

  useEffect(() => {
    let active = true;
    setQrCode('');
    if (!enrollment?.otpauthUri) return () => undefined;
    QRCode.toDataURL(enrollment.otpauthUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
      color: { dark: '#111827', light: '#FFFFFF' },
    })
      .then((value) => {
        if (active) setQrCode(value);
      })
      .catch(() => {
        if (active) setQrCode('');
      });
    return () => {
      active = false;
    };
  }, [enrollment]);

  const startEnrollment = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentPassword) return;
    setStarting(true);
    setError('');
    try {
      const result = await beginCustomerTotpEnrollment(currentPassword, getCsrfToken());
      setEnrollment(result);
      setCurrentPassword('');
      setOtpCode('');
    } catch (caught) {
      setError(enrollmentError(caught));
    } finally {
      setStarting(false);
    }
  };

  const verifyEnrollment = async (event: FormEvent) => {
    event.preventDefault();
    if (!enrollment?.enrollmentToken || !/^\d{6}$/.test(otpCode)) return;
    setVerifying(true);
    setError('');
    try {
      const result = await verifyCustomerTotpEnrollment(
        enrollment.enrollmentToken,
        otpCode,
        getCsrfToken()
      );
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      setOtpCode('');
      await refreshSession();
    } catch (caught) {
      setError(enrollmentError(caught));
    } finally {
      setVerifying(false);
    }
  };

  const copyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
  };

  return (
    <>
      <Helmet>
        <title>{portalText('安全与设置')} | {APP_DISPLAY_NAME}</title>
      </Helmet>
      <Container maxWidth="md">
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4">{portalText('安全与设置')}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75 }}>
              {portalText('查看账户资料并管理登录安全设置。')}
            </Typography>
          </Box>

          <Card>
            <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                <Box>
                  <Typography variant="h6">{portalText('客户资料')}</Typography>
                  <Typography color="text.secondary">
                    {customer?.type === 'BUSINESS'
                      ? portalText('企业认证资料')
                      : portalText('个人认证资料')}
                  </Typography>
                </Box>
                <Chip
                  label={
                    customer?.status === 'ACTIVE' ? portalText('账户正常') : customer?.status || '—'
                  }
                />
              </Stack>
              <Divider sx={{ my: 2.5 }} />
              <Detail
                label={customer?.type === 'BUSINESS' ? portalText('企业名称') : portalText('姓名')}
                value={customer?.legalName || customer?.displayName || '—'}
              />

              <Detail
                label={portalText('电子邮箱')}
                value={customer?.email || user?.email || '—'}
              />

              <Detail label={portalText('注册国家/地区')} value={customer?.countryCode || '—'} />
            </CardContent>
          </Card>

          <Card>
            <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
              <Stack direction="row" spacing={2} alignItems="flex-start">
                <Box
                  sx={{
                    width: 46,
                    height: 46,
                    borderRadius: 2,
                    bgcolor: totpEnabled ? 'success.lighter' : 'warning.lighter',
                    color: totpEnabled ? 'success.main' : 'warning.dark',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Iconify icon="solar:shield-keyhole-bold-duotone" width={25} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                    <Typography variant="h6">{portalText('两步验证')}</Typography>
                    <Chip
                      size="small"
                      color={totpEnabled ? 'success' : 'warning'}
                      label={totpEnabled ? portalText('已启用') : portalText('未启用')}
                    />
                  </Stack>
                  <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                    {portalText(
                      '使用 Google Authenticator、Microsoft Authenticator 或其他身份验证器生成 6 位动态码。'
                    )}
                  </Typography>
                </Box>
              </Stack>

              <Divider sx={{ my: 3 }} />

              {error && (
                <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2.5 }}>
                  {error}
                </Alert>
              )}

              {recoveryCodes.length > 0 && (
                <Stack spacing={2.5}>
                  <Alert severity="success">
                    {portalText('两步验证已启用，其他设备上的旧会话已安全退出。')}
                  </Alert>
                  <Box>
                    <Typography variant="subtitle1">{portalText('保存恢复码')}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {portalText(
                        '每个恢复码只能使用一次。这是唯一一次显示，请保存到密码管理器，不要截图或发送给他人。'
                      )}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                      gap: 1,
                      p: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1.5,
                      bgcolor: 'background.neutral',
                    }}
                  >
                    {recoveryCodes.map((code) => (
                      <Typography key={code} sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                        {code}
                      </Typography>
                    ))}
                  </Box>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <Button variant="outlined" onClick={copyRecoveryCodes}>
                      {copied ? portalText('已复制') : portalText('复制恢复码')}
                    </Button>
                    <Button variant="contained" onClick={() => setRecoveryCodes([])}>
                      {portalText('我已安全保存，完成')}
                    </Button>
                  </Stack>
                </Stack>
              )}
              {recoveryCodes.length === 0 && totpEnabled && (
                <Alert severity="success" icon={<Iconify icon="solar:shield-check-bold" />}>
                  {portalText(
                    '当前账户已绑定验证器。新增转出白名单地址或修改密码时，需要输入当前 6 位动态码。'
                  )}
                </Alert>
              )}
              {recoveryCodes.length === 0 && !totpEnabled && enrollment && (
                <Box component="form" onSubmit={verifyEnrollment}>
                  <Stack spacing={2.5}>
                    <Alert severity="warning">
                      {portalText(
                        '请先将下方账户添加至身份验证器，再输入动态码确认。完成确认前，两步验证尚未生效。'
                      )}
                    </Alert>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems="center">
                      <Box
                        sx={{
                          width: 220,
                          height: 220,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1.5,
                          bgcolor: 'common.white',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {qrCode ? (
                          <Box
                            component="img"
                            src={qrCode}
                            alt={portalText('两步验证绑定二维码')}
                            sx={{ width: 220 }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            {portalText('正在生成二维码…')}
                          </Typography>
                        )}
                      </Box>
                      <Stack spacing={1.5} sx={{ width: 1, minWidth: 0 }}>
                        <Typography variant="subtitle1">
                          {portalText('无法扫码？手动输入密钥')}
                        </Typography>
                        <Typography
                          sx={{
                            p: 1.5,
                            borderRadius: 1,
                            bgcolor: 'background.neutral',
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {enrollment.secret}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {portalText('账户：')}
                          {enrollment.accountName || user?.email}
                          {portalText('· 每 30 秒更新')}
                        </Typography>
                      </Stack>
                    </Stack>
                    <TextField
                      required
                      label={portalText('6 位动态码')}
                      value={otpCode}
                      onChange={(event) =>
                        setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                      helperText={portalText('输入验证器当前显示且尚未使用的动态码。')}
                      autoComplete="one-time-code"
                      inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6 }}
                    />

                    <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5}>
                      <Button
                        onClick={() => {
                          setEnrollment(null);
                          setOtpCode('');
                          setError('');
                        }}
                        disabled={verifying}
                      >
                        {portalText('取消')}
                      </Button>
                      <LoadingButton
                        type="submit"
                        variant="contained"
                        loading={verifying}
                        disabled={!/^\d{6}$/.test(otpCode)}
                      >
                        {portalText('验证并启用两步验证')}
                      </LoadingButton>
                    </Stack>
                  </Stack>
                </Box>
              )}
              {recoveryCodes.length === 0 && !totpEnabled && !enrollment && (
                <Box component="form" onSubmit={startEnrollment}>
                  <Stack spacing={2.5}>
                    <Alert severity="info">
                      {portalText('启用后，登录、新增转出白名单地址和修改密码均受动态码保护。')}
                    </Alert>
                    <TextField
                      required
                      type="password"
                      label={portalText('当前登录密码')}
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                      inputProps={{ maxLength: 128 }}
                      helperText={portalText('先验证当前密码，再显示只属于此账户的绑定二维码。')}
                    />

                    <LoadingButton
                      type="submit"
                      variant="contained"
                      loading={starting}
                      disabled={!currentPassword}
                      sx={{ alignSelf: { sm: 'flex-start' } }}
                    >
                      {portalText('设置两步验证')}
                    </LoadingButton>
                  </Stack>
                </Box>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 1 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography variant="subtitle2" textAlign="right">
        {value}
      </Typography>
    </Stack>
  );
}
