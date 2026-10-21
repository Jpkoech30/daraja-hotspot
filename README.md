🇰🇪 Daraja Hotspot ⚡
A Node.js provisioning backend built to empower Kenyan mini-ISPs.
It bridges Safaricom M-Pesa (Daraja API) payments with MikroTik RouterOS to automate Wi-Fi sales, manage captive portals, and provision internet bundles.

📖 Table of Contents
The Problem

The Solution: Agent Polling Architecture

Tech Stack

Core Features

Database Schema

Security & Idempotency

Local Development Setup

Roadmap

🚨 The Problem
Local mini-ISPs in Kenya face three major hurdles:

CGNAT (Carrier-Grade NAT): Routers using Starlink or Airtel 5G sit behind a NAT, meaning cloud backends cannot reach them directly via API to provision users.

Payment Complexity: Handling M-Pesa STK Push webhooks reliably without double-charging or double-provisioning is difficult.

Manual Vouchers: Traditional voucher sales lead to revenue loss and lack of analytics.

💡 The Solution: Agent Polling Architecture
Daraja Hotspot bypasses CGNAT by using a reverse-polling model. The router talks to the cloud, rather than the cloud talking to the router.

text
[ Customer's Phone ]
        │ 1. Connects to Wi-Fi
        ▼
[ MikroTik Router ] ────── 2. Redirects to Portal ──────▶ [ Express Backend ]
        ▲                                                         │
        │                                                         │ 3. Triggers STK Push
        │ 6. Agent polls every 30s,                               ▼
        │    picks up job, and                               [ Safaricom API ]
        │    executes locally.                                      │
        │                                                           │ 4. User enters PIN
        │                                                           ▼
        └────────────── 5. Webhook confirms payment ◀──────── [ Callback ]
A local MikroTik agent polls the backend every 30 seconds via HTTPS.

A customer connects to the Wi-Fi and is redirected to the captive portal.

The customer selects a plan and initiates an M-Pesa STK Push.

Safaricom sends a webhook to the backend confirming the payment.

The backend queues a CREATE_USER provisioning job.

The MikroTik agent picks up the job on its next poll and grants internet access.

🛠️ Tech Stack
We deliberately chose a lightweight, high-performance stack to ensure the backend can handle thousands of concurrent polling agents and webhooks without crashing.

🟢 Core Runtime & Framework
Node.js (v18+): Chosen for its non-blocking, event-driven I/O model. Perfect for handling thousands of simultaneous agent polling requests and asynchronous M-Pesa webhooks.

Express.js: A minimal and flexible Node.js web application framework used to structure our REST APIs, handle routing, and manage middleware (JWT, CORS, JSON parsing).

🗄️ Database & Data Layer
PostgreSQL (v14+): A powerful, open-source object-relational database. We rely heavily on its advanced features to guarantee financial security and job queue reliability.

pg (node-postgres): The non-blocking PostgreSQL client for Node.js.

Zero ORM: We write Raw SQL. This gives us 100% control over query performance, enables the use of partial indexes, and allows us to use FOR UPDATE SKIP LOCKED for a race-condition-free job queue.

💳 Payments & Integrations
Safaricom Daraja API: The official gateway for M-Pesa. We integrate directly via HTTP requests to initiate STK Pushes and listen for payment confirmation callbacks.

MikroTik RouterOS v7: The target hardware. Our backend generates custom RouterOS scripts that bypass the need to expose API ports to the public internet.

🛡️ Security & Utilities
jsonwebtoken & bcryptjs: Used for secure Admin Dashboard authentication and password hashing.

dotenv & Node.js crypto: Used to manage environment variables and implement AES-256-GCM encryption for securing tenants' M-Pesa API keys at rest.

✨ Core Features
Automated Router Onboarding: Mini-ISPs log into their dashboard and click "Generate Script." The backend provides a custom RouterOS script containing unique API tokens for them to paste into their router.

Real Daraja API Integration: Replaces manual vouchers with real STK Push prompts sent directly to the customer's phone.

Secure Multi-Tenancy: Every database query is strictly scoped by tenant_id. Tenant M-Pesa keys are encrypted with AES-256-GCM before storage.

Admin Dashboard: A clean web interface for ISPs to view revenue stats, manage Wi-Fi bundles, and update their Daraja API credentials.

Captive Portal: A responsive, browser-based payment page that automatically polls the backend and grants access the moment payment is confirmed.

🗄️ Database Schema
The database uses strict ENUM types and cascading foreign keys to ensure data integrity.

Table Name	Description	Key Fields
tenants	Mini-ISPs	id, email, password_hash, encrypted M-Pesa credentials
routers	MikroTik devices	tenant_id, local_ip, health, agent_token_hash
hotspot_plans	Products sold	name, price, duration_min, mikrotik_profile
transactions	M-Pesa records	checkout_id, receipt, phone, mac_address, status
jobs	Command queue	router_id, action, JSONB payload, status
🔒 Security & Idempotency
Financial-grade engineering rules applied to this system:

Webhook Idempotency: Uses SELECT ... FOR UPDATE on the transaction row. If Safaricom sends the same webhook twice, the backend ignores the duplicate.

Agent Authentication: Routers use a unique token generated by the dashboard. The backend stores only the SHA-256 hash of the token.

Tenant Isolation: Every repository function strictly requires a tenant_id in the WHERE clause.

Job Queue Integrity: Uses PostgreSQL FOR UPDATE SKIP LOCKED to guarantee race-condition-free job processing, ensuring a job is never given to two routers at once.

Encryption: M-Pesa Daraja Keys are encrypted at rest using AES-256-GCM.

🚀 Local Development Setup
Prerequisites
Node.js (v18+)

PostgreSQL (v14+)

1. Installation
Clone the repository and install dependencies:

bash
git clone <your-repo-url>
cd daraja-hotspot
npm install
2. Environment Variables
Create a .env file in the root directory:

env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres@localhost:5432/miniisp
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=7d
ENCRYPTION_KEY=your_64_character_hex_string
BACKEND_URL=https://your-ngrok-url.ngrok-free.app
3. Database Setup
Run the setup script to build tables and insert test data:

bash
node setup.js
(Default Admin Login: admin@eldoretfastnet.co.ke / password123)

4. Start the Server
bash
npm run dev
The server will start at http://localhost:3000.

Customer Portal: http://localhost:3000

Admin Dashboard: http://localhost:3000/admin

🗺️ Roadmap
☑ Phase 1: Project structure, Database schema, and Express setup.
☑ Phase 2: Tenant Management & Plan Fetching API.
☑ Phase 3: Safaricom Daraja API Integration (STK Push & Webhooks).
☑ Phase 4: MikroTik Agent Polling Endpoint & Auto-Script Generator.
☑ Phase 5: Captive Portal Frontend (HTML/JS).
☑ Phase 6: Admin Dashboard for Mini-ISPs (HTML/JS).
□ Phase 7: Airtel Money Integration.
□ Phase 8: Automated SMS Receipts and Expiry Reminders.