interface Env {
  DB: D1Database;
  GO_D1_GATEWAY_SECRET: string;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface D1PreparedStatement {
  bind(...values: (string | number | null)[]): D1PreparedStatement;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface ExportedHandler<Bindings = unknown> {
  fetch(request: Request, env: Bindings, context: ExecutionContext): Response | Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
