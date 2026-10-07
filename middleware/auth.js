const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'AcxiomCRM_Super_Secret_Key_2026_Secure_Hash';

function generateToken(user) {
  return jwt.sign(
    {
      UserId: user.UserId,
      Name: user.Name,
      Email: user.Email,
      Role: user.Role
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function authMiddleware(req, res, next) {
  // 1. Check Bearer Token in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      // Verify user is still active in DB
      const user = db.prepare('SELECT UserId, Name, Email, Role, IsActive, FailedLoginCount, LockoutEnd FROM Users WHERE UserId = ?').get(decoded.UserId);
      if (user && user.IsActive) {
        req.user = user;
        return next();
      }
    } catch (e) {
      // Invalid JWT, continue to session check
    }
  }

  // 2. Check Session
  if (req.session && req.session.user) {
    const user = db.prepare('SELECT UserId, Name, Email, Role, IsActive, FailedLoginCount, LockoutEnd FROM Users WHERE UserId = ?').get(req.session.user.UserId);
    if (user && user.IsActive) {
      req.user = user;
      res.locals.currentUser = user;
      return next();
    } else {
      // User deactivated or deleted, clear session
      req.session.destroy();
    }
  }

  req.user = null;
  res.locals.currentUser = null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.originalUrl.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication is required to access this resource.'
      });
    }
    return res.redirect('/login?returnUrl=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      if (req.originalUrl.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required.'
        });
      }
      return res.redirect('/login');
    }

    if (!allowedRoles.includes(req.user.Role)) {
      if (req.originalUrl.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: `Access denied. Role '${req.user.Role}' does not have sufficient permissions for this operation.`
        });
      }
      return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>403 Forbidden - AcxiomCRM</title>
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
        </head>
        <body class="bg-light d-flex align-items-center justify-content-center vh-100">
          <div class="text-center p-5 bg-white rounded shadow-sm" style="max-width: 500px;">
            <h1 class="display-3 text-danger fw-bold">403</h1>
            <h4 class="mb-3">Access Denied</h4>
            <p class="text-muted">Your role (<strong>${req.user.Role}</strong>) does not have permission to access this module.</p>
            <a href="/dashboard" class="btn btn-primary mt-2">Return to Dashboard</a>
          </div>
        </body>
        </html>
      `);
    }
    next();
  };
}

// Scope check for SalesExecutive
function enforceSalesScope(req, assignedToId, createdById = null) {
  if (req.user.Role === 'Admin' || req.user.Role === 'Manager') {
    return true; // Unrestricted CRM scope for Admin & Manager
  }
  // SalesExecutive only permitted to access records assigned to them or created by them
  if (assignedToId === req.user.UserId || (createdById && createdById === req.user.UserId)) {
    return true;
  }
  return false;
}

module.exports = {
  authMiddleware,
  requireAuth,
  requireRole,
  enforceSalesScope,
  generateToken,
  JWT_SECRET
};
