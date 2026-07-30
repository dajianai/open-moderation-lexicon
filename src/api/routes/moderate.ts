/** `POST /v1/moderate` and `POST /v1/moderate/batch`. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError, ERROR_CODES, type ErrorCode } from '../errors.js';
import { batchSchema, moderateSchema } from '../schemas/index.js';
import { InvalidMaskCharError } from '../../core/masker.js';
import { ModerationInputError, type Moderator } from '../../moderator.js';
import {
  MATCH_MODES,
  type CheckOptions,
  type ModerationResult,
} from '../../core/types.js';
import type { ServerConfig } from '../config.js';

interface ModerateOptionsBody {
  mode?: string;
  categories?: string[];
  returnMatches?: boolean;
  maxMatches?: number;
  overlap?: 'all' | 'leftmost-longest';
  mask?: boolean;
  maskChar?: string;
  allowlist?: string[];
}

interface ModerateBody {
  text: string;
  options?: ModerateOptionsBody;
}

interface BatchBody {
  items: { id?: string; text?: unknown }[];
  options?: ModerateOptionsBody;
}

export async function registerModerateRoutes(app: FastifyInstance): Promise<void> {
  const config = app.config;

  app.post<{ Body: ModerateBody }>(
    '/v1/moderate',
    { schema: moderateSchema(config.maxTextLength) },
    async (request, reply) => {
      const moderator = app.requireModerator();
      const body = request.body;
      const options = toCheckOptions(body.options, config);
      const result = runCheck(moderator, body.text, options);
      annotateLog(request, {
        textLength: body.text.length,
        hitCount: result.hitCount,
        decision: result.decision,
        riskLevel: result.riskLevel,
        categories: result.categories,
        mode: options.mode ?? config.defaultMode,
        ...(config.logText ? {} : {}),
      });
      return reply.status(200).send({ success: true, data: result });
    },
  );

  app.post<{ Body: BatchBody }>(
    '/v1/moderate/batch',
    { schema: batchSchema(config.batchMaxItems) },
    async (request, reply) => {
      const moderator = app.requireModerator();
      const body = request.body;
      const options = toCheckOptions(body.options, config);

      const seenIds = new Set<string>();
      const results: {
        id: string;
        success: boolean;
        data?: ModerationResult;
        error?: { code: ErrorCode; message: string; details?: Record<string, unknown> };
      }[] = [];
      let succeeded = 0;
      let failed = 0;
      let matched = 0;

      for (let index = 0; index < body.items.length; index += 1) {
        const item = body.items[index]!;
        const id = item.id ?? String(index);
        if (seenIds.has(id)) throw ApiError.duplicateBatchId(id);
        seenIds.add(id);

        const validation = validateBatchText(item.text, config);
        if (validation !== null) {
          failed += 1;
          results.push({
            id,
            success: false,
            error: {
              code: validation.code,
              message: validation.message,
              ...(validation.details ? { details: validation.details } : {}),
            },
          });
          continue;
        }

        try {
          const result = runCheck(moderator, item.text as string, options);
          succeeded += 1;
          if (result.matched) matched += 1;
          results.push({ id, success: true, data: result });
        } catch (error) {
          const apiError = toItemError(error);
          failed += 1;
          results.push({
            id,
            success: false,
            error: {
              code: apiError.code,
              message: apiError.message,
              ...(apiError.details ? { details: apiError.details } : {}),
            },
          });
        }
      }

      annotateLog(request, {
        itemCount: body.items.length,
        hitCount: matched,
        mode: options.mode ?? config.defaultMode,
      });

      return reply.status(200).send({
        success: true,
        data: {
          results,
          summary: { total: body.items.length, succeeded, failed, matched },
        },
      });
    },
  );
}

function runCheck(
  moderator: Moderator,
  text: string,
  options: CheckOptions,
): ModerationResult {
  try {
    return moderator.check(text, options);
  } catch (error) {
    throw toItemError(error);
  }
}

/** Translate SDK errors into API errors. */
function toItemError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof InvalidMaskCharError) return ApiError.invalidMaskChar();
  if (error instanceof ModerationInputError) {
    switch (error.code) {
      case 'UNKNOWN_CATEGORY':
        return ApiError.unknownCategory(
          error.message.replace('unknown category: ', '').split(', '),
        );
      case 'INVALID_MODE':
        return ApiError.invalidMode(MATCH_MODES);
      case 'INVALID_TEXT':
        return ApiError.textNotString();
      default:
        return new ApiError(ERROR_CODES.INVALID_REQUEST, 400, 'Request is invalid');
    }
  }
  return ApiError.internal();
}

/** Per-item text validation, so one bad item cannot fail an entire batch. */
function validateBatchText(
  text: unknown,
  config: ServerConfig,
): { code: ErrorCode; message: string; details?: Record<string, unknown> } | null {
  if (text === undefined || text === null) {
    return { code: ERROR_CODES.TEXT_REQUIRED, message: 'Field "text" is required' };
  }
  if (typeof text !== 'string') {
    return {
      code: ERROR_CODES.TEXT_NOT_STRING,
      message: 'Field "text" must be a string',
    };
  }
  if (text.length === 0) {
    return { code: ERROR_CODES.TEXT_EMPTY, message: 'Field "text" must not be empty' };
  }
  if (text.trim() === '') {
    return {
      code: ERROR_CODES.TEXT_BLANK,
      message: 'Field "text" must contain at least one non-whitespace character',
    };
  }
  if (text.length > config.maxTextLength) {
    return {
      code: ERROR_CODES.TEXT_TOO_LONG,
      message: 'Text exceeds the configured maximum length',
      details: { maxTextLength: config.maxTextLength },
    };
  }
  return null;
}

function toCheckOptions(
  body: ModerateOptionsBody | undefined,
  config: ServerConfig,
): CheckOptions {
  if (body === undefined) return { mode: config.defaultMode };
  if (body.maskChar !== undefined && [...body.maskChar].length !== 1) {
    throw ApiError.invalidMaskChar();
  }
  return {
    mode: (body.mode as CheckOptions['mode']) ?? config.defaultMode,
    ...(body.categories ? { categories: body.categories } : {}),
    ...(body.returnMatches !== undefined ? { returnMatches: body.returnMatches } : {}),
    ...(body.maxMatches !== undefined ? { maxMatches: body.maxMatches } : {}),
    ...(body.overlap ? { overlap: body.overlap } : {}),
    ...(body.mask !== undefined ? { mask: body.mask } : {}),
    ...(body.maskChar !== undefined ? { maskChar: body.maskChar } : {}),
    ...(body.allowlist ? { allowlist: body.allowlist } : {}),
  };
}

function annotateLog(
  request: FastifyRequest,
  fields: NonNullable<FastifyRequest['moderationLog']>,
): void {
  request.moderationLog = { ...request.moderationLog, ...fields };
}
