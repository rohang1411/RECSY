import { describe, expect, it } from 'vitest';
import { extractByokFromHeaders } from './byok-parser';
import { ByokError } from '@/lib/errors';

describe('extractByokFromHeaders', () => {
  it('returns null when no key header is supplied', () => {
    expect(extractByokFromHeaders({})).toBeNull();
  });

  it('returns null when key is too short', () => {
    expect(extractByokFromHeaders({ 'x-recsy-user-key': 'short' })).toBeNull();
  });

  it('extracts valid user key, provider, and mode from record headers', () => {
    const headers = {
      'x-recsy-user-key': 'gsk_valid_groq_api_key_12345678',
      'x-recsy-user-provider': 'groq',
      'x-recsy-user-mode': 'deep',
    };
    const result = extractByokFromHeaders(headers);
    expect(result).toEqual({
      apiKey: 'gsk_valid_groq_api_key_12345678',
      provider: 'groq',
      userMode: 'deep',
    });
  });

  it('handles Web Standard Headers object', () => {
    const headers = new Headers();
    headers.set('x-recsy-user-key', 'AIzaSy_gemini_user_key_987654321');
    headers.set('x-recsy-user-provider', 'gemini');
    headers.set('x-recsy-user-mode', 'fast');

    const result = extractByokFromHeaders(headers);
    expect(result).toEqual({
      apiKey: 'AIzaSy_gemini_user_key_987654321',
      provider: 'gemini',
      userMode: 'fast',
    });
  });

  it('defaults provider to gemini and mode to fast when unspecified', () => {
    const headers = {
      'x-recsy-user-key': 'some_generic_api_key_12345678',
    };
    const result = extractByokFromHeaders(headers);
    expect(result).toEqual({
      apiKey: 'some_generic_api_key_12345678',
      provider: 'gemini',
      userMode: 'fast',
    });
  });

  it('supports openrouter and openai providers', () => {
    const orHeaders = {
      'x-recsy-user-key': 'sk-or-v1-123456789012345678',
      'x-recsy-user-provider': 'openrouter',
    };
    expect(extractByokFromHeaders(orHeaders)?.provider).toBe('openrouter');

    const oaiHeaders = {
      'x-recsy-user-key': 'sk-proj-123456789012345678',
      'x-recsy-user-provider': 'openai',
    };
    expect(extractByokFromHeaders(oaiHeaders)?.provider).toBe('openai');
  });

  it('throws ByokError 400 BYOK_UNSUPPORTED on unknown provider', () => {
    const headers = {
      'x-recsy-user-key': 'some_generic_api_key_12345678',
      'x-recsy-user-provider': 'unsupported_provider_xyz',
    };
    expect(() => extractByokFromHeaders(headers)).toThrow(ByokError);
    try {
      extractByokFromHeaders(headers);
    } catch (err) {
      expect(err).toBeInstanceOf(ByokError);
      const byokErr = err as ByokError;
      expect(byokErr.code).toBe('BYOK_UNSUPPORTED');
      expect(byokErr.status).toBe(400);
    }
  });
});
