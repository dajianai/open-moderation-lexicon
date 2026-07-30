import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/api/config.js';

describe('loadConfig', () => {
  it('runs on defaults with an empty environment', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      maxTextLength: 20_000,
      maxBodyBytes: 1_048_576,
      batchMaxItems: 100,
      defaultMode: 'normalized',
      categories: ['all'],
      includeNeedsReview: false,
      minTermLength: 2,
      blockSeverities: ['high'],
      blockCategories: [],
      allowCategories: [],
      maskChar: '*',
      corsOrigin: null,
      rateLimitMax: 120,
      rateLimitWindow: '1 minute',
      apiToken: null,
      enableDocs: true,
      logText: false,
      trustProxy: false,
      precompileModes: ['normalized'],
      requestTimeoutMs: 30_000,
    });
  });

  it('reads every documented variable', () => {
    const config = loadConfig({
      HOST: '127.0.0.1',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      MAX_TEXT_LENGTH: '500',
      MAX_BODY_BYTES: '2048',
      BATCH_MAX_ITEMS: '25',
      DEFAULT_MODE: 'fuzzy',
      PRECOMPILE_MODES: 'normalized,fuzzy',
      LEXICON_CATEGORIES: 'adult, politics',
      LEXICON_MIN_TERM_LENGTH: '3',
      LEXICON_INCLUDE_NEEDS_REVIEW: 'true',
      POLICY_BLOCK_SEVERITIES: 'medium,high',
      POLICY_BLOCK_CATEGORIES: 'weapons-explosives',
      POLICY_ALLOW_CATEGORIES: 'advertising',
      MASK_CHAR: '#',
      CORS_ORIGIN: 'https://a.example, https://b.example',
      RATE_LIMIT_MAX: '10',
      RATE_LIMIT_WINDOW: '30 seconds',
      API_TOKEN: '  secret  ',
      ENABLE_DOCS: 'false',
      LOG_TEXT: 'yes',
      TRUST_PROXY: '1',
      REQUEST_TIMEOUT_MS: '5000',
    });
    expect(config).toEqual({
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'debug',
      maxTextLength: 500,
      maxBodyBytes: 2048,
      batchMaxItems: 25,
      defaultMode: 'fuzzy',
      precompileModes: ['normalized', 'fuzzy'],
      categories: ['adult', 'politics'],
      minTermLength: 3,
      includeNeedsReview: true,
      blockSeverities: ['medium', 'high'],
      blockCategories: ['weapons-explosives'],
      allowCategories: ['advertising'],
      maskChar: '#',
      corsOrigin: ['https://a.example', 'https://b.example'],
      rateLimitMax: 10,
      rateLimitWindow: '30 seconds',
      apiToken: 'secret',
      enableDocs: false,
      logText: true,
      trustProxy: true,
      requestTimeoutMs: 5000,
    });
  });

  it('treats an empty value as unset', () => {
    const config = loadConfig({
      PORT: '',
      MASK_CHAR: '',
      API_TOKEN: '   ',
      CORS_ORIGIN: '  ',
    });
    expect(config.port).toBe(3000);
    expect(config.maskChar).toBe('*');
    // An empty token must not enable authentication with an empty secret.
    expect(config.apiToken).toBeNull();
    expect(config.corsOrigin).toBeNull();
  });

  it('interprets the CORS shorthands', () => {
    expect(loadConfig({ CORS_ORIGIN: '*' }).corsOrigin).toBe(true);
    expect(loadConfig({ CORS_ORIGIN: 'false' }).corsOrigin).toBe(false);
    expect(loadConfig({ CORS_ORIGIN: 'https://one.example' }).corsOrigin).toEqual([
      'https://one.example',
    ]);
  });

  it('accepts the documented boolean spellings', () => {
    for (const value of ['1', 'true', 'yes', 'on', 'TRUE', ' On ']) {
      expect(loadConfig({ LOG_TEXT: value }).logText, value).toBe(true);
    }
    for (const value of ['0', 'false', 'no', 'off', 'FALSE']) {
      expect(loadConfig({ LOG_TEXT: value }).logText, value).toBe(false);
    }
  });

  it('rejects a non-boolean boolean', () => {
    expect(() => loadConfig({ ENABLE_DOCS: 'maybe' })).toThrow(ConfigError);
    expect(() => loadConfig({ ENABLE_DOCS: 'maybe' })).toThrow(/must be a boolean/);
  });

  it('rejects a non-integer number', () => {
    expect(() => loadConfig({ PORT: 'http' })).toThrow(/must be an integer/);
  });

  it('rejects a number out of range', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow(/between 1 and 65535/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/between 1 and 65535/);
    expect(() => loadConfig({ MAX_BODY_BYTES: '10' })).toThrow(/between 1024/);
    expect(() => loadConfig({ BATCH_MAX_ITEMS: '0' })).toThrow(/between 1 and 10000/);
    expect(() => loadConfig({ REQUEST_TIMEOUT_MS: '10' })).toThrow(/between 1000/);
  });

  it('rejects an unsupported mode', () => {
    expect(() => loadConfig({ DEFAULT_MODE: 'semantic' })).toThrow(
      /DEFAULT_MODE must be one of exact, normalized, fuzzy/,
    );
    expect(() => loadConfig({ PRECOMPILE_MODES: 'normalized,semantic' })).toThrow(
      /PRECOMPILE_MODES contains an unsupported mode/,
    );
  });

  it('rejects an unknown severity', () => {
    expect(() => loadConfig({ POLICY_BLOCK_SEVERITIES: 'critical' })).toThrow(
      /POLICY_BLOCK_SEVERITIES must contain only low, medium, high/,
    );
  });

  it('rejects a mask character that is not one code point', () => {
    expect(() => loadConfig({ MASK_CHAR: 'ab' })).toThrow(
      /exactly one Unicode code point/,
    );
    // An astral character is a single code point and is therefore accepted.
    expect(loadConfig({ MASK_CHAR: '🚫' }).maskChar).toBe('🚫');
  });

  it('defaults precompileModes to the default mode', () => {
    expect(loadConfig({ DEFAULT_MODE: 'exact' }).precompileModes).toEqual(['exact']);
  });
});
