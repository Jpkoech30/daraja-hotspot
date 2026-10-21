<div align="center">

# 🇰🇪 Daraja Hotspot

### M-Pesa-powered Wi-Fi access for Kenyan mini-ISPs

Connect customer payments to MikroTik hotspot provisioning with a Node.js and PostgreSQL backend.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-4169E1?logo=postgresql&logoColor=white)
![M-Pesa](https://img.shields.io/badge/Payments-M--Pesa-brightgreen)

</div>

---

## Contents

- [Overview](#overview)
- [How it works](#how-it-works)
- [Features](#features)
- [Technology](#technology)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [API routes](#api-routes)
- [Project structure](#project-structure)
- [Development status](#development-status)

## Overview

**Daraja Hotspot** is a captive-portal and provisioning backend for mini-ISPs. Customers choose a Wi-Fi bundle and request an M-Pesa STK Push. After a successful payment callback, the backend queues a provisioning job for the MikroTik router agent.

The router initiates outbound requests to the backend, so the design does not require the backend to connect directly to a router behind carrier-grade NAT.

## How it works

```text
Customer                 Backend                    Safaricom             MikroTik
   |                        |                           |                     |
   |-- Choose a plan ------>|                           |                     |
   |-- Request STK Push ---->|-- Start payment -------->|                     |
   |<-- Enter M-Pesa PIN ----|<-- Payment prompt -------|                     |
   |                        |<-- Payment callback ------|                     |
   |                        |-- Queue provisioning job ---------------------> |
   |                        |<------------------------- Agent polls ----------|
   |<--------------------------- Internet access ----------------------------|
```

The generated RouterOS setup script schedules an agent poll every 30 seconds. The agent requests queued jobs, and the backend processes payment callbacks idempotently by locking the matching transaction while it is handled.

## Features

- Customer portal for listing plans and initiating checkout
- M-Pesa STK Push integration through Safaricom's Daraja **sandbox**
- Admin login and dashboard for plans, router setup, payment settings, and basic stats
- RouterOS script generation and an outbound polling endpoint for router agents
- PostgreSQL-backed tenants, routers, plans, transactions, and provisioning jobs
- AES-256-GCM encryption for stored M-Pesa consumer credentials
- JWT-based admin authentication and password hashing with bcrypt

## Technology

| Component | Technology |
| --- | --- |
| Runtime and web framework | Node.js 18+, Express 5 |
| Database | PostgreSQL 14+, `pg` |
| Payments | Safaricom Daraja API (sandbox endpoints) |
| Admin authentication | JWT, bcryptjs |
| Credential encryption | Node.js `crypto` (AES-256-GCM) |
| Frontend | Static HTML, CSS, and JavaScript |

## Getting started

### Prerequisites

- Node.js 18 or later
- PostgreSQL 14 or later
- Safaricom Daraja sandbox credentials for payment testing

### 1. Install dependencies

```bash
git clone <your-repository-url>
cd daraja-hotspot
npm install
```

### 2. Configure environment

Create a `.env` file in the project root using the variables in [Configuration](#configuration).

### 3. Create the development database

Create a PostgreSQL database (for example, `miniisp`), then run:

```bash
node setup.js
```

> **Warning:** The setup script drops and recreates the application's tables and inserts sample data. It is destructive—use it only with a disposable development database.

The seeded development login is `admin@eldoretfastnet.co.ke` / `password123`. Do not use these credentials in a deployed environment.

### 4. Start the server

```bash
npm run dev
```

The app listens on `http://localhost:3000` by default.

| Page | URL |
| --- | --- |
| Customer portal | <http://localhost:3000/> |
| Admin dashboard | <http://localhost:3000/admin/> |
| Health check | <http://localhost:3000/health> |

## Configuration

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/miniisp
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
ENCRYPTION_KEY=replace_with_64_hex_characters
BACKEND_URL=https://your-public-https-url
MPESA_CALLBACK_URL=https://your-public-https-url/api/webhooks/mpesa
```

`ENCRYPTION_KEY` must be exactly 64 hexadecimal characters (32 bytes). Use a cryptographically random value and keep it private. `BACKEND_URL` is used in the generated router setup script; the Daraja callback URL must be reachable by Safaricom. For local callback testing, expose your development server through a secure HTTPS tunnel and set both URLs accordingly.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/admin/auth/login` | Admin login |
| `GET` | `/api/admin/stats` | Dashboard statistics (authenticated) |
| `GET` | `/api/admin/plans` | List plans (authenticated) |
| `POST` | `/api/admin/plans` | Create a plan (authenticated) |
| `POST` | `/api/admin/settings/mpesa` | Save M-Pesa credentials (authenticated) |
| `POST` | `/api/admin/routers` | Create a router and generate its setup script (authenticated) |
| `GET` | `/api/portal/plans/:tenantId` | List active plans for a tenant |
| `POST` | `/api/portal/checkout` | Initiate an STK Push |
| `POST` | `/api/agents/poll` | Router agent heartbeat and job polling |
| `POST` | `/api/webhooks/mpesa` | Receive Daraja payment callbacks |
| `GET` | `/health` | Check that the server is running |

Protected admin routes require the JWT returned by the login endpoint.

## Project structure

```text
daraja-hotspot/
├── public/                 # Customer portal and admin dashboard
├── src/
│   ├── config/             # Database connection
│   ├── middlewares/        # Authentication middleware
│   ├── modules/            # Auth, admin, agents, checkout, plans, webhooks
│   ├── services/           # Daraja integration
│   ├── utils/              # Encryption helpers
│   └── app.js              # Express app and route registration
├── setup.js                # Destructive development database seeding
└── server.js               # Server entry point
```

## Development status

This project is under active development and is intended for local and sandbox testing. The Daraja integration currently targets Safaricom's sandbox, and the seeded account and sample records are for development only. Review and harden authentication, router-agent security, payment configuration, and deployment settings before handling real users or payments.

The package currently has no automated test suite configured.
