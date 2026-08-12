let csrfToken: string | null = null;

export const AUTH_SESSION_EXPIRED_EVENT = 'va-auth-session-expired';

export function setCsrfToken(value: string | null | undefined) {
  csrfToken = typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getCsrfToken() {
  return csrfToken;
}

export function clearCsrfToken() {
  csrfToken = null;
}

export function notifySessionExpired() {
  clearCsrfToken();
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT));
}
