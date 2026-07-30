/**
 * JSON Schemas for every request and response body.
 *
 * Requests are validated by Fastify's Ajv instance; responses are validated and
 * serialized by fast-json-stringify, which also guarantees that no unexpected field
 * (for example an internal path) can leak into a response.
 */
import { MATCH_MODES, SEVERITIES } from '../../core/types.js';
import { ERROR_CODES } from '../errors.js';

/** Shared definitions, registered once under `$id`s. */
export const sharedSchemas = [
  {
    $id: 'oml:error',
    type: 'object',
    additionalProperties: false,
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', const: false },
      error: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'message', 'requestId'],
        properties: {
          code: { type: 'string', enum: Object.values(ERROR_CODES) },
          message: { type: 'string' },
          requestId: { type: 'string' },
          details: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
  {
    $id: 'oml:match',
    type: 'object',
    additionalProperties: false,
    required: [
      'term',
      'matchedText',
      'category',
      'severity',
      'matchType',
      'start',
      'end',
    ],
    properties: {
      term: { type: 'string', description: 'The lexicon term that matched.' },
      matchedText: {
        type: 'string',
        description: 'Exact substring of the submitted text that matched.',
      },
      category: { type: 'string' },
      severity: { type: 'string', enum: [...SEVERITIES] },
      matchType: {
        type: 'string',
        enum: [...MATCH_MODES],
        description:
          'Weakest rule required for this occurrence: exact (literal), normalized (after Unicode/case/traditional folding) or fuzzy (heuristic).',
      },
      start: {
        type: 'integer',
        minimum: 0,
        description: 'Inclusive start offset in Unicode code points.',
      },
      end: {
        type: 'integer',
        minimum: 0,
        description: 'Exclusive end offset in Unicode code points.',
      },
    },
  },
  {
    $id: 'oml:moderationResult',
    type: 'object',
    additionalProperties: false,
    required: [
      'matched',
      'decision',
      'riskLevel',
      'hitCount',
      'uniqueTermCount',
      'categories',
      'matches',
      'lexicon',
    ],
    properties: {
      matched: { type: 'boolean', description: 'True when at least one term matched.' },
      decision: {
        type: 'string',
        enum: ['allow', 'review', 'block'],
        description:
          'Suggested action from the configured policy. Not a legal or regulatory conclusion.',
      },
      riskLevel: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
      hitCount: { type: 'integer', minimum: 0 },
      uniqueTermCount: { type: 'integer', minimum: 0 },
      categories: { type: 'array', items: { type: 'string' } },
      matches: { type: 'array', items: { $ref: 'oml:match#' } },
      maskedText: { type: 'string' },
      lexicon: {
        type: 'object',
        additionalProperties: false,
        required: ['version', 'upstreamCommit'],
        properties: {
          version: { type: 'string' },
          upstreamCommit: { type: ['string', 'null'] },
        },
      },
    },
  },
] as const;

/** Options object accepted by both moderate endpoints. */
function optionsSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      mode: {
        type: 'string',
        enum: [...MATCH_MODES],
        description: 'Matching mode. Defaults to the server default (normalized).',
      },
      categories: {
        type: 'array',
        minItems: 1,
        maxItems: 200,
        items: { type: 'string', minLength: 1, maxLength: 64 },
        description:
          'Category ids to match against. Use ["all"] for the default selection or ["*"] for every loaded category.',
      },
      returnMatches: { type: 'boolean', default: true },
      maxMatches: { type: 'integer', minimum: 0, maximum: 100000 },
      overlap: { type: 'string', enum: ['all', 'leftmost-longest'] },
      mask: { type: 'boolean', default: false },
      // A single code point is at most two UTF-16 code units; the exact check happens
      // in the handler so the error code can be specific.
      maskChar: { type: 'string', minLength: 1, maxLength: 2 },
      allowlist: {
        type: 'array',
        maxItems: 1000,
        items: { type: 'string', minLength: 1, maxLength: 256 },
      },
    },
  } as const;
}

/** Schema for `POST /v1/moderate`. */
export function moderateSchema(maxTextLength: number) {
  return {
    summary: 'Check one text against the lexicon',
    description:
      'Returns keyword matches, a suggested decision and an optional masked text. Offsets are Unicode code point offsets of the submitted text.',
    tags: ['moderation'],
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: {
          type: 'string',
          minLength: 1,
          maxLength: maxTextLength,
          pattern: '\\S',
          description:
            'Text to check. Must contain at least one non-whitespace character.',
        },
        options: optionsSchema(),
      },
    },
    response: {
      200: {
        type: 'object',
        additionalProperties: false,
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', const: true },
          data: { $ref: 'oml:moderationResult#' },
        },
      },
      400: { $ref: 'oml:error#' },
      401: { $ref: 'oml:error#' },
      413: { $ref: 'oml:error#' },
      415: { $ref: 'oml:error#' },
      429: { $ref: 'oml:error#' },
      500: { $ref: 'oml:error#' },
      503: { $ref: 'oml:error#' },
    },
  } as const;
}

/**
 * Schema for `POST /v1/moderate/batch`.
 *
 * `maxTextLength` is enforced per item inside the handler rather than by the schema, so
 * an oversized item fails on its own instead of rejecting the whole batch.
 */
export function batchSchema(batchMaxItems: number) {
  return {
    summary: 'Check up to N texts in one request',
    description:
      'Each item is processed independently: a malformed item fails without affecting the others. The HTTP status is 200 whenever the envelope itself is valid.',
    tags: ['moderation'],
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: batchMaxItems,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 128 },
              // Per-item text is validated in the handler so one bad item does not
              // reject the whole batch.
              text: {},
            },
          },
        },
        options: optionsSchema(),
      },
    },
    response: {
      200: {
        type: 'object',
        additionalProperties: false,
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'object',
            additionalProperties: false,
            required: ['results', 'summary'],
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'success'],
                  properties: {
                    id: { type: 'string' },
                    success: { type: 'boolean' },
                    data: { $ref: 'oml:moderationResult#' },
                    error: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['code', 'message'],
                      properties: {
                        code: { type: 'string', enum: Object.values(ERROR_CODES) },
                        message: { type: 'string' },
                        details: { type: 'object', additionalProperties: true },
                      },
                    },
                  },
                },
              },
              summary: {
                type: 'object',
                additionalProperties: false,
                required: ['total', 'succeeded', 'failed', 'matched'],
                properties: {
                  total: { type: 'integer', minimum: 0 },
                  succeeded: { type: 'integer', minimum: 0 },
                  failed: { type: 'integer', minimum: 0 },
                  matched: { type: 'integer', minimum: 0 },
                },
              },
            },
          },
        },
      },
      400: { $ref: 'oml:error#' },
      401: { $ref: 'oml:error#' },
      413: { $ref: 'oml:error#' },
      415: { $ref: 'oml:error#' },
      429: { $ref: 'oml:error#' },
      500: { $ref: 'oml:error#' },
      503: { $ref: 'oml:error#' },
    },
  } as const;
}

/** Schema for `GET /health`. */
export const healthSchema = {
  summary: 'Liveness and readiness probe',
  description:
    'Returns 200 when the lexicon is loaded and 503 while it is loading or after a load failure.',
  tags: ['system'],
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', const: true },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'version', 'uptimeSeconds', 'lexicon'],
          properties: {
            status: { type: 'string', enum: ['ok', 'loading', 'error'] },
            version: { type: 'string' },
            uptimeSeconds: { type: 'number', minimum: 0 },
            lexicon: {
              type: 'object',
              additionalProperties: false,
              required: ['loaded'],
              properties: {
                loaded: { type: 'boolean' },
                version: { type: 'string' },
                upstreamCommit: { type: ['string', 'null'] },
                termCount: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
      },
    },
    503: { $ref: 'oml:error#' },
  },
} as const;

/** Schema for `GET /v1/metadata`. */
export const metadataSchema = {
  summary: 'Lexicon and API metadata',
  tags: ['system'],
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', const: true },
        data: {
          type: 'object',
          additionalProperties: false,
          required: [
            'apiVersion',
            'lexiconVersion',
            'upstreamCommit',
            'termCount',
            'totalTermCount',
            'categories',
            'supportedModes',
            'defaults',
            'limits',
          ],
          properties: {
            apiVersion: { type: 'string' },
            lexiconVersion: { type: 'string' },
            upstreamCommit: { type: ['string', 'null'] },
            upstreamRepository: { type: 'string' },
            syncedAt: { type: ['string', 'null'] },
            builtAt: { type: 'string' },
            termCount: { type: 'integer', minimum: 0 },
            totalTermCount: { type: 'integer', minimum: 0 },
            categories: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'displayName',
                  'severity',
                  'termCount',
                  'defaultEnabled',
                ],
                properties: {
                  id: { type: 'string' },
                  displayName: { type: 'string' },
                  severity: { type: 'string', enum: [...SEVERITIES] },
                  termCount: { type: 'integer', minimum: 0 },
                  defaultEnabled: { type: 'boolean' },
                  description: { type: 'string' },
                },
              },
            },
            supportedModes: {
              type: 'array',
              items: { type: 'string', enum: [...MATCH_MODES] },
            },
            defaults: {
              type: 'object',
              additionalProperties: false,
              required: ['mode', 'overlap', 'maskChar', 'blockSeverities'],
              properties: {
                mode: { type: 'string', enum: [...MATCH_MODES] },
                overlap: { type: 'string' },
                maskChar: { type: 'string' },
                blockSeverities: {
                  type: 'array',
                  items: { type: 'string', enum: [...SEVERITIES] },
                },
              },
            },
            limits: {
              type: 'object',
              additionalProperties: false,
              required: ['maxTextLength', 'maxBodyBytes', 'batchMaxItems'],
              properties: {
                maxTextLength: { type: 'integer' },
                maxBodyBytes: { type: 'integer' },
                batchMaxItems: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    401: { $ref: 'oml:error#' },
    503: { $ref: 'oml:error#' },
  },
} as const;
