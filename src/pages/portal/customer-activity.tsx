import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Box,
  Card,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import { money, OperationStatus, OperationTitle } from './customer-shared';

export default function CustomerActivity() {
  const { operations } = usePortalCustomer();
  const [status, setStatus] = useState('all');
  const rows = useMemo(
    () => operations.filter((row) => status === 'all' || row.status === status),
    [operations, status]
  );
  return (
    <>
      <Helmet>
        <title>交易记录 | Moventra</title>
      </Helmet>
      <Container maxWidth="lg">
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4">交易记录</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75 }}>
              追踪每一笔收款、转账、换汇、OTC 和付款。
            </Typography>
          </Box>
          <Card>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ sm: 'center' }}
              gap={2}
              sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <Typography variant="h6">全部交易</Typography>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>状态</InputLabel>
                <Select
                  label="状态"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <MenuItem value="all">全部状态</MenuItem>
                  <MenuItem value="SUBMITTED">审核中</MenuItem>
                  <MenuItem value="PROCESSING">处理中</MenuItem>
                  <MenuItem value="COMPLETED">已完成</MenuItem>
                  <MenuItem value="REJECTED">未通过</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            {rows.map((row) => (
              <Stack
                key={row.id}
                direction="row"
                alignItems="center"
                spacing={2}
                sx={{
                  px: { xs: 2, md: 3 },
                  py: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 2,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: row.type === 'DEPOSIT' ? 'success.lighter' : 'grey.100',
                  }}
                >
                  <Iconify
                    icon={row.type === 'DEPOSIT' ? 'solar:arrow-down-bold' : 'solar:arrow-up-bold'}
                    color={row.type === 'DEPOSIT' ? 'success.main' : 'text.secondary'}
                  />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <OperationTitle operation={row} />
                  <Typography variant="caption" color="text.secondary">
                    {new Date(row.createdAt).toLocaleString('zh-CN')}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="subtitle1">
                    {row.type === 'DEPOSIT' ? '+' : '-'}
                    {money(row.amount, row.currency)}
                  </Typography>
                  <OperationStatus status={row.status} />
                </Box>
              </Stack>
            ))}
            {!rows.length && (
              <Typography color="text.secondary" align="center" sx={{ py: 8 }}>
                暂无符合条件的交易
              </Typography>
            )}
          </Card>
        </Stack>
      </Container>
    </>
  );
}
