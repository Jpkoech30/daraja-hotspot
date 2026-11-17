const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

exports.ensureConfigured = () => {
  const missing = ['RESEND_API_KEY', 'RESEND_FROM_EMAIL']
    .filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Email verification is not configured. Missing: ${missing.join(', ')}`);
  }
};

exports.sendVerificationEmail = async (email, name, code) => {
  exports.ensureConfigured();

  const greeting = escapeHtml(name);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [email],
      subject: 'Your Daraja Hotspot verification code',
      html: `<p>Hello ${greeting},</p><p>Enter this code in Daraja Hotspot to verify your email address:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes and can only be used once. If you did not create this account, you can ignore this email.</p>`,
      text: `Hello ${name},\n\nEnter this code in Daraja Hotspot to verify your email address:\n\n${code}\n\nThis code expires in 10 minutes and can only be used once. If you did not create this account, you can ignore this email.`
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend email delivery failed with status ${response.status}: ${details}`);
  }
};
