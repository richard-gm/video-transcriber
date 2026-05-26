'use strict';

const PATTERNS = [
  { id: 'youtube',   hosts: ['youtube.com', 'youtu.be'] },
  { id: 'tiktok',    hosts: ['tiktok.com'] },
  { id: 'instagram', hosts: ['instagram.com'] },
  { id: 'twitter',   hosts: ['twitter.com', 'x.com'] },
  { id: 'facebook',  hosts: ['facebook.com', 'fb.watch'] },
  { id: 'linkedin',  hosts: ['linkedin.com'] },
];

function detectPlatform(url) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^www\./, '');
    for (const { id, hosts } of PATTERNS) {
      if (hosts.some(h => host === h || host.endsWith('.' + h))) return id;
    }
  } catch {}
  return 'unknown';
}

module.exports = { detectPlatform };
