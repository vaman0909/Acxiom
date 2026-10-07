const crypto = require('crypto');

function csrfProtection(req, res, next) {
  // Generate token in session if not present
  if (req.session) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;
    req.csrfToken = () => req.session.csrfToken;
  } else {
    req.csrfToken = () => '';
  }

  // Exempt read-only methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Exempt API requests and public auth endpoints
  if (req.originalUrl.startsWith('/api/') || req.originalUrl === '/auth/login' || req.originalUrl === '/auth/demo-login' || req.originalUrl === '/auth/register') {
    return next();
  }

  // Exempt requests that use JWT Bearer token authentication
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

  // For state-changing requests, check token in header or body
  const clientToken = req.headers['x-csrf-token'] || req.body?._csrf || req.query?._csrf;

  if (!clientToken || clientToken !== req.session?.csrfToken) {
    if (req.originalUrl.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({
        success: false,
        error: 'Invalid CSRF Token',
        message: 'Anti-forgery token validation failed. Please refresh the page.'
      });
    }
    return res.status(403).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>403 - Invalid Anti-Forgery Token</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
      </head>
      <body class="bg-light d-flex align-items-center justify-content-center vh-100">
        <div class="text-center p-5 bg-white rounded shadow-sm" style="max-width: 500px;">
          <h2 class="text-danger">Anti-Forgery Validation Failed</h2>
          <p class="text-muted">A security check failed (Invalid or missing CSRF token). Please return to the previous page and try again.</p>
          <a href="javascript:history.back()" class="btn btn-secondary me-2">Go Back</a>
          <a href="/dashboard" class="btn btn-primary">Dashboard</a>
        </div>
      </body>
      </html>
    `);
  }

  next();
}

module.exports = { csrfProtection };
