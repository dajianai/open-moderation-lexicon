/**
 * Uniform error envelope.
 *
 * Error messages are fixed strings written by this project. Stack traces, file system
 * paths and upstream error text never reach the client.
 */

/** Machine readable error codes returned by the API. */
export const ERROR_CODES = {
  TEXT_REQUIRED: 'TEXT_REQUIRED',
  TEXT_NOT_STRING: 'TEXT_NOT_STRING',
  TEXT_EMPTY: 'TEXT_EMPTY',
  TEXT_BLANK: 'TEXT_BLANK',
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_MODE: 'INVALID_MODE',
  INVALID_MASK_CHAR: 'INVALID_MASK_CHAR',
  UNKNOWN_CATEGORY: 'UNKNOWN_CATEGORY',
  BATCH_EMPTY: 'BATCH_EMPTY',
  BATCH_TOO_LARGE: 'BATCH_TOO_LARGE',
  BATCH_ITEM_INVALID: 'BATCH_ITEM_INVALID',
  DUPLICATE_BATCH_ID: 'DUPLICATE_BATCH_ID',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  LEXICON_LOAD_FAILED: 'LEXICON_LOAD_FAILED',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** One of {@link ERROR_CODES}. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Error carrying an API error code and an HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusCode: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static textRequired(): ApiError {
    return new ApiError(ERROR_CODES.TEXT_REQUIRED, 400, 'Field "text" is required');
  }

  static textNotString(): ApiError {
    return new ApiError(
      ERROR_CODES.TEXT_NOT_STRING,
      400,
      'Field "text" must be a string',
    );
  }

  static textEmpty(): ApiError {
    return new ApiError(ERROR_CODES.TEXT_EMPTY, 400, 'Field "text" must not be empty');
  }

  static textBlank(): ApiError {
    return new ApiError(
      ERROR_CODES.TEXT_BLANK,
      400,
      'Field "text" must contain at least one non-whitespace character',
    );
  }

  static textTooLong(limit: number): ApiError {
    return new ApiError(
      ERROR_CODES.TEXT_TOO_LONG,
      413,
      'Text exceeds the configured maximum length',
      { maxTextLength: limit },
    );
  }

  static invalidJson(): ApiError {
    return new ApiError(
      ERROR_CODES.INVALID_JSON,
      400,
      'Request body is not valid JSON',
    );
  }

  static invalidMode(supported: readonly string[]): ApiError {
    return new ApiError(ERROR_CODES.INVALID_MODE, 400, 'Unsupported match mode', {
      supportedModes: [...supported],
    });
  }

  static invalidMaskChar(): ApiError {
    return new ApiError(
      ERROR_CODES.INVALID_MASK_CHAR,
      400,
      'Field "options.maskChar" must be exactly one Unicode code point',
    );
  }

  static unknownCategory(categories: string[]): ApiError {
    return new ApiError(
      ERROR_CODES.UNKNOWN_CATEGORY,
      400,
      'Unknown category requested',
      {
        unknownCategories: categories,
      },
    );
  }

  static batchEmpty(): ApiError {
    return new ApiError(
      ERROR_CODES.BATCH_EMPTY,
      400,
      'Field "items" must contain at least one item',
    );
  }

  static batchTooLarge(limit: number): ApiError {
    return new ApiError(
      ERROR_CODES.BATCH_TOO_LARGE,
      400,
      'Batch exceeds the configured maximum number of items',
      { batchMaxItems: limit },
    );
  }

  static duplicateBatchId(id: string): ApiError {
    return new ApiError(
      ERROR_CODES.DUPLICATE_BATCH_ID,
      400,
      'Batch item ids must be unique',
      {
        duplicateId: id,
      },
    );
  }

  static payloadTooLarge(limit: number): ApiError {
    return new ApiError(
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      413,
      'Request body exceeds the configured maximum size',
      { maxBodyBytes: limit },
    );
  }

  static unsupportedMediaType(): ApiError {
    return new ApiError(
      ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
      415,
      'Content-Type must be application/json',
    );
  }

  static unauthorized(): ApiError {
    return new ApiError(
      ERROR_CODES.UNAUTHORIZED,
      401,
      'Missing or invalid bearer token',
    );
  }

  static notFound(): ApiError {
    return new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Route not found');
  }

  static serviceUnavailable(): ApiError {
    return new ApiError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      503,
      'Service is still loading the lexicon',
    );
  }

  static lexiconLoadFailed(): ApiError {
    return new ApiError(
      ERROR_CODES.LEXICON_LOAD_FAILED,
      503,
      'Lexicon could not be loaded; check the server logs',
    );
  }

  static internal(): ApiError {
    return new ApiError(ERROR_CODES.INTERNAL_ERROR, 500, 'Internal server error');
  }
}

/** The wire format of an error response. */
export interface ErrorEnvelope {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

/** Build an error envelope. */
export function toErrorEnvelope(error: ApiError, requestId: string): ErrorEnvelope {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}
