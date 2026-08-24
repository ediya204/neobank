import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import LoadingButton from '@mui/lab/LoadingButton';
import {
  Alert, Box, Button, Card, CardContent, Chip, Container, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, Grid, IconButton, LinearProgress, List,
  ListItem, ListItemText, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { APP_DISPLAY_NAME } from 'src/config-global';
import { useAuthContext } from 'src/auth/hooks';
import { getCsrfToken } from 'src/auth/csrf-token';
import {
  AuthApiError, applyCustomerEmailChange, beginCustomerTotpEnrollment,
  beginCustomerTotpReplacement, cancelCustomerAccountClosure,
  changeCurrentPassword, changeCustomerWithdrawalLock, customerPasskeysSupported,
  exportCustomerData, getCustomerSecuritySummary, regenerateCustomerRecoveryCodes,
  registerCustomerPasskey, removeCustomerPasskey, requestCustomerAccountClosure,
  requestCustomerEmailChange, revokeCustomerSession, revokeOtherCustomerSessions,
  verifyCustomerTotpEnrollment, verifyCustomerTotpReplacement,
  type CustomerSecuritySummary,
} from 'src/auth/context/jwt/auth-api';
import { CustomerTotpEnrollmentResult } from 'src/auth/types';
import Iconify from 'src/components/iconify';
import { useSnackbar } from 'src/components/snackbar';
import TotpEnrollmentPanel from 'src/components/totp-enrollment-panel/totp-enrollment-panel';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import { portalLocale, portalText } from 'src/locales/portal-text';

type SecurityAction = 'password' | 'recovery' | 'totpReplace' | 'passkeyAdd' |
  'passkeyRemove' | 'emailRequest' | 'emailApply' | 'lockEnable' |
  'lockRequestUnlock' | 'lockConfirmUnlock' | 'dataExport' | 'closureRequest';

type ActionFields = {
  currentPassword: string; totpCode: string; newPassword: string;
  confirmPassword: string; newEmail: string; passkeyName: string; reason: string;
};

const emptyFields: ActionFields = {
  currentPassword: '', totpCode: '', newPassword: '', confirmPassword: '',
  newEmail: '', passkeyName: '', reason: '',
};

const eventLabels: Record<string, string> = {
  'auth.login_succeeded': portalText('登录成功'), 'auth.login_failed': portalText('登录失败'),
  'auth.logout': portalText('安全退出'), 'auth.password_changed': portalText('密码已修改'),
  'auth.password_reset_completed': portalText('密码已通过邮件重置'),
  'auth.totp_enrolled': portalText('两步验证已启用'), 'auth.totp_replaced': portalText('验证器已更换'),
  'auth.recovery_codes_regenerated': portalText('恢复码已重新生成'),
  'auth.session_revoked': portalText('登录设备已退出'), 'auth.passkey_added': portalText('已添加通行密钥'),
  'auth.passkey_removed': portalText('已移除通行密钥'),
  'auth.passkey_login_succeeded': portalText('使用通行密钥登录'),
  'auth.email_change_requested': portalText('已申请变更登录邮箱'),
  'auth.email_change_verified': portalText('新登录邮箱已验证'), 'auth.email_changed': portalText('登录邮箱已变更'),
  'security.withdrawals_locked': portalText('转出保护已锁定'),
  'security.withdrawal_unlock_requested': portalText('已申请解除转出锁定'),
  'security.withdrawals_unlocked': portalText('转出保护已解除'),
  'privacy.data_exported': portalText('账户数据已导出'),
  'privacy.account_closure_requested': portalText('账户关闭申请已提交'),
  'privacy.account_closure_cancelled': portalText('账户关闭申请已取消'),
};

function formatDate(value?: string | null) {
  if (!value) return portalText('暂无记录');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return portalText('暂无记录');
  return new Intl.DateTimeFormat(portalLocale(), {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function describeError(error: unknown) {
  if (!(error instanceof AuthApiError)) return portalText('操作暂时无法完成，请稍后重试。');
  const messages: Record<string, string> = {
    invalid_current_password: portalText('当前密码不正确。'),
    invalid_totp_code: portalText('动态码无效、已过期或已使用，请输入当前动态码。'),
    totp_required: portalText('请先启用两步验证，再执行此安全操作。'),
    password_unchanged: portalText('新密码不能与当前密码相同。'),
    email_already_in_use: portalText('该邮箱已被其他账户使用。'),
    email_change_not_ready: portalText('新邮箱尚未验证或 24 小时安全等待期尚未结束。'),
    invalid_passkey_challenge: portalText('通行密钥验证已过期，请重新开始。'),
    passkey_verification_failed: portalText('无法验证此通行密钥，请重试或使用其他设备。'),
    auth_rate_limited: portalText('安全请求过于频繁，请稍后再试。'),
    session_expired: portalText('登录会话已失效，请重新登录。'),
  };
  return messages[error.code] || portalText('操作暂时无法完成，请稍后重试。');
}

export default function CustomerSettings() {
  const navigate = useNavigate();
  const { customer } = usePortalCustomer();
  const { user, refreshSession } = useAuthContext();
  const { enqueueSnackbar } = useSnackbar();
  const [summary, setSummary] = useState<CustomerSecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [action, setAction] = useState<SecurityAction | null>(null);
  const [target, setTarget] = useState('');
  const [fields, setFields] = useState<ActionFields>(emptyFields);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [enrollment, setEnrollment] = useState<CustomerTotpEnrollmentResult | null>(null);
  const [replacement, setReplacement] = useState<CustomerTotpEnrollmentResult | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [enrollmentPassword, setEnrollmentPassword] = useState('');
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const totpEnabled = Boolean(summary?.totp_enabled || user?.totpEnabled || recoveryCodes.length);

  const reload = useCallback(async () => {
    setLoadError('');
    try { setSummary(await getCustomerSecuritySummary()); }
    catch (error) { setLoadError(describeError(error)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const openAction = (next: SecurityAction, nextTarget = '') => {
    setAction(next); setTarget(nextTarget); setFields(emptyFields); setActionError('');
  };
  const closeAction = () => {
    if (actionLoading) return;
    setAction(null); setTarget(''); setFields(emptyFields); setActionError('');
  };

  const handleAction = async () => {
    if (!action) return;
    if (!fields.currentPassword || !/^\d{6}$/.test(fields.totpCode)) {
      setActionError(portalText('请输入当前密码和 6 位动态码。')); return;
    }
    if (action === 'password') {
      const strong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{14,128}$/.test(fields.newPassword);
      if (!strong || fields.newPassword !== fields.confirmPassword) {
        setActionError(portalText('新密码需为 14–128 位，并包含大小写字母、数字和符号；两次输入必须一致。')); return;
      }
    }
    if (action === 'emailRequest' && !/^\S+@\S+\.\S+$/.test(fields.newEmail)) {
      setActionError(portalText('请输入有效的新邮箱地址。')); return;
    }
    if (action === 'passkeyAdd' && !fields.passkeyName.trim()) {
      setActionError(portalText('请为通行密钥填写名称。')); return;
    }
    if (action === 'closureRequest' && fields.reason.trim().length < 10) {
      setActionError(portalText('请至少填写 10 个字符说明关闭账户的原因。')); return;
    }
    setActionLoading(true); setActionError('');
    const stepUp = { currentPassword: fields.currentPassword, totpCode: fields.totpCode };
    try {
      let success = portalText('安全设置已更新。');
      if (action === 'password') {
        await changeCurrentPassword({ ...stepUp, newPassword: fields.newPassword }, 'customer', getCsrfToken());
        success = portalText('密码已修改，其他设备上的会话已退出。');
      } else if (action === 'recovery') {
        setRecoveryCodes(await regenerateCustomerRecoveryCodes(stepUp, getCsrfToken()));
        success = portalText('新的恢复码已生成，请立即安全保存。');
      } else if (action === 'totpReplace') {
        setReplacement(await beginCustomerTotpReplacement(stepUp, getCsrfToken()));
        setSetupCode(''); success = portalText('请使用新验证器扫描二维码并确认动态码。');
      } else if (action === 'passkeyAdd') {
        await registerCustomerPasskey({ ...stepUp, displayName: fields.passkeyName.trim() }, getCsrfToken());
        success = portalText('通行密钥已添加。');
      } else if (action === 'passkeyRemove') {
        await removeCustomerPasskey(target, stepUp, getCsrfToken()); success = portalText('通行密钥已移除。');
      } else if (action === 'emailRequest') {
        await requestCustomerEmailChange({ ...stepUp, newEmail: fields.newEmail.trim().toLowerCase() }, getCsrfToken());
        success = portalText('验证邮件已发送至新邮箱，旧邮箱也会收到安全提醒。');
      } else if (action === 'emailApply') {
        await applyCustomerEmailChange(stepUp, getCsrfToken()); await refreshSession('customer');
        success = portalText('新登录邮箱已生效，其他设备上的会话已退出。');
      } else if (action === 'lockEnable') {
        await changeCustomerWithdrawalLock('enable', stepUp, getCsrfToken()); success = portalText('转出保护已立即锁定。');
      } else if (action === 'lockRequestUnlock') {
        await changeCustomerWithdrawalLock('request-unlock', stepUp, getCsrfToken()); success = portalText('解除申请已提交，24 小时内转出仍保持锁定。');
      } else if (action === 'lockConfirmUnlock') {
        await changeCustomerWithdrawalLock('confirm-unlock', stepUp, getCsrfToken()); success = portalText('转出保护已解除。');
      } else if (action === 'dataExport') {
        const data = await exportCustomerData(stepUp, getCsrfToken());
        const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = href;
        anchor.download = `ssc-customer-data-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click(); URL.revokeObjectURL(href); success = portalText('账户数据已安全导出。');
      } else if (action === 'closureRequest') {
        await requestCustomerAccountClosure({ ...stepUp, reason: fields.reason.trim() }, getCsrfToken());
        success = portalText('账户关闭申请已提交人工审核。');
      }
      setAction(null); setTarget(''); setFields(emptyFields);
      enqueueSnackbar(success, { variant: 'success' }); await reload();
    } catch (error) { setActionError(describeError(error)); }
    finally { setActionLoading(false); }
  };

  const startEnrollment = async (event: FormEvent) => {
    event.preventDefault(); if (!enrollmentPassword) return; setEnrollmentLoading(true);
    try { setEnrollment(await beginCustomerTotpEnrollment(enrollmentPassword, getCsrfToken())); setEnrollmentPassword(''); setSetupCode(''); }
    catch (error) { setActionError(describeError(error)); }
    finally { setEnrollmentLoading(false); }
  };
  const verifyEnrollment = async (event: FormEvent) => {
    event.preventDefault(); const setup = replacement || enrollment;
    if (!setup?.enrollmentToken || !/^\d{6}$/.test(setupCode)) return;
    setVerificationLoading(true);
    try {
      const result = replacement
        ? await verifyCustomerTotpReplacement(setup.enrollmentToken, setupCode, getCsrfToken())
        : await verifyCustomerTotpEnrollment(setup.enrollmentToken, setupCode, getCsrfToken());
      setRecoveryCodes(result.recoveryCodes); setEnrollment(null); setReplacement(null); setSetupCode('');
      await refreshSession('customer'); await reload();
      enqueueSnackbar(portalText(replacement ? '验证器已安全更换。' : '两步验证已启用。'), { variant: 'success' });
    } catch (error) { setActionError(describeError(error)); }
    finally { setVerificationLoading(false); }
  };
  const revokeOne = async (id: string) => {
    try { await revokeCustomerSession(id, getCsrfToken()); enqueueSnackbar(portalText('该设备已安全退出。'), { variant: 'success' }); await reload(); }
    catch (error) { enqueueSnackbar(describeError(error), { variant: 'error' }); }
  };
  const revokeOthers = async () => {
    try { await revokeOtherCustomerSessions(getCsrfToken()); enqueueSnackbar(portalText('其他设备已全部安全退出。'), { variant: 'success' }); await reload(); }
    catch (error) { enqueueSnackbar(describeError(error), { variant: 'error' }); }
  };
  const cancelClosure = async () => {
    try { await cancelCustomerAccountClosure(getCsrfToken()); enqueueSnackbar(portalText('账户关闭申请已取消。'), { variant: 'success' }); await reload(); }
    catch (error) { enqueueSnackbar(describeError(error), { variant: 'error' }); }
  };

  const copyTotpSecret = useCallback(async (value: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(value);
      enqueueSnackbar(portalText('已复制到剪贴板'), { variant: 'success' });
    } catch {
      enqueueSnackbar(portalText('复制失败，请手动选择并复制'), { variant: 'error' });
    }
  }, [enqueueSnackbar]);

  const score = useMemo(() => summary ? [summary.email_verified, summary.totp_enabled,
    summary.passkeys.length > 0, summary.recovery_codes_remaining >= 5].filter(Boolean).length * 25 : 0, [summary]);
  const setup = replacement || enrollment;
  const emailReady = Boolean(summary?.pending_email_change?.apply_after && new Date(summary.pending_email_change.apply_after).getTime() <= Date.now());
  const unlockReady = Boolean(summary?.withdrawal_lock.unlock_available_at && new Date(summary.withdrawal_lock.unlock_available_at).getTime() <= Date.now());
  let emailChangeControl = <Button variant="outlined" onClick={() => openAction('emailRequest')} startIcon={<Iconify icon="solar:letter-opened-bold-duotone" />} disabled={!totpEnabled}>{portalText('变更登录邮箱')}</Button>;
  if (summary?.pending_email_change) {
    emailChangeControl = <Alert severity={emailReady ? 'success' : 'info'}>{summary.pending_email_change.verified_at ? portalText('新邮箱 {{email}} 已验证，可生效时间：{{time}}。', { email: summary.pending_email_change.new_email, time: formatDate(summary.pending_email_change.apply_after) }) : portalText('验证邮件已发送至 {{email}}，请在链接失效前完成验证。', { email: summary.pending_email_change.new_email })}{emailReady && <Button size="small" onClick={() => openAction('emailApply')} sx={{ ml: 1 }}>{portalText('确认生效')}</Button>}</Alert>;
  }
  let totpControl: React.ReactNode;
  if (recoveryCodes.length > 0) {
    totpControl = <RecoveryPanel codes={recoveryCodes} onDone={() => setRecoveryCodes([])} />;
  } else if (setup) {
    totpControl = <Box component="form" onSubmit={verifyEnrollment}><Stack spacing={2.5}>
      <Alert severity="warning">{portalText(replacement ? '请先把新账户添加至验证器。确认成功后旧验证器和旧恢复码会立即失效。' : '请先把账户添加至验证器，再输入当前动态码完成启用。')}</Alert>
      <TotpEnrollmentPanel
        layout="wide"
        secret={setup.secret}
        otpauthUri={setup.otpauthUri}
        qrCodeDataUri={setup.qrCodeDataUri}
        issuer={setup.issuer}
        accountName={setup.accountName}
        onCopy={copyTotpSecret}
        labels={{
          qrAlt: portalText('两步验证绑定二维码'),
          qrGenerating: portalText('正在生成二维码…'),
          qrUnavailable: portalText('二维码生成失败，请使用手动密钥完成绑定。'),
          manualKey: portalText('无法扫码？手动输入密钥'),
          copyManualKey: portalText('复制手动输入密钥'),
          account: portalText('账户：'),
          period: portalText('· 每 30 秒更新'),
          localOnlyNotice: portalText('二维码在当前浏览器本地生成，不会把验证器密钥发送给第三方服务。'),
        }}
      />
      <TextField required label={portalText('新验证器的 6 位动态码')} value={setupCode} onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" />
      <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5}><Button onClick={() => { setEnrollment(null); setReplacement(null); setSetupCode(''); }}>{portalText('取消')}</Button><LoadingButton type="submit" variant="contained" loading={verificationLoading} disabled={!/^\d{6}$/.test(setupCode)}>{portalText(replacement ? '验证并更换验证器' : '验证并启用两步验证')}</LoadingButton></Stack>
    </Stack></Box>;
  } else if (totpEnabled) {
    totpControl = <Stack spacing={2}><Detail label={portalText('未使用恢复码')} value={portalText('{{count}} 个', { count: summary?.recovery_codes_remaining || 0 })} /><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}><Button variant="outlined" onClick={() => openAction('recovery')}>{portalText('重新生成恢复码')}</Button><Button variant="outlined" color="warning" onClick={() => openAction('totpReplace')}>{portalText('更换验证器')}</Button></Stack></Stack>;
  } else {
    totpControl = <Box component="form" onSubmit={startEnrollment}><Stack spacing={2.5}><Alert severity="info">{portalText('启用后，登录、新增转出白名单地址和敏感安全操作均受动态码保护。')}</Alert><TextField required type="password" label={portalText('当前登录密码')} value={enrollmentPassword} onChange={(e) => setEnrollmentPassword(e.target.value)} autoComplete="current-password" /><LoadingButton type="submit" variant="contained" loading={enrollmentLoading} disabled={!enrollmentPassword} sx={{ alignSelf: { sm: 'flex-start' } }}>{portalText('设置两步验证')}</LoadingButton></Stack></Box>;
  }

  return <>
    <Helmet><title>{portalText('安全与设置')} | {APP_DISPLAY_NAME}</title></Helmet>
    <Container maxWidth="lg"><Stack spacing={3} sx={{ pb: 5 }}>
      <Box><Typography variant="h4">{portalText('安全与设置')}</Typography><Typography color="text.secondary" sx={{ mt: 0.75 }}>{portalText('管理登录凭据、可信设备、转出保护与隐私请求。')}</Typography></Box>
      {loading && <LinearProgress />}
      {loadError && <Alert severity="error" action={<Button onClick={reload}>{portalText('重试')}</Button>}>{loadError}</Alert>}

      <Card><CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems={{ md: 'center' }}>
          <SectionHeading icon="solar:shield-check-bold-duotone" title={portalText('账户安全概览')} description={portalText('关键保护状态集中展示，异常操作会留下审计记录并发送安全提醒。')} />
          <Box sx={{ minWidth: { md: 210 } }}><Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}><Typography variant="caption" color="text.secondary">{portalText('安全完成度')}</Typography><Typography variant="subtitle2">{loading ? '—' : `${score}%`}</Typography></Stack><LinearProgress variant="determinate" value={score} color={score >= 75 ? 'success' : 'warning'} sx={{ height: 8, borderRadius: 99 }} /></Box>
        </Stack>
        <Grid container spacing={1.5} sx={{ mt: 2 }}>
          <StatusTile icon="solar:letter-bold-duotone" label={portalText('邮箱')} active={Boolean(summary?.email_verified)} activeText={portalText('已验证')} inactiveText={portalText('待验证')} />
          <StatusTile icon="solar:shield-keyhole-bold-duotone" label={portalText('两步验证')} active={totpEnabled} activeText={portalText('已启用')} inactiveText={portalText('未启用')} />
          <StatusTile icon="solar:key-square-bold-duotone" label={portalText('通行密钥')} active={Boolean(summary?.passkeys.length)} activeText={portalText('{{count}} 枚', { count: summary?.passkeys.length || 0 })} inactiveText={portalText('未添加')} />
          <StatusTile icon="solar:smartphone-update-bold-duotone" label={portalText('活跃设备')} active={Boolean(summary?.sessions.length)} activeText={portalText('{{count}} 台', { count: summary?.sessions.length || 0 })} inactiveText={portalText('无')} />
        </Grid>
      </CardContent></Card>

      <SecurityCard
        icon="solar:user-id-bold-duotone"
        title={portalText('转出白名单')}
        description={portalText('统一管理法币银行账户与 USDT-TRON 地址。新增和停用均需两步验证，已保存资料不可修改。')}
        action={
          <Button
            variant="outlined"
            endIcon={<Iconify icon="solar:arrow-right-linear" />}
            onClick={() => navigate('/portal/settings/allowlist')}
          >
            {portalText('管理转出白名单')}
          </Button>
        }
      >
        <Alert severity="info">
          {portalText('停用白名单只影响后续转出，不会删除历史交易。')}
        </Alert>
      </SecurityCard>

      <SecurityCard icon="solar:user-id-bold-duotone" title={portalText('客户资料')} description={portalText(customer?.type === 'BUSINESS' ? '企业认证资料' : '个人认证资料')} action={<Chip label={customer?.status === 'ACTIVE' ? portalText('账户正常') : customer?.status || '—'} />}>
        <Detail label={portalText(customer?.type === 'BUSINESS' ? '企业名称' : '姓名')} value={customer?.legalName || customer?.displayName || '—'} />
        <Detail label={portalText('电子邮箱')} value={customer?.email || user?.email || '—'} trailing={<Chip size="small" color={summary?.email_verified ? 'success' : 'warning'} label={portalText(summary?.email_verified ? '已验证' : '待验证')} />} />
        <Detail label={portalText('注册国家/地区')} value={customer?.countryCode || '—'} /><Divider sx={{ my: 2 }} />
        {emailChangeControl}
      </SecurityCard>

      <SecurityCard icon="solar:lock-password-bold-duotone" title={portalText('登录密码')} description={portalText('已登录状态下修改密码需要当前密码和动态码；忘记密码时使用邮箱安全链接，无需动态码。')} action={<Button variant="outlined" onClick={() => openAction('password')} disabled={!totpEnabled}>{portalText('修改密码')}</Button>}>
        <Detail label={portalText('最近修改')} value={formatDate(summary?.password_changed_at)} /><Alert severity="info" sx={{ mt: 2 }}>{portalText('修改成功后保留当前设备，并立即退出其他设备上的会话。')}</Alert>
      </SecurityCard>

      <SecurityCard icon="solar:shield-keyhole-bold-duotone" title={portalText('两步验证与恢复码')} description={portalText('验证器保护登录和敏感安全操作；恢复码只能使用一次且只在生成时显示。')} action={<Chip size="small" color={totpEnabled ? 'success' : 'warning'} label={portalText(totpEnabled ? '已启用' : '未启用')} />}>
        {actionError && !action && <Alert severity="error" onClose={() => setActionError('')} sx={{ mb: 2 }}>{actionError}</Alert>}
        {totpControl}
      </SecurityCard>

      <SecurityCard icon="solar:key-square-bold-duotone" title={portalText('通行密钥')} description={portalText('使用设备生物识别或屏幕锁安全登录；公钥凭据加密保存，银行不会获得您的指纹或面容数据。')} action={<Button variant="outlined" onClick={() => openAction('passkeyAdd')} disabled={!totpEnabled || !customerPasskeysSupported()}>{portalText('添加通行密钥')}</Button>}>
        {!customerPasskeysSupported() && <Alert severity="warning" sx={{ mb: 2 }}>{portalText('当前浏览器不支持通行密钥，请使用最新版 Safari、Chrome、Edge 或 Firefox。')}</Alert>}
        {summary?.passkeys.length ? <List disablePadding>{summary.passkeys.map((passkey) => <ListItem key={passkey.id} divider secondaryAction={<Tooltip title={portalText('移除')}><IconButton edge="end" onClick={() => openAction('passkeyRemove', passkey.id)}><Iconify icon="solar:trash-bin-trash-linear" /></IconButton></Tooltip>}><ListItemText primary={passkey.display_name} secondary={portalText('添加于 {{date}} · 最近使用 {{used}}', { date: formatDate(passkey.created_at), used: formatDate(passkey.last_used_at) })} /></ListItem>)}</List> : <Typography color="text.secondary">{portalText('尚未添加通行密钥。')}</Typography>}
      </SecurityCard>

      <SecurityCard icon="solar:devices-bold-duotone" title={portalText('登录设备')} description={portalText('设备名称由浏览器和操作系统概括生成；页面不会显示原始 IP、完整 User-Agent 或会话令牌。')} action={<Button variant="outlined" onClick={revokeOthers} disabled={(summary?.sessions.length || 0) <= 1}>{portalText('退出其他设备')}</Button>}>
        {summary?.sessions.length ? <List disablePadding>{summary.sessions.map((device) => <ListItem key={device.id} divider secondaryAction={!device.current && <Button size="small" color="error" onClick={() => revokeOne(device.id)}>{portalText('退出')}</Button>}><ListItemText primary={<Stack direction="row" spacing={1} alignItems="center"><Typography variant="subtitle2">{device.device_label || portalText('已登录设备')}</Typography>{device.current && <Chip size="small" color="success" label={portalText('当前设备')} />}</Stack>} secondary={portalText('最近活动 {{last}} · 登录于 {{created}}', { last: formatDate(device.last_seen_at), created: formatDate(device.created_at) })} /></ListItem>)}</List> : <Typography color="text.secondary">{portalText('暂无活跃设备。')}</Typography>}
      </SecurityCard>

      <SecurityCard icon="solar:shield-warning-bold-duotone" title={portalText('转出保护')} description={portalText('紧急锁定后，客户发起的数字资产转出立即被阻止；解除需要再次验证并等待 24 小时。')} action={<Chip size="small" color={summary?.withdrawal_lock.enabled ? 'error' : 'success'} label={portalText(summary?.withdrawal_lock.enabled ? '已锁定' : '未锁定')} />}>
        {summary?.withdrawal_lock.enabled ? <Stack spacing={2}><Alert severity="warning">{summary.withdrawal_lock.unlock_requested_at ? portalText('解除申请已提交，可确认解除时间：{{time}}。', { time: formatDate(summary.withdrawal_lock.unlock_available_at) }) : portalText('转出目前被安全锁定。')}</Alert>{!summary.withdrawal_lock.unlock_requested_at ? <Button variant="outlined" color="warning" onClick={() => openAction('lockRequestUnlock')}>{portalText('申请解除锁定')}</Button> : <Button variant="contained" color="warning" disabled={!unlockReady} onClick={() => openAction('lockConfirmUnlock')}>{portalText('确认解除锁定')}</Button>}</Stack> : <Button variant="contained" color="error" onClick={() => openAction('lockEnable')} disabled={!totpEnabled}>{portalText('立即锁定转出')}</Button>}
      </SecurityCard>

      <SecurityCard icon="solar:history-bold-duotone" title={portalText('安全活动')} description={portalText('这里只显示允许公开给客户的安全事件，不包含内部操作员、原始网络信息或队列状态。')}>
        {summary?.events.length ? <List disablePadding>{summary.events.slice(0, 12).map((event, index) => <ListItem key={`${event.event_type}-${event.created_at}-${index}`} divider><ListItemText primary={eventLabels[event.event_type] || portalText('安全状态更新')} secondary={formatDate(event.created_at)} /></ListItem>)}</List> : <Typography color="text.secondary">{portalText('暂无安全活动记录。')}</Typography>}
      </SecurityCard>

      <SecurityCard icon="solar:document-text-bold-duotone" title={portalText('隐私与账户')} description={portalText('导出仅包含您的客户资料和业务记录，不包含密码哈希、验证器密钥、恢复码、会话令牌或内部备注。')}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}><Button variant="outlined" onClick={() => openAction('dataExport')} disabled={!totpEnabled}>{portalText('导出我的数据')}</Button>{summary?.pending_closure ? <Button color="warning" variant="outlined" onClick={cancelClosure}>{portalText('取消账户关闭申请')}</Button> : <Button color="error" variant="outlined" onClick={() => openAction('closureRequest')} disabled={!totpEnabled}>{portalText('申请关闭账户')}</Button>}</Stack>
        {summary?.pending_closure && <Alert severity="warning" sx={{ mt: 2 }}>{portalText('账户关闭申请正在人工审核。审核完成前不会自动关闭，也不会自动转移或结算任何资金。')}</Alert>}
      </SecurityCard>
    </Stack></Container>
    <ActionDialog action={action} fields={fields} onChange={setFields} loading={actionLoading} error={actionError} onClose={closeAction} onSubmit={handleAction} />
  </>;
}

function SectionHeading({ icon, title, description }: { icon: string; title: string; description: string }) {
  return <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1 }}><Box sx={{ width: 48, height: 48, borderRadius: 2, bgcolor: 'success.lighter', color: 'success.main', display: 'grid', placeItems: 'center' }}><Iconify icon={icon} width={28} /></Box><Box><Typography variant="h6">{title}</Typography><Typography variant="body2" color="text.secondary">{description}</Typography></Box></Stack>;
}
function StatusTile({ icon, label, active, activeText, inactiveText }: { icon: string; label: string; active: boolean; activeText: string; inactiveText: string }) {
  return <Grid item xs={6} md={3}><Paper variant="outlined" sx={{ p: 2, height: 1 }}><Stack direction="row" spacing={1.25} alignItems="center"><Box sx={{ width: 36, height: 36, borderRadius: 1.5, bgcolor: active ? 'success.lighter' : 'warning.lighter', color: active ? 'success.main' : 'warning.dark', display: 'grid', placeItems: 'center' }}><Iconify icon={icon} width={21} /></Box><Box><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="subtitle2">{active ? activeText : inactiveText}</Typography></Box></Stack></Paper></Grid>;
}
function SecurityCard({ icon, title, description, action, children }: { icon: string; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <Card><CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={2}><Stack direction="row" spacing={2} alignItems="flex-start"><Box sx={{ width: 46, height: 46, borderRadius: 2, bgcolor: 'primary.lighter', color: 'primary.main', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Iconify icon={icon} width={25} /></Box><Box><Typography variant="h6">{title}</Typography><Typography color="text.secondary" sx={{ mt: 0.25 }}>{description}</Typography></Box></Stack>{action}</Stack><Divider sx={{ my: 3 }} />{children}</CardContent></Card>;
}
function Detail({ label, value, trailing }: { label: string; value: string; trailing?: React.ReactNode }) {
  return <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2} sx={{ py: 1 }}><Typography color="text.secondary">{label}</Typography><Stack direction="row" spacing={1} alignItems="center"><Typography variant="subtitle2" textAlign="right">{value}</Typography>{trailing}</Stack></Stack>;
}
function RecoveryPanel({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return <Stack spacing={2.5}><Alert severity="success">{portalText('这是唯一一次显示新的恢复码。请保存到密码管理器，不要截图或发送给他人。')}</Alert><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.neutral' }}>{codes.map((code) => <Typography key={code} sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{code}</Typography>)}</Box><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}><Button variant="outlined" onClick={async () => { await navigator.clipboard.writeText(codes.join('\n')); setCopied(true); }}>{copied ? portalText('已复制') : portalText('复制恢复码')}</Button><Button variant="contained" onClick={onDone}>{portalText('我已安全保存，完成')}</Button></Stack></Stack>;
}
function ActionDialog({ action, fields, onChange, loading, error, onClose, onSubmit }: { action: SecurityAction | null; fields: ActionFields; onChange: (value: ActionFields) => void; loading: boolean; error: string; onClose: () => void; onSubmit: () => void }) {
  const copy: Record<SecurityAction, { title: string; description: string; submit: string; danger?: boolean }> = {
    password: { title: portalText('修改登录密码'), description: portalText('确认当前密码与动态码。成功后当前设备保留登录，其他设备立即退出。'), submit: portalText('安全修改密码') },
    recovery: { title: portalText('重新生成恢复码'), description: portalText('旧恢复码会立即失效，新恢复码只显示一次。'), submit: portalText('生成新恢复码') },
    totpReplace: { title: portalText('更换验证器'), description: portalText('先验证旧验证器，再绑定新验证器。成功后旧验证器和旧恢复码立即失效。'), submit: portalText('开始更换') },
    passkeyAdd: { title: portalText('添加通行密钥'), description: portalText('浏览器将调用设备生物识别或屏幕锁。请使用容易识别的设备名称。'), submit: portalText('添加通行密钥') },
    passkeyRemove: { title: portalText('移除通行密钥'), description: portalText('移除后，该设备不能再使用此通行密钥登录。'), submit: portalText('确认移除'), danger: true },
    emailRequest: { title: portalText('变更登录邮箱'), description: portalText('新邮箱需完成验证并等待 24 小时；旧邮箱会收到安全提醒。'), submit: portalText('发送验证邮件') },
    emailApply: { title: portalText('确认新邮箱生效'), description: portalText('生效后登录邮箱立即变更，其他设备全部退出。'), submit: portalText('确认生效') },
    lockEnable: { title: portalText('立即锁定转出'), description: portalText('锁定立即生效。解除需再次验证并等待 24 小时。'), submit: portalText('立即锁定'), danger: true },
    lockRequestUnlock: { title: portalText('申请解除转出锁定'), description: portalText('提交后进入 24 小时安全等待期，期间转出仍不可用。'), submit: portalText('提交解除申请') },
    lockConfirmUnlock: { title: portalText('确认解除转出锁定'), description: portalText('安全等待期已结束。解除后客户可再次发起数字资产转出。'), submit: portalText('确认解除'), danger: true },
    dataExport: { title: portalText('导出我的数据'), description: portalText('导出文件包含客户资料和业务记录，不包含任何认证密钥或内部备注。'), submit: portalText('验证并导出') },
    closureRequest: { title: portalText('申请关闭账户'), description: portalText('申请进入人工审核，不会自动转移或结算资金，也不会立即关闭账户。'), submit: portalText('提交人工审核'), danger: true },
  };
  const selected = action ? copy[action] : null;
  return <Dialog open={Boolean(action)} onClose={onClose} fullWidth maxWidth="sm"><DialogTitle>{selected?.title}</DialogTitle><DialogContent><Stack spacing={2.25} sx={{ pt: 1 }}>{selected && <Typography color="text.secondary">{selected.description}</Typography>}{error && <Alert severity="error">{error}</Alert>}{action === 'emailRequest' && <TextField required type="email" label={portalText('新登录邮箱')} value={fields.newEmail} onChange={(e) => onChange({ ...fields, newEmail: e.target.value })} />}{action === 'passkeyAdd' && <TextField required label={portalText('通行密钥名称')} value={fields.passkeyName} onChange={(e) => onChange({ ...fields, passkeyName: e.target.value.slice(0, 80) })} placeholder={portalText('例如：MacBook Touch ID')} />}{action === 'closureRequest' && <TextField required multiline minRows={3} label={portalText('关闭原因')} value={fields.reason} onChange={(e) => onChange({ ...fields, reason: e.target.value.slice(0, 500) })} helperText={portalText('10–500 个字符；该内容仅用于人工审核。')} />}{action === 'password' && <><TextField required type="password" label={portalText('新密码')} value={fields.newPassword} onChange={(e) => onChange({ ...fields, newPassword: e.target.value })} autoComplete="new-password" helperText={portalText('14–128 位，包含大小写字母、数字和符号。')} /><TextField required type="password" label={portalText('确认新密码')} value={fields.confirmPassword} onChange={(e) => onChange({ ...fields, confirmPassword: e.target.value })} autoComplete="new-password" /></>}<Divider /><TextField required type="password" label={portalText('当前登录密码')} value={fields.currentPassword} onChange={(e) => onChange({ ...fields, currentPassword: e.target.value })} autoComplete="current-password" /><TextField required label={portalText('当前 6 位动态码')} value={fields.totpCode} onChange={(e) => onChange({ ...fields, totpCode: e.target.value.replace(/\D/g, '').slice(0, 6) })} autoComplete="one-time-code" /></Stack></DialogContent><DialogActions><Button onClick={onClose} disabled={loading}>{portalText('取消')}</Button><LoadingButton onClick={onSubmit} loading={loading} variant="contained" color={selected?.danger ? 'error' : 'primary'}>{selected?.submit}</LoadingButton></DialogActions></Dialog>;
}
