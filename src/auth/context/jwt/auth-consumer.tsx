// components
import { SplashScreen } from 'src/components/loading-screen';
import { isNonBlockingSessionCheckPath } from 'src/auth/role-access';
//
import { AuthContext } from './auth-context';

// ----------------------------------------------------------------------

type Props = {
  children: React.ReactNode;
};

export function AuthConsumer({ children }: Props) {
  return (
    <AuthContext.Consumer>
      {(auth) =>
        auth.loading && !isNonBlockingSessionCheckPath(window.location.pathname) ? (
          <SplashScreen />
        ) : (
          children
        )
      }
    </AuthContext.Consumer>
  );
}
