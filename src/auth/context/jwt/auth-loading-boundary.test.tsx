import { renderToStaticMarkup } from 'react-dom/server';
import { JWTContextType } from 'src/auth/types';
import GuestGuard from 'src/auth/guard/guest-guard';
import { AuthConsumer } from './auth-consumer';
import { AuthContext } from './auth-context';

jest.mock('src/components/loading-screen', () => ({
  SplashScreen: () => <div>session-splash</div>,
}));
jest.mock('react-router-dom', () => ({
  Navigate: () => <div>navigate</div>,
}));
jest.mock('src/routes/hooks', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

function loadingContext(): JWTContextType {
  return {
    user: null,
    method: 'cookie',
    loading: true,
    authenticated: false,
    unauthenticated: true,
    sessionError: null,
  } as JWTContextType;
}

describe('authentication loading boundaries', () => {
  it.each(['/admin/login', '/customer/login'])(
    'renders the %s page before the background session check completes',
    (pathname) => {
      window.history.pushState({}, '', pathname);

      const markup = renderToStaticMarkup(
        <AuthContext.Provider value={loadingContext()}>
          <AuthConsumer>
            <div>login-shell</div>
          </AuthConsumer>
        </AuthContext.Provider>
      );

      expect(markup).toContain('login-shell');
      expect(markup).not.toContain('session-splash');
    }
  );

  it('keeps a protected workspace behind the session loading boundary', () => {
    window.history.pushState({}, '', '/admin');

    const markup = renderToStaticMarkup(
      <AuthContext.Provider value={loadingContext()}>
        <AuthConsumer>
          <div>protected-workspace</div>
        </AuthConsumer>
      </AuthContext.Provider>
    );

    expect(markup).toContain('session-splash');
    expect(markup).not.toContain('protected-workspace');
  });

  it('lets a guest login shell render while its session check is pending', () => {
    const markup = renderToStaticMarkup(
      <AuthContext.Provider value={loadingContext()}>
        <GuestGuard expectedRole="admin">
          <div>guarded-login-shell</div>
        </GuestGuard>
      </AuthContext.Provider>
    );

    expect(markup).toContain('guarded-login-shell');
    expect(markup).not.toContain('session-splash');
  });
});
