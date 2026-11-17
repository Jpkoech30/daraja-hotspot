const authService = require('./auth.service');

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await authService.login(email, password);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error.message === 'Invalid credentials') {
      return res.status(401).json({ error: error.message });
    }
    if (error.message === 'Email not verified') {
      return res.status(403).json({ success: false, error: error.message });
    }
    next(error);
  }
};

exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    const result = await authService.register(name, email, password);
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    if (error.message === 'Email already registered') {
      return res.status(409).json({ success: false, error: error.message });
    }
    if (error.message.startsWith('ISP name ')
        || error.message === 'A valid email address is required'
        || error.message.startsWith('Password ')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
};

exports.resendVerificationEmail = async (req, res, next) => {
  try {
    const { email } = req.body || {};
    const result = await authService.resendVerificationEmail(email);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error.message === 'A valid email address is required') {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const { email, code } = req.body || {};
    const result = await authService.verifyEmail(email, code);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error.message === 'Verification code is invalid, expired, or has too many attempts') {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
};