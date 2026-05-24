#!/usr/bin/env node
'use strict';

const VIDEO_ID = process.env.VIDEO_ID;

if (!VIDEO_ID) {
  console.error('ERROR: VIDEO_ID environment variable is required');
  process.exit(1);
}

const { runPipeline } = require('./pipeline');

runPipeline(VIDEO_ID)
  .then((success) => process.exit(success ? 0 : 1))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
