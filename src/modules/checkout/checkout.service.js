// src/modules/checkout/checkout.service.js
const checkoutRepo = require('./checkout.repo');
const darajaService = require('../../services/daraja.service');
const { decrypt } = require('../../utils/crypto');

exports.initiateCheckout = async (tenantId, routerId, planId, phone, macAddress) => {
  // 1. Verify plan
  const plan = await checkoutRepo.getPlanPrice(planId, tenantId);
  if (!plan) throw new Error('Invalid or inactive plan');
  
  const amount = plan.price;

  // 2. Fetch Tenant's M-Pesa Settings
  const tenant = await checkoutRepo.getTenantMpesaSettings(tenantId);
  if (!tenant || !tenant.mpesa_shortcode || !tenant.mpesa_key_enc) {
    throw new Error('This ISP has not configured their M-Pesa settings yet.');
  }

  // 3. Decrypt the keys
  const consumerKey = decrypt(tenant.mpesa_key_enc);
  const consumerSecret = decrypt(tenant.mpesa_secret_enc);
  // NOTE: For sandbox testing, we will use the standard Daraja sandbox passkey.
  // In production, you would add a `mpesa_passkey_enc` column to the tenants table.
  const sandboxPasskey = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919"; 

  console.log(`[M-PESA] Authenticating with Safaricom for Tenant ${tenantId}...`);
  const token = await darajaService.getAccessToken(consumerKey, consumerSecret);

  console.log(`[M-PESA] Triggering STK Push to ${phone} for KES ${amount}...`);
  const stkResult = await darajaService.initiateStkPush(
    tenant.mpesa_shortcode,
    sandboxPasskey, // Use the passkey
    phone,
    amount,
    macAddress,
    token
  );

  // 4. Save transaction with the REAL Safaricom Checkout ID
  await checkoutRepo.createTransaction(
    tenantId, 
    routerId, 
    planId, 
    stkResult.checkoutId, 
    phone, 
    amount, 
    macAddress
  );

  return {
    success: true,
    checkoutId: stkResult.checkoutId,
    message: 'STK push sent. Please enter your M-Pesa PIN.'
  };
};