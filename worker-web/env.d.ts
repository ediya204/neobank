interface Env {
  ASSETS: Fetcher;
  GO_API_BASE_URL: string;
  GO_EDGE_SHARED_SECRET: string;
  CORE_API_BASE_URL: string;
  CORE_EDGE_SHARED_SECRET: string;
  CORE_ORGANIZATION_ID: string;
  CUSTOMER_AUTH_MAINTENANCE: string;
  ADMIN_AUTH_RATE_LIMITER: RateLimit;
  CUSTOMER_AUTH_RATE_LIMITER: RateLimit;
}

interface SubtleCrypto {
  timingSafeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface ExportedHandler<Bindings = unknown> {
  fetch(request: Request, env: Bindings, context: ExecutionContext): Response | Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
