'use strict';

const JobQueue = require('./job-queue');
const { config } = require('../config');

const localQueue = new JobQueue(config.MAX_CONCURRENT_JOBS);

module.exports = localQueue;
