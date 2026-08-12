import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import {
  CountryCallingCodeOption,
  SUPPORTED_COUNTRY_CALLING_CODES,
} from 'src/data/supported-country-calling-codes';

type Props = {
  value: string;
  onChange: (callingCode: string) => void;
  label: string;
  helperText?: ReactNode;
  error?: boolean;
  required?: boolean;
  disabled?: boolean;
  initialIso2?: string;
  noOptionsText?: ReactNode;
  sx?: SxProps<Theme>;
};

function resolveInitialOption(value: string, initialIso2?: string) {
  const matches = SUPPORTED_COUNTRY_CALLING_CODES.filter((option) => option.callingCode === value);
  const preferred = matches.find((option) => option.iso2 === initialIso2);

  if (preferred) return preferred;
  if (matches.length === 1) return matches[0];
  return undefined;
}

function countryFlag(iso2: string) {
  return String.fromCodePoint(
    ...iso2
      .toUpperCase()
      .split('')
      .map((character) => 127397 + character.charCodeAt(0))
  );
}

export function getCountryCallingCodeLabel(
  option: CountryCallingCodeOption,
  language: 'cn' | 'en'
) {
  if (language === 'cn') return option.label;
  return `${countryFlag(option.iso2)} ${option.country} (${option.callingCode})`;
}

export default function CountryCallingCodeAutocomplete({
  value,
  onChange,
  label,
  helperText,
  error = false,
  required = false,
  disabled = false,
  initialIso2,
  noOptionsText,
  sx,
}: Props) {
  const { i18n } = useTranslation();
  const language =
    i18n.resolvedLanguage === 'cn' || i18n.language === 'cn' ? ('cn' as const) : ('en' as const);
  const initialOption = resolveInitialOption(value, initialIso2);
  const [selectedIso2, setSelectedIso2] = useState(initialOption?.iso2 || '');
  const selectedIso2Ref = useRef(selectedIso2);
  const [inputValue, setInputValue] = useState(
    initialOption ? getCountryCallingCodeLabel(initialOption, language) : value
  );

  const setSelectedCountry = (iso2: string) => {
    selectedIso2Ref.current = iso2;
    setSelectedIso2(iso2);
  };

  useEffect(() => {
    const retainedOption = SUPPORTED_COUNTRY_CALLING_CODES.find(
      (option) => option.iso2 === selectedIso2Ref.current && option.callingCode === value
    );
    const nextOption = retainedOption || resolveInitialOption(value, initialIso2);

    setSelectedCountry(nextOption?.iso2 || '');
    setInputValue(nextOption ? getCountryCallingCodeLabel(nextOption, language) : value);
  }, [initialIso2, language, value]);

  const selectedOption = useMemo(
    () =>
      SUPPORTED_COUNTRY_CALLING_CODES.find(
        (option) => option.iso2 === selectedIso2 && option.callingCode === value
      ) || null,
    [selectedIso2, value]
  );

  return (
    <Autocomplete<CountryCallingCodeOption, false, false, false>
      options={SUPPORTED_COUNTRY_CALLING_CODES}
      value={selectedOption}
      inputValue={inputValue}
      autoHighlight
      openOnFocus
      selectOnFocus
      clearOnEscape
      disabled={disabled}
      getOptionLabel={(option) => getCountryCallingCodeLabel(option, language)}
      isOptionEqualToValue={(option, selected) =>
        option.iso2 === selected.iso2 && option.callingCode === selected.callingCode
      }
      filterOptions={(options, state) => {
        const query = state.inputValue.trim().toLowerCase();
        if (
          !query ||
          (selectedOption &&
            query === getCountryCallingCodeLabel(selectedOption, language).toLowerCase())
        ) {
          return options;
        }
        return options.filter((option) => option.searchText.includes(query));
      }}
      onInputChange={(_event, nextInputValue, reason) => {
        if (reason === 'input' || reason === 'clear') {
          setInputValue(nextInputValue);
        }
      }}
      onChange={(_event, option) => {
        setSelectedCountry(option?.iso2 || '');
        setInputValue(option ? getCountryCallingCodeLabel(option, language) : '');
        onChange(option?.callingCode || '');
      }}
      noOptionsText={noOptionsText}
      sx={sx}
      renderInput={(params) => (
        <TextField
          {...params}
          required={required}
          label={label}
          error={error}
          helperText={helperText}
          onBlur={() => {
            setInputValue(
              selectedOption ? getCountryCallingCodeLabel(selectedOption, language) : value
            );
          }}
        />
      )}
    />
  );
}
