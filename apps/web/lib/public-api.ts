import { API_URL } from './config';

/**
 * The unauthenticated brand surface — partner names, colors and uploaded
 * logos, for the signed-out landing page. No credentials: this must work for
 * a first-time visitor, and sending cookies to a public cacheable endpoint
 * would only make its caching worse.
 */

export interface PublicPartnerMark {
  id: string;
  code: string;
  name: string;
  kind: string | null;
  color: string | null;
  tint: string | null;
  hasLogo: boolean;
}

/** Where a partner's uploaded logo is served from, without a session. */
export function publicPartnerLogoUrl(id: string): string {
  return `${API_URL}/api/public/partner-logo/${id}`;
}

let marksPromise: Promise<PublicPartnerMark[]> | null = null;

/** The network's public marks, one shared in-flight request per page load;
 *  a failure clears the slot so the next caller retries. */
export function getPublicPartnerMarks(): Promise<PublicPartnerMark[]> {
  if (!marksPromise) {
    marksPromise = fetch(`${API_URL}/api/public/partner-marks`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        const body = (await res.json()) as { marks: PublicPartnerMark[] };
        return body.marks;
      })
      .catch((err) => {
        marksPromise = null;
        throw err;
      });
  }
  return marksPromise;
}
