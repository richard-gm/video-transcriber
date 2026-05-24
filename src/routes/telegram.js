'use strict';

const { Router } = require('express');
const supabase = require('../lib/supabase');
const { enqueueTask } = require('../lib/queue');
const { runPipeline } = require('../pipeline');
const localQueue = require('../lib/local-queue');
const { config, logger } = require('../config');
const { sendTelegramMessage } = require('../lib/telegram');

const router = Router();

function isValidVideoUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

if (config.TELEGRAM_BOT_TOKEN) {
  router.post('/telegram-webhook', (req, res) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (config.TELEGRAM_SECRET_TOKEN && secret !== config.TELEGRAM_SECRET_TOKEN) {
      return res.status(401).end();
    }

    const update = req.body;
    const msg = update?.message;
    if (!msg?.text) return res.status(200).end();

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (text === '/start') {
      sendTelegramMessage(chatId, 'Send me a YouTube, TikTok, or Instagram URL and I will transcribe it.');
      return res.status(200).end();
    }

    if (!isValidVideoUrl(text)) {
      sendTelegramMessage(chatId, 'Please send a valid video URL (YouTube, TikTok, Instagram, etc.).');
      return res.status(200).end();
    }

    supabase
      .from(config.SUPABASE_TABLE)
      .insert({ url: text, status: 'pending', chat_id: String(chatId) })
      .select()
      .single()
      .then(({ data, error }) => {
        if (error) {
          logger.error({ err: error.message }, 'telegram webhook insert failed');
          sendTelegramMessage(chatId, 'Sorry, something went wrong. Try again later.');
        } else {
          logger.info({ id: data.id, url: text }, 'telegram: submitted for transcription');
          sendTelegramMessage(chatId, 'Got it! Processing… I will send you the result when done.');

          if (config.TASK_QUEUE_PATH) {
            enqueueTask(data.id).catch((err) =>
              logger.error({ err: err.message, videoId: data.id }, 'enqueue failed'),
            );
          } else {
            localQueue.add(() => runPipeline(data.id));
          }
        }
      });

    res.status(200).end();
  });
}

module.exports = router;
