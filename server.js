'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pino = require('pino');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'videos';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 10;
const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS) || 2;

// ── Helpers ───────────────────────────────────────────────────────────────────
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 600_000, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

function isValidVideoUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) logger.warn({ chatId, status: res.status }, 'telegram send failed');
  } catch (err) {
    logger.warn({ err: err.message }, 'telegram send error');
  }
}

// ── Job queue (concurrency-limited) ───────────────────────────────────────────
// Prevents too many downloads / ffmpeg processes from running at once.
class JobQueue {
  constructor(concurrency) {
    this._concurrency = concurrency;
    this._running = 0;
    this._queue = [];
  }

  add(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._next();
    });
  }

  _next() {
    if (this._running >= this._concurrency || this._queue.length === 0) return;
    const { fn, resolve, reject } = this._queue.shift();
    this._running++;
    Promise.resolve(fn()).then(resolve, reject).finally(() => {
      this._running--;
      this._next();
    });
  }
}

const jobQueue = new JobQueue(MAX_CONCURRENT_JOBS);

// ── Persistent Whisper worker ─────────────────────────────────────────────────
// Keeps the model loaded in memory across transcriptions.
class WhisperWorker {
  constructor(modelName) {
    this._modelName = modelName;
    this._proc = null;
    this._pending = new Map();
    this._nextId = 1;
    this._readyPromise = new Promise((resolve) => { this._resolveReady = resolve; });
    this._start();
  }

  ready() { return this._readyPromise; }

  _start() {
    const proc = spawn('python3', [
      path.join(__dirname, 'scripts', 'transcribe_worker.py'),
      this._modelName,
    ]);
    this._proc = proc;

    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.ready) {
            logger.info({ model: this._modelName }, 'whisper worker ready');
            this._resolveReady();
            continue;
          }
          const pending = this._pending.get(msg.id);
          if (!pending) continue;
          this._pending.delete(msg.id);
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.text);
        } catch {
          // malformed JSON — ignore
        }
      }
    });

    proc.stderr.on('data', (d) => {
      logger.warn({ stderr: d.toString() }, 'whisper worker stderr');
    });

    proc.on('exit', (code, signal) => {
      logger.error({ code, signal }, 'whisper worker exited — restarting in 1s');
      for (const [, p] of this._pending) p.reject(new Error('Whisper worker died'));
      this._pending.clear();
      setTimeout(() => this._start(), 1000);
    });

    proc.on('error', (err) => {
      logger.error({ err: err.message }, 'whisper worker spawn failed');
    });
  }

  transcribe(audioPath) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });
      this._proc.stdin.write(JSON.stringify({ id, audio: audioPath }) + '\n');
    });
  }

  close() {
    if (this._proc) {
      this._proc.stdin.end();
      this._proc.kill();
      this._proc = null;
    }
  }
}

const activeJobs = new Set();
let whisperWorker;

// ── Core pipeline ─────────────────────────────────────────────────────────────
async function processVideo(id, url, chatId) {
  activeJobs.add(id);
  logger.info({ id, url }, 'processing video');

  await supabase.from(SUPABASE_TABLE).update({ status: 'processing' }).eq('id', id);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtx-'));

  try {
    logger.info({ id, url }, 'downloading video');
    await run('yt-dlp', [
      '--no-playlist',
      '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--output', path.join(tmpDir, 'video.%(ext)s'),
      url,
    ]);

    const downloaded = fs.readdirSync(tmpDir).find((f) => f.startsWith('video.'));
    if (!downloaded) throw new Error('Download produced no file');

    const audioPath = path.join(tmpDir, 'audio.wav');
    logger.info({ id }, 'extracting audio');
    await run('ffmpeg', [
      '-i', path.join(tmpDir, downloaded),
      '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y',
      audioPath,
    ]);

    logger.info({ id, model: WHISPER_MODEL }, 'transcribing');
    const text = await whisperWorker.transcribe(audioPath);

    await supabase
      .from(SUPABASE_TABLE)
      .update({ status: 'done', transcript: text, processed_at: new Date().toISOString() })
      .eq('id', id);

    logger.info({ id }, 'video processed successfully');
    await sendTelegramMessage(chatId, '✅ Done\n' + url);
  } catch (err) {
    logger.error({ id, err: err.message }, 'processing failed');
    await supabase
      .from(SUPABASE_TABLE)
      .update({ status: 'error', error: err.message })
      .eq('id', id);

    await sendTelegramMessage(chatId, '❌ Failed: ' + err.message + '\n' + url);
  } finally {
    activeJobs.delete(id);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Supabase Realtime subscriber ──────────────────────────────────────────────
// Fires instantly when a new row is inserted — no polling, no cron.
let realtimeChannel;

function startRealtimeWorker() {
  realtimeChannel = supabase
    .channel('video-inserts')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: SUPABASE_TABLE },
      (payload) => {
        const { id, url, status, chat_id: chatId } = payload.new;
        if (status !== 'pending') return;
        jobQueue.add(() => processVideo(id, url, chatId));
      },
    )
    .subscribe((state) => {
      logger.info({ state }, 'realtime subscription state');
    });
}

// ── Pick up any pending rows missed while the app was offline ─────────────────
async function processPendingOnStartup() {
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select('id, url, chat_id')
    .eq('status', 'pending');

  if (error) return logger.error({ err: error.message }, 'startup: could not fetch pending rows');
  if (!data.length) return logger.info('startup: no pending rows');

  logger.info({ count: data.length }, 'startup: queuing pending rows');
  for (const row of data) {
    jobQueue.add(() => processVideo(row.id, row.url, row.chat_id));
  }
}

// ── Web server (view results) ─────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), activeJobs: activeJobs.size });
});

app.get('/transcriptions', async (_req, res) => {
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/process', apiLimiter, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!isValidVideoUrl(url)) return res.status(400).json({ error: 'Invalid video URL' });

  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .insert({ url, status: 'pending' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  logger.info({ id: data.id, url }, 'submitted for transcription');
  res.status(201).json(data);
});

// ── Telegram webhook ──────────────────────────────────────────────────────────
// Receives updates from Telegram when a user sends a URL to the bot.
// Only registers if TELEGRAM_BOT_TOKEN is set (graceful fallback for local dev).
if (TELEGRAM_BOT_TOKEN) {
  app.post('/telegram-webhook', (req, res) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (TELEGRAM_SECRET_TOKEN && secret !== TELEGRAM_SECRET_TOKEN) {
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
      .from(SUPABASE_TABLE)
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
        }
      });

    res.status(200).end();
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info({ signal, activeJobs: activeJobs.size }, 'shutting down');

  server.close(() => logger.info('http server closed'));

  if (realtimeChannel) supabase.removeChannel(realtimeChannel);

  if (activeJobs.size > 0) {
    logger.info({ count: activeJobs.size }, 'waiting for active jobs to finish');
    const deadline = Date.now() + 300_000;
    while (activeJobs.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (activeJobs.size > 0) {
      logger.warn({ count: activeJobs.size }, 'force shutdown with active jobs remaining');
    }
  }

  if (whisperWorker) whisperWorker.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Boot ──────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'server started');

  whisperWorker = new WhisperWorker(WHISPER_MODEL);
  await whisperWorker.ready();

  await processPendingOnStartup();
  startRealtimeWorker();
  logger.info({ table: SUPABASE_TABLE }, 'waiting for new video URLs');
});
