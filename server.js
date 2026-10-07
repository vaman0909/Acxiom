const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

// Initialize database schema and seeds
require('./db');
require('./db/seed');

const { authMiddleware, requireAuth, requireRole } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const customerRoutes = require('./routes/customers');
const leadRoutes = require('./routes/leads');
const opportunityRoutes = require('./routes/opportunities');
const followupRoutes = require('./routes/followups');
const activityRoutes = require('./routes/activities');
const userRoutes = require('./routes/users');
const auditRoutes = require('./routes/audit');
const reportRoutes = require('./routes/reports');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Core Middleware
app.use(morgan('short'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Secure Session Configuration
app.use(session({
  name: 'acxiom_crm_sid',
  secret: process.env.SESSION_SECRET || 'AcxiomCRM_Secure_Production_Session_Secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Authentication & CSRF
app.use(authMiddleware);
app.use(csrfProtection);

const PUBLIC_DIR = path.join(__dirname, 'public');

// Page Routing
app.get('/', (req, res) => {
  if (req.user) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.user) {
    return res.redirect('/dashboard');
  }
  res.sendFile('login.html', { root: PUBLIC_DIR });
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile('dashboard.html', { root: PUBLIC_DIR });
});

app.get('/customers', requireAuth, (req, res) => {
  res.sendFile('customers.html', { root: PUBLIC_DIR });
});

app.get('/leads', requireAuth, (req, res) => {
  res.sendFile('leads.html', { root: PUBLIC_DIR });
});

app.get('/opportunities', requireAuth, (req, res) => {
  res.sendFile('opportunities.html', { root: PUBLIC_DIR });
});

app.get('/followups', requireAuth, (req, res) => {
  res.sendFile('followups.html', { root: PUBLIC_DIR });
});

app.get('/activities', requireAuth, (req, res) => {
  res.sendFile('activities.html', { root: PUBLIC_DIR });
});

app.get('/users', requireAuth, requireRole('Admin'), (req, res) => {
  res.sendFile('users.html', { root: PUBLIC_DIR });
});

app.get('/audit', requireAuth, requireRole('Admin', 'Manager'), (req, res) => {
  res.sendFile('audit.html', { root: PUBLIC_DIR });
});

app.get('/reports', requireAuth, (req, res) => {
  res.sendFile('reports.html', { root: PUBLIC_DIR });
});

app.get('/api-docs', requireAuth, (req, res) => {
  res.sendFile('api-docs.html', { root: PUBLIC_DIR });
});

// CSRF Token endpoint for client single-page interactions
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Mount Feature Routes
app.use('/auth', authRoutes);
app.use('/dashboard-data', dashboardRoutes);
app.use('/customers-data', customerRoutes);
app.use('/leads-data', leadRoutes);
app.use('/opportunities-data', opportunityRoutes);
app.use('/followups-data', followupRoutes);
app.use('/activities-data', activityRoutes);
app.use('/users-data', userRoutes);
app.use('/audit-data', auditRoutes);
app.use('/reports-data', reportRoutes);

// Mount Official REST API Specification
app.use('/api', apiRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Application Error]', err.stack);
  if (req.originalUrl.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    return res.status(err.status || 500).json({
      success: false,
      error: 'An internal server error occurred.',
      message: err.message
    });
  }
  res.status(500).send(`
    <!DOCTYPE html>
    <html>
    <head><title>500 Internal Server Error</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"></head>
    <body class="bg-light d-flex align-items-center justify-content-center vh-100">
      <div class="text-center p-5 bg-white rounded shadow-sm">
        <h2 class="text-danger">500 Server Error</h2>
        <p class="text-muted">A server-side error occurred while processing your request.</p>
        <a href="/dashboard" class="btn btn-primary">Return to Dashboard</a>
      </div>
    </body>
    </html>
  `);
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`  AcxiomCRM Enterprise System running on port ${PORT}`);
    console.log(`  URL: http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

module.exports = app;
