# Authentication API contract

Contract version: `auth-v1`

This contract covers application-managed human authentication for the Admin
and Partner Portal. It does not apply to the Partner machine API under
`/api/v1`, which continues to use a Cloudflare Access Service Token.

All authentication responses include `Cache-Control: no-store`. Request and
response bodies are JSON unless a success response is documented as empty.
JSON request bodies must be objects and cannot exceed 16 KB.

## Role-scoped paths

| Operation                             | Admin                                 | Partner Portal                         |
| ------------------------------------- | ------------------------------------- | -------------------------------------- |
| Password login                        | `POST /api/auth/admin/login`          | `POST /api/auth/portal/login`          |
| Complete password setup               | `POST /api/auth/admin/setup/complete` | `POST /api/auth/portal/setup/complete` |
| Read or create TOTP enrollment secret | `POST /api/auth/admin/totp/setup`     | `POST /api/auth/portal/totp/setup`     |
| Verify enrollment or login            | `POST /api/auth/admin/totp/verify`    | `POST /api/auth/portal/totp/verify`    |
| Change the active password            | `POST /api/auth/admin/password/change` | `POST /api/auth/portal/password/change` |

The path fixes the required role. There is no role field in these request
bodies. Admin credentials and intermediate tokens return a generic
authentication error on Portal endpoints without being consumed, and the
inverse rule applies to Partner Portal credentials and tokens.

The retired shared paths `/api/auth/login`, `/api/auth/setup/complete`,
`/api/auth/totp/setup`, `/api/auth/totp/verify`, and
`/api/auth/password/change` return:

```json
{
  "error": {
    "code": "not_found",
    "message": "API 路径不存在"
  }
}
```

## Common schemas

All timestamps are UTC ISO 8601 strings.

```json
{
  "$defs": {
    "role": {
      "type": "string",
      "enum": ["admin", "partner"]
    },
    "purpose": {
      "type": "string",
      "enum": ["initial_setup", "credential_reset"]
    },
    "user": {
      "type": "object",
      "required": ["id", "email", "role"],
      "properties": {
        "id": { "type": "string" },
        "email": { "type": "string", "format": "email" },
        "role": { "$ref": "#/$defs/role" }
      },
      "additionalProperties": false
    },
    "error": {
      "type": "object",
      "required": ["error"],
      "properties": {
        "error": {
          "type": "object",
          "required": ["code", "message"],
          "properties": {
            "code": { "type": "string" },
            "message": { "type": "string" },
            "details": {}
          }
        }
      }
    }
  }
}
```

Successful session creation and `GET /api/auth/me` use this data shape:

```json
{
  "data": {
    "user": {
      "id": "usr_...",
      "email": "admin@example.com",
      "role": "admin"
    },
    "expires_at": "2026-07-29T18:00:00.000Z",
    "csrf_token": "..."
  }
}
```

The enrollment-verification response adds a `recovery_codes` array containing
exactly ten newly generated one-time codes. It is the only response that
returns those plaintext codes.

## `POST /api/auth/setup-token`

This administrator-protected bootstrap operation requires:

```http
Authorization: Bearer <AUTH_BOOTSTRAP_SECRET>
Content-Type: application/json
```

Request:

```json
{
  "email": "admin@example.com",
  "role": "admin",
  "purpose": "initial_setup"
}
```

| Field     | Type                                  | Required | Contract                                                      |
| --------- | ------------------------------------- | -------- | ------------------------------------------------------------- |
| `email`   | email string                          | yes      | Must appear in the comma-separated Worker-configured email allowlist for the selected role. |
| `role`    | `admin` or `partner`                  | yes      | Cannot alter an existing account's role.                      |
| `purpose` | `initial_setup` or `credential_reset` | no       | Defaults to `initial_setup`.                                  |

Success `200`:

```json
{
  "data": {
    "setup_token": "...",
    "expires_at": "2026-07-29T10:30:00.000Z",
    "purpose": "initial_setup"
  }
}
```

The setup token expires after 30 minutes and is single-use.

`initial_setup` creates or continues only an account that has not completed
activation. `credential_reset` succeeds only for an account that has completed
activation. A successful reset transaction:

- creates the new setup token;
- revokes active sessions and login challenges;
- invalidates pending TOTP enrollments and older setup tokens;
- clears the password record, encrypted TOTP secret, TOTP replay counter,
  recovery codes, password lock, and activation timestamp.

Consequently, all old credentials stop working immediately. The account cannot
log in again until the role-specific setup and TOTP enrollment flow completes.

Operation-specific errors:

| HTTP  | Code                             | Meaning                                                              |
| ----- | -------------------------------- | -------------------------------------------------------------------- |
| `401` | `invalid_bootstrap_secret`       | Missing or incorrect bootstrap bearer secret.                        |
| `409` | `setup_already_completed`        | Default/initial setup requested for an activated account.            |
| `409` | `credential_reset_not_available` | Reset requested for a missing or incomplete account.                 |
| `409` | `credential_reset_state_changed` | Account state changed while the reset was being issued. Start again. |
| `409` | `identity_role_conflict`         | Stored role conflicts with the configured role.                      |
| `422` | `identity_not_configured`        | Email and role do not match the Worker configuration.                |
| `422` | `invalid_setup_purpose`          | `purpose` is not one of the two supported values.                    |

## `POST /api/auth/{admin|portal}/setup/complete`

Request:

```json
{
  "setup_token": "...",
  "password": "a-strong-new-password-Aa1!"
}
```

The password must contain 14–128 characters including uppercase, lowercase,
number, and symbol. The token must belong to the role selected by the path.

Success `200`:

```json
{
  "data": {
    "enrollment_token": "...",
    "expires_at": "2026-07-29T10:15:00.000Z"
  }
}
```

The enrollment token expires after 15 minutes. Reusing the setup token returns
`401 invalid_setup_token`; a concurrent claim may return
`409 setup_token_consumed`.

## `POST /api/auth/{admin|portal}/totp/setup`

Request:

```json
{
  "enrollment_token": "..."
}
```

Success `200`:

```json
{
  "data": {
    "enrollment_token": "...",
    "secret": "BASE32SECRET",
    "otpauth_uri": "otpauth://totp/...",
    "expires_at": "2026-07-29T10:15:00.000Z"
  }
}
```

The secret is encrypted at rest before it is returned. Repeating this operation
for the same active enrollment returns the same secret. Never log the secret or
`otpauth_uri`.

Errors are `401 invalid_enrollment_token` for a missing, expired, consumed, or
wrong-role token and `409 enrollment_state_changed` for a concurrent state
change.

## `POST /api/auth/{admin|portal}/totp/verify`

This path has two mutually exclusive request modes.

TOTP enrollment mode:

```json
{
  "enrollment_token": "...",
  "code": "123456"
}
```

Success is the common session response plus:

```json
{
  "recovery_codes": ["ABCD-EFGH-JK23"]
}
```

The actual array contains ten codes. Successful enrollment marks activation
complete, issues a session, and replaces any old recovery-code set.

Login verification mode with TOTP:

```json
{
  "challenge_id": "chl_...",
  "code": "123456"
}
```

Login verification mode with a one-time recovery code:

```json
{
  "challenge_id": "chl_...",
  "recovery_code": "ABCD-EFGH-JK23"
}
```

Supply exactly one of `code` or `recovery_code`. Successful login verification
returns the common session response. A TOTP counter cannot be accepted twice,
and a recovery code is atomically marked used.

Errors include `401 invalid_enrollment_token`, `401 invalid_challenge`,
`401 invalid_totp_code`, `409 enrollment_state_changed`, and
`409 challenge_consumed`.

## `POST /api/auth/{admin|portal}/login`

Request:

```json
{
  "email": "admin@example.com",
  "password": "..."
}
```

Success `200`:

```json
{
  "data": {
    "challenge_id": "chl_...",
    "requires_totp": true,
    "expires_at": "2026-07-29T10:05:00.000Z"
  }
}
```

The challenge expires after five minutes and is bound to the request IP,
user-agent hash, and role-specific entry path. Authentication failures,
disabled/incomplete accounts, wrong-role use, and account lockout all return
the same `401 invalid_credentials` envelope. This avoids disclosing account
state.

## `GET /api/auth/me`

Requires a valid `__Host-va_session` cookie.

Success `200` is the common session response. Missing, expired, idle-expired,
revoked, or disabled-user sessions return `401 authentication_required`.

## `POST /api/auth/{admin|portal}/password/change`

Changes the password for the role-matching signed-in account. Send the active
session Cookie together with the exact same-origin CSRF headers:

```http
Origin: https://your-va-portal.example
X-CSRF-Token: <csrf_token returned by login verification or /api/auth/me>
Content-Type: application/json
```

Request:

```json
{
  "current_password": "...",
  "new_password": "...",
  "totp_code": "123456"
}
```

The request does not accept an email or role. The URL path and current session
must identify the same role. The current password is verified before the TOTP
counter is consumed. The new password must be 14–128 characters, contain an
uppercase letter, lowercase letter, number, and symbol, and differ from the
current password. The TOTP code must be current and unused. Local Portal auth
bypass never bypasses this step-up check.

Success `200`:

```json
{
  "data": {
    "password_changed_at": "2026-08-02T10:30:00.000Z",
    "revoked_sessions": 2
  }
}
```

The password update, `auth.password_change` success audit event, revocation of
every other active session, and consumption of outstanding login challenges
are committed in one D1 batch. The requesting session and its CSRF token remain
valid so the current device can continue without another login. TOTP enrollment
and recovery codes are unchanged.

New login challenges carry an opaque credential version derived from the
password record. Challenge creation, TOTP/recovery verification, and the final
session insert all re-check that version, so a request that verified the old
password cannot finish after a concurrent password change. Migration
`0021_auth_challenge_credential_version.sql` must be applied before deploying
Worker code that reads this field.

Operation-specific errors:

| HTTP  | Code                          | Meaning                                                        |
| ----- | ----------------------------- | -------------------------------------------------------------- |
| `401` | `invalid_current_password`    | The supplied current password is incorrect.                    |
| `401` | `invalid_totp_code`           | The TOTP code is invalid, expired, or already used.            |
| `403` | `forbidden`                   | The session role does not match the Admin or Portal path.      |
| `409` | `password_change_unavailable` | The account has no active password record, including bypass.   |
| `409` | `password_change_conflict`    | Account credentials changed concurrently; refresh and retry.   |
| `422` | `password_unchanged`          | The new password matches the current password.                 |
| `422` | `validation_error`            | The new password does not satisfy the password policy.         |
| `429` | `auth_rate_limited`           | The password or TOTP step-up attempt limit was exceeded.       |

## `POST /api/auth/logout`

With a valid session, send both:

```http
Origin: https://your-va-portal.example
X-CSRF-Token: <csrf_token returned by login verification or /api/auth/me>
```

The `Origin` value must exactly equal the request origin. Success is `204` with
an empty body and an expired session cookie. Calling logout without a valid
session is also idempotently successful with `204`; in that case no CSRF token
is required.

## Session cookie and CSRF contract

Successful TOTP enrollment or login verification sets:

```http
Set-Cookie: __Host-va_session=<opaque>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800
```

- Absolute session lifetime: 8 hours.
- Idle lifetime: 1 hour, refreshed after activity gaps longer than 5 minutes
  without extending past the absolute expiry.
- JavaScript cannot read the cookie; the browser sends it only over HTTPS.
- The cookie has no `Domain` attribute.
- The CSRF token is returned in JSON and is bound to the opaque session token.

For `/api/browser/v1/admin/*` and `/api/browser/v1/portal/*`, `GET`, `HEAD`, and
`OPTIONS` require only the role-matching session. Every other HTTP method
requires the exact same-origin `Origin` header and
`X-CSRF-Token: <csrf_token>`. Missing or mismatched values return
`403 invalid_origin` or `403 invalid_csrf_token`. A valid session for the wrong
browser API role returns `403 forbidden`.

## Common errors

All JSON errors use:

```json
{
  "error": {
    "code": "invalid_credentials",
    "message": "邮箱或密码不正确",
    "details": {}
  }
}
```

`details` is optional. Messages may be localized; clients must branch on
`error.code`.

| HTTP  | Code                   | Applies when                                                 |
| ----- | ---------------------- | ------------------------------------------------------------ |
| `400` | `invalid_json`         | Body is not valid JSON or is not a JSON object.              |
| `401` | endpoint-specific code | Credential, token, challenge, or session is invalid.         |
| `403` | `invalid_origin`       | Unsafe session request lacks the exact same origin.          |
| `403` | `invalid_csrf_token`   | Unsafe session request lacks the session-bound token.        |
| `403` | `forbidden`            | Valid session has the wrong role.                            |
| `404` | `not_found`            | Authentication path does not exist or is retired.            |
| `405` | `method_not_allowed`   | Path exists but the HTTP method is unsupported.              |
| `409` | endpoint-specific code | One-time state was consumed or changed.                      |
| `413` | `payload_too_large`    | JSON body exceeds 16 KB.                                     |
| `422` | `validation_error`     | Password or request field validation failed.                 |
| `429` | `auth_rate_limited`    | Coarse or D1 authentication rate limit rejected the request. |
| `503` | `auth_unavailable`     | A required authentication secret/binding is unavailable.     |

`429` responses include `Retry-After`. No authentication endpoint returns a
secret in an error response.

## Customer security center (P0-P2)

Authenticated customer routes now include:

- `GET /api/auth/customer/security/summary`
- `POST /api/auth/customer/security/sessions/:id/revoke`
- `POST /api/auth/customer/security/sessions/revoke-others`
- `POST /api/auth/customer/security/recovery-codes/regenerate`
- `POST /api/auth/customer/security/totp/replace/start`
- `POST /api/auth/customer/security/totp/replace/verify`
- `POST /api/auth/customer/security/email-change/request`
- `POST /api/auth/customer/security/email-change/apply`
- `POST /api/auth/customer/security/withdrawal-lock/{enable,request-unlock,confirm-unlock}`
- `POST /api/auth/customer/security/data-export`
- `POST /api/auth/customer/security/account-closure/{request,cancel}`
- `POST /api/auth/customer/passkey/register/{options,verify}`
- `POST /api/auth/customer/passkey/login/{options,verify}`
- `POST /api/auth/customer/passkey/:id/remove`

`POST /api/auth/customer/email-change/verify` consumes the purpose-bound token
from the new address without requiring an existing session. Applying the verified
address still requires a signed-in password and TOTP step-up after the 24-hour
cooling period. Password recovery remains a separate email-link flow and does not
require TOTP. See `docs/CUSTOMER_SECURITY_CENTER_RUNBOOK.md` for state, privacy,
migration, and acceptance boundaries.
