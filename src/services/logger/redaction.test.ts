import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { emailRef } from './index';

describe('Logger Redaction and emailRef', () => {
  it('redacts sensitive fields and headers from serialised JSON', () => {
    let output = '';
    const destination = {
      write(msg: string) {
        output += msg;
      },
    };

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
        redact: { paths: REDACT_PATHS, remove: true },
      },
      destination,
    );

    testLogger.info(
      {
        password: 'SUPER_SECRET_PASSWORD',
        apiKey: 'SECRET_API_KEY_123',
        userByokKey: 'BYOK_SECRET_456',
        email: 'user@example.com',
        clientSecret: 'SECRET_CLIENT_789',
        headers: {
          authorization: 'Bearer SECRET_TOKEN',
          cookie: 'sb-auth=SUPER_SECRET_COOKIE',
          'stripe-signature': 't=123,v1=SIGNATURE_SECRET',
          'x-turnstile-token': 'TURNSTILE_TOKEN_VAL',
          'x-recsy-user-key': 'RECSY_KEY_VAL',
        },
      },
      'sensitive event',
    );

    expect(output).not.toContain('SUPER_SECRET_PASSWORD');
    expect(output).not.toContain('SECRET_API_KEY_123');
    expect(output).not.toContain('BYOK_SECRET_456');
    expect(output).not.toContain('user@example.com');
    expect(output).not.toContain('SECRET_CLIENT_789');
    expect(output).not.toContain('Bearer SECRET_TOKEN');
    expect(output).not.toContain('SUPER_SECRET_COOKIE');
    expect(output).not.toContain('SIGNATURE_SECRET');
    expect(output).not.toContain('TURNSTILE_TOKEN_VAL');
    expect(output).not.toContain('RECSY_KEY_VAL');
  });

  describe('emailRef', () => {
    it('produces a deterministic 8-character hex digest', () => {
      const ref1 = emailRef('user@example.com');
      const ref2 = emailRef('USER@EXAMPLE.COM ');
      expect(ref1).toHaveLength(8);
      expect(ref1).toBe(ref2);
      expect(/^[0-9a-f]{8}$/.test(ref1)).toBe(true);
    });

    it('returns "none" for missing or empty emails', () => {
      expect(emailRef(null)).toBe('none');
      expect(emailRef(undefined)).toBe('none');
      expect(emailRef('')).toBe('none');
      expect(emailRef('   ')).toBe('none');
    });
  });
});
