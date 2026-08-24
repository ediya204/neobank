import { LogoutOptions, RedirectLoginOptions, PopupLoginOptions } from '@auth0/auth0-react';

// ----------------------------------------------------------------------

export type ActionMapType<M extends { [index: string]: any }> = {
  [Key in keyof M]: M[Key] extends undefined
    ? {
        type: Key;
      }
    : {
        type: Key;
        payload: M[Key];
      };
};

export type AuthUserType = null | Record<string, any>;

export type AuthStateType = {
  status?: string;
  loading: boolean;
  user: AuthUserType;
};

export type AuthRole = 'admin' | 'customer';

export type AdminPermission =
  | 'admin_users.manage'
  | 'customer_credentials.manage'
  | 'customers.read'
  | 'customers.review'
  | 'funds.read'
  | 'funds.manage'
  | 'settings.manage'
  | 'reports.read';

export type SessionPermission = AdminPermission;

export type AdminAccessRole =
  | 'super_admin'
  | 'operations_admin'
  | 'compliance_admin'
  | 'read_only_admin';

export type AuthSessionUser = {
  id: string;
  coreUserId?: string | null;
  email: string;
  displayName: string;
  role: AuthRole;
  totpEnabled?: boolean;
  accessRole?: AdminAccessRole | null;
  photoURL?: string | null;
  permissions: SessionPermission[];
};

export type AuthFlowStep =
  | 'authenticated'
  | 'setup_required'
  | 'totp_setup_required'
  | 'totp_required'
  | 'unknown';

export type TotpSetupData = {
  secret: string;
  otpauthUri: string | null;
  qrCodeDataUri: string | null;
  issuer: string | null;
  accountName: string | null;
  enrollmentToken: string | null;
};

export type AuthFlowResult = {
  nextStep: AuthFlowStep;
  user: AuthSessionUser | null;
  challengeToken: string | null;
  enrollmentToken: string | null;
  setupToken: string | null;
  totpSetup: TotpSetupData | null;
  recoveryCodes: string[];
  csrfToken: string | null;
};

export type AuthSessionData = {
  user: AuthSessionUser;
  csrfToken: string | null;
};

export type CompleteSetupInput = {
  setupToken: string;
  password: string;
  expectedRole: AuthRole;
};

export type VerifyTotpInput = {
  expectedRole: AuthRole;
  code?: string;
  recoveryCode?: string;
  challengeToken?: string | null;
  enrollmentToken?: string | null;
};

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
  totpCode: string;
};

export type CustomerTotpEnrollmentResult = TotpSetupData & {
  expiresAt: string | null;
};

export type CustomerTotpVerificationResult = {
  totpEnabled: boolean;
  recoveryCodes: string[];
  otherSessionsRevoked: boolean;
};

// ----------------------------------------------------------------------

type CanRemove = {
  login?: (email: string, password: string) => Promise<void>;
  register?: (
    email: string,
    password: string,
    firstName: string,
    lastName: string
  ) => Promise<void>;
  //
  loginWithGoogle?: () => Promise<void>;
  loginWithGithub?: () => Promise<void>;
  loginWithTwitter?: () => Promise<void>;
  //
  loginWithPopup?: (options?: PopupLoginOptions) => Promise<void>;
  loginWithRedirect?: (options?: RedirectLoginOptions) => Promise<void>;
  //
  confirmRegister?: (email: string, code: string) => Promise<void>;
  forgotPassword?: (email: string) => Promise<void>;
  resendCodeRegister?: (email: string) => Promise<void>;
  newPassword?: (email: string, code: string, password: string) => Promise<void>;
};

export type JWTContextType = {
  user: AuthSessionUser | null;
  method: string;
  loading: boolean;
  authenticated: boolean;
  unauthenticated: boolean;
  sessionError: string | null;
  login: (email: string, password: string, expectedRole: AuthRole) => Promise<AuthFlowResult>;
  completeSetup: (input: CompleteSetupInput) => Promise<AuthFlowResult>;
  setupTotp: (role: AuthRole, challengeToken?: string | null) => Promise<TotpSetupData>;
  verifyTotp: (input: VerifyTotpInput) => Promise<AuthFlowResult>;
  refreshSession: (expectedRole?: AuthRole) => Promise<AuthSessionUser | null>;
  changePassword: (input: ChangePasswordInput) => Promise<void>;
  logout: (expectedRole?: AuthRole) => Promise<void>;
};

export type FirebaseContextType = CanRemove & {
  user: AuthUserType;
  method: string;
  loading: boolean;
  authenticated: boolean;
  unauthenticated: boolean;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGithub: () => Promise<void>;
  loginWithTwitter: () => Promise<void>;
  forgotPassword?: (email: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
};

export type AmplifyContextType = CanRemove & {
  user: AuthUserType;
  method: string;
  loading: boolean;
  authenticated: boolean;
  unauthenticated: boolean;
  login: (email: string, password: string) => Promise<unknown>;
  register: (
    email: string,
    password: string,
    firstName: string,
    lastName: string
  ) => Promise<unknown>;
  logout: () => Promise<unknown>;
  confirmRegister: (email: string, code: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resendCodeRegister: (email: string) => Promise<void>;
  newPassword: (email: string, code: string, password: string) => Promise<void>;
};

// ----------------------------------------------------------------------

export type Auth0ContextType = CanRemove & {
  user: AuthUserType;
  method: string;
  loading: boolean;
  authenticated: boolean;
  unauthenticated: boolean;
  loginWithPopup: (options?: PopupLoginOptions) => Promise<void>;
  loginWithRedirect: (options?: RedirectLoginOptions) => Promise<void>;
  logout: (options?: LogoutOptions) => Promise<void>;
};
