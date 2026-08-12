import { coreApi } from './core-api';

function response(input: {
  ok?: boolean;
  status?: number;
  contentType?: string;
  payload?: unknown;
  jsonError?: Error;
}) {
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    headers: { get: () => input.contentType ?? 'application/json' },
    json: input.jsonError
      ? jest.fn().mockRejectedValue(input.jsonError)
      : jest.fn().mockResolvedValue(input.payload),
  } as unknown as Response;
}

describe('coreApi response validation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a successful HTML fallback instead of returning null to the page', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      response({ contentType: 'text/html', payload: '<html />' })
    );

    await expect(coreApi('/customers')).rejects.toThrow('API 响应格式无效');
  });

  it('rejects malformed JSON on a successful response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      response({ jsonError: new SyntaxError('invalid JSON') })
    );

    await expect(coreApi('/customers')).rejects.toThrow('API 响应格式无效');
  });

  it('returns a valid JSON payload', async () => {
    const payload = [{ id: 'customer_test' }];
    jest.spyOn(global, 'fetch').mockResolvedValue(response({ payload }));

    await expect(coreApi('/customers')).resolves.toEqual(payload);
  });
});
