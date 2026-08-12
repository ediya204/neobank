// PROTOTYPE ONLY — remove after a home-visualization direction is selected.
import { useEffect } from 'react';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import Iconify from 'src/components/iconify';

export type PrototypeVariant = {
  key: string;
  label: string;
};

export default function PrototypeVariantSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: PrototypeVariant[];
  current: string;
  onChange: (variant: string) => void;
}) {
  const currentIndex = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current)
  );
  const cycle = (offset: number) => {
    const nextIndex = (currentIndex + offset + variants.length) % variants.length;
    onChange(variants[nextIndex].key);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches('input, textarea, select, [contenteditable="true"]') ||
        !['ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        return;
      }
      event.preventDefault();
      cycle(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        zIndex: 1400,
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        px: 1,
        py: 0.75,
        borderRadius: 99,
        color: 'common.white',
        bgcolor: 'grey.900',
        boxShadow: 20,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.75}>
        <IconButton color="inherit" size="small" onClick={() => cycle(-1)}>
          <Iconify icon="solar:alt-arrow-left-linear" />
        </IconButton>
        <Typography variant="subtitle2" sx={{ minWidth: 190, textAlign: 'center' }}>
          {variants[currentIndex].key} — {variants[currentIndex].label}
        </Typography>
        <IconButton color="inherit" size="small" onClick={() => cycle(1)}>
          <Iconify icon="solar:alt-arrow-right-linear" />
        </IconButton>
      </Stack>
    </Box>
  );
}
