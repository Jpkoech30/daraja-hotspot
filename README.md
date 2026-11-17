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

The [ISP product landing page](./public/business.html), served at `/business`, explains the customer and operator journeys. Daraja currently supports time-based bundles, MikroTik hotspot provisioning, workspace payment/router reporting, and Safaricom Daraja **sandbox** checkout. It is not ready to process live customer payments; the ISP supplies and operates its own internet connection, Wi-Fi coverage, router policies, and customer support. Speed limits, data caps, and other router vendors are not supported by this build.

## How it works

```text
Customer                 Backend                    Safaricom             MikroTik
   |                        |                           |                     |
   |<-- Captive redirect -----------------------------------------------------|
   |-- Open payment portal->|                           |                     |
   |-- Choose a plan ------>|                           |                     |
   |-- Request STK Push ---->|-- Start payment -------->|                     |
   |<-- Enter M-Pesa PIN ----|<-- Payment prompt -------|                     |
   |                        |<-- Payment callback ------|                     |
   |                        |-- Queue provisioning job ->|                   |
   |                        |<------------------------- Agent polls ----------|
   |<-- Sign in to hotspot --|                           |                     |
```

The one-line RouterOS installer configures a hotspot login page that redirects unauthenticated customers to the ISP's payment portal, and adds a walled-garden allowance for the app host so the portal and checkout work before purchase. The app backend—not the unpaid customer—contacts Safaricom to initiate the STK Push. After payment, the router agent creates the hotspot user; the portal then submits that user's credentials to the router login page. Expiry disables the account and removes its active session. The generated RouterOS agent polls every 30 seconds using its `X-Agent-Token` header. Each poll is recorded in per-router minute buckets for dashboard ping counts; the dashboard refreshes received pings over the last hour and 24 hours, recent router connectivity, each active router's latest heartbeat, and latest agent poll every 30 seconds. The router setup wizard waits for an actual poll before confirming the connection; a heartbeat alone is not treated as proof that job polling works. On fetch failures, the router retains any pending job result for the next poll, logs the underlying error on the first failure and then every tenth consecutive failure, and logs when polling recovers. RouterOS job failures include the actual command error in the result sent to the backend. Jobs are returned as `jobId:ACTION:...`; the next poll reports the previous job as `jobId:SUCCESS:` or `jobId:FAILED:error message`.

## ISP manager workflow in Kenya

Daraja is for the ISP manager or owner who controls the internet service and MikroTik router used to provide customer Wi-Fi. You are responsible for the upstream internet connection, router, customer LAN/Wi-Fi coverage, bundle terms, and customer support. Daraja adds a captive portal, payment-testing flow, and router user provisioning; it does not supply internet bandwidth, configure the ISP's upstream/WAN service or Wi-Fi, or replace the ISP's responsibility to operate its network.

The usual operator workflow is:

1. **Prepare the internet service and equipment.** Confirm the ISP's upstream connection already works through the MikroTik. Decide which interface/bridge is the customer LAN, configure the Wi-Fi access point and SSID, and keep a separate way to administer the router. Back up the router before setup.
2. **Set up the ISP workspace.** Register the business/workspace, verify its email, then create bundles with clear KES prices and access durations. Current bundles represent time only, not a data cap or speed guarantee.
3. **Make the service reachable.** Host Daraja at a public HTTPS address. The router needs outbound access to that address to poll for setup and provisioning jobs; Safaricom needs to reach the configured callback. A local `localhost` URL is not usable by the router or Safaricom.
4. **Connect the customer-facing router LAN.** Add a router in the workspace, select the verified customer LAN if interface discovery would be ambiguous, then run the generated RouterOS command and confirm an agent poll appears in the dashboard. Never select the WAN interface as the hotspot LAN.
5. **Test payment and access end to end.** Configure sandbox Daraja credentials, connect a test device to the ISP's Wi-Fi, choose a test bundle, and complete the sandbox flow. Confirm callback, router provisioning, and hotspot sign-in before offering the workflow to customers.
6. **Operate and support the hotspot.** Check router connectivity and polling, review payment/provisioning status when a customer reports trouble, and maintain a separate support/refund/reconciliation process. Daraja currently does not manage those business processes or show an ISP support contact in the portal.

### What the ISP's customer experiences

1. **Connect to the ISP's Wi-Fi.** The customer joins the network configured by the ISP. MikroTik redirects an unauthenticated device to the hotspot portal. The ISP must configure its wireless access point/SSID and ensure the router's hotspot LAN reaches the internet; the Daraja installer does not create Wi-Fi networks.
2. **Choose a bundle.** The portal lists the ISP's active bundles and prices in Kenyan shillings (KES). The current bundle model sells access time (minutes); it does not enforce a data allowance, speed limit, or fair-use policy.
3. **Request an M-Pesa prompt.** The customer enters the Safaricom M-Pesa number on which they can approve an STK Push (for example, `0712 345 678`, `0112 345 678`, or `+254 712 345 678`) and taps **Pay with M-Pesa**. They should confirm the amount and business prompt on their phone before entering their M-Pesa PIN.
4. **Wait for payment confirmation.** Safaricom sends the payment result to the ISP backend callback. A customer closing the browser or a delayed callback may leave the portal waiting; the customer should not submit repeated payments just because the page is slow. The ISP should first check the M-Pesa message and dashboard transaction status.
5. **Receive Wi-Fi access.** After a successful callback, Daraja queues a job for that router. The router must be online and polling for the paid user to be created. When provisioning completes, the portal submits the hotspot credentials and signs the customer in automatically. If automatic sign-in cannot finish, reconnect to the SSID and follow the portal's prompt; the ISP can check router pings, transaction status, and provisioning outcomes in the admin dashboard.

The current payment adapter is for **Safaricom Daraja sandbox testing only**. It calls Safaricom sandbox endpoints and uses the Paybill STK transaction type. It is not configured for live Safaricom payments, Till/Buy Goods STK, Airtel Money, or other payment providers. Do not enter live customer credentials or advertise the current build as ready to collect real payments. A production launch requires a reviewed production Daraja integration and credentials, a production callback URL reachable over HTTPS, and end-to-end live-mode verification.

## Features

- Customer portal for listing plans and initiating checkout
- M-Pesa STK Push integration through Safaricom's Daraja **sandbox**
- Admin login and dashboard for plans, router setup, payment settings, and basic stats
- 7/30/90-day payment reporting, daily revenue trends, provisioning outcomes, and masked recent-payment activity
- One-line MikroTik hotspot setup with payment-portal redirect and pre-payment walled garden
- Guided MikroTik setup with live heartbeat confirmation after script installation
- RouterOS script generation and an outbound polling endpoint for router agents
- Expiry worker that queues `DISABLE_USER` jobs for expired hotspot users every minute
- Checkout status endpoint for frontend payment polling
- PostgreSQL-backed tenants, routers, plans, transactions, and provisioning jobs
- AES-256-GCM encryption for stored M-Pesa consumer credentials
- JWT-based admin authentication and password hashing with bcrypt

## Technology

| Component | Technology |
| --- | --- |
| Runtime and web framework | Node.js 18+, Express 5 |
| Database | PostgreSQL 14+, `pg` |
| Payments | Safaricom Daraja API (sandbox endpoints) |
| Background scheduling | `node-cron` |
| Admin authentication | JWT, bcryptjs, Resend email verification |
| Credential encryption | Node.js `crypto` (AES-256-GCM) |
| Frontend | React, Vite, HTML, and CSS |

## Getting started

### Prerequisites

- Node.js 18 or later
- PostgreSQL 14 or later
- Safaricom Daraja sandbox credentials for payment testing
- A MikroTik router supported by the generated RouterOS script, plus a configured WAN and customer LAN
- An internet-reachable HTTPS backend URL for Safaricom callbacks and router polling

### 1. Install dependencies

```bash
git clone <your-repository-url>
cd daraja-hotspot
npm install
```

### 2. Configure environment

Create a `.env` file in the project root using the variables in [Configuration](#configuration).

### 3. Apply database migrations

Create an empty PostgreSQL database (for example, `miniisp`), configure `DATABASE_URL`, then run:

```bash
npm run migrate
```

Build the React admin dashboard before starting the backend:

```bash
npm run build
npm start
```

For frontend development, run `npm run dev:admin` alongside `npm run dev`, then open <http://localhost:5173>. Vite proxies `/api` requests to `http://localhost:3000`; the Express backend remains the source of all API and database behavior. The customer portal remains served by Express as before.

Migrations are tracked in `schema_migrations` and are applied once, in filename order. They do not drop and recreate existing tables.

The development sample-data migrations run only when `NODE_ENV=development`. They create the sample login `admin@eldoretfast.co.ke` / `password123`; use it only for local development and never as a production credential.

### 4. Start the server

```bash
npm run dev
```

The app listens on `http://localhost:3000` by default.

| Page | URL |
| --- | --- |
| ISP product landing page | <http://localhost:3000/business> |
| Customer Wi-Fi portal | <http://localhost:3000/> |
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
RESEND_API_KEY=re_your_resend_api_key
RESEND_FROM_EMAIL=Daraja Hotspot <verify@your-verified-domain.com>
```

`ENCRYPTION_KEY` must be exactly 64 hexadecimal characters (32 bytes). Use a cryptographically random value and keep it private. `BACKEND_URL` is used in the generated router setup script; the Daraja callback URL must be reachable by Safaricom. For local callback testing, expose your development server through a secure HTTPS tunnel and set both URLs accordingly.

### Kenyan ISP setup checklist

1. **Create and verify the ISP account.** Register with a monitored business email and verify the one-time email code. Use a unique production password; the development seed login is only for local testing.
2. **Create clear KES bundles.** In **Bundles**, enter the customer-facing name, price in KES, access duration in minutes, and a MikroTik profile name. The current installer creates/uses a named profile but does not configure rate limits, data quotas, or fair-use limits. Make the duration and any separately managed speed policy clear to customers.
3. **Prepare the network before installing the hotspot.** Configure the MikroTik WAN and customer LAN, internet routing, DNS, and Wi-Fi/SSID separately. Decide which LAN interface or bridge serves paying customers. Keep management access on a path that will not be captured by the hotspot, and back up the router configuration before provisioning. The installer does not configure WAN, Wi-Fi, a bridge, or a full firewall policy.
4. **Expose the backend.** Set `BACKEND_URL` to the public HTTPS address routers can reach (never `localhost`), and set `MPESA_CALLBACK_URL` to its `/api/webhooks/mpesa` endpoint. Safaricom must be able to reach the callback. Keep TLS certificates valid and ensure the unpaid hotspot can reach the portal host and DNS.
5. **Configure M-Pesa for sandbox testing only.** Obtain sandbox app credentials and enter the sandbox shortcode, consumer key, consumer secret, and Lipa Na M-Pesa passkey in **M-Pesa settings**. The application currently targets Safaricom sandbox endpoints and Paybill STK. Use Safaricom's designated sandbox test numbers and follow its test-payment guidance; sandbox prompts do not move real funds. Live Daraja, Till/Buy Goods, and other providers are not supported by this configuration.
6. **Connect a router.** In **Routers → Add router**, enter its name and, when there is more than one candidate LAN, the verified customer-facing interface. Run the generated one-line command from RouterOS Terminal. Confirm the installer reaches completion and the dashboard receives an agent poll. The router makes outbound HTTPS requests; no inbound router port-forward is required.
7. **Run an end-to-end sandbox test.** Connect a test device to the customer SSID, choose a low-value test bundle, submit an allowed sandbox number, approve the test prompt as directed by Safaricom, and wait for callback, provisioning, and hotspot sign-in. Verify the transaction and router's last poll in the admin dashboard. Test failed/cancelled payment and offline-router behavior before inviting customers.
8. **Prepare customer support and operating procedures.** Tell customers which SSID to join, what bundle duration they are buying, how to approve the M-Pesa prompt, and how to contact the ISP if payment is confirmed but access does not arrive. The app does not currently store or display an ISP support phone number, issue refunds, or reconcile M-Pesa statements; provide those processes outside the portal.

To provision a MikroTik router, configure `BACKEND_URL` once as an HTTP(S) address the router can reach (not `localhost`). Create the ISP's bundles first, then choose **Connect router** and enter a router name. If the router has multiple possible LAN interfaces, enter the confirmed customer LAN interface in the optional interface field; discovery verifies that it exists, is enabled, and is not identified as WAN before using it. Otherwise, discovery excludes interfaces with an enabled DHCP client or active default route, then chooses the remaining unique bridge or Ethernet interface. It uses the interface's existing `/24` address as its gateway; if that interface has no address, it selects an unused `192.168.88.0/24` through `192.168.99.0/24` subnet and assigns its `.1` address. The script stops and prints candidate interfaces if it cannot identify exactly one safe LAN, if the existing LAN address is not `/24`, or if it cannot find an unused automatic subnet. It also stops rather than repurposing an unrelated hotspot server already attached to the customer LAN. It does not alter WAN settings. After discovery it downloads and imports the setup for that interface. A temporary heartbeat script reports once during installation; the recurring scheduler is installed only after the full job-provisioning poller is ready. The installer then adds any missing LAN IP, DHCP pool/server, Daraja hotspot server, bundle profiles, captive-login redirect, and app-host walled-garden rule, and registers the detected gateway with Daraja. It does not configure a WAN connection, create a bridge, or set up Wi-Fi. If a bundle is added later, the agent creates its MikroTik user profile when the first paid customer is provisioned. RouterOS-specific discovery and installation still need testing on CHR or a physical MikroTik before production use.

The generated scheduler invokes the `daraja-agent-poll` script by its script name. Agent POST responses are read directly from RouterOS Fetch output rather than using temporary files, avoiding missing response-file errors. The installer's initial heartbeat is best-effort and retries up to three times with a short delay; even if all attempts fail, it logs that setup is continuing and the installed poller retries on its normal schedule. Setup-status reports are also best-effort, while required setup downloads and gateway registration stop installation on failure. The installer checks for existing scripts and schedulers before removing them, so a clean first install does not fail when those items are absent. During installation, the router reports each setup checkpoint to the backend; the admin wizard displays the last completed step and flags setup that stops progressing, including the final installer download and import. The dashboard confirms router setup only after it observes an actual agent poll, separately from heartbeat-only check-ins. These statuses require the `011_router_poll_status.sql` and `012_router_setup_progress.sql` migrations.

Deleting a router from the dashboard requests a remote Daraja uninstall. The router must be online and polling; the admin list shows pending uninstall while it is offline. The MikroTik removes tagged Daraja hotspot users, the Daraja-named hotspot and DHCP server/pool/profile, Daraja-marked addresses, DHCP networks and user profiles, the walled-garden rule, the Daraja portal page, and the agent scheduler/script. It leaves WAN, bridges, Wi-Fi, and unmarked/unrelated configuration alone. The backend deletes the router record only after the router reports cleanup and confirms finalization. Routers with payment history remain protected and should be archived. To use the physical device again, add it after the uninstall finishes and run the newly generated setup command. RouterOS-specific cleanup should be checked on the target router before relying on it in production.

If RouterOS reports `SSL: internal error`, identify the exact `/tool fetch` URL from the reported script line; setup makes requests to the discovery, install, hotspot-login, configure, and setup-status endpoints. Check the MikroTik's clock (`/system clock print`), RouterOS version (`/system resource print`), and whether its trusted certificate store is current. From RouterOS Terminal, test the public hostname with `/tool fetch url="https://YOUR_BACKEND_HOST/health" output=user`; do not include an agent token in a shared log or disable certificate checking. If `/health` also fails with SSL, update RouterOS to a supported release and verify that the public HTTPS endpoint presents a valid, complete certificate chain compatible with that RouterOS release. If only an authenticated endpoint fails, check that endpoint's exact backend/proxy route and server logs. The installer reports the captured Fetch error before its final stop message, including the gateway registration request. Its heartbeat scheduler starts only after setup installs the full poller, avoiding concurrent scheduled HTTPS polls during setup.

If the download succeeds but RouterOS reports a syntax error while importing the setup file, rebuild/restart the backend and generate a fresh setup command before retrying. The poller's UUID regular expression must escape its `$` end-anchor for RouterOS string parsing; old downloaded scripts do not update themselves.

To verify connectivity independently of provisioning, create this diagnostic script and scheduler in RouterOS Terminal. Replace the backend host and router token locally; never share the token. This heartbeat-only script does not claim provisioning jobs.

```routeros
/system script add name="daraja-heartbeat-check" policy=ftp,read,write,policy,test source={
    :local response [/tool fetch url="https://YOUR_BACKEND_HOST/api/agents/heartbeat" http-method=post http-header-field="X-Agent-Token: YOUR_ROUTER_AGENT_TOKEN,Content-Type: text/plain" http-data="PING" as-value output=user]
}
/system scheduler add name="daraja-heartbeat-check" interval=30s on-event="daraja-heartbeat-check" policy=ftp,read,write,policy,test
/system script run daraja-heartbeat-check
```

ISP registration requires a working Resend configuration. Set `RESEND_API_KEY` to your private Resend API key and `RESEND_FROM_EMAIL` to a sender address on a domain verified in Resend. Do not commit these values. New ISP accounts must verify their email with an 8-digit code within 10 minutes before they can log in. Codes are single-use and limited to five attempts; the login screen can request a replacement code.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/admin/auth/login` | Admin login |
| `POST` | `/api/admin/auth/register` | Create an ISP tenant and email a verification code |
| `POST` | `/api/admin/auth/resend-verification` | Resend a verification code |
| `POST` | `/api/admin/auth/verify-email` | Verify an email using its one-time code |
| `GET` | `/api/admin/stats` | Dashboard statistics (authenticated) |
| `GET` | `/api/admin/overview?days=30` | Tenant-scoped payment, revenue, provisioning, and masked recent-payment data for 7, 30, or 90 days |
| `GET` | `/api/admin/plans` | List plans (authenticated) |
| `POST` | `/api/admin/plans` | Create a plan (authenticated) |
| `PUT` | `/api/admin/plans/:planId` | Update a plan or reactivate an archived plan (authenticated) |
| `DELETE` | `/api/admin/plans/:planId` | Archive a plan without deleting payment history (authenticated) |
| `GET` | `/api/admin/routers` | List routers (authenticated) |
| `POST` | `/api/admin/settings/mpesa` | Save M-Pesa shortcode, consumer key, consumer secret, and passkey (authenticated) |
| `GET` | `/api/admin/settings/mpesa` | Read M-Pesa configuration status without exposing secrets (authenticated) |
| `DELETE` | `/api/admin/settings/mpesa` | Clear stored M-Pesa credentials (authenticated) |
| `POST` | `/api/admin/routers` | Create a router and generate its setup script (authenticated) |
| `PUT` | `/api/admin/routers/:routerId` | Update or reactivate a router (authenticated) |
| `DELETE` | `/api/admin/routers/:routerId` | Archive a router without deleting its history (authenticated) |
| `GET` | `/api/portal/plans/:tenantId` | List active plans for a tenant |
| `POST` | `/api/portal/checkout` | Initiate an STK Push |
| `GET` | `/api/portal/checkout/status/:checkoutId` | Get a transaction's payment status |
| `GET` | `/api/portal/checkout/access/:checkoutId` | Retrieve credentials for a paid, provisioned client with its MAC and router login URL |
| `GET` | `/api/agents/discover` | Fetch authenticated RouterOS interface and gateway discovery script |
| `GET` | `/api/agents/install` | Fetch authenticated RouterOS provisioning script for detected interface and gateway |
| `POST` | `/api/agents/configure` | Register the gateway detected by an authenticated router |
| `GET` | `/api/agents/hotspot-login` | Fetch authenticated captive-portal redirect page |
| `POST` | `/api/agents/heartbeat` | Record an authenticated router heartbeat without claiming provisioning jobs |
| `POST` | `/api/agents/poll` | Router agent heartbeat and job polling |
| `POST` | `/api/webhooks/mpesa` | Receive Daraja payment callbacks |
| `GET` | `/health` | Check that the server is running |

Protected admin routes require the JWT returned by the login endpoint.

The customer portal reads `tenantId`, `routerId`, and `mac` from its URL query string. For example: `http://localhost:3000/?tenantId=<tenant-uuid>&routerId=<router-uuid>&mac=AA:BB:CC:DD:EE:FF`.

The expiry worker starts with the server and runs once per minute. Expired users are removed from `hotspot_users` as their `DISABLE_USER` provisioning jobs are queued, so routers can disconnect those accounts on their next poll.

## Tests

Run the unit tests with:

```bash
npm test
```

The PostgreSQL integration test is opt-in because it creates and drops uniquely named temporary databases. Set `TEST_DATABASE_URL` to a PostgreSQL URL for a role allowed to create databases, then run `npm test`. It checks clean production and development migrations, repeat migration runs, ISP CRUD, M-Pesa credential storage, and the payment-to-router provisioning database flow.

## Project structure

```text
daraja-hotspot/
├── frontend/admin/         # React admin dashboard (Vite)
├── public/                 # Customer portal and built admin assets
├── src/
│   ├── db/
│   │   ├── migrations/     # Versioned database changes
│   │   └── schema.sql       # Full schema reference
│   ├── config/             # Database connection
│   ├── middlewares/        # Authentication middleware
│   ├── modules/            # Auth, admin, agents, checkout, plans, webhooks
│   ├── workers/            # Scheduled expiry processing
│   ├── services/           # Daraja integration
│   ├── utils/              # Encryption helpers
│   └── app.js              # Express app and route registration
└── server.js               # Server entry point
```

## Development status

This project is under active development and is intended for local and sandbox testing. The Daraja integration currently targets Safaricom's sandbox, and the seeded account and sample records are for development only. Review and harden authentication, router-agent security, payment configuration, and deployment settings before handling real users or payments.

Run `npm test` for the automated tests. PostgreSQL migration integration tests are skipped unless `TEST_DATABASE_URL` points to a PostgreSQL server where the test role can create and drop temporary databases. The generated captive-portal setup still needs validation on a CHR or physical MikroTik running the target RouterOS version before production use.
