/**
 * REST API integration tests, including scenario 24 (concurrent requests) and
 * scenario 30 (a batch where some items are valid and some are not).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { createModeratorFromTerms } from '../../src/moderator.js';
import { TEST_TERMS } from '../fixtures/terms.js';

const moderator = createModeratorFromTerms(TEST_TERMS, {
  precompileModes: ['normalized', 'fuzzy'],
});

async function server(
  config: Parameters<typeof buildServer>[0] = {},
): Promise<FastifyInstance> {
  return buildServer({
    moderator,
    ...config,
    config: {
      logLevel: 'silent',
      corsOrigin: null,
      enableDocs: false,
      rateLimitMax: 100_000,
      maxTextLength: 200,
      maxBodyBytes: 4096,
      batchMaxItems: 5,
      ...config.config,
    },
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await server();
});

afterAll(async () => {
  await app.close();
});

async function post(
  url: string,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', ...headers },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

describe('GET /health', () => {
  it('reports a loaded lexicon', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.lexicon.loaded).toBe(true);
    expect(body.data.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof body.data.uptimeSeconds).toBe('number');
  });

  it('reports 503 while the lexicon is still loading', async () => {
    const loading = await buildServer({
      deferLexiconLoad: true,
      config: { logLevel: 'silent', corsOrigin: null, enableDocs: false },
    });
    const response = await loading.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('SERVICE_UNAVAILABLE');
    const moderate = await loading.inject({
      method: 'POST',
      url: '/v1/moderate',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'x' }),
    });
    expect(moderate.statusCode).toBe(503);
    expect(moderate.json().error.code).toBe('SERVICE_UNAVAILABLE');
    await loading.close();
  });

  it('reports 503 when the lexicon failed to load', async () => {
    const failed = await buildServer({
      loadModerator: () =>
        Promise.reject(new Error('/secret/path/lexicon.json is broken')),
      config: { logLevel: 'silent', corsOrigin: null, enableDocs: false },
    });
    expect(failed.lexiconStatus).toBe('failed');
    const response = await failed.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.error.code).toBe('LEXICON_LOAD_FAILED');
    // The internal path must not leak.
    expect(JSON.stringify(body)).not.toContain('/secret/path');
    await failed.close();
  });
});

describe('GET /v1/metadata', () => {
  it('describes the lexicon and the limits', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/metadata' });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.supportedModes).toEqual(['exact', 'normalized', 'fuzzy']);
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.limits).toEqual({
      maxTextLength: 200,
      maxBodyBytes: 4096,
      batchMaxItems: 5,
    });
    expect(data.defaults.mode).toBe('normalized');
    expect(data.defaults.blockSeverities).toEqual(['high']);
    expect(data.upstreamRepository).toContain('github.com');
  });
});

describe('POST /v1/moderate', () => {
  it('returns the documented envelope', async () => {
    const response = await post('/v1/moderate', {
      text: '这段文本有违规词',
      options: { mask: true },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.matched).toBe(true);
    expect(body.data.decision).toBe('review');
    expect(body.data.riskLevel).toBe('medium');
    expect(body.data.hitCount).toBe(1);
    expect(body.data.uniqueTermCount).toBe(1);
    expect(body.data.categories).toEqual(['test-basic']);
    expect(body.data.matches[0]).toEqual({
      term: '违规词',
      matchedText: '违规词',
      category: 'test-basic',
      severity: 'medium',
      matchType: 'exact',
      start: 5,
      end: 8,
    });
    expect(body.data.maskedText).toBe('这段文本有***');
    expect(body.data.lexicon).toHaveProperty('version');
  });

  it('allows clean text', async () => {
    const body = (await post('/v1/moderate', { text: '完全正常的一段内容' })).json();
    expect(body.data.matched).toBe(false);
    expect(body.data.decision).toBe('allow');
    expect(body.data.riskLevel).toBe('none');
  });

  it('honours options', async () => {
    const filtered = (
      await post('/v1/moderate', {
        text: '违规词 badword',
        options: { categories: ['test-en'] },
      })
    ).json();
    expect(filtered.data.categories).toEqual(['test-en']);

    const noMatches = (
      await post('/v1/moderate', { text: '违规词', options: { returnMatches: false } })
    ).json();
    expect(noMatches.data.matches).toEqual([]);
    expect(noMatches.data.hitCount).toBe(1);

    const fuzzy = (
      await post('/v1/moderate', { text: 'b4dw0rd', options: { mode: 'fuzzy' } })
    ).json();
    expect(fuzzy.data.matches[0].matchType).toBe('fuzzy');

    const exact = (
      await post('/v1/moderate', { text: 'BADWORD', options: { mode: 'exact' } })
    ).json();
    expect(exact.data.matched).toBe(false);

    const custom = (
      await post('/v1/moderate', {
        text: '违规词',
        options: { mask: true, maskChar: '#' },
      })
    ).json();
    expect(custom.data.maskedText).toBe('###');

    const allowed = (
      await post('/v1/moderate', { text: '违规词', options: { allowlist: ['违规词'] } })
    ).json();
    expect(allowed.data.matched).toBe(false);
  });

  it('rejects invalid input with specific codes', async () => {
    const cases: [unknown, number, string][] = [
      [{}, 400, 'TEXT_REQUIRED'],
      [{ text: 123 }, 400, 'TEXT_NOT_STRING'],
      [{ text: '' }, 400, 'TEXT_EMPTY'],
      [{ text: '   \n\t' }, 400, 'TEXT_BLANK'],
      [{ text: 'x'.repeat(201) }, 413, 'TEXT_TOO_LONG'],
      [{ text: 'x', options: { mode: 'semantic' } }, 400, 'INVALID_MODE'],
      [{ text: 'x', options: { maskChar: '' } }, 400, 'INVALID_MASK_CHAR'],
      [{ text: 'x', options: { maskChar: 'ab' } }, 400, 'INVALID_MASK_CHAR'],
      [{ text: 'x', options: { categories: [] } }, 400, 'INVALID_REQUEST'],
      [{ text: 'x', options: { unknownOption: 1 } }, 400, 'INVALID_REQUEST'],
    ];
    for (const [payload, status, code] of cases) {
      const response = await post('/v1/moderate', payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(status);
      const body = response.json();
      expect(body.error.code, JSON.stringify(payload)).toBe(code);
      expect(body.success).toBe(false);
      expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('rejects an unknown category with the offending id', async () => {
    const response = await post('/v1/moderate', {
      text: 'x',
      options: { categories: ['no-such-category'] },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('UNKNOWN_CATEGORY');
    expect(body.error.details.unknownCategories).toEqual(['no-such-category']);
  });

  it('rejects malformed JSON and wrong content types', async () => {
    const badJson = await post('/v1/moderate', '{"text": ');
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json().error.code).toBe('INVALID_JSON');

    const wrongType = await app.inject({
      method: 'POST',
      url: '/v1/moderate',
      headers: { 'content-type': 'text/plain' },
      payload: 'text',
    });
    expect(wrongType.statusCode).toBe(415);
    expect(wrongType.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an oversized body before parsing it', async () => {
    const response = await post('/v1/moderate', { text: 'x'.repeat(8000) });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('never leaks stack traces or paths', async () => {
    const response = await post('/v1/moderate', { text: 123 });
    const raw = response.body;
    expect(raw).not.toMatch(/at .*\.ts:/);
    expect(raw).not.toContain('node_modules');
    expect(raw).not.toContain('/Users/');
    expect(Object.keys(response.json().error).sort()).toEqual([
      'code',
      'message',
      'requestId',
    ]);
  });
});

describe('POST /v1/moderate/batch', () => {
  it('processes valid and invalid items independently', async () => {
    const response = await post('/v1/moderate/batch', {
      items: [
        { id: '1', text: '干净内容' },
        { id: '2', text: '有违规词' },
        { id: '3', text: 42 },
        { id: '4', text: '   ' },
        { id: '5', text: 'x'.repeat(201) },
      ],
    });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.summary).toEqual({ total: 5, succeeded: 2, failed: 3, matched: 1 });
    expect(data.results[0]).toMatchObject({ id: '1', success: true });
    expect(data.results[0].data.matched).toBe(false);
    expect(data.results[1].data.matched).toBe(true);
    expect(data.results[2]).toMatchObject({
      id: '3',
      success: false,
      error: { code: 'TEXT_NOT_STRING' },
    });
    expect(data.results[3].error.code).toBe('TEXT_BLANK');
    expect(data.results[4].error.code).toBe('TEXT_TOO_LONG');
    expect(data.results[4].error.details.maxTextLength).toBe(200);
  });

  it('defaults ids to the item index', async () => {
    const data = (
      await post('/v1/moderate/batch', { items: [{ text: 'a' }, { text: 'b' }] })
    ).json().data;
    expect(data.results.map((item: { id: string }) => item.id)).toEqual(['0', '1']);
  });

  it('rejects duplicate ids', async () => {
    const response = await post('/v1/moderate/batch', {
      items: [
        { id: 'same', text: 'a' },
        { id: 'same', text: 'b' },
      ],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('DUPLICATE_BATCH_ID');
  });

  it('enforces the batch size limits', async () => {
    const empty = await post('/v1/moderate/batch', { items: [] });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe('BATCH_EMPTY');

    const tooLarge = await post('/v1/moderate/batch', {
      items: Array.from({ length: 6 }, (_unused, index) => ({ text: `t${index}` })),
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json().error.code).toBe('BATCH_TOO_LARGE');
    expect(tooLarge.json().error.details.batchMaxItems).toBe(5);

    const missing = await post('/v1/moderate/batch', {});
    expect(missing.statusCode).toBe(400);
  });

  it('applies shared options to every item', async () => {
    const data = (
      await post('/v1/moderate/batch', {
        items: [{ text: 'b4dw0rd' }, { text: 'badword' }],
        options: { mode: 'fuzzy', mask: true },
      })
    ).json().data;
    expect(data.results[0].data.matches[0].matchType).toBe('fuzzy');
    expect(data.results[1].data.maskedText).toBe('*******');
  });
});

describe('scenario 24: concurrency', () => {
  it('handles many concurrent requests with stable results', async () => {
    const payloads = Array.from({ length: 60 }, (_unused, index) =>
      index % 3 === 0
        ? '干净的内容'
        : index % 3 === 1
          ? '有违规词的内容'
          : '爆炸物制造相关',
    );
    const responses = await Promise.all(
      payloads.map((text) => post('/v1/moderate', { text, options: { mask: true } })),
    );
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);

    responses.forEach((response, index) => {
      const data = response.json().data;
      if (index % 3 === 0) {
        expect(data.decision).toBe('allow');
      } else if (index % 3 === 1) {
        expect(data.decision).toBe('review');
        expect(data.maskedText).toBe('有***的内容');
      } else {
        expect(data.decision).toBe('block');
        expect(data.riskLevel).toBe('high');
      }
    });

    const versions = new Set(
      responses.map((response) => String(response.json().data.lexicon.version)),
    );
    expect(versions.size).toBe(1);
  });

  it('handles concurrent batch requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        post('/v1/moderate/batch', {
          items: [{ text: '违规词' }, { text: '干净' }],
        }),
      ),
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.json().data.summary).toEqual({
        total: 2,
        succeeded: 2,
        failed: 0,
        matched: 1,
      });
    }
  });
});

describe('security controls', () => {
  it('requires a bearer token on /v1 when configured', async () => {
    const secured = await server({ config: { apiToken: 'secret-token' } });
    const unauthorized = await secured.inject({
      method: 'POST',
      url: '/v1/moderate',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'x' }),
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error.code).toBe('UNAUTHORIZED');

    const authorized = await secured.inject({
      method: 'POST',
      url: '/v1/moderate',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret-token',
      },
      payload: JSON.stringify({ text: 'x' }),
    });
    expect(authorized.statusCode).toBe(200);

    // Health stays open so orchestrators can probe it.
    const health = await secured.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    await secured.close();
  });

  it('enforces the rate limit', async () => {
    const limited = await server({
      config: { rateLimitMax: 3, rateLimitWindow: '1 minute' },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await limited.inject({
        method: 'POST',
        url: '/v1/moderate',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ text: 'x' }),
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    await limited.close();
  });

  it('serves CORS headers only when configured', async () => {
    const withCors = await server({ config: { corsOrigin: ['https://example.com'] } });
    const response = await withCors.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://example.com' },
    });
    expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
    await withCors.close();

    const withoutCors = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://example.com' },
    });
    expect(withoutCors.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exposes the OpenAPI document when docs are enabled', async () => {
    const documented = await server({ config: { enableDocs: true } });
    await documented.ready();
    const response = await documented.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(Object.keys(document.paths).sort()).toEqual([
      '/health',
      '/v1/metadata',
      '/v1/moderate',
      '/v1/moderate/batch',
    ]);
    await documented.close();
  });
});
