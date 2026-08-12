import { useCallback, useEffect, useMemo, useReducer } from 'react';
import {
  AuthFlowResult,
  AuthRole,
  AuthSessionUser,
  ChangePasswordInput,
  CompleteSetupInput,
  TotpSetupData,
  VerifyTotpInput,
} from 'src/auth/types';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  clearCsrfToken,
  getCsrfToken,
  setCsrfToken,
} from 'src/auth/csrf-token';
import { AuthContext } from './auth-context';
import {
  AuthApiError,
  beginTotpSetup,
  changeCurrentPassword,
  completeInitialSetup,
  getSession,
  loginWithPassword,
  logoutSession,
  verifyTotpChallenge,
} from './auth-api';

enum Types {
  INITIAL = 'INITIAL',
  AUTHENTICATED = 'AUTHENTICATED',
  LOGOUT = 'LOGOUT',
}

type State = {
  user: AuthSessionUser | null;
  loading: boolean;
  sessionError: string | null;
};

type Action =
  | {
      type: Types.INITIAL;
      payload: { user: AuthSessionUser | null; sessionError: string | null };
    }
  | { type: Types.AUTHENTICATED; payload: { user: AuthSessionUser } }
  | { type: Types.LOGOUT };

const initialState: State = {
  user: null,
  loading: true,
  sessionError: null,
};

function localDemoUser(): AuthSessionUser | null {
  if (process.env.NODE_ENV !== 'development' || process.env.REACT_APP_LOCAL_DEMO !== 'true') {
    return null;
  }
  const partner = window.location.pathname.startsWith('/portal');
  return {
    id: partner ? 'usr_maker' : 'usr_admin',
    email: partner ? 'partner@moventra.local' : 'admin@moventra.local',
    displayName: partner ? '本地合作方' : '本地管理员',
    role: partner ? 'partner' : 'admin',
    organization: partner
      ? { id: 'org_demo', name: 'Moventra Demo Partner', partnerKey: 'moventra-demo' }
      : null,
    membership: partner
      ? {
          id: 'mem_demo',
          roleId: 'role_demo',
          roleCode: 'owner',
          roleName: 'Owner',
          status: 'active',
        }
      : null,
    permissions: partner
      ? [
          'team.read',
          'team.invite',
          'team.manage_members',
          'team.manage_roles',
          'customers.read',
          'customers.create',
          'balances.read',
          'transactions.read',
          'integrations.read',
          'integrations.request_change',
          'credentials.reveal',
          'notifications.read',
        ]
      : [],
  };
}

function reducer(state: State, action: Action): State {
  if (action.type === Types.INITIAL) {
    return {
      user: action.payload.user,
      loading: false,
      sessionError: action.payload.sessionError,
    };
  }
  if (action.type === Types.AUTHENTICATED) {
    return {
      user: action.payload.user,
      loading: false,
      sessionError: null,
    };
  }
  if (action.type === Types.LOGOUT) {
    return {
      user: null,
      loading: false,
      sessionError: null,
    };
  }
  return state;
}

type Props = {
  children: React.ReactNode;
};

export function AuthProvider({ children }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const refreshSession = useCallback(async () => {
    const demoUser = localDemoUser();
    if (demoUser) {
      dispatch({ type: Types.INITIAL, payload: { user: demoUser, sessionError: null } });
      return demoUser;
    }
    const session = await getSession();
    setCsrfToken(session?.csrfToken);
    dispatch({
      type: Types.INITIAL,
      payload: { user: session?.user || null, sessionError: null },
    });
    return session?.user || null;
  }, []);

  const initialize = useCallback(async () => {
    try {
      await refreshSession();
    } catch (error) {
      dispatch({
        type: Types.INITIAL,
        payload: {
          user: null,
          sessionError: error instanceof Error ? error.message : 'session_unavailable',
        },
      });
    }
  }, [refreshSession]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    const handleSessionExpired = () => {
      clearCsrfToken();
      dispatch({ type: Types.LOGOUT });
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const applyFlowResult = useCallback(async (result: AuthFlowResult) => {
    if (result.nextStep !== 'authenticated') return result;

    // The authentication response only establishes identity. Always refresh
    // the server-derived Partner membership and permissions before rendering.
    const session = await getSession();
    const user = session?.user || result.user || null;
    const csrfToken = result.csrfToken || session?.csrfToken || null;
    if (!user || !csrfToken) {
      return {
        ...result,
        nextStep: 'unknown' as const,
      };
    }

    setCsrfToken(csrfToken);
    dispatch({
      type: Types.AUTHENTICATED,
      payload: { user },
    });

    return {
      ...result,
      user,
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string, expectedRole: AuthRole) =>
      applyFlowResult(await loginWithPassword(email, password, expectedRole)),
    [applyFlowResult]
  );

  const completeSetup = useCallback(
    async (input: CompleteSetupInput) => applyFlowResult(await completeInitialSetup(input)),
    [applyFlowResult]
  );

  const setupTotp = useCallback(
    async (expectedRole: AuthRole, enrollmentToken?: string | null): Promise<TotpSetupData> =>
      beginTotpSetup(expectedRole, enrollmentToken),
    []
  );

  const verifyTotp = useCallback(
    async (input: VerifyTotpInput) => applyFlowResult(await verifyTotpChallenge(input)),
    [applyFlowResult]
  );

  const logout = useCallback(async () => {
    if (localDemoUser()) {
      dispatch({ type: Types.LOGOUT });
      return;
    }
    try {
      await logoutSession(getCsrfToken());
    } finally {
      clearCsrfToken();
      dispatch({ type: Types.LOGOUT });
    }
  }, []);

  const changePassword = useCallback(
    async (input: ChangePasswordInput) => {
      if (!state.user?.role) throw new Error('authentication_required');
      try {
        await changeCurrentPassword(input, state.user.role, getCsrfToken());
      } catch (error) {
        if (error instanceof AuthApiError && error.code === 'authentication_required') {
          clearCsrfToken();
          dispatch({ type: Types.LOGOUT });
        }
        throw error;
      }
    },
    [state.user?.role]
  );

  const authenticated = Boolean(state.user);

  const memoizedValue = useMemo(
    () => ({
      user: state.user,
      method: 'cookie',
      loading: state.loading,
      authenticated,
      unauthenticated: !authenticated,
      sessionError: state.sessionError,
      login,
      completeSetup,
      setupTotp,
      verifyTotp,
      refreshSession,
      changePassword,
      logout,
    }),
    [
      authenticated,
      changePassword,
      completeSetup,
      login,
      logout,
      refreshSession,
      setupTotp,
      state.loading,
      state.sessionError,
      state.user,
      verifyTotp,
    ]
  );

  return <AuthContext.Provider value={memoizedValue}>{children}</AuthContext.Provider>;
}
