import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Container,
  InputAdornment,
  MenuItem,
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
import UiIconBadge from 'src/components/ui-icon-badge';
import { coreApi, demoOrganizationId, VirtualAccountRequest } from 'src/features/finance/core-api';
import { paths } from 'src/routes/paths';
import { ACTION_ICONS } from 'src/theme/iconography';

function formatDate(value?: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function statusPresentation(status: VirtualAccountRequest['status']) {
  if (status === 'APPROVED') return { label: '已开通', color: 'success' as const };
  if (status === 'REJECTED') return { label: '已拒绝', color: 'error' as const };
  return { label: '待处理', color: 'warning' as const };
}

export default function VaRequestManagementPage() {
  const navigate = useNavigate();
  const userId = 'usr_admin';
  const [rows, setRows] = useState<VirtualAccountRequest[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | VirtualAccountRequest['status']>('ALL');
  const [source, setSource] = useState<'ALL' | 'CUSTOMER' | 'ADMIN'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const requests = await coreApi<VirtualAccountRequest[]>(
        `/virtual-account-requests?organizationId=${demoOrganizationId}`,
        { userId }
      );
      setRows(requests);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'VA 申请加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return rows.filter((request) => {
      if (status !== 'ALL' && request.status !== status) return false;
      if (source !== 'ALL' && request.requestSource !== source) return false;
      return (
        !keyword ||
        [
          request.id,
          request.customer?.displayName,
          request.customer?.email,
          request.channel?.settlementBankName,
          request.channel?.name,
          request.currency,
          request.purpose,
          request.requesterEmail,
        ].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(keyword)
        )
      );
    });
  }, [query, rows, source, status]);

  const counts = {
    pending: rows.filter((row) => row.status === 'SUBMITTED').length,
    approved: rows.filter((row) => row.status === 'APPROVED').length,
    rejected: rows.filter((row) => row.status === 'REJECTED').length,
  };

  return (
    <>
      <Helmet>
        <title>VA 申请 | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems={{ md: 'flex-end' }}
            gap={2}
          >
            <Box>
              <Typography variant="overline" color="primary.main" fontWeight={800}>
                VIRTUAL ACCOUNT OPERATIONS
              </Typography>
              <Typography variant="h4">VA 申请</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.65 }}>
                处理已开户客户提交的银行 VA 申请；银行、币种和用途以客户提交内容为准。
              </Typography>
            </Box>
            <Button
              color="inherit"
              startIcon={<Iconify icon="solar:refresh-linear" />}
              disabled={loading}
              onClick={() => load()}
            >
              刷新申请
            </Button>
          </Stack>

          {error && (
            <Alert severity="error" action={<Button onClick={() => load()}>重试</Button>}>
              {error}
            </Alert>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
              borderTop: '1px solid',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            {[
              ['待处理', counts.pending, '等待银行账号回执'],
              ['已开通', counts.approved, 'VA 账户已创建'],
              ['已拒绝', counts.rejected, '原因已回显客户'],
            ].map(([label, value, hint], index) => (
              <Box
                key={label}
                sx={{
                  py: 2.25,
                  px: { xs: 0, sm: 2.5 },
                  borderLeft: { xs: 0, sm: index ? '1px solid' : 0 },
                  borderColor: 'divider',
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 760, letterSpacing: '-0.04em' }}>
                  {value}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {hint}
                </Typography>
              </Box>
            ))}
          </Box>

          <Card variant="outlined" sx={{ boxShadow: 'none' }}>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} sx={{ p: 2 }}>
              <TextField
                fullWidth
                size="small"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索客户、邮箱、银行、币种、用途或申请编号"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Iconify icon="solar:magnifier-linear" />
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                select
                size="small"
                label="处理状态"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as 'ALL' | VirtualAccountRequest['status'])
                }
                sx={{ minWidth: 165 }}
              >
                <MenuItem value="ALL">全部状态</MenuItem>
                <MenuItem value="SUBMITTED">待处理</MenuItem>
                <MenuItem value="APPROVED">已开通</MenuItem>
                <MenuItem value="REJECTED">已拒绝</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                label="申请来源"
                value={source}
                onChange={(event) => setSource(event.target.value as 'ALL' | 'CUSTOMER' | 'ADMIN')}
                sx={{ minWidth: 165 }}
              >
                <MenuItem value="ALL">全部来源</MenuItem>
                <MenuItem value="CUSTOMER">客户 Portal</MenuItem>
                <MenuItem value="ADMIN">管理员代申请</MenuItem>
              </TextField>
            </Stack>

            <TableContainer>
              <Table sx={{ minWidth: 1180 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>申请 / 时间</TableCell>
                    <TableCell>客户</TableCell>
                    <TableCell>来源</TableCell>
                    <TableCell>银行与币种</TableCell>
                    <TableCell>账户用途</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((request) => {
                    const presentation = statusPresentation(request.status);
                    return (
                      <TableRow
                        key={request.id}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() =>
                          navigate(paths.dashboard.fundOperations.virtualAccountDetails(request.id))
                        }
                      >
                        <TableCell>
                          <Typography variant="body2" fontWeight={700}>
                            {request.id}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(request.createdAt)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="subtitle2">
                            {request.customer?.displayName || '未知客户'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {request.customer?.email || request.customerId}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {request.requestSource === 'CUSTOMER' ? '客户 Portal' : '管理员'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {request.requesterEmail ||
                              request.maker?.displayName ||
                              request.makerId}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={650}>
                            {request.channel?.settlementBankName ||
                              request.channel?.name ||
                              '历史银行渠道'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {request.currency} ·{' '}
                            {request.channel?.bankCountry || request.preferredCountry}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 260 }}>
                          <Typography variant="body2" noWrap title={request.purpose}>
                            {request.purpose}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Label color={presentation.color}>{presentation.label}</Label>
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant={request.status === 'SUBMITTED' ? 'contained' : 'text'}
                            endIcon={<Iconify icon="solar:arrow-right-linear" />}
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(
                                paths.dashboard.fundOperations.virtualAccountDetails(request.id)
                              );
                            }}
                          >
                            {request.status === 'SUBMITTED' ? '开始处理' : '查看结果'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!filtered.length && (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 10 }}>
                        {loading ? (
                          <CircularProgress size={28} />
                        ) : (
                          <Stack alignItems="center" spacing={1}>
                            <UiIconBadge
                              icon={ACTION_ICONS.bankAccount}
                              tone="info"
                              size={48}
                              iconSize={28}
                            />
                            <Typography color="text.secondary">
                              当前没有符合条件的 VA 申请
                            </Typography>
                          </Stack>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Stack>
      </Container>
    </>
  );
}
