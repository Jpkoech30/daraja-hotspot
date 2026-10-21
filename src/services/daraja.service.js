// src/services/daraja.service.js
const getTimestamp = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

// 1. Get OAuth Token from Safaricom
exports.getAccessToken = async (consumerKey, consumerSecret) => {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const url = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` }
  });

  if (!response.ok) throw new Error('Failed to get M-Pesa Access Token');
  const data = await response.json();
  return data.access_token;
};

// 2. Initiate STK Push
exports.initiateStkPush = async (shortcode, passkey, phone, amount, accountRef, token) => {
  const timestamp = getTimestamp();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  const url = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

  // Format phone to 2547XXXXXXXX
  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.slice(1);
  if (formattedPhone.startsWith('7') || formattedPhone.startsWith('1')) formattedPhone = '254' + formattedPhone;

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: formattedPhone,
    PartyB: shortcode,
    PhoneNumber: formattedPhone,
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: accountRef || 'WiFi',
    TransactionDesc: 'WiFi Bundle Payment'
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  
  if (!response.ok || data.ResponseCode !== '0') {
    throw new Error(data.errorMessage || data.CustomerMessage || 'STK Push failed');
  }

  return {
    checkoutId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID
  };
};