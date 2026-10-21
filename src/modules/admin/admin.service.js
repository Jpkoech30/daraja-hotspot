// src/modules/admin/admin.service.js
const adminRepo = require('./admin.repo');
const { encrypt } = require('../../utils/crypto');

exports.saveMpesaSettings = async (tenantId, shortcode, consumerKey, consumerSecret) => {
  if (!shortcode || !consumerKey || !consumerSecret) {
    throw new Error('All M-Pesa fields are required');
  }

  // Encrypt the sensitive keys using our AES-256 utility
  const keyEnc = encrypt(consumerKey);
  const secretEnc = encrypt(consumerSecret);

  return await adminRepo.updateMpesaSettings(tenantId, shortcode, keyEnc, secretEnc);
};

exports.getDashboardStats = async (tenantId) => {
  return await adminRepo.getStats(tenantId);
};

exports.getPlans = async (tenantId) => {
  return await adminRepo.getPlans(tenantId);
};

exports.createPlan = async (tenantId, data) => {
  const { name, price, durationMin, profile } = data;
  
  if (!name || !price || !durationMin || !profile) {
    throw new Error('Missing required plan fields');
  }

  return await adminRepo.createPlan(tenantId, name, price, durationMin, profile);
};