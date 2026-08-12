import { useTranslation } from 'react-i18next';
import Typography from '@mui/material/Typography';
import Paper, { PaperProps } from '@mui/material/Paper';

// ----------------------------------------------------------------------

interface Props extends PaperProps {
  query?: string;
}

export default function SearchNotFound({ query, sx, ...other }: Props) {
  const { t } = useTranslation('common');

  return query ? (
    <Paper
      sx={{
        bgcolor: 'unset',
        textAlign: 'center',
        ...sx,
      }}
      {...other}
    >
      <Typography variant="h6" gutterBottom>
        {t('header.search_not_found')}
      </Typography>

      <Typography variant="body2">
        {t('header.search_not_found_detail', { query })}
      </Typography>
    </Paper>
  ) : (
    <Typography variant="body2" sx={sx}>
      {t('header.search_prompt')}
    </Typography>
  );
}
