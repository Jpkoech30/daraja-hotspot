const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const authRepo = require('./auth.repo');

exports.login = async (email, password) => {
  const tenant = await authRepo.findTenantByEmail(email);

  if (!tenant) throw new Error('Invalid credentials');
  if (tenant.status !== 'ACTIVE') throw new Error('Account suspended');

  const isValid = await bcrypt.compare(password, tenant.password_hash);
  if (!isValid) throw new Error('Invalid credentials');

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