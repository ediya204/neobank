interface Env {
  ASSETS: Fetcher;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  NEOBANK_ADMIN_EMAILS: string;
  GO_API_BASE_URL: string;
  GO_EDGE_SHARED_SECRET: string;
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
