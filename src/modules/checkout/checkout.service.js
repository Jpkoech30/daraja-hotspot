

const checkoutRepo = require('./checkout.repo');

exports.initiateCheckout = async (tenantId, routerId, planId, phone, macAddress) => {
  // 1. Ask the repo to get the plan
  const plan = await checkoutRepo.getPlanPrice(planId, tenantId);
  
  if (!plan) {
    throw new Error('Invalid or inactive plan');
  }
  
  const amount = plan.price;

  // 2. MOCK M-PESA STK PUSH (To be replaced with real Daraja API later)
  const mockCheckoutId = `ws_CO_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  
  console.log(`[M-PESA MOCK] Sending STK Push to ${phone} for KES ${amount}`);
  console.log(`[M-PESA MOCK] Generated Checkout ID: ${mockCheckoutId}`);

  // 3. Ask the repo to save the transaction
  await checkoutRepo.createTransaction(
    tenantId, 
    routerId, 
    planId, 
    mockCheckoutId, 
    phone, 
    amount, 
    macAddress
  );

  return {
    success: true,
    checkoutId: mockCheckoutId,
    message: 'STK push sent. Please enter your M-Pesa PIN.'
  };
};