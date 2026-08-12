import { m } from 'framer-motion';
// @mui
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
// routes
import { RouterLink } from 'src/routes/components';
// components
import { MotionContainer, varBounce } from 'src/components/animate';
// assets
import { PageNotFoundIllustration } from 'src/assets/illustrations';

// ----------------------------------------------------------------------

export default function NotFoundView() {
  const { t } = useTranslation('common');

  return (
    <MotionContainer>
      <m.div variants={varBounce().in}>
        <Typography sx={{ mb: 2, typography: { xs: 'h4', sm: 'h3' } }}>
          {t('error_pages.not_found.title')}
        </Typography>
      </m.div>

      <m.div variants={varBounce().in}>
        <Typography sx={{ color: 'text.secondary', maxWidth: 560, mx: 'auto' }}>
          {t('error_pages.not_found.description')}
        </Typography>
      </m.div>

      <m.div variants={varBounce().in}>
        <PageNotFoundIllustration
          sx={{
            height: 260,
            my: { xs: 5, sm: 10 },
          }}
        />
      </m.div>

      <Button
        component={RouterLink}
        href="/"
        size="large"
        variant="contained"
        sx={{ minHeight: 44, width: { xs: 1, sm: 'auto' }, maxWidth: { xs: 320, sm: 'none' } }}
      >
        {t('error_pages.back_home')}
      </Button>
    </MotionContainer>
  );
}
