const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { validatePasswordPolicy, isValidEmail, isValidPhone } = require('../utils/validation');

// Helper to sanitize user object for response (never expose password hash)
function toUserDTO(user) {
  if (!user) return null;
  const { PasswordHash, ...dto } = user;
  return dto;
}

// POST /auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required.'
    });
  }

  const user = db.prepare('SELECT * FROM Users WHERE Email = ? COLLATE NOCASE').get(email.trim());

  if (!user) {
    logAudit({
      userEmail: email,
      action: 'FAILED_LOGIN',
      entityName: 'Auth',
      result: 'FAILURE',
      details: 'Attempted login with non-existent email.',
      req
    });
    return res.status(401).json({
      success: false,
      error: 'Invalid email or password.'
    });
  }

  // Check if account is deactivated
  if (!user.IsActive) {
    logAudit({
      userId: user.UserId,
      userEmail: user.Email,
      action: 'FAILED_LOGIN',
      entityName: 'Auth',
      result: 'BLOCKED',
      details: 'Attempted login to deactivated account.',
      req
    });
    return res.status(403).json({
      success: false,
      error: 'Your account has been deactivated. Please contact an administrator.'
    });
  }

  // Check account lockout
  const now = new Date();
  if (user.LockoutEnd) {
    const lockoutDate = new Date(user.LockoutEnd);
    if (lockoutDate > now) {
      const minutesRemaining = Math.ceil((lockoutDate - now) / (60 * 1000));
      logAudit({
        userId: user.UserId,
        userEmail: user.Email,
        action: 'FAILED_LOGIN',
        entityName: 'Auth',
        result: 'BLOCKED',
        details: `Login attempted on locked account. Lockout ends in ${minutesRemaining} minutes.`,
        req
      });
      return res.status(423).json({
        success: false,
        error: `Account is temporarily locked due to repeated failed login attempts. Please try again in ${minutesRemaining} minute(s) or contact your administrator.`
      });
    } else {
      // Lockout duration expired, clear lockout
      db.prepare('UPDATE Users SET LockoutEnd = NULL, FailedLoginCount = 0 WHERE UserId = ?').run(user.UserId);
      user.FailedLoginCount = 0;
      user.LockoutEnd = null;
    }
  }

  // Verify password
  const isMatch = bcrypt.compareSync(password, user.PasswordHash);

  if (!isMatch) {
    const newFailedCount = (user.FailedLoginCount || 0) + 1;
    let lockoutEndVal = null;
    let message = 'Invalid email or password.';

    if (newFailedCount >= 5) {
      // 15-minute lockout
      const lockUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      lockoutEndVal = lockUntil;
      db.prepare('UPDATE Users SET FailedLoginCount = ?, LockoutEnd = ? WHERE UserId = ?').run(newFailedCount, lockUntil, user.UserId);

      logAudit({
        userId: user.UserId,
        userEmail: user.Email,
        action: 'LOCKOUT',
        entityName: 'Auth',
        recordId: user.UserId,
        result: 'SECURITY_ALERT',
        details: `Account locked after ${newFailedCount} consecutive failed attempts.`,
        req
      });

      return res.status(423).json({
        success: false,
        error: 'Too many failed login attempts. Your account has been temporarily locked for 15 minutes.'
      });
    } else {
      db.prepare('UPDATE Users SET FailedLoginCount = ? WHERE UserId = ?').run(newFailedCount, user.UserId);
      const remaining = 5 - newFailedCount;
      message += ` (${remaining} attempt${remaining === 1 ? '' : 's'} remaining before account lockout).`;
    }

    logAudit({
      userId: user.UserId,
      userEmail: user.Email,
      action: 'FAILED_LOGIN',
      entityName: 'Auth',
      recordId: user.UserId,
      result: 'FAILURE',
      details: `Password mismatch (Failed count: ${newFailedCount}).`,
      req
    });

    return res.status(401).json({
      success: false,
      error: message
    });
  }

  // Password correct: Reset failed attempts & lockout
  db.prepare('UPDATE Users SET FailedLoginCount = 0, LockoutEnd = NULL WHERE UserId = ?').run(user.UserId);

  // Store in session
  const userDto = toUserDTO(user);
  req.session.user = userDto;

  // Generate JWT token
  const token = generateToken(userDto);

  logAudit({
    userId: user.UserId,
    userEmail: user.Email,
    action: 'LOGIN',
    entityName: 'Auth',
    recordId: user.UserId,
    result: 'SUCCESS',
    details: `User logged in with role: ${user.Role}.`,
    req
  });

  return res.json({
    success: true,
    message: 'Login successful.',
    user: userDto,
    token,
    redirectUrl: '/dashboard'
  });
});

// Demo Login route for quick role switching during evaluation
router.post('/demo-login', (req, res) => {
  const { role } = req.body;
  const roleMap = {
    Admin: 'admin@acxiom.com',
    Manager: 'manager@acxiom.com',
    SalesExecutive: 'sales@acxiom.com'
  };

  const targetEmail = roleMap[role];
  if (!targetEmail) {
    return res.status(400).json({ success: false, error: 'Invalid demo role.' });
  }

  const user = db.prepare('SELECT * FROM Users WHERE Email = ?').get(targetEmail);
  if (!user) {
    return res.status(404).json({ success: false, error: 'Demo user not found.' });
  }

  // Reset lockout if any
  db.prepare('UPDATE Users SET FailedLoginCount = 0, LockoutEnd = NULL WHERE UserId = ?').run(user.UserId);

  const userDto = toUserDTO(user);
  req.session.user = userDto;
  const token = generateToken(userDto);

  logAudit({
    userId: user.UserId,
    userEmail: user.Email,
    action: 'LOGIN',
    entityName: 'Auth',
    recordId: user.UserId,
    result: 'SUCCESS',
    details: `Demo quick login as ${user.Role}.`,
    req
  });

  return res.json({
    success: true,
    message: `Logged in as ${user.Role}`,
    user: userDto,
    token,
    redirectUrl: '/dashboard'
  });
});

// POST /auth/register
router.post('/register', (req, res) => {
  const { name, email, phone, password, role } = req.body;

  const errors = [];

  if (!name || !name.trim()) errors.push('Full Name is required.');
  if (!email || !isValidEmail(email)) errors.push('Enter a valid email address.');
  if (!phone || !isValidPhone(phone)) errors.push('Enter a valid phone number (minimum 10 digits).');

  const passwordPolicy = validatePasswordPolicy(password);
  if (!passwordPolicy.isValid) {
    errors.push(...passwordPolicy.errors);
  }

  // Check unique email
  if (email) {
    const existing = db.prepare('SELECT UserId FROM Users WHERE Email = ? COLLATE NOCASE').get(email.trim());
    if (existing) {
      errors.push('An account with this email address already exists.');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: errors[0],
      errors
    });
  }

  const allowedRoles = ['Admin', 'Manager', 'SalesExecutive'];
  const userRole = (role && allowedRoles.includes(role)) ? role : 'SalesExecutive';

  const saltRounds = 10;
  const passwordHash = bcrypt.hashSync(password, saltRounds);
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO Users (Name, Email, PasswordHash, Role, Phone, IsActive, FailedLoginCount, CreatedDate)
    VALUES (?, ?, ?, ?, ?, 1, 0, ?)
  `);

  const result = insert.run(name.trim(), email.trim(), passwordHash, userRole, phone ? phone.trim() : null, now);
  const newUserId = result.lastInsertRowid;

  const newUser = db.prepare('SELECT * FROM Users WHERE UserId = ?').get(newUserId);
  const userDto = toUserDTO(newUser);

  logAudit({
    userId: newUserId,
    userEmail: newUser.Email,
    action: 'CREATE',
    entityName: 'User',
    recordId: newUserId,
    result: 'SUCCESS',
    details: `New user self-registered with role ${userRole}.`,
    req
  });

  // Automatically sign in the user
  req.session.user = userDto;
  const token = generateToken(userDto);

  return res.status(201).json({
    success: true,
    message: 'Registration successful!',
    user: userDto,
    token,
    redirectUrl: '/dashboard'
  });
});

// POST & GET /auth/logout
const handleLogout = (req, res) => {
  if (req.user) {
    logAudit({
      userId: req.user.UserId,
      userEmail: req.user.Email,
      action: 'LOGOUT',
      entityName: 'Auth',
      recordId: req.user.UserId,
      result: 'SUCCESS',
      details: 'User logged out.',
      req
    });
  }

  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      if (req.headers.accept?.includes('application/json')) {
        return res.json({ success: true, message: 'Logged out successfully.' });
      }
      return res.redirect('/login');
    });
  } else {
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: 'Logged out successfully.' });
    }
    return res.redirect('/login');
  }
};

router.post('/logout', handleLogout);
router.get('/logout', handleLogout);

// GET /auth/me
router.get('/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated.' });
  }
  return res.json({
    success: true,
    user: toUserDTO(req.user)
  });
});

module.exports = router;
