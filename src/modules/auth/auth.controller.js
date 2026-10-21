const authService = require('./auth.service');

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await authService.login(email, password);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error.message === 'Invalid credentials') {
      return res.status(401).json({ error: error.message });
    }
    next(error);
  }
};