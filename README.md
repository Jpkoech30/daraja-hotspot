# 🇰🇪 Daraja Hotspot ⚡

**Daraja Hotspot** is a production-ready, Node.js provisioning backend built to empower Kenyan mini-ISPs (Internet Service Providers). It seamlessly bridges **Safaricom M-Pesa (Daraja API)** payments with **MikroTik RouterOS** to automate Wi-Fi sales, manage captive portals, and provision internet bundles.

Designed specifically for the local hustle, it allows entrepreneurs to sell "Mbao" bundles (KES 20) and scale their neighborhood Wi-Fi networks without needing expensive billing hardware or a public IP address.

---

## 🚨 The Problem

Selling Wi-Fi in Kenya is hard for small-scale ISPs. They face three major hurdles:
1. **CGNAT (Carrier-Grade NAT):** Most local ISPs use Airtel 5G or Starlink, which puts the MikroTik router behind a massive NAT. You cannot simply SSH or API into the router from a cloud server to provision users.
2. **Payment Integration:** Safaricom's Daraja API is powerful but complex. Building a reliable STK Push flow that doesn't double-charge or double-provision on webhook retries is difficult.
3. **Manual Vouchers:** Many ISPs still rely on printed vouchers, which are prone to theft and offer zero analytics. 

## 💡 The Solution: Agent Polling Architecture

Daraja Hotspot solves the CGNAT problem by using a **reverse-polling agent**. 
Instead of the cloud trying to talk to the router, the router talks to the cloud.

1. **The Agent:** A lightweight script runs on the local MikroTik router and polls our backend every 30 seconds via HTTPS. 
2. **The Payment:** A customer connects to the Wi-Fi, gets redirected to our captive portal, and triggers an M-Pesa STK Push.
3. **The Webhook:** Safaricom confirms the payment to our backend.
4. **The Queue:** The backend instantly queues a `CREATE_USER` job.
5. **The Execution:** The MikroTik agent picks up the job on its next poll and grants the user internet access. Total time: **< 30 seconds**.

---

## ✨ Key Features

*   **Multi-Tenant Architecture:** Built to handle multiple mini-ISPs from a single backend. Every query is strictly scoped by `tenant_id`.
*   **Zero ORM, Raw SQL Performance:** Uses native `pg` for PostgreSQL. No Prisma or Sequelize. This allows for advanced PostgreSQL features like `FOR UPDATE SKIP LOCKED` for reliable job queueing and partial indexing for high-speed polling.
*   **Idempotent Webhooks:** Built-in database locking ensures that even if Safaricom sends the same payment callback 10 times, the customer is only provisioned once.
*   **Robust Agent Security:** Routers authenticate using unique, SHA-256 hashed agent tokens. Revoking a router is as simple as flipping a database flag.
*   **Local Context:** Optimized for selling micro-bundles (10 KES, 20 KES) with MikroTik speed limits (Queues) to prevent network abuse.

---

## 🛠️ Tech Stack

*   **Runtime:** Node.js
*   **Framework:** Express.js
*   **Database:** PostgreSQL (Raw SQL via `pg` driver)
*   **Payments:** Safaricom Daraja API (STK Push)
*   **Router Integration:** MikroTik RouterOS API

---

## 📂 Project Structure

```text
daraja-hotspot/
├── server.js                  # Entry point
├── src/
│   ├── app.js                 # Express app setup
│   ├── config/
│   │   └── db.js              # PostgreSQL connection pool
│   ├── db/
│   │   └── schema.sql         # Database schema and indexes
│   └── modules/
│       ├── plans/             # Captive portal plan fetching
│       ├── checkout/          # M-Pesa STK Push initiation
│       ├── webhooks/          # Safaricom callbacks
│       └── agents/            # MikroTik polling endpoints
