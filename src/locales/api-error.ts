import i18n from './i18n';

type ApiErrorBody = {
  error?: {
    code?: unknown;
  };
};

export function getLocalizedApiError(body: ApiErrorBody | null | undefined, fallback?: string) {
  const code = typeof body?.error?.code === 'string' ? body.error.code : '';
  const key = code ? `api_errors.${code}` : '';

  if (key && i18n.exists(key, { ns: 'common' })) {
    return i18n.t(key, { ns: 'common' });
  }

  return fallback || i18n.t('api_errors.request_failed', { ns: 'common' });
}
