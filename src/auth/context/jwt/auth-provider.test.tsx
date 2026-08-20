import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { AuthFlowResult, AuthSessionData, AuthSessionUser, JWTContextType } from 'src/auth/types';
import { clearCsrfToken, getCsrfToken } from 'src/auth/csrf-token';
import { useAuthContext } from 'src/auth/hooks';
import { AuthProvider } from './auth-provider';
import { getSession, loginWithPassword } from './auth-api';

jest.mock('./auth-api', () => {
  const actual = jest.requireActual('./auth-api');
  return {
    ...actual,
    getSession: jest.fn(),
    loginWithPassword: jest.fn(),
  };
});

const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const mockedLoginWithPassword = loginWithPassword as jest.MockedFunction<typeof loginWithPassword>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const adminUser: AuthSessionUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  displayName: 'Admin',
  role: 'admin',
  organization: null,
  membership: null,
  permissions: ['customers.read'],
  accessRole: 'super_admin',
};

const authenticatedResult: AuthFlowResult = {
  nextStep: 'authenticated',
  user: adminUser,
  challengeToken: null,
  enrollmentToken: null,
  setupToken: null,
  totpSetup: null,
  recoveryCodes: [],
  csrfToken: 'fresh-csrf',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('AuthProvider session request ordering', () => {
  let container: HTMLDivElement;
  let root: Root;
  let authContext: JWTContextType;

  function CaptureContext() {
    authContext = useAuthContext();
    return null;
  }

  beforeEach(() => {
    clearCsrfToken();
    mockedGetSession.mockReset();
    mockedLoginWithPassword.mockReset();
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    clearCsrfToken();
  });

  it('does not let a stale background session result overwrite a successful login', async () => {
    const initialSession = deferred<AuthSessionData | null>();
    mockedGetSession
      .mockImplementationOnce(() => initialSession.promise)
      .mockResolvedValueOnce({ user: adminUser, csrfToken: 'fresh-csrf' });
    mockedLoginWithPassword.mockResolvedValue(authenticatedResult);

    await act(async () => {
      root.render(
        <AuthProvider>
          <CaptureContext />
        </AuthProvider>
      );
    });

    await act(async () => {
      await authContext.login('admin@example.com', 'password', 'admin');
    });

    expect(authContext.user).toEqual(adminUser);
    expect(getCsrfToken()).toBe('fresh-csrf');

    await act(async () => {
      initialSession.resolve(null);
      await initialSession.promise;
    });

    expect(authContext.user).toEqual(adminUser);
    expect(getCsrfToken()).toBe('fresh-csrf');
  });
});
