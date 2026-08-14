/**
 * Sliding-window rate limit, per IP and in aggregate.
 *
 * In-memory on purpose: one small handler, one process, no store to run. A
 * restart forgives everyone, which is an acceptable trade for a contact form.
 */

export class RateLimiter {
  #max;
  #maxGlobal;
  #windowMs;
  /** @type {Map<string, number[]>} */
  #hits = new Map();

  constructor({ max, maxGlobal, windowMs }) {
    this.#max = max;
    this.#maxGlobal = maxGlobal;
    this.#windowMs = windowMs;

    // Sweep stale buckets so a long-running process doesn't accumulate an
    // entry per IP that ever visited. unref() keeps it from holding the
    // event loop open at shutdown.
    const sweep = setInterval(() => this.#prune(Date.now()), windowMs);
    sweep.unref();
  }

  #prune(now) {
    const cutoff = now - this.#windowMs;
    for (const [key, times] of this.#hits) {
      const live = times.filter((time) => time > cutoff);
      if (live.length) this.#hits.set(key, live);
      else this.#hits.delete(key);
    }
  }

  /**
   * Records an attempt.
   * @returns {{ allowed: boolean, retryAfterSec: number }}
   */
  take(key, now = Date.now()) {
    const cutoff = now - this.#windowMs;

    const times = (this.#hits.get(key) ?? []).filter((time) => time > cutoff);
    let total = 0;
    for (const [other, otherTimes] of this.#hits) {
      if (other !== key) total += otherTimes.filter((time) => time > cutoff).length;
    }
    total += times.length;

    if (times.length >= this.#max || total >= this.#maxGlobal) {
      const oldest = times[0] ?? now;
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((oldest + this.#windowMs - now) / 1000)),
      };
    }

    times.push(now);
    this.#hits.set(key, times);
    return { allowed: true, retryAfterSec: 0 };
  }
}
