import { isChunkLoadError } from './chunk-load-recovery';

describe('isChunkLoadError', () => {
  it.each([
    new Error('Loading chunk 817 failed.'),
    Object.assign(new Error('Loading chunk account-page failed.'), { name: 'ChunkLoadError' }),
    new TypeError('Failed to fetch dynamically imported module'),
    new TypeError('Importing a module script failed'),
  ])('recognizes recoverable chunk failures', (error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('recognizes a stale webpack module factory without masking ordinary call errors', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'call')");
    error.stack = `${error.name}: ${error.message}\n    at options.factory (bundle.js:242742:31)\n    at __webpack_require__ (bundle.js:242135:33)`;

    expect(isChunkLoadError(error)).toBe(true);
  });

  it('does not hide ordinary application errors', () => {
    expect(
      isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'call')"))
    ).toBe(false);
  });
});
