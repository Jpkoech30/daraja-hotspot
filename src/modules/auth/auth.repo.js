const { pool } = require('../../config/db');

const getEmailAliases = (email) => {
  const trimmed = String(email || '').trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const variants = new Set([lower]);

  if (lower.includes('eldoretfastnet.co.ke')) {
    variants.add(lower.replace('eldoretfastnet.co.ke', 'eldoretfast.co.ke'));
  }

  if (lower.includes('eldoretfast.co.ke')) {
    variants.add(lower.replace('eldoretfast.co.ke', 'eldoretfastnet.co.ke'));
  }

  return Array.from(variants);
};

exports.findTenantByEmail = async (email) => {
  const aliases = getEmailAliases(email);
  if (aliases.length === 0) return null;

  const placeholders = aliases.map((_, index) => `$${index + 1}`).join(', ');
  const query = `
    SELECT id, name, email, password_hash, status, email_verified_at
    FROM tenants
    WHERE LOWER(TRIM(email)) IN (${placeholders})
    ORDER BY CASE LOWER(TRIM(email))
      WHEN LOWER(TRIM($${aliases.length + 1})) THEN 0
      ELSE 1
    END
    LIMIT 1
  `;

  const { rows } = await pool.query(query, [...aliases, aliases[0]]);
  return rows[0];
};

exports.createTenant = async (name, email, passwordHash, codeHash, codeExpiresAt) => {
  const query = `
    INSERT INTO tenants (
      name, email, password_hash, email_verification_code_hash,
      email_verification_expires_at
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, status, email_verified_at
  `;
  try {
    const { rows } = await pool.query(query, [
      name, email, passwordHash, codeHash, codeExpiresAt
    ]);
    return rows[0];
  } catch (error) {
    if (error.code === '23505'
        && ['idx_tenants_email_normalized', 'tenants_email_key'].includes(error.constraint)) {
      throw new Error('Email already registered');
    }
    throw error;
  }
};

exports.updateUnverifiedTenantVerificationCode = async (email, codeHash, codeExpiresAt) => {
  const aliases = getEmailAliases(email);
  if (aliases.length === 0) return null;

  const placeholders = aliases.map((_, index) => `$${index + 1}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE tenants
     SET email_verification_code_hash = $${aliases.length + 1},
         email_verification_expires_at = $${aliases.length + 2},
         email_verification_attempts = 0
     WHERE id = (
       SELECT id FROM tenants
       WHERE LOWER(TRIM(email)) IN (${placeholders})
         AND email_verified_at IS NULL
       ORDER BY CASE LOWER(TRIM(email))
         WHEN LOWER(TRIM($${aliases.length + 3})) THEN 0
         ELSE 1
       END
       LIMIT 1
       FOR UPDATE
     )
     RETURNING id, name, email`,
    [...aliases, codeHash, codeExpiresAt, aliases[0]]
  );
  return rows[0] || null;
};

exports.verifyEmail = async (email, codeHash) => {
  const aliases = getEmailAliases(email);
  if (aliases.length === 0) return false;

  const placeholders = aliases.map((_, index) => `$${index + 1}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE tenants
     SET email_verified_at = CASE
           WHEN email_verification_code_hash = $${aliases.length + 1} THEN NOW()
           ELSE email_verified_at
         END,
         email_verification_code_hash = CASE
           WHEN email_verification_code_hash = $${aliases.length + 1} THEN NULL
           ELSE email_verification_code_hash
         END,
         email_verification_expires_at = CASE
           WHEN email_verification_code_hash = $${aliases.length + 1} THEN NULL
           ELSE email_verification_expires_at
         END,
         email_verification_attempts = CASE
           WHEN email_verification_code_hash = $${aliases.length + 1} THEN 0
           ELSE email_verification_attempts + 1
         END
     WHERE id = (
       SELECT id FROM tenants
       WHERE LOWER(TRIM(email)) IN (${placeholders})
         AND email_verified_at IS NULL
         AND email_verification_expires_at > NOW()
         AND email_verification_attempts < 5
       ORDER BY CASE LOWER(TRIM(email))
         WHEN LOWER(TRIM($${aliases.length + 2})) THEN 0
         ELSE 1
       END
       LIMIT 1
       FOR UPDATE
     )
     RETURNING email_verified_at`,
    [...aliases, codeHash, aliases[0]]
  );
  return Boolean(rows[0] && rows[0].email_verified_at);
};
