const express = require('express');
const authController = require('./auth.controller');
const { createRateLimiter } = require('../../middlewares/rate-limit');
const router = express.Router();

const loginLimiter = createRateLimiter({
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  suffix: 'login',
  message: 'Too many login attempts. Please wait 15 minutes before trying again.'
});

const registerLimiter = createRateLimiter({
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  suffix: 'register',
  message: 'Too many registration attempts. Please wait 15 minutes before trying again.'
});

const resendVerificationLimiter = createRateLimiter({
  maxAttempts: 3,
  windowMs: 15 * 60 * 1000,
  suffix: 'resend-verification',
  message: 'Too many verification requests. Please wait 15 minutes before trying again.'
});

const verifyEmailLimiter = createRateLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  suffix: 'verify-email',
  message: 'Too many verification attempts. Please wait 15 minutes before trying again.'
});

router.post('/login', loginLimiter, authController.login);
router.post('/register', registerLimiter, authController.register);
router.post('/resend-verification', resendVerificationLimiter, authController.resendVerificationEmail);
router.post('/verify-email', verifyEmailLimiter, authController.verifyEmail);

module.exports = router;