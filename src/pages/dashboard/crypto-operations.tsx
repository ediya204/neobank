import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import {
  coreApi,
  CryptoTransfer,
  Customer,
  demoOrganizationId,
  demoUsers,
} from 'src/features/finance/core-api';

export default function CryptoOperationsAdmin() {
  const [userId, setUserId] = useState('usr_checker');
  const [rows, setRows] = useState<CryptoTransfer[]>([]);
  const [selected, setSelected] = useState<CryptoTransfer | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const customers = await coreApi<Customer[]>(
        `/customers?organizationId=${demoOrganizationId}`,
        { userId }
      );
      const batches = await Promise.all(
        customers.map((customer) =>
          coreApi<CryptoTransfer[]>(`/crypto-wallets/transfers?customerId=${customer.id}`, {
            userId,
          })
        )
      );
      setRows(
        batches
          .flat()
          .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : '链上指令加载失败');
    }
  }, [userId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const metrics = useMemo(
    () => ({
      submitted: rows.filter((row) => row.status === 'SUBMITTED').length,
      processing: rows.filter((row) => row.status === 'PROCESSING').length,
      completed: rows.filter((row) => row.status === 'COMPLETED').length,
    }),
    [rows]
  );

  const perform = async (action: 'approve' | 'reject' | 'execute') => {
    if (!selected) return;
    try {
      let body: string | undefined;
      if (action === 'reject') body = JSON.stringify({ reason });
      if (action === 'execute') {
        const txHash = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('')}`;
        body = JSON.stringify({ txHash });
      }
      const updated = await coreApi<CryptoTransfer>(
        `/crypto-wallets/transfers/${selected.id}/${action}`,
        { method: 'PATCH', body, userId }
      );
      setSelected(updated);
      setRejectOpen(false);
      setReason('');
      let message = '本地链上执行已完成并生成交易哈希';
      if (action === 'approve') message = '复核通过，指令已进入链上执行队列';
      if (action === 'reject') message = '指令已拒绝，冻结余额已释放';
      setSuccess(message);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '操作失败');
    }
  };

  return (
    <>
      <Helmet>
        <title>数字钱包复核 | Moventra</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h4">数字钱包复核</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                复核 USDT 付币指令，并在通道执行后登记链上交易哈希。
              </Typography>
            </Box>
            <FormControl size="small" sx={{ minWidth: 190 }}>
              <InputLabel>本地演示身份</InputLabel>
              <Select
                label="本地演示身份"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
              >
                {demoUsers.map((user) => (
                  <MenuItem key={user.id} value={user.id}>
                    {user.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          {error && (
            <Alert severity="error" onClose={() => setError('')}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" onClose={() => setSuccess('')}>
              {success}
            </Alert>
          )}
          <Alert severity="info">
            提交人与复核人必须不同；链上执行仅为本地模拟，Cregis 接入后由适配器回填真实 TXID。
          </Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Metric label="待复核" value={metrics.submitted} color="warning.main" />
            <Metric label="链上处理中" value={metrics.processing} color="info.main" />
            <Metric label="已完成" value={metrics.completed} color="success.main" />
          </Stack>
          <Card>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>指令</TableCell>
                    <TableCell>客户</TableCell>
                    <TableCell>网络</TableCell>
                    <TableCell>金额</TableCell>
                    <TableCell>手续费</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>提交人</TableCell>
                    <TableCell>时间</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      hover
                      onClick={() => setSelected(row)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>{row.reference}</TableCell>
                      <TableCell>{row.customerId}</TableCell>
                      <TableCell>
                        {row.network} · {row.wallet.tokenStandard}
                      </TableCell>
                      <TableCell>{row.amount} USDT</TableCell>
                      <TableCell>{row.feeAmount} USDT</TableCell>
                      <TableCell>
                        <StatusLabel status={row.status} />
                      </TableCell>
                      <TableCell>{row.maker?.displayName || row.maker?.id}</TableCell>
                      <TableCell>{new Date(row.createdAt).toLocaleString('zh-CN')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Stack>
      </Container>
      <Drawer
        anchor="right"
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        PaperProps={{ sx: { width: { xs: 1, sm: 500 }, p: 3 } }}
      >
        {selected && (
          <Stack spacing={3}>
            <Stack direction="row" justifyContent="space-between">
              <Box>
                <Typography variant="h5">付币指令</Typography>
                <Typography color="text.secondary">{selected.reference}</Typography>
              </Box>
              <IconButton onClick={() => setSelected(null)}>
                <Iconify icon="mingcute:close-line" />
              </IconButton>
            </Stack>
            <Card variant="outlined" sx={{ p: 2.5 }}>
              <Info label="网络" value={`${selected.network} · ${selected.wallet.tokenStandard}`} />
              <Info label="发送数量" value={`${selected.amount} USDT`} />
              <Info label="预计到账" value={`${selected.netAmount} USDT`} />
              <Info label="目标地址" value={selected.toAddress} mono />
              <Info label="交易哈希" value={selected.txHash || '执行后生成'} mono />
            </Card>
            {selected.status === 'SUBMITTED' && (
              <Stack direction="row" spacing={1}>
                <Button
                  fullWidth
                  color="error"
                  variant="outlined"
                  onClick={() => setRejectOpen(true)}
                >
                  拒绝
                </Button>
                <Button
                  fullWidth
                  variant="contained"
                  disabled={selected.maker?.id === userId}
                  onClick={() => perform('approve').catch(() => undefined)}
                >
                  复核通过
                </Button>
              </Stack>
            )}
            {selected.status === 'PROCESSING' && (
              <Button variant="contained" onClick={() => perform('execute').catch(() => undefined)}>
                模拟通道执行并回填 TXID
              </Button>
            )}
          </Stack>
        )}
      </Drawer>
      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>拒绝付币指令</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="拒绝原因"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>取消</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!reason.trim()}
            onClick={() => perform('reject').catch(() => undefined)}
          >
            确认拒绝
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card sx={{ flex: 1, p: 2.5 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography variant="h3" sx={{ mt: 1, color }}>
        {value}
      </Typography>
    </Card>
  );
}
function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 1 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography
        variant="subtitle2"
        sx={{
          textAlign: 'right',
          fontFamily: mono ? 'monospace' : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
function StatusLabel({ status }: { status: CryptoTransfer['status'] }) {
  const names = {
    SUBMITTED: '待复核',
    PROCESSING: '处理中',
    COMPLETED: '已完成',
    REJECTED: '已拒绝',
    FAILED: '失败',
  };
  let color: 'default' | 'warning' | 'info' | 'success' | 'error' = 'default';
  if (status === 'SUBMITTED') color = 'warning';
  if (status === 'PROCESSING') color = 'info';
  if (status === 'COMPLETED') color = 'success';
  if (status === 'REJECTED' || status === 'FAILED') color = 'error';
  return <Label color={color}>{names[status]}</Label>;
}
