/** `GET /v1/metadata` – lexicon provenance, categories and limits. */
import type { FastifyInstance } from 'fastify';
import { API_VERSION, UPSTREAM_REPOSITORY } from '../server.js';
import { metadataSchema } from '../schemas/index.js';
import { supportedModes } from '../../lexicon/metadata.js';

export async function registerMetadataRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/metadata', { schema: metadataSchema }, async (_request, reply) => {
    const moderator = app.requireModerator();
    const metadata = moderator.getMetadata();
    const config = app.config;
    return reply.status(200).send({
      success: true,
      data: {
        apiVersion: API_VERSION,
        lexiconVersion: metadata.version,
        upstreamCommit: metadata.upstreamCommit,
        upstreamRepository: UPSTREAM_REPOSITORY,
        syncedAt: metadata.syncedAt,
        builtAt: metadata.builtAt,
        termCount: metadata.termCount,
        totalTermCount: metadata.totalTermCount,
        categories: metadata.categories,
        supportedModes: supportedModes(),
        defaults: {
          mode: config.defaultMode,
          overlap: 'leftmost-longest',
          maskChar: config.maskChar,
          blockSeverities: config.blockSeverities,
        },
        limits: {
          maxTextLength: config.maxTextLength,
          maxBodyBytes: config.maxBodyBytes,
          batchMaxItems: config.batchMaxItems,
        },
      },
    });
  });
}
