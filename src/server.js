'use strict';

const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { config, logger } = require('./config');
const { runPipeline } = require('./pipeline');
const localQueue = require('./lib/local-queue');

const healthRoutes = require('./routes/health');
const transcribeRoutes = require('./routes/transcribe');
const statusRoutes = require('./routes/status');
const transcriptionsRoutes = require('./routes/transcriptions');
const taskHandlerRoutes = require('./routes/task-handler');
const telegramRoutes = require('./routes/telegram');
const cancelRoutes = require('./routes/cancel');
const deleteRoutes = require('./routes/delete');

const app = express();
app.set('trust proxy', 1); // Cloud Run sits behind Google's load balancer
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(healthRoutes);
app.use(transcribeRoutes);
app.use(statusRoutes);
app.use(transcriptionsRoutes);
app.use(taskHandlerRoutes);
app.use(telegramRoutes);
app.use(cancelRoutes);
app.use(deleteRoutes);

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => logger.info('http server closed'));
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const server = app.listen(config.PORT, async () => {
  logger.info({ port: config.PORT }, 'server started');

  if (config.TASK_QUEUE_PATH) return;

  // Pick up any pending rows from previous runs (local mode only)
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const { data, error } = await supabase
    .from(config.SUPABASE_TABLE)
    .select('id')
    .eq('status', 'pending');

  if (error) {
    logger.error({ err: error.message }, 'startup: could not fetch pending rows');
    return;
  }

  if (!data || data.length === 0) {
    logger.info('startup: no pending rows');
    return;
  }

  logger.info({ count: data.length }, 'startup: queuing pending rows from previous run');
  for (const row of data) {
    localQueue.add(() => runPipeline(row.id));
  }
});
