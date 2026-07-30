/**
 * Fastify application factory.
 *
 * The matcher is completely independent of Fastify; this module only adds transport,
 * validation, logging and policy plumbing. The lexicon is loaded once, before the
 * server starts accepting traffic, and shared by reference across requests.
 */
import { randomUUID } from 'node:crypto';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ApiError, ERROR_CODES, toErrorEnvelope } from './errors.js';
import { loadConfig, type ServerConfig } from './config.js';
import { sharedSchemas } from './schemas/index.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMetadataRoutes } from './routes/metadata.js';
import { registerModerateRoutes } from './routes/moderate.js';
import { createModerator, type Moderator } from '../moderator.js';
import { MATCH_MODES } from '../core/types.js';

/** Version reported by `/health` and `/v1/metadata`. */
export const API_VERSION = '0.1.0';
/** Upstream repository, echoed in metadata for attribution. */
export const UPSTREAM_REPOSITORY = 'https://github.com/konsheng/Sensitive-lexicon';

/** Lexicon lifecycle state exposed to the routes. */
export type LexiconStatus = 'loading' | 'ready' | 'failed';

/** Options for {@link buildServer}. */
export interface BuildServerOptions {
  config?: Partial<ServerConfig>;
  /** Use a pre-built moderator instead of loading one. */
  moderator?: Moderator;
  /** Custom loader, mainly for tests that need to simulate failures. */
  loadModerator?: (config: ServerConfig) => Promise<Moderator>;
  /**
   * Skip loading during `buildServer`, so tests can observe the `loading` state.
   * The load is then triggered by {@link ModerationServer.loadLexicon}.
   */
  deferLexiconLoad?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: ServerConfig;
    lexiconStatus: LexiconStatus;
    moderator: Moderator | null;
    /** Load (or reload) the lexicon. Resolves to the resulting status. */
    loadLexicon: () => Promise<LexiconStatus>;
    /** Throws when the lexicon is not ready. */
    requireModerator: () => Moderator;
  }
  interface FastifyRequest {
    /** Fields collected by the routes for the structured access log. */
    moderationLog?: {
      textLength?: number;
      hitCount?: number;
      decision?: string;
      riskLevel?: string;
      categories?: string[];
      mode?: string;
      itemCount?: number;
    };
  }
}

/** Build a configured, not yet listening Fastify instance. */
export async function buildServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const config: ServerConfig = { ...loadConfig(), ...options.config };

  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Never log request or response bodies: they contain user submitted content.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[redacted]',
      },
      serializers: {
        req: (request: FastifyRequest) => ({
          method: request.method,
          url: request.url,
          remoteAddress: request.ip,
        }),
      },
    },
    genReqId: () => randomUUID(),
    bodyLimit: config.maxBodyBytes,
    requestTimeout: config.requestTimeoutMs,
    trustProxy: config.trustProxy,
    // The default per-request logs are replaced by the structured onResponse log below,
    // which deliberately omits request and response bodies.
    logController: new LogController({ disableRequestLogging: true }),
    ajv: {
      customOptions: {
        allErrors: false,
        removeAdditional: false,
        coerceTypes: false,
      },
    },
  });

  app.decorate('config', config);
  app.decorate('lexiconStatus', 'loading' as LexiconStatus);
  app.decorate('moderator', null as Moderator | null);

  const loader =
    options.loadModerator ??
    (async (serverConfig: ServerConfig) =>
      createModerator({
        mode: serverConfig.defaultMode,
        maskChar: serverConfig.maskChar,
        precompileModes: serverConfig.precompileModes,
        policy: {
          blockSeverities: serverConfig.blockSeverities,
          blockCategories: serverConfig.blockCategories,
          allowCategories: serverConfig.allowCategories,
        },
        lexicon: {
          categories: serverConfig.categories,
          includeNeedsReview: serverConfig.includeNeedsReview,
          minTermLength: serverConfig.minTermLength,
        },
      }));

  app.decorate('loadLexicon', async (): Promise<LexiconStatus> => {
    try {
      const moderator = options.moderator ?? (await loader(config));
      app.moderator = moderator;
      app.lexiconStatus = 'ready';
      const metadata = moderator.getMetadata();
      app.log.info(
        {
          lexiconVersion: metadata.version,
          upstreamCommit: metadata.upstreamCommit,
          termCount: metadata.termCount,
          categories: metadata.categories.length,
        },
        'lexicon loaded',
      );
    } catch (error) {
      app.lexiconStatus = 'failed';
      app.moderator = null;
      app.log.error(
        { err: error instanceof Error ? { message: error.message } : {} },
        'lexicon load failed',
      );
    }
    return app.lexiconStatus;
  });

  app.decorate('requireModerator', (): Moderator => {
    if (app.lexiconStatus === 'failed') throw ApiError.lexiconLoadFailed();
    if (app.moderator === null) throw ApiError.serviceUnavailable();
    return app.moderator;
  });

  for (const schema of sharedSchemas) app.addSchema(schema);

  if (config.corsOrigin !== null) {
    await app.register(cors, {
      origin: config.corsOrigin,
      methods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 600,
    });
  }

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    allowList: () => false,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
      error: 'Too Many Requests',
      message: `Rate limit exceeded, retry in ${context.after}`,
      requestId: request.id,
    }),
  });

  if (config.enableDocs) {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'open-moderation-lexicon',
          description: [
            'Keyword based moderation API built on an open sensitive-word lexicon.',
            '',
            'This service detects keywords. It does not understand meaning, intent or context,',
            'and `decision` is the result of a configurable policy, not a legal conclusion.',
            '',
            `Lexicon source: ${UPSTREAM_REPOSITORY} (MIT).`,
          ].join('\n'),
          version: API_VERSION,
          license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
        },
        servers: [{ url: '/', description: 'Current server' }],
        tags: [
          { name: 'moderation', description: 'Text moderation endpoints' },
          { name: 'system', description: 'Health and metadata' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer' },
          },
        },
        ...(config.apiToken ? { security: [{ bearerAuth: [] }] } : {}),
      },
    });
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  }

  // Reject unsupported media types before body parsing so the error code is specific.
  app.addHook('onRequest', async (request) => {
    if (
      request.method !== 'POST' &&
      request.method !== 'PUT' &&
      request.method !== 'PATCH'
    ) {
      return;
    }
    const contentType = request.headers['content-type'];
    if (contentType === undefined) {
      // A body-less POST is rejected by schema validation instead.
      if (request.headers['content-length'] === undefined) return;
      throw ApiError.unsupportedMediaType();
    }
    const mediaType = contentType.split(';', 1)[0]!.trim().toLowerCase();
    if (mediaType !== 'application/json' && !mediaType.endsWith('+json')) {
      throw ApiError.unsupportedMediaType();
    }
  });

  // Bearer token check for /v1 routes when a token is configured.
  app.addHook('onRequest', async (request) => {
    if (config.apiToken === null) return;
    if (!request.url.startsWith('/v1')) return;
    const header = request.headers.authorization;
    const expected = `Bearer ${config.apiToken}`;
    if (header !== expected) throw ApiError.unauthorized();
  });

  // Structured access log without user content.
  app.addHook('onResponse', async (request, reply) => {
    const log = request.moderationLog ?? {};
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: Number(reply.elapsedTime.toFixed(2)),
        ...log,
      },
      'request completed',
    );
  });

  app.setNotFoundHandler(
    { preHandler: app.rateLimit() },
    (request: FastifyRequest, reply: FastifyReply) => {
      void reply.status(404).send(toErrorEnvelope(ApiError.notFound(), request.id));
    },
  );

  app.setErrorHandler((error: unknown, request, reply) => {
    const apiError = mapError(error, config);
    if (apiError.statusCode >= 500) {
      request.log.error(
        {
          requestId: request.id,
          code: apiError.code,
          // Only the message, never the stack or any path.
          err: { message: error instanceof Error ? error.message : 'unknown error' },
        },
        'request failed',
      );
    } else {
      request.log.warn(
        { requestId: request.id, code: apiError.code, statusCode: apiError.statusCode },
        'request rejected',
      );
    }
    void reply.status(apiError.statusCode).send(toErrorEnvelope(apiError, request.id));
  });

  await registerHealthRoutes(app);
  await registerMetadataRoutes(app);
  await registerModerateRoutes(app);

  if (options.deferLexiconLoad !== true) {
    await app.loadLexicon();
  }

  return app;
}

interface FastifyErrorLike extends Error {
  statusCode?: number;
  code?: string;
  validation?: {
    keyword: string;
    instancePath: string;
    params?: Record<string, unknown>;
  }[];
  validationContext?: string;
}

/** Translate framework, validation and SDK errors into {@link ApiError}. */
export function mapError(error: unknown, config: ServerConfig): ApiError {
  if (error instanceof ApiError) return error;

  const candidate = error as FastifyErrorLike;

  if (Array.isArray(candidate.validation) && candidate.validation.length > 0) {
    return mapValidationError(candidate, config);
  }

  switch (candidate.code) {
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return ApiError.invalidJson();
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return ApiError.unsupportedMediaType();
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return ApiError.payloadTooLarge(config.maxBodyBytes);
    case 'FST_ERR_VALIDATION':
      return new ApiError(ERROR_CODES.INVALID_REQUEST, 400, 'Request body is invalid');
    case 'FST_ERR_BAD_STATUS_CODE':
      return ApiError.internal();
    default:
      break;
  }

  if (error instanceof SyntaxError) return ApiError.invalidJson();

  if (candidate.statusCode === 429) {
    return new ApiError(ERROR_CODES.RATE_LIMITED, 429, 'Rate limit exceeded');
  }
  if (candidate.statusCode === 408) {
    return new ApiError(ERROR_CODES.REQUEST_TIMEOUT, 408, 'Request timed out');
  }
  if (candidate.statusCode === 415) return ApiError.unsupportedMediaType();
  if (candidate.statusCode === 413)
    return ApiError.payloadTooLarge(config.maxBodyBytes);
  if (candidate.statusCode === 404) return ApiError.notFound();
  if (candidate.statusCode === 401) return ApiError.unauthorized();

  return ApiError.internal();
}

function mapValidationError(error: FastifyErrorLike, config: ServerConfig): ApiError {
  const first = error.validation![0]!;
  const path = first.instancePath;
  const keyword = first.keyword;

  if (keyword === 'required') {
    const missing = (first.params?.missingProperty as string | undefined) ?? '';
    if (missing === 'text' || path.endsWith('/items')) return ApiError.textRequired();
    return new ApiError(
      ERROR_CODES.INVALID_REQUEST,
      400,
      `Field "${missing}" is required`,
    );
  }

  if (path === '/text') {
    if (keyword === 'type') return ApiError.textNotString();
    if (keyword === 'minLength') return ApiError.textEmpty();
    if (keyword === 'pattern') return ApiError.textBlank();
    if (keyword === 'maxLength') return ApiError.textTooLong(config.maxTextLength);
  }

  if (path === '/items') {
    if (keyword === 'minItems') return ApiError.batchEmpty();
    if (keyword === 'maxItems') return ApiError.batchTooLarge(config.batchMaxItems);
    if (keyword === 'type') {
      return new ApiError(
        ERROR_CODES.INVALID_REQUEST,
        400,
        'Field "items" must be an array',
      );
    }
  }

  if (path === '/options/mode') return ApiError.invalidMode(MATCH_MODES);
  if (path === '/options/maskChar') return ApiError.invalidMaskChar();
  if (path.startsWith('/options/categories')) {
    return new ApiError(
      ERROR_CODES.INVALID_REQUEST,
      400,
      'Field "options.categories" must be a non-empty array of category ids',
    );
  }

  return new ApiError(ERROR_CODES.INVALID_REQUEST, 400, 'Request body is invalid');
}
