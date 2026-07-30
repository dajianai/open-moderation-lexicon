/**
 * Server configuration.
 *
 * Every knob is read from the environment. No secret is ever read from a file in the
 * repository, and no configuration value can be supplied by an API client.
 */
import {
  MATCH_MODES,
  SEVERITIES,
  type MatchMode,
  type Severity,
} from '../core/types.js';

/** Resolved server configuration. */
export interface ServerConfig {
  host: string;
  port: number;
  logLevel: string;
  /** Maximum accepted text length, in UTF-16 code units. */
  maxTextLength: number;
  /** Maximum accepted request body size in bytes. */
  maxBodyBytes: number;
  /** Maximum number of items in a batch request. */
  batchMaxItems: number;
  defaultMode: MatchMode;
  /** Categories to load. `['all']` uses the default selection. */
  categories: string[];
  includeNeedsReview: boolean;
  minTermLength: number;
  blockSeverities: Severity[];
  blockCategories: string[];
  allowCategories: string[];
  maskChar: string;
  /** CORS origins; `null` disables the CORS plugin entirely. */
  corsOrigin: string[] | boolean | null;
  rateLimitMax: number;
  rateLimitWindow: string;
  /** Optional bearer token required on `/v1/*`. */
  apiToken: string | null;
  enableDocs: boolean;
  /** Log the submitted text. Off by default; turning it on logs user content. */
  logText: boolean;
  trustProxy: boolean;
  /** Modes compiled at startup so the first request is not slow. */
  precompileModes: MatchMode[];
  requestTimeoutMs: number;
}

/** Raised for an invalid environment variable. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function readString(env: Env, key: string, fallback: string): string {
  const value = env[key];
  return value === undefined || value === '' ? fallback : value;
}

function readInt(
  env: Env,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) {
    throw new ConfigError(`${key} must be an integer, received "${raw}"`);
  }
  if (value < min || value > max) {
    throw new ConfigError(
      `${key} must be between ${min} and ${max}, received ${value}`,
    );
  }
  return value;
}

function readBoolean(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new ConfigError(`${key} must be a boolean, received "${raw}"`);
}

function readList(env: Env, key: string, fallback: string[]): string[] {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** Build the configuration from an environment. */
export function loadConfig(env: Env = process.env): ServerConfig {
  const defaultMode = readString(env, 'DEFAULT_MODE', 'normalized');
  if (!MATCH_MODES.includes(defaultMode as MatchMode)) {
    throw new ConfigError(
      `DEFAULT_MODE must be one of ${MATCH_MODES.join(', ')}, received "${defaultMode}"`,
    );
  }
  const blockSeverities = readList(env, 'POLICY_BLOCK_SEVERITIES', ['high']);
  for (const severity of blockSeverities) {
    if (!SEVERITIES.includes(severity as Severity)) {
      throw new ConfigError(
        `POLICY_BLOCK_SEVERITIES must contain only ${SEVERITIES.join(', ')}, received "${severity}"`,
      );
    }
  }
  const maskChar = readString(env, 'MASK_CHAR', '*');
  if ([...maskChar].length !== 1) {
    throw new ConfigError('MASK_CHAR must be exactly one Unicode code point');
  }

  const corsRaw = env.CORS_ORIGIN;
  let corsOrigin: string[] | boolean | null;
  if (corsRaw === undefined || corsRaw.trim() === '') corsOrigin = null;
  else if (corsRaw.trim() === '*') corsOrigin = true;
  else if (corsRaw.trim().toLowerCase() === 'false') corsOrigin = false;
  else corsOrigin = readList(env, 'CORS_ORIGIN', []);

  const precompile = readList(env, 'PRECOMPILE_MODES', [defaultMode]);
  for (const mode of precompile) {
    if (!MATCH_MODES.includes(mode as MatchMode)) {
      throw new ConfigError(`PRECOMPILE_MODES contains an unsupported mode: "${mode}"`);
    }
  }

  return {
    host: readString(env, 'HOST', '0.0.0.0'),
    port: readInt(env, 'PORT', 3000, 1, 65535),
    logLevel: readString(env, 'LOG_LEVEL', 'info'),
    maxTextLength: readInt(env, 'MAX_TEXT_LENGTH', 20_000, 1, 10_000_000),
    maxBodyBytes: readInt(env, 'MAX_BODY_BYTES', 1_048_576, 1024, 268_435_456),
    batchMaxItems: readInt(env, 'BATCH_MAX_ITEMS', 100, 1, 10_000),
    defaultMode: defaultMode as MatchMode,
    categories: readList(env, 'LEXICON_CATEGORIES', ['all']),
    includeNeedsReview: readBoolean(env, 'LEXICON_INCLUDE_NEEDS_REVIEW', false),
    minTermLength: readInt(env, 'LEXICON_MIN_TERM_LENGTH', 2, 1, 64),
    blockSeverities: blockSeverities as Severity[],
    blockCategories: readList(env, 'POLICY_BLOCK_CATEGORIES', []),
    allowCategories: readList(env, 'POLICY_ALLOW_CATEGORIES', []),
    maskChar,
    corsOrigin,
    rateLimitMax: readInt(env, 'RATE_LIMIT_MAX', 120, 1, 1_000_000),
    rateLimitWindow: readString(env, 'RATE_LIMIT_WINDOW', '1 minute'),
    apiToken:
      env.API_TOKEN && env.API_TOKEN.trim() !== '' ? env.API_TOKEN.trim() : null,
    enableDocs: readBoolean(env, 'ENABLE_DOCS', true),
    logText: readBoolean(env, 'LOG_TEXT', false),
    trustProxy: readBoolean(env, 'TRUST_PROXY', false),
    precompileModes: precompile as MatchMode[],
    requestTimeoutMs: readInt(env, 'REQUEST_TIMEOUT_MS', 30_000, 1000, 600_000),
  };
}
