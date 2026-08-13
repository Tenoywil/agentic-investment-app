import { describe, expect, test } from 'bun:test';
import { readSocialResult } from '../app/_lib/google-sign-in';

/**
 * The Google button did nothing, and this is the function that is why.
 *
 * Better Auth's client is a betterFetch wrapper: it RESOLVES with
 * `{ data, error }` and does not throw on an HTTP failure. Both entry points
 * were written as `signIn.social(...).catch(setError)`, so the catch was
 * unreachable for every ordinary failure — a 403 from CORS, a 500, a
 * misconfigured provider — and the screen showed nothing whatsoever. Reported
 * from a phone, twice, before it was found.
 *
 * So the shape of the resolved value is the contract that matters, and it is
 * the thing worth pinning down.
 */
describe('readSocialResult', () => {
  test('surfaces the message the service gave', () => {
    expect(readSocialResult({ error: { message: 'gateway refused', status: 500 } })).toEqual({
      error: 'gateway refused',
    });
  });

  test('falls back to the status text when there is no message', () => {
    expect(readSocialResult({ error: { statusText: 'Forbidden', status: 403 } })).toEqual({
      error: 'Forbidden',
    });
  });

  test('names the status when that is all there is', () => {
    expect(readSocialResult({ error: { status: 502 } })).toEqual({
      error: 'the sign-in service answered 502',
    });
  });

  /**
   * Status 0 is not a reply — it is the request never leaving the device. The
   * generic branch rendered "the sign-in service answered 0", which tells the
   * person holding the phone nothing they can act on.
   */
  test('translates a request that never left the device', () => {
    expect(readSocialResult({ error: { status: 0 } })).toEqual({
      error: 'Could not reach the sign-in service. Check your connection and try again.',
    });
  });

  test('never returns an empty message for an error', () => {
    const { error } = readSocialResult({ error: {} });
    expect(error).toBeTruthy();
  });

  /** The client normally redirects itself; a returned URL must still be used. */
  test('passes back a URL the client did not navigate to itself', () => {
    expect(
      readSocialResult({ data: { url: 'https://accounts.google.com/o/oauth2/v2/auth' } }),
    ).toEqual({ url: 'https://accounts.google.com/o/oauth2/v2/auth' });
  });

  test('reports neither url nor error when the client is navigating itself', () => {
    expect(readSocialResult({ data: { redirect: true } })).toEqual({});
  });

  test('survives a shape it does not recognise', () => {
    expect(readSocialResult(null)).toEqual({});
    expect(readSocialResult(undefined)).toEqual({});
    expect(readSocialResult('nope')).toEqual({});
  });
});
