/** `GET /health` – liveness and readiness. */
import type { FastifyInstance } from 'fastify';
import { API_VERSION } from '../server.js';
import { ApiError, toErrorEnvelope } from '../errors.js';
import { healthSchema } from '../schemas/index.js';

const startedAt = Date.now();

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { schema: healthSchema }, async (request, reply) => {
    const uptimeSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
    if (app.lexiconStatus !== 'ready' || app.moderator === null) {
      const error =
        app.lexiconStatus === 'failed'
          ? ApiError.lexiconLoadFailed()
          : ApiError.serviceUnavailable();
      return reply.status(503).send(toErrorEnvelope(error, request.id));
    }
    const metadata = app.moderator.getMetadata();
    return reply.status(200).send({
      success: true,
      data: {
        status: 'ok',
        version: API_VERSION,
        uptimeSeconds,
        lexicon: {
          loaded: true,
          version: metadata.version,
          upstreamCommit: metadata.upstreamCommit,
          termCount: metadata.termCount,
        },
      },
    });
  });
}
