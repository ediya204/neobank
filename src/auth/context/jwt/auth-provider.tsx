import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
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
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import { requiredRoleForPath } from 'src/auth/role-access';
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
  if (
    IS_NEOBANK_DEPLOYMENT ||
    process.env.NODE_ENV !== 'development' ||
    process.env.REACT_APP_LOCAL_DEMO !== 'true'
  ) {
    return null;
  }
  // Customer authentication is always exercised against the real local Go
  // session API. A synthetic user here would bypass login and then fail every
  // customer-scoped request because no server session exists.
  if (window.location.pathname.startsWith('/customer')) return null;

  const partner = window.location.pathname.startsWith('/portal');
  let role: AuthRole = 'admin';
  let id = 'usr_admin';
  let email = 'admin@ssc-digital-bank.local';
  let displayName = '本地管理员';
  if (partner) {
    role = 'partner';
    id = 'usr_maker';
    email = 'partner@ssc-digital-bank.local';
    displayName = '本地合作方';
  }
  return {
    id,
    email,
    displayName,
    role,
    organization: partner
      ? {
          id: 'org_demo',
          name: 'SSC Digital Bank Demo Partner',
          partnerKey: 'ssc-digital-bank-demo',
        }
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
      : [
          'admin_users.manage',
          'customers.read',
          'customers.review',
          'funds.read',
          'funds.manage',
          'settings.manage',
          'reports.read',
        ],
    accessRole: partner ? null : 'super_admin',
    coreUserId: partner ? null : id,
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
  const latestSessionRequestRef = useRef(0);

  const refreshSession = useCallback(async (expectedRole?: AuthRole) => {
    const requestId = latestSessionRequestRef.current + 1;
    latestSessionRequestRef.current = requestId;
    const demoUser = localDemoUser();
    if (demoUser) {
      if (latestSessionRequestRef.current === requestId) {
        dispatch({ type: Types.INITIAL, payload: { user: demoUser, sessionError: null } });
      }
      return demoUser;
    }
    try {
      const session = await getSession(
        expectedRole || requiredRoleForPath(window.location.pathname) || undefined
      );
      if (latestSessionRequestRef.current !== requestId) return null;

      setCsrfToken(session?.csrfToken);
      dispatch({
        type: Types.INITIAL,
        payload: { user: session?.user || null, sessionError: null },
      });
      return session?.user || null;
    } catch (error) {
      if (latestSessionRequestRef.current !== requestId) return null;

      dispatch({
        type: Types.INITIAL,
        payload: {
          user: null,
          sessionError: error instanceof Error ? error.message : 'session_unavailable',
        },
      });
      throw error;
    }
  }, []);

  const initialize = useCallback(async () => {
    try {
      await refreshSession();
    } catch {
      // refreshSession records the current request failure. Login routes remain usable.
    }
  }, [refreshSession]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    const handleSessionExpired = () => {
      latestSessionRequestRef.current += 1;
      clearCsrfToken();
      dispatch({ type: Types.LOGOUT });
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const applyFlowResult = useCallback(async (result: AuthFlowResult, expectedRole: AuthRole) => {
    if (result.nextStep !== 'authenticated') return result;

    const requestId = latestSessionRequestRef.current + 1;
    latestSessionRequestRef.current = requestId;

    // The authentication response only establishes identity. Always refresh
    // the server-derived Partner membership and permissions before rendering.
    try {
      const session = await getSession(expectedRole);
      if (latestSessionRequestRef.current !== requestId) {
        return { ...result, nextStep: 'unknown' as const };
      }

      const user = session?.user || result.user || null;
      const csrfToken = result.csrfToken || session?.csrfToken || null;
      if (!user || !csrfToken) {
        dispatch({
          type: Types.INITIAL,
          payload: { user: null, sessionError: 'invalid_auth_response' },
        });
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
    } catch (error) {
      if (latestSessionRequestRef.current === requestId) {
        dispatch({
          type: Types.INITIAL,
          payload: {
            user: null,
            sessionError: error instanceof Error ? error.message : 'session_unavailable',
          },
        });
      }
      throw error;
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string, expectedRole: AuthRole) =>
      applyFlowResult(await loginWithPassword(email, password, expectedRole), expectedRole),
    [applyFlowResult]
  );

  const completeSetup = useCallback(
    async (input: CompleteSetupInput) =>
      applyFlowResult(await completeInitialSetup(input), input.expectedRole),
    [applyFlowResult]
  );

  const setupTotp = useCallback(
    async (expectedRole: AuthRole, enrollmentToken?: string | null): Promise<TotpSetupData> =>
      beginTotpSetup(expectedRole, enrollmentToken),
    []
  );

  const verifyTotp = useCallback(
    async (input: VerifyTotpInput) =>
      applyFlowResult(await verifyTotpChallenge(input), input.expectedRole),
    [applyFlowResult]
  );

  const logout = useCallback(
    async (expectedRole?: AuthRole) => {
      latestSessionRequestRef.current += 1;
      if (localDemoUser()) {
        dispatch({ type: Types.LOGOUT });
        return;
      }
      try {
        await logoutSession(
          expectedRole || state.user?.role || requiredRoleForPath(window.location.pathname),
          getCsrfToken()
        );
      } catch (error) {
        if (!(error instanceof AuthApiError && error.status === 401)) throw error;
      } finally {
        clearCsrfToken();
        dispatch({ type: Types.LOGOUT });
      }
    },
    [state.user?.role]
  );

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
