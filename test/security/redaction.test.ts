import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { emailRef } from '@/services/logger';

/**
 * Redaction & Secrets Protection Test Suite.
 * Normative reference: Plan 25 Section 10.7, Section 10.9.
 *
 * Verifies that structured logs NEVER leak sensitive credentials, tokens,
 * secrets, session cookies, or plaintext email addresses.
 */
describe('Logging Redaction & Secrets Protection', () => {
  it('redacts all sensitive header values, cookies, and secrets from JSON log output', async () => {
    let capturedLog = '';

    // Create a logger instance using the exact redaction configuration of recsy logger
    const REDACT_PATHS = [
      'password',
      '*.password',
      'apiKey',
      '*.apiKey',
      'authorization',
      'headers.authorization',
      'headers.cookie',
      'cookie',
      'token',
      '*.token',
      'userByokKey',
      '*.userByokKey',
      'headers.x-recsy-user-key',
      '*.x-recsy-user-key',
      'stripe-signature',
      '*.stripe-signature',
      'headers.stripe-signature',
      'x-turnstile-token',
      '*.x-turnstile-token',
      'headers.x-turnstile-token',
      'email',
      '*.email',
      'clientSecret',
      '*.clientSecret',
      'secret',
      '*.secret',
      'sb-*',
      '*.sb-*',
    ];

    const testLogger = pino(
      {
        level: 'info',
        redact: { paths: REDACT_PATHS, remove: true },
      },
      {
        write: (msg: string) => {
          capturedLog += msg;
        },
      },
    );

    const sensitiveFixture = {
      traceId: 'tr_1234567890abcdef',
      password: 'super-secret-password-123',
      apiKey: 'sk-live-fake-api-key-99999',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive_payload',
      userByokKey: 'gsk_live_1234567890abcdef',
      clientSecret: 'whsec_test_secret_stripe_987654',
      secret: 'very-secret-internal-key',
      email: 'user-to-redact@example.com',
      headers: {
        authorization: 'Bearer supabase_access_token_abc_xyz',
        cookie: 'sb-auth-token=secret_jwt; recsy_did=abc12345',
        'stripe-signature': 't=1700000000,v1=signature_hash_value',
        'x-turnstile-token': '0.cloudflare-turnstile-response-token',
        'x-recsy-user-key': 'user-provided-groq-key-777',
      },
      nested: {
        password: 'nested-secret-password',
        apiKey: 'nested-secret-key',
        email: 'nested-email@example.com',
        token: 'nested-token',
      },
    };

    testLogger.info(sensitiveFixture, 'test message with sensitive fixture');

    expect(capturedLog).toBeTruthy();

    // Verify none of the secret strings appear anywhere in the serialized log
    const forbiddenValues = [
      'super-secret-password-123',
      'sk-live-fake-api-key-99999',
      'sensitive_payload',
      'gsk_live_1234567890abcdef',
      'whsec_test_secret_stripe_987654',
      'very-secret-internal-key',
      'user-to-redact@example.com',
      'Bearer supabase_access_token_abc_xyz',
      'secret_jwt',
      'signature_hash_value',
      '0.cloudflare-turnstile-response-token',
      'user-provided-groq-key-777',
      'nested-secret-password',
      'nested-secret-key',
      'nested-email@example.com',
      'nested-token',
    ];

    for (const forbidden of forbiddenValues) {
      expect(capturedLog).not.toContain(forbidden);
    }

    // Verify safe non-sensitive attributes are preserved
    expect(capturedLog).toContain('tr_1234567890abcdef');
    expect(capturedLog).toContain('test message with sensitive fixture');
  });

  describe('emailRef', () => {
    it('returns "none" for null, undefined, or whitespace emails', () => {
      expect(emailRef(null)).toBe('none');
      expect(emailRef(undefined)).toBe('none');
      expect(emailRef('')).toBe('none');
      expect(emailRef('   ')).toBe('none');
    });

    it('returns an 8-character hex digest without leaking email content', () => {
      const email = 'alex.developer@example.com';
      const ref = emailRef(email);

      expect(ref).toMatch(/^[0-9a-f]{8}$/);
      expect(ref).not.toContain('alex');
      expect(ref).not.toContain('example');
    });

    it('is deterministic and case-insensitive', () => {
      const emailLower = 'user@example.com';
      const emailUpper = 'USER@EXAMPLE.COM';
      const emailSpaced = '  user@example.com  ';

      const ref1 = emailRef(emailLower);
      const ref2 = emailRef(emailUpper);
      const ref3 = emailRef(emailSpaced);

      expect(ref1).toBe(ref2);
      expect(ref2).toBe(ref3);
    });

    it('produces distinct digests for different emails', () => {
      const ref1 = emailRef('user1@example.com');
      const ref2 = emailRef('user2@example.com');

      expect(ref1).not.toBe(ref2);
    });
  });
});
