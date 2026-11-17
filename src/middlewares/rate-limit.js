const WINDOW_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const buckets = new Map();
let nextCleanupAt = 0;

const getKey = (req, suffix = '') => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const email = (req.body && typeof req.body.email === 'string')
    ? req.body.email.trim().toLowerCase()
    : '';

  return `${suffix}:${ip}:${email}`;
};

exports.createRateLimiter = ({ maxAttempts, windowMs = WINDOW_MS, suffix, message } = {}) => {
  return (req, res, next) => {
    const key = getKey(req, suffix);
    const now = Date.now();
    if (now >= nextCleanupAt) {
      for (const [bucketKey, existingBucket] of buckets) {
        if (now >= existingBucket.resetAt) buckets.delete(bucketKey);
      }
      nextCleanupAt = now + CLEANUP_INTERVAL_MS;
    }

    const bucket = buckets.get(key) || { attempts: 0, resetAt: now + windowMs };

    if (now >= bucket.resetAt) {
      bucket.attempts = 0;
      bucket.resetAt = now + windowMs;
    }

    if (bucket.attempts >= maxAttempts) {
      const retrySeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySeconds));
      return res.status(429).json({
        success: false,
        error: message || `Too many requests. Retry in ${retrySeconds} seconds.`
      });
    }

    bucket.attempts += 1;
    buckets.set(key, bucket);
    next();
  };
};
