import { describe, expect, test } from 'bun:test';
import { FieldDecryptionError, createFieldCipher, parseKeyMaterial } from './field-crypto';

const keyA = { id: 'k1', material: new Uint8Array(32).fill(7) };
const keyB = { id: 'k2', material: new Uint8Array(32).fill(9) };

/** Deterministic IVs so envelopes are reproducible in assertions. */
const fixedRandom = (size: number) => new Uint8Array(size).fill(3);

describe('parseKeyMaterial', () => {
  test('accepts 64-char hex', () => {
    expect(parseKeyMaterial('ab'.repeat(32)).length).toBe(32);
  });

  test('accepts base64url', () => {
    const encoded = Buffer.from(new Uint8Array(32).fill(1)).toString('base64url');
    expect(parseKeyMaterial(encoded).length).toBe(32);
  });

  test('rejects a key of the wrong length instead of padding it', () => {
    expect(() => parseKeyMaterial('abcd')).toThrow(/must be 32 bytes/);
    expect(() => parseKeyMaterial('ab'.repeat(16))).toThrow(/must be 32 bytes/);
  });
});

describe('round trip', () => {
  test('encrypts and decrypts under a matching context', async () => {
    const cipher = createFieldCipher(keyA);
    const sealed = await cipher.encrypt('AB123456', 'kyc_documents.passport_ref:user-1');
    expect(await cipher.decrypt(sealed, 'kyc_documents.passport_ref:user-1')).toBe('AB123456');
  });

  test('handles empty strings and unicode', async () => {
    const cipher = createFieldCipher(keyA);
    for (const value of ['', 'Marcus Bailey', 'Kingston · Montego Bay 🇯🇲', 'x'.repeat(4096)]) {
      const sealed = await cipher.encrypt(value, 'ctx');
      expect(await cipher.decrypt(sealed, 'ctx')).toBe(value);
    }
  });

  test('produces a versioned envelope naming the key', async () => {
    const cipher = createFieldCipher(keyA, { randomBytes: fixedRandom });
    const sealed = await cipher.encrypt('secret', 'ctx');
    const [version, keyId] = sealed.split('.');
    expect(version).toBe('v1');
    expect(keyId).toBe('k1');
    expect(sealed.split('.')).toHaveLength(4);
  });

  test('a random IV makes repeated encryption of the same value differ', async () => {
    const cipher = createFieldCipher(keyA);
    const first = await cipher.encrypt('same', 'ctx');
    const second = await cipher.encrypt('same', 'ctx');
    expect(first).not.toBe(second);
    expect(await cipher.decrypt(second, 'ctx')).toBe('same');
  });

  test('the plaintext never appears in the envelope', async () => {
    const cipher = createFieldCipher(keyA);
    const sealed = await cipher.encrypt('BAILEY-PASSPORT-9931', 'ctx');
    expect(sealed).not.toContain('BAILEY');
    expect(sealed).not.toContain('9931');
  });
});

describe('context binding', () => {
  test('refuses to decrypt under a different context', async () => {
    const cipher = createFieldCipher(keyA);
    const sealed = await cipher.encrypt('AB123456', 'kyc.passport:user-1');
    // The relocation attack: same column, different owner.
    await expect(cipher.decrypt(sealed, 'kyc.passport:user-2')).rejects.toBeInstanceOf(
      FieldDecryptionError,
    );
  });

  test('refuses a ciphertext moved to another column', async () => {
    const cipher = createFieldCipher(keyA);
    const sealed = await cipher.encrypt('AB123456', 'kyc.passport:user-1');
    await expect(cipher.decrypt(sealed, 'kyc.tax_id:user-1')).rejects.toBeInstanceOf(
      FieldDecryptionError,
    );
  });
});

describe('tamper detection', () => {
  test('rejects a modified ciphertext body', async () => {
    const cipher = createFieldCipher(keyA);
    const sealed = await cipher.encrypt('AB123456', 'ctx');
    const parts = sealed.split('.');
    const body = parts[3] as string;
    // Flip one character of the payload.
    parts[3] = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
    await expect(cipher.decrypt(parts.join('.'), 'ctx')).rejects.toBeInstanceOf(
      FieldDecryptionError,
    );
  });

  test('rejects a swapped IV', async () => {
    const cipher = createFieldCipher(keyA);
    const one = (await cipher.encrypt('first', 'ctx')).split('.');
    const two = (await cipher.encrypt('second', 'ctx')).split('.');
    const frankenstein = [one[0], one[1], two[2], one[3]].join('.');
    await expect(cipher.decrypt(frankenstein, 'ctx')).rejects.toBeInstanceOf(FieldDecryptionError);
  });

  test('rejects a malformed or unversioned envelope', async () => {
    const cipher = createFieldCipher(keyA);
    for (const bad of ['', 'nonsense', 'v1.k1.only-three', 'v2.k1.aaaa.bbbb']) {
      await expect(cipher.decrypt(bad, 'ctx')).rejects.toBeInstanceOf(FieldDecryptionError);
    }
  });

  test('rejects an envelope naming an unknown key', async () => {
    const sealed = await createFieldCipher(keyB).encrypt('x', 'ctx');
    const onlyA = createFieldCipher(keyA);
    await expect(onlyA.decrypt(sealed, 'ctx')).rejects.toThrow(/unknown key id k2/);
  });

  test('rejects the right envelope under the wrong key', async () => {
    const sealed = await createFieldCipher(keyA).encrypt('x', 'ctx');
    // Same key id, different material — an attacker-supplied key must not open it.
    const impostor = createFieldCipher({ id: 'k1', material: new Uint8Array(32).fill(11) });
    await expect(impostor.decrypt(sealed, 'ctx')).rejects.toBeInstanceOf(FieldDecryptionError);
  });
});

describe('key rotation', () => {
  test('decrypts values written by a retired key', async () => {
    const old = createFieldCipher(keyA);
    const sealed = await old.encrypt('AB123456', 'ctx');

    const rotated = createFieldCipher(keyB, { previous: [keyA] });
    expect(await rotated.decrypt(sealed, 'ctx')).toBe('AB123456');
  });

  test('new writes use the new primary key', async () => {
    const rotated = createFieldCipher(keyB, { previous: [keyA] });
    const sealed = await rotated.encrypt('AB123456', 'ctx');
    expect(sealed.split('.')[1]).toBe('k2');
  });

  test('needsRotation flags stale and malformed envelopes only', async () => {
    const oldEnvelope = await createFieldCipher(keyA).encrypt('x', 'ctx');
    const rotated = createFieldCipher(keyB, { previous: [keyA] });
    const freshEnvelope = await rotated.encrypt('x', 'ctx');

    expect(rotated.needsRotation(oldEnvelope)).toBe(true);
    expect(rotated.needsRotation(freshEnvelope)).toBe(false);
    expect(rotated.needsRotation('garbage')).toBe(true);
  });
});

describe('construction guards', () => {
  test('rejects a key of the wrong size', () => {
    expect(() => createFieldCipher({ id: 'k', material: new Uint8Array(16) })).toThrow(
      /must be 32 bytes/,
    );
  });

  test('rejects a key id containing the envelope separator', () => {
    expect(() => createFieldCipher({ id: 'k.1', material: new Uint8Array(32) })).toThrow(
      /must not contain/,
    );
  });

  test('rejects duplicate key ids, which would make decryption ambiguous', () => {
    expect(() =>
      createFieldCipher(keyA, { previous: [{ id: 'k1', material: new Uint8Array(32).fill(1) }] }),
    ).toThrow(/duplicate key id/);
  });
});
