'use strict';

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'videos';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 600_000, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// ── Core pipeline ─────────────────────────────────────────────────────────────
async function processVideo(id, url) {
  console.log(`[process] ${id} — ${url}`);

  // Mark as processing
  await supabase.from(SUPABASE_TABLE).update({ status: 'processing' }).eq('id', id);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtx-'));

  try {
    // 1. Download
    console.log(`[download] ${url}`);
    await run('yt-dlp', [
      '--no-playlist',
      '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--output', path.join(tmpDir, 'video.%(ext)s'),
      url,
    ]);

    const downloaded = fs.readdirSync(tmpDir).find((f) => f.startsWith('video.'));
    if (!downloaded) throw new Error('Download produced no file');

    // 2. Extract audio (16 kHz mono WAV — optimal for Whisper)
    const audioPath = path.join(tmpDir, 'audio.wav');
    console.log('[ffmpeg] extracting audio');
    await run('ffmpeg', [
      '-i', path.join(tmpDir, downloaded),
      '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y',
      audioPath,
    ]);

    // 3. Transcribe
    console.log(`[whisper] model=${WHISPER_MODEL}`);
    const out = await run('python3', [
      path.join(__dirname, 'scripts', 'transcribe.py'),
      audioPath,
      WHISPER_MODEL,
    ]);
    const { text } = JSON.parse(out);

    // 4. Save result to Supabase
    await supabase
      .from(SUPABASE_TABLE)
      .update({ status: 'done', transcript: text, processed_at: new Date().toISOString() })
      .eq('id', id);

    console.log(`[done] ${id}`);
  } catch (err) {
    console.error(`[error] ${id}:`, err.message);
    await supabase
      .from(SUPABASE_TABLE)
      .update({ status: 'error', error: err.message })
      .eq('id', id);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Supabase Realtime subscriber ──────────────────────────────────────────────
// Fires instantly when a new row is inserted — no polling, no cron.
function startRealtimeWorker() {
  const channel = supabase
    .channel('video-inserts')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: SUPABASE_TABLE },
      (payload) => {
        const { id, url, status } = payload.new;
        if (status !== 'pending') return; // skip if already picked up
        processVideo(id, url);
      },
    )
    .subscribe((state) => {
      console.log(`[realtime] ${state}`);
    });

  return channel;
}

// ── Pick up any pending rows missed while the app was offline ─────────────────
async function processPendingOnStartup() {
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select('id, url')
    .eq('status', 'pending');

  if (error) return console.error('[startup] could not fetch pending rows:', error.message);
  if (!data.length) return console.log('[startup] no pending rows');

  console.log(`[startup] found ${data.length} pending row(s) — processing now`);
  for (const row of data) {
    await processVideo(row.id, row.url);
  }
}

// ── Web server (view results) ─────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/transcriptions', async (_req, res) => {
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`Video transcriber running at http://localhost:${PORT}`);
  await processPendingOnStartup();
  startRealtimeWorker();
  console.log(`[realtime] subscribed to table "${SUPABASE_TABLE}" — waiting for new URLs`);
});
