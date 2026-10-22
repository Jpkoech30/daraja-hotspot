require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

// Import Routes
const plansRoutes = require('./modules/plans/plans.routes');
const checkoutRoutes = require('./modules/checkout/checkout.routes');
const agentsRoutes = require('./modules/agents/agents.routes');
const webhooksRoutes = require('./modules/webhooks/webhooks.routes');
const authRoutes = require('./modules/auth/auth.routes');
const adminRoutes = require('./modules/admin/admin.routes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// --- MOUNT ROUTES ---

// 1. Public Auth Routes (MUST be before /api/admin)
app.use('/api/admin/auth', authRoutes); 

// 2. Protected Admin Routes
app.use('/api/admin', adminRoutes); 

// 3. Portal & Agent Routes
app.use('/api/portal/plans', plansRoutes);
app.use('/api/portal/checkout', checkoutRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/webhooks', webhooksRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'daraja-hotspot backend is running' });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error'
  });
});

module.exports = app;