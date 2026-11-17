const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const authRepo = require('./auth.repo');
const emailService = require('../../services/email.service');

const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;

const createVerificationCode = () => {
  const code = crypto.randomInt(0, 100000000).toString().padStart(8, '0');
  return {
    code,
    hash: crypto.createHash('sha256').update(code).digest('hex'),
    expiresAt: new Date(Date.now() + VERIFICATION_CODE_TTL_MS)
  };
};

exports.login = async (email, password) => {
  const tenant = await authRepo.findTenantByEmail(email);

  if (!tenant || !tenant.password_hash) throw new Error('Invalid credentials');

  const isValid = await bcrypt.compare(password, tenant.password_hash);
  if (!isValid) throw new Error('Invalid credentials');
  if (!tenant.email_verified_at) throw new Error('Email not verified');
  if (tenant.status !== 'ACTIVE') throw new Error('Account suspended');

  const token = jwt.sign(
    { tenantId: tenant.id, email: tenant.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return { 
    token, 
    tenant: { id: tenant.id, name: tenant.name, email: tenant.email } 
  };
};

exports.register = async (name, email, password) => {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (normalizedName.length < 2 || normalizedName.length > 120) {
    throw new Error('ISP name must be between 2 and 120 characters');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new Error('A valid email address is required');
  }
  if (typeof password !== 'string' || password.length < 12
      || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password must be between 12 and 72 characters');
  }

  emailService.ensureConfigured();
  const passwordHash = await bcrypt.hash(password, 12);
  const verification = createVerificationCode();
  const tenant = await authRepo.createTenant(
    normalizedName,
    normalizedEmail,
    passwordHash,
    verification.hash,
    verification.expiresAt
  );
  await emailService.sendVerificationEmail(tenant.email, tenant.name, verification.code);

  return {
    message: 'Account created. Check your email for an 8-digit verification code before logging in.'
  };
};

exports.resendVerificationEmail = async (email) => {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new Error('A valid email address is required');
  }

  emailService.ensureConfigured();
  const verification = createVerificationCode();
  const tenant = await authRepo.updateUnverifiedTenantVerificationCode(
    normalizedEmail,
    verification.hash,
    verification.expiresAt
  );

  if (tenant) {
    await emailService.sendVerificationEmail(tenant.email, tenant.name, verification.code);
  }

  return {
    message: 'If an unverified account exists for that email, a verification code has been sent.'
  };
};

exports.verifyEmail = async (email, code) => {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254
      || typeof code !== 'string' || !/^\d{8}$/.test(code)) {
    throw new Error('Verification code is invalid, expired, or has too many attempts');
  }

  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const verified = await authRepo.verifyEmail(normalizedEmail, codeHash);
  if (!verified) throw new Error('Verification code is invalid, expired, or has too many attempts');

  return { message: 'Email verified. You can now log in.' };
};