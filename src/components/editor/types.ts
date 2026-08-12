import ReactQuill from 'react-quill';
// @mui
import { Theme, SxProps } from '@mui/material/styles';

// ----------------------------------------------------------------------

export interface EditorProps extends React.ComponentProps<typeof ReactQuill> {
  error?: boolean;
  simple?: boolean;
  helperText?: React.ReactNode;
  sx?: SxProps<Theme>;
}
