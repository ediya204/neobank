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

  it('does not hide ordinary application errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
