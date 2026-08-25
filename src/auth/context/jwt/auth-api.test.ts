import { AUTH_SESSION_EXPIRED_EVENT } from 'src/auth/csrf-token';
import { getCustomerSecuritySummary } from './auth-api';

function response(code: string) {
  return {
    ok: false,
    status: 401,
    headers: { get: () => 'application/json' },
    json: jest.fn().mockResolvedValue({ error: { code } }),
  } as unknown as Response;
}

describe('authentication API session expiry handling', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['authentication_required', 'session_expired'])(
    'notifies the auth provider for %s',
    async (code) => {
      const listener = jest.fn();
      window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, listener);
      jest.spyOn(global, 'fetch').mockResolvedValue(response(code));

      await expect(getCustomerSecuritySummary()).rejects.toMatchObject({ status: 401, code });
      expect(listener).toHaveBeenCalledTimes(1);

      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, listener);
    }
  );

  it('does not clear the current session for invalid login credentials', async () => {
    const listener = jest.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, listener);
    jest.spyOn(global, 'fetch').mockResolvedValue(response('invalid_credentials'));

    await expect(getCustomerSecuritySummary()).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials',
    });
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, listener);
  });
});
