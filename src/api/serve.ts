#!/usr/bin/env node
/**
 * Server entry point. Fails fast when the lexicon cannot be loaded, so an orchestrator
 * never routes traffic to an instance that can only return 503.
 */
import { buildServer } from './server.js';
import { ConfigError, loadConfig } from './config.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`configuration error: ${error.message}`);
      process.exit(2);
    }
    throw error;
  }

  const app = await buildServer();
  if (app.lexiconStatus !== 'ready') {
    app.log.fatal(
      'lexicon could not be loaded; run "npm run lexicon:build" and restart',
    );
    await app.close();
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.fatal(
      { err: error instanceof Error ? { message: error.message } : {} },
      'listen failed',
    );
    process.exit(1);
  }
}

void main();
