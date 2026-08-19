import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const MAX_CLOCK_SKEW_SECONDS = 60;

export type EdgeSignatureInput = {
  body: Buffer;
  identity: string;
  method: string;
  nowSeconds?: number;
  requestTarget: string;
  secret: string;
  signature: string;
  timestamp: string;
};

export function edgeSignature(input: Omit<EdgeSignatureInput, 'nowSeconds' | 'signature'>) {
  const bodyHash = createHash('sha256').update(input.body).digest('hex');
  const canonical = [
    input.timestamp,
    input.method,
    input.requestTarget,
    input.identity,
    bodyHash,
  ].join('\n');
  return createHmac('sha256', input.secret).update(canonical).digest('hex');
}

export function verifyEdgeSignature(input: EdgeSignatureInput): boolean {
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS ||
    !input.identity ||
    !/^[a-f0-9]{64}$/i.test(input.signature)
  ) {
    return false;
  }
  const expected = Buffer.from(edgeSignature(input), 'hex');
  const provided = Buffer.from(input.signature, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function requestBodyForSignature(request: Request & { rawBody?: Buffer }): Buffer {
  if (request.rawBody && request.rawBody.length > 0) return request.rawBody;
  if (request.body === undefined || request.body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === 'string') return Buffer.from(request.body);
  return Buffer.from(JSON.stringify(request.body));
}

export function edgeAuthMiddleware(options: { adminUserId: string; secret: string }) {
  if (Buffer.byteLength(options.secret) < 32) {
    throw new Error('CORE_EDGE_SHARED_SECRET must be at least 32 bytes');
  }
  if (!options.adminUserId.trim()) {
    throw new Error('CORE_ADMIN_USER_ID is required');
  }

  return (request: Request & { rawBody?: Buffer }, response: Response, next: NextFunction) => {
    if (request.method === 'GET' && request.originalUrl.split('?', 1)[0] === '/api/v1/health') {
      next();
      return;
    }
    const identity = request.header('x-neobank-user')?.trim() || '';
    const timestamp = request.header('x-core-edge-timestamp')?.trim() || '';
    const signature = request.header('x-core-edge-signature')?.trim() || '';
    // Nest's rawBody capture can be empty behind a chunked reverse proxy even
    // though the JSON parser produced request.body. The Worker forwards
    // canonical JSON, so re-serializing the parsed value preserves the signed
    // bytes and keeps write requests authenticated without weakening the body
    // integrity check.
    const body = requestBodyForSignature(request);
    if (
      !verifyEdgeSignature({
        body,
        identity,
        method: request.method,
        requestTarget: request.originalUrl,
        secret: options.secret,
        signature,
        timestamp,
      })
    ) {
      response.status(401).json({ error: { code: 'unauthorized_edge_request' } });
      return;
    }
    request.headers['x-user-id'] = options.adminUserId;
    if (identity.startsWith('customer:')) {
      const separator = identity.indexOf(':', 'customer:'.length);
      const customerId = separator > 0 ? identity.slice('customer:'.length, separator) : '';
      const email = separator > 0 ? identity.slice(separator + 1) : '';
      if (!customerId || !email) {
        response.status(401).json({ error: { code: 'unauthorized_edge_request' } });
        return;
      }
      request.headers['x-authenticated-role'] = 'customer';
      request.headers['x-authenticated-customer-id'] = customerId;
      request.headers['x-authenticated-email'] = email;
    } else {
      request.headers['x-authenticated-role'] = 'admin';
      request.headers['x-authenticated-email'] = identity.startsWith('admin:')
        ? identity.slice('admin:'.length)
        : identity;
    }
    next();
  };
}
