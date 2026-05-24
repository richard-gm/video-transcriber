'use strict';

const { CloudTasksClient } = require('@google-cloud/tasks');
const { JobsClient } = require('@google-cloud/run').v2;
const { config, logger } = require('../config');

let tasksClient;
let runJobsClient;
if (config.GCP_PROJECT_ID && config.TASK_QUEUE_PATH) {
  tasksClient = new CloudTasksClient();
  runJobsClient = new JobsClient({ apiEndpoint: `${config.CLOUD_RUN_REGION}-run.googleapis.com` });
}

async function enqueueTask(videoId) {
  if (!tasksClient || !config.HANDLER_URL) {
    logger.info({ videoId }, 'cloud tasks not configured — skipping enqueue');
    return;
  }

  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: `${config.HANDLER_URL}/api/task-handler`,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ videoId })).toString('base64'),
    },
  };

  const [response] = await tasksClient.createTask({ parent: config.TASK_QUEUE_PATH, task });
  logger.info({ videoId, taskName: response.name }, 'task enqueued');
}

async function createJobExecution(videoId) {
  if (!runJobsClient) {
    logger.warn({ videoId }, 'cloud run client not configured — cannot start job');
    return;
  }

  const name = `projects/${config.GCP_PROJECT_ID}/locations/${config.CLOUD_RUN_REGION}/jobs/${config.CLOUD_RUN_JOB_NAME}`;
  const [operation] = await runJobsClient.runJob({
    name,
    overrides: {
      containerOverrides: [{
        env: [{ name: 'VIDEO_ID', value: videoId }],
      }],
      taskCount: 1,
      timeout: '3600s',
    },
  });

  logger.info({ videoId, operation: operation.name }, 'job execution created');
}

module.exports = { enqueueTask, createJobExecution };
