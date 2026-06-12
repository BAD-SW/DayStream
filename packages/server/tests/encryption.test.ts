import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/utils/encryption';

describe('Encryption', () => {
  it('encrypts and decrypts a string', () => {
    const plaintext = 'Hello, DayStream!';
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces different ciphertext for same input (random IV)', () => {
    const plaintext = 'same text';
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  it('detects tampered ciphertext', () => {
    const ciphertext = encrypt('secret data that is long enough to tamper reliably');
    const parts = ciphertext.split(':');
    // Tamper with the auth tag to guarantee authentication failure
    parts[1] = '0'.repeat(parts[1].length);
    const tampered = parts.join(':');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('handles empty string', () => {
    const plaintext = '';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe('');
  });

  it('handles unicode', () => {
    const plaintext = '日本語テスト 🎉 Ñoño';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });
});
