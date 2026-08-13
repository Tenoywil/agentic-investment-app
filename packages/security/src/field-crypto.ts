/**
 * Field-level encryption for PII and KYC references at rest.
 *
 * Supabase already encrypts the volume; this protects individual columns from
 * anything that can read the database but should not read identity material —
 * a leaked read-replica, a support query, an over-broad backup.
 *
 * **Primitive: AES-256-GCM via Web Crypto** (native in Bun, no dependency).
 * The plan sketched libsodium sealed boxes, but a sealed box is an *asymmetric*
 * construction for "anyone may encrypt, only the key holder may decrypt". Here the
 * same service both writes and reads the field, so authenticated symmetric
 * encryption is the correct — and simpler — primitive. Reach for a sealed box only
 * if a write-only producer is ever introduced.
 *
 * Two properties worth stating explicitly:
 *  - **Context binding.** Every value is bound with AAD to a caller-supplied context
 *    (`kyc_documents.passport_ref:<user-id>`). A ciphertext lifted from one row or
 *    column fails to decrypt in another, so an attacker with UPDATE cannot relocate
 *    someone else's identity blob onto their own record.
 *  - **Rotation.** The envelope carries the key id, so a new primary key can be
 *    introduced while old keys stay available for decryption. Rotation is a config
 *    change plus a re-encrypt sweep — never a schema change.
 *
 * Envelope: `v1.<keyId>.<iv base64url>.<ciphertext+tag base64url>`
 */

const VERSION = 'v1';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const KEY_BYTES = 32; // AES-256

export type FieldKey = {
  /** Short, stable identifier recorded in the envelope (e.g. "k1"). */
  id: string;
  /** 32 raw bytes. Supply via config; never hardcode. */
  material: Uint8Array;
};

export type FieldCipher = {
  /** Encrypt a value, binding it to `context`. */
  encrypt(plaintext: string, context: string): Promise<string>;
  /** Decrypt an envelope. Throws unless `context` matches the one used to encrypt. */
  decrypt(envelope: string, context: string): Promise<string>;
  /** True when the envelope was written by a key other than the current primary. */
  needsRotation(envelope: string): boolean;
};

export class FieldDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldDecryptionError';
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64url'));
}

/**
 * Decode a configured key. Accepts base64/base64url or 64-char hex, and requires
 * exactly 32 bytes — a short key is a configuration error, never silently padded.
 */
export function parseKeyMaterial(encoded: string): Uint8Array {
  const trimmed = encoded.trim();
  const bytes = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? new Uint8Array(Buffer.from(trimmed, 'hex'))
    : new Uint8Array(Buffer.from(trimmed, 'base64url'));
  if (bytes.length !== KEY_BYTES) {
    throw new Error(`field encryption key must be ${KEY_BYTES} bytes, got ${bytes.length}`);
  }
  return bytes;
}

/**
 * Build a cipher over a primary key plus any retired keys kept for decryption.
 * `randomBytes` is injected so tests are deterministic.
 */
export function createFieldCipher(
  primary: FieldKey,
  options: {
    previous?: readonly FieldKey[];
    randomBytes?: (size: number) => Uint8Array;
    subtle?: SubtleCrypto;
  } = {},
): FieldCipher {
  const subtle = options.subtle ?? globalThis.crypto.subtle;
  const randomBytes =
    options.randomBytes ??
    ((size: number) => globalThis.crypto.getRandomValues(new Uint8Array(size)));

  const all = [primary, ...(options.previous ?? [])];
  const seenIds = new Set<string>();
  for (const key of all) {
    if (key.material.length !== KEY_BYTES) {
      throw new Error(`key ${key.id} must be ${KEY_BYTES} bytes, got ${key.material.length}`);
    }
    if (key.id.includes('.')) throw new Error(`key id ${key.id} must not contain "."`);
    if (seenIds.has(key.id)) throw new Error(`duplicate key id ${key.id}`);
    seenIds.add(key.id);
  }

  const imported = new Map<string, Promise<CryptoKey>>();
  const keyFor = (id: string, material: Uint8Array): Promise<CryptoKey> => {
    const existing = imported.get(id);
    if (existing) return existing;
    // Defensive copy: importKey reads the view's range, and the caller keeps its own.
    const created = subtle.importKey('raw', material.slice(), 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
    imported.set(id, created);
    return created;
  };

  const aad = (context: string) => new TextEncoder().encode(context);

  return {
    async encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const key = await keyFor(primary.id, primary.material);
      const sealed = await subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(context) },
        key,
        new TextEncoder().encode(plaintext),
      );
      return [VERSION, primary.id, toBase64Url(iv), toBase64Url(new Uint8Array(sealed))].join('.');
    },

    async decrypt(envelope, context) {
      const parts = envelope.split('.');
      if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new FieldDecryptionError('malformed ciphertext envelope');
      }
      const [, keyId, ivText, payloadText] = parts as [string, string, string, string];
      const match = all.find((candidate) => candidate.id === keyId);
      if (!match) throw new FieldDecryptionError(`unknown key id ${keyId}`);

      const key = await keyFor(match.id, match.material);
      try {
        const opened = await subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64Url(ivText), additionalData: aad(context) },
          key,
          fromBase64Url(payloadText),
        );
        return new TextDecoder().decode(opened);
      } catch {
        // Wrong key, wrong context, or tampered bytes — indistinguishable by design.
        throw new FieldDecryptionError('ciphertext failed authentication');
      }
    },

    needsRotation(envelope) {
      const parts = envelope.split('.');
      if (parts.length !== 4 || parts[0] !== VERSION) return true;
      return parts[1] !== primary.id;
    },
  };
}
