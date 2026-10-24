import { formatBytes, timeAgo, unwrap, unwrapAny } from './api';

describe('formatBytes', () => {
  it('scales to the largest whole unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB');
    expect(formatBytes(250 * 1024 ** 2)).toBe('250 MB');
  });

  it('accepts the string numbers the API sometimes returns', () => {
    expect(formatBytes('2048')).toBe('2.0 KB');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes('nope')).toBe('0 B');
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  it('uses coarse, readable steps', () => {
    expect(timeAgo('2026-06-01T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-06-01T11:45:00Z', now)).toBe('15 min ago');
    expect(timeAgo('2026-06-01T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-05-28T12:00:00Z', now)).toBe('4 d ago');
    expect(timeAgo(null, now)).toBe('');
  });
});

describe('unwrap', () => {
  it('returns data and throws the API message on errors', async () => {
    await expect(unwrap(Promise.resolve({ data: 42 }))).resolves.toBe(42);
    await expect(
      unwrap(Promise.resolve({ error: { message: 'Wrong password' }, response: new Response(null, { status: 401 }) }))
    ).rejects.toThrow('Wrong password');
  });

  it('unwrapAny accepts task snapshots from 409 responses', async () => {
    const busy = { current: { id: 'backup', status: 'running' } };
    await expect(unwrapAny(Promise.resolve({ error: busy }))).resolves.toBe(busy);
  });
});
