require('dotenv').config();
const app = require('./src/app');
const { pool } = require('./src/config/db');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();