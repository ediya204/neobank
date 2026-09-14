import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useAuthContext } from 'src/auth/hooks';
import { hasAdminPermission } from 'src/auth/permissions';
import { coreApi, VirtualAccountRequest } from './core-api';

type Policy = {
  isInternal: boolean;
  exempt: boolean;
  version: number;
  events: {
    id: string;
    reason: string;
    actorId: string;
    createdAt: string;
    before: { isInternal: boolean; vaFeeExempt: boolean };
    after: { isInternal: boolean; vaFeeExempt: boolean };
  }[];
};

const policyLabel = (value: { isInternal: boolean; vaFeeExempt: boolean }) => {
  if (value.isInternal) return '内部人员免收';
  return value.vaFeeExempt ? '普通客户 · 特殊免收' : '普通客户 · 银行标准收费';
};

export default function VaFeePolicyPanel({
  customerId,
  customerName,
  requests,
  onSaved,
}: {
  customerId: string;
  customerName: string;
  requests: VirtualAccountRequest[];
  onSaved: () => Promise<void>;
}) {
  const { user } = useAuthContext();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [action, setAction] = useState<'identity' | 'exemption' | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      setPolicy(await coreApi<Policy>(`/customers/${customerId}/va-fee-policy`));
    } catch (e) {
      setError(e instanceof Error ? e.message : '免收设置加载失败');
    }
  }, [customerId]);
  useEffect(() => {
    load();
  }, [load]);
  const pending = requests.filter(
    (r) => r.status === 'SUBMITTED' && Number(r.openingFeeEffectiveUsd ?? r.openingFeeUsd) > 0
  );
  const pendingAmount =
    pending.reduce(
      (sum, r) => sum + Math.round(Number(r.openingFeeEffectiveUsd ?? r.openingFeeUsd) * 100),
      0
    ) / 100;
  const enabled = action === 'identity' ? !policy?.isInternal : !policy?.exempt;
  const next =
    action === 'identity'
      ? { isInternal: enabled, vaFeeExempt: false }
      : { isInternal: false, vaFeeExempt: enabled };
  const save = async () => {
    if (!policy || !action) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await coreApi(
        `/customers/${customerId}/${action === 'identity' ? 'internal-identity' : 'va-fee-policy'}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled, expectedVersion: policy.version, reason: reason.trim() }),
        }
      );
      setAction(null);
      setReason('');
      setSuccess('设置已保存，仅影响之后提交的申请。');
      await Promise.all([load(), onSaved()]);
    } catch (e) {
      setAction(null);
      setError(e instanceof Error ? e.message : '保存失败');
      await load();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="h6">客户身份与 VA 开户费待遇</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}
        {policy && (
          <>
            <Typography>
              {policyLabel({ isInternal: policy.isInternal, vaFeeExempt: policy.exempt })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              适用于所有银行的新 VA 申请。已提交申请需在申请详情中逐笔减免。
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {hasAdminPermission(user, 'customers.review') && (
                <Button
                  variant="outlined"
                  onClick={() => {
                    setReason('');
                    setAction('identity');
                  }}
                >
                  {policy.isInternal ? '取消内部人员身份' : '标记内部人员'}
                </Button>
              )}
              {!policy.isInternal && hasAdminPermission(user, 'settings.manage') && (
                <Button
                  variant="outlined"
                  onClick={() => {
                    setReason('');
                    setAction('exemption');
                  }}
                >
                  {policy.exempt ? '恢复银行标准收费' : '设置特殊客户免收'}
                </Button>
              )}
            </Stack>
            {pending.length > 0 && (
              <Alert severity="info">
                有 {pending.length} 笔待审批收费申请，合计冻结 USD {pendingAmount.toFixed(2)}
                。更改待遇不会自动释放这部分费用。
                <Button href="/dashboard/operations/virtual-accounts">查看待处理申请</Button>
              </Alert>
            )}
            {policy.events.map((event) => (
              <Typography key={event.id} variant="body2" color="text.secondary">
                {new Date(event.createdAt).toLocaleString()} · {policyLabel(event.before)} →{' '}
                {policyLabel(event.after)} · {event.reason} · {event.actorId}
              </Typography>
            ))}
          </>
        )}
        <Dialog
          open={Boolean(action)}
          onClose={() => {
            if (!saving) setAction(null);
          }}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>确认调整 VA 开户费待遇</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography>
                {customerName} · {customerId}
              </Typography>
              {policy && (
                <Typography>
                  {policyLabel({ isInternal: policy.isInternal, vaFeeExempt: policy.exempt })} →{' '}
                  {policyLabel(next)}
                </Typography>
              )}
              <Alert severity="info">
                仅影响之后新提交的申请。内部人员必须为后台创建且已明确确认身份的客户。
              </Alert>
              <TextField
                autoFocus
                required
                multiline
                label="内部操作原因"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                inputProps={{ maxLength: 500 }}
              />
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={saving} onClick={() => setAction(null)}>
              取消
            </Button>
            <Button
              variant="contained"
              disabled={saving || reason.trim().length < 2}
              onClick={save}
            >
              确认保存
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Paper>
  );
}
