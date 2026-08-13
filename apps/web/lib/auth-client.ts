import { createAuthClient } from 'better-auth/react';
import { API_URL } from './config';

/**
 * Better Auth browser client, pointed at the Bun API which owns /api/auth/*.
 * `signIn.social({ provider: 'google' })` starts the OAuth redirect.
 */
export const authClient = createAuthClient({ baseURL: API_URL });
