'use strict';

const { config, logger } = require('../config');

async function sendTelegramMessage(chatId, text) {
  if (!config.TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) logger.warn({ chatId, status: res.status }, 'telegram send failed');
  } catch (err) {
    logger.warn({ err: err.message }, 'telegram send error');
  }
}

module.exports = { sendTelegramMessage };
