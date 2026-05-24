'use strict';

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

module.exports = JobQueue;
