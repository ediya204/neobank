// ----------------------------------------------------------------------

export function remToPx(value: string) {
  return Math.round(parseFloat(value) * 16);
}

export function pxToRem(value: number) {
  return `${value / 16}rem`;
}

export function responsiveFontSizes({ sm, md, lg }: { sm: number; md: number; lg: number }) {
  return {
    '@media (min-width:600px)': {
      fontSize: pxToRem(sm),
    },
    '@media (min-width:900px)': {
      fontSize: pxToRem(md),
    },
    '@media (min-width:1200px)': {
      fontSize: pxToRem(lg),
    },
  };
}

declare module '@mui/material/styles' {
  interface TypographyVariants {
    fontWeightSemiBold: React.CSSProperties['fontWeight'];
  }
}

const primaryFont = 'Public Sans, sans-serif'; // Google Font
// const secondaryFont = 'CircularStd, sans-serif'; // Local Font

// ----------------------------------------------------------------------

export const typography = {
  fontFamily: primaryFont,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightSemiBold: 600,
  fontWeightBold: 700,
  h1: {
    fontWeight: 800,
    lineHeight: 80 / 64,
    fontSize: pxToRem(40),
    ...responsiveFontSizes({ sm: 52, md: 58, lg: 64 }),
  },
  h2: {
    fontWeight: 800,
    lineHeight: 64 / 48,
    fontSize: pxToRem(32),
    ...responsiveFontSizes({ sm: 40, md: 44, lg: 48 }),
  },
  h3: {
    fontWeight: 700,
    lineHeight: 1.5,
    fontSize: pxToRem(24),
    ...responsiveFontSizes({ sm: 26, md: 30, lg: 32 }),
  },
  h4: {
    fontWeight: 700,
    lineHeight: 1.5,
    fontSize: pxToRem(22),
    ...responsiveFontSizes({ sm: 22, md: 26, lg: 26 }),
  },
  h5: {
    fontWeight: 700,
    lineHeight: 1.5,
    fontSize: pxToRem(19),
    ...responsiveFontSizes({ sm: 20, md: 21, lg: 21 }),
  },
  h6: {
    fontWeight: 700,
    lineHeight: 30 / 19,
    fontSize: pxToRem(18),
    ...responsiveFontSizes({ sm: 19, md: 19, lg: 19 }),
  },
  subtitle1: {
    fontWeight: 600,
    lineHeight: 1.5,
    fontSize: pxToRem(17),
  },
  subtitle2: {
    fontWeight: 600,
    lineHeight: 24 / 15,
    fontSize: pxToRem(15),
  },
  body1: {
    lineHeight: 1.5,
    fontSize: pxToRem(17),
  },
  body2: {
    lineHeight: 24 / 15,
    fontSize: pxToRem(15),
  },
  caption: {
    lineHeight: 1.5,
    fontSize: pxToRem(13),
  },
  overline: {
    fontWeight: 700,
    lineHeight: 1.5,
    fontSize: pxToRem(13),
    textTransform: 'uppercase',
  },
  button: {
    fontWeight: 700,
    lineHeight: 24 / 15,
    fontSize: pxToRem(15),
    textTransform: 'unset',
  },
} as const;
