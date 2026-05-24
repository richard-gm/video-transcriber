'use strict';

const pino = require('pino');

const config = {
  PORT: process.env.PORT || 3000,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_TABLE: process.env.SUPABASE_TABLE || 'videos',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_SECRET_TOKEN: process.env.TELEGRAM_SECRET_TOKEN,
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
  CLOUD_RUN_REGION: process.env.CLOUD_RUN_REGION || 'us-central1',
  TASK_QUEUE_PATH: process.env.TASK_QUEUE_PATH,
  HANDLER_URL: process.env.HANDLER_URL,
  CLOUD_RUN_JOB_NAME: process.env.CLOUD_RUN_JOB_NAME || 'video-transcriber-worker',
  WHISPER_MODEL: process.env.WHISPER_MODEL || 'base',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX) || 10,
  MAX_CONCURRENT_JOBS: Number(process.env.MAX_CONCURRENT_JOBS) || 2,
  WHISPER_THREADS: Number(process.env.WHISPER_THREADS) || 4,
};

if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
  process.exit(1);
}

const logger = pino({ level: config.LOG_LEVEL });

module.exports = { config, logger };
