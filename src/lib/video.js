'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { logger } = require('../config');

function downloadVideo(url, tmpDir, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      '--no-playlist',
      '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--output', path.join(tmpDir, 'video.%(ext)s'),
      '--newline',
      // Use the iOS client API — bypasses YouTube bot detection on cloud IPs
      '--extractor-args', 'youtube:player_client=ios',
      url,
    ]);

    let lastPct = -1;
    const stderrChunks = [];

    proc.stderr.on('data', (d) => {
      stderrChunks.push(d.toString());
      const lines = d.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const pctMatch = line.match(/\[download\]\s+([\d.]+)%/);
        if (!pctMatch) continue;

        const pct = parseFloat(pctMatch[1]);
        if (pct - lastPct < 2 && pct < 100) continue;
        lastPct = pct;

        const speedMatch = line.match(/at\s+([\d.]+\s+\S+\/s)/);
        const etaMatch = line.match(/ETA\s+(\S+)/);
        const speed = speedMatch ? speedMatch[1] : null;
        const eta = etaMatch ? etaMatch[1] : null;

        const msg = eta && speed ? `Downloading (${speed}, ETA ${eta})` : 'Downloading...';
        onProgress({ percentage: pct, message: msg, eta });
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = stderrChunks.join('').trim();
        logger.error({ url, code, stderr }, 'yt-dlp failed');
        return reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-500)}`));
      }
      const downloaded = fs.readdirSync(tmpDir).find((f) => f.startsWith('video.'));
      if (!downloaded) return reject(new Error('Download produced no file'));
      resolve(downloaded);
    });

    proc.on('error', reject);
  });
}

function extractAudio(tmpDir, videoFile, onProgress) {
  return new Promise((resolve, reject) => {
    const audioPath = path.join(tmpDir, 'audio.wav');
    logger.info({ videoFile }, 'extracting audio');

    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      path.join(tmpDir, videoFile),
    ]);

    let totalDuration = 0;
    proc.stdout.on('data', (d) => {
      totalDuration = parseFloat(d.toString().trim()) || 0;
    });

    proc.on('close', (code) => {
      if (code !== 0) totalDuration = 0;

      const extract = spawn('ffmpeg', [
        '-i', path.join(tmpDir, videoFile),
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y',
        audioPath,
      ]);

      extract.stderr.on('data', (d) => {
        if (!totalDuration) return;
        const timeMatch = d.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (!timeMatch) return;
        const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        const pct = Math.min(100, Math.round((secs / totalDuration) * 100));
        if (pct % 5 === 0 || pct === 100) {
          onProgress({ percentage: pct, message: `Extracting audio (${pct}%)` });
        }
      });

      extract.on('close', (extractCode) => {
        if (extractCode !== 0) return reject(new Error(`ffmpeg exited with code ${extractCode}`));
        resolve(audioPath);
      });

      extract.on('error', reject);
    });

    proc.on('error', () => { totalDuration = 0; });
    proc.stdin.end();
  });
}

function getAudioDuration(audioPath) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      audioPath,
    ], (err, stdout) => {
      if (err) return resolve(0);
      resolve(parseFloat(stdout.trim()) || 0);
    });
  });
}

module.exports = { downloadVideo, extractAudio, getAudioDuration };
