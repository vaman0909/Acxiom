# AcxiomCRM

A full-stack, role-based CRM application built with Node.js, Express, SQLite, Chart.js, and Bootstrap 5. It manages the customer-sales lifecycle from lead acquisition to opportunity closing, follow-ups, activity tracking, audit logging, and revenue reporting.

---

## Features

- **Authentication & Security**
  - Session-based web auth and JWT bearer tokens for REST endpoints.
  - Passwords hashed with `bcrypt` (10 rounds).
  - Password complexity policy (minimum 8 chars, uppercase, lowercase, digit, and special char).
  - Account lockout after 5 consecutive failed attempts (15-minute freeze, manual unlock by admin).
  - CSRF protection on state-changing web requests (`POST`, `PUT`, `DELETE`).
  - Parameterized SQLite queries preventing SQL injection.

- **Role-Based Access Control (RBAC)**
  - `Admin`: Full system access, user provisioning, password resets, account unlocking, append-only audit trail, and all CRM records.
  - `Manager`: Team-wide visibility, pipeline monitoring, management reports, and deal review. No user administration.
  - `SalesExecutive`: Scoped access limited to assigned/created customers, leads, opportunities, follow-ups, and activities.
  - Quick role-switcher in top navigation for testing permission boundaries.

- **Lead Management & Conversion**
  - Track leads by source (*Website, Referral, Cold Call, Campaign, Partner*), priority, and status (*New, Contacted, Qualified, Unqualified, Converted, Lost*).
  - Transactional conversion workflow: promotes qualified leads to Customer Master accounts and optionally initializes a new Opportunity.
  - Converted leads cannot be un-converted.

- **Customer Master**
  - Complete master data (name, email, phone, company, address, assigned sales rep, notes).
  - Multi-field search (name, email, phone, company, code) and status filtering.
  - 360-degree customer detail view showing linked opportunities, follow-ups, and activity history.
  - Deletion guard: soft-deactivates accounts with active pipeline deals.

- **Opportunity Pipeline**
  - Stages: *Qualification, Proposal, Negotiation, Won, Lost*.
  - Enforces positive deal amount (`> 0`) and valid probability (`0` to `100`).
  - Active deals require a future expected close date (`>= today`).
  - Real-time weighted pipeline calculation: `Amount * (Probability / 100)`.

- **Follow-Ups & Activity Tracking**
  - Schedule calls, meetings, emails, and tasks with date validation (cannot be in the past for new/planned items).
  - Overdue alerts and one-click completion that auto-logs an interaction entry.
  - Filterable by type, status, and assigned executive.

- **Analytics Dashboard & Reports**
  - 10 KPI cards with role-based scoping and date range filters (All Time, This Month, This Week, Today).
  - Chart.js charts: Lead Status distribution (doughnut), Opportunity Pipeline by Stage (bar), and 6-Month revenue performance (line).
  - Stage-wise and owner-wise pipeline breakdown.
  - Conversion and win rate metrics.
  - Export data to CSV (Customers, Leads, Opportunities).

- **Audit Trail**
  - Immutable append-only log capturing user, action (`LOGIN`, `FAILED_LOGIN`, `LOCKOUT`, `CREATE`, `UPDATE`, `DELETE`, `ROLE_CHANGE`, `SECURITY`, `LEAD_CONVERSION`), entity, record ID, IP address, timestamp, and pre/post JSON diffs.

- **REST API & Built-In Tester**
  - Clean DTO payloads (passwords/hashes are never exposed).
  - Proper HTTP status codes (`200`, `201`, `400`, `401`, `403`, `404`, `423`).
  - Interactive API console available at `/api-docs` to test endpoints directly in the browser.

---

## Tech Stack

- **Backend:** Node.js (v20+ / v24), Express 5
- **Database:** SQLite via `better-sqlite3` (WAL mode enabled, foreign keys enforced)
- **Frontend:** Vanilla HTML5, Vanilla JavaScript, Bootstrap 5.3, Bootstrap Icons
- **Visualizations:** Chart.js 4.4
- **Auth & Security:** `bcryptjs`, `jsonwebtoken`, `express-session`, custom CSRF middleware

---

## Project Structure

```
AcxiomCRM/
├── db/
│   ├── index.js          # SQLite connection, pragmas, table schemas & indexes
│   ├── seed.js           # Seeds roles and initial admin/manager/sales accounts
│   ├── reset.js          # Clears CRM data (customers, leads, deals, logs)
│   └── crm.sqlite        # SQLite database file
├── middleware/
│   ├── auth.js           # Session & JWT auth, requireAuth, requireRole, sales scoping
│   ├── audit.js          # Append-only audit logger service
│   └── csrf.js           # Anti-forgery CSRF validation and API exemption
├── routes/
│   ├── auth.js           # Login, register, demo-login, logout, /me
│   ├── dashboard.js      # Role-scoped KPI stats and chart data
│   ├── customers.js      # Customer CRUD, search, history view
│   ├── leads.js          # Lead CRUD, search, conversion workflow
│   ├── opportunities.js  # Opportunity CRUD, pipeline calculations
│   ├── followups.js      # Follow-up scheduling, completion, reschedule
│   ├── activities.js     # Activity logging (calls, meetings, emails, tasks)
│   ├── users.js          # Admin user management, role assignments, lockout release
│   ├── audit.js          # Audit log retrieval with multi-field filters
│   ├── reports.js        # Pipeline, conversion, activity reports, CSV export
│   └── api.js            # Standard REST API endpoints (/api/*)
├── public/
│   ├── css/
│   │   └── style.css     # Enterprise design system, cards, tables, badges
│   ├── js/
│   │   ├── app.js        # Global session loader, client validation, toasts
│   │   └── dashboard.js  # Chart.js initialization and dynamic updates
│   ├── login.html
│   ├── dashboard.html
│   ├── customers.html
│   ├── leads.html
│   ├── opportunities.html
│   ├── followups.html
│   ├── activities.html
│   ├── users.html
│   ├── audit.html
│   ├── reports.html
│   └── api-docs.html     # Interactive API tester
├── tests/
│   ├── suite.test.js     # Automated acceptance test suite (all 14 scenarios)
│   ├── lockout.test.js   # 5-attempt account lockout and unlock test
│   └── routes.test.js    # HTML view route verification
├── server.js             # Main application entry point
└── package.json
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18, 20, or 24)
- npm

### Installation

1. Clone or navigate to the project directory:
   ```bash
   cd AcxiomCRM
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Initialize the database and default accounts:
   ```bash
   npm run seed
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. Open your browser and go to:
   ```
   http://localhost:3000
   ```

---

## Default Seed Accounts

The system initializes with clean default accounts for each role (no dummy customer or lead records):

| Role | Email | Password | Scope |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@acxiom.com` | `Admin@12345` | Global administration, user management, audit logs |
| **Manager** | `manager@acxiom.com` | `Manager@12345` | Full pipeline oversight, team reports, CRM records |
| **Sales Executive** | `sales@acxiom.com` | `Sales@12345` | Scoped to assigned records only |

*Note: The login page also includes 1-click login buttons for testing each role quickly.*

---

## Validation & Business Rules

Validation runs on both the client (instant browser feedback) and the server (re-validates all inputs before database operations):

| Field / Area | Validation Rule |
| :--- | :--- |
| **Customer Name** | Required, max 100 characters |
| **Customer Email** | Required, valid email format, must be unique across all customers |
| **Customer Phone** | Required, 10–15 digits, must be unique across all customers |
| **Lead Name** | Required, max 100 characters |
| **Lead Status** | Must be one of: `New`, `Contacted`, `Qualified`, `Unqualified`, `Converted`, `Lost` |
| **Opportunity Amount** | Numeric, strictly greater than 0 |
| **Probability** | Numeric, between 0 and 100 inclusive |
| **Expected Close Date** | Cannot be in the past for active opportunities |
| **Follow-Up Date** | Cannot be earlier than today for new or planned follow-ups |
| **Password Policy** | Minimum 8 characters, at least 1 uppercase, 1 lowercase, 1 number, 1 special character |
| **Account Lockout** | 5 consecutive failed logins lock the account for 15 minutes |

---

## REST API Reference

All protected endpoints require authentication via either a session cookie or a `Bearer <token>` header.

### Authentication
- `POST /api/auth/login` — Login with `{ email, password }`, returns JWT and user profile.
- `POST /api/auth/logout` — Invalidate session.

### Customers
- `GET /api/customers` — List customers (scoped by role).
- `GET /api/customers/:id` — Get customer details.
- `POST /api/customers` — Create customer.
- `PUT /api/customers/:id` — Update customer.
- `DELETE /api/customers/:id` — Delete / deactivate customer (Admin/Manager only).

### Leads
- `GET /api/leads` — List leads.
- `POST /api/leads` — Create lead.
- `POST /api/leads/:id/convert` — Convert lead to customer and optional opportunity.

### Opportunities
- `GET /api/opportunities` — List opportunities with weighted amounts.
- `POST /api/opportunities` — Create opportunity.
- `PUT /api/opportunities/:id` — Update opportunity.

### Follow-Ups
- `GET /api/followups` — List scheduled follow-ups.
- `POST /api/followups` — Schedule new follow-up.

### Reports
- `GET /api/reports/pipeline` — Stage-wise deal aggregation.

You can test these endpoints interactively using the built-in **REST API Explorer** at `http://localhost:3000/api-docs`.

---

## Useful Commands

```bash
# Start server
npm start

# Seed database with initial roles and accounts
npm run seed

# Purge all CRM data (customers, leads, deals, logs)
npm run reset

# Run automated acceptance test suite
node tests/suite.test.js

# Test 5-attempt account lockout policy
node tests/lockout.test.js

# Verify all HTML view routes return HTTP 200
node tests/routes.test.js
```

---

## License

ISC
