const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { validatePasswordPolicy, isValidEmail, isValidPhone } = require('../utils/validation');

// Entire router restricted to Admin only
router.use(requireRole('Admin'));

// Helper to sanitize users list
function sanitizeUser(u) {
  const { PasswordHash, ...safe } = u;
  safe.isLocked = safe.LockoutEnd ? new Date(safe.LockoutEnd) > new Date() : false;
  return safe;
}

// GET /users (List users)
router.get('/', (req, res) => {
  const users = db.prepare(`
    SELECT UserId, Name, Email, Role, Phone, IsActive, FailedLoginCount, LockoutEnd, CreatedDate
    FROM Users
    ORDER BY UserId ASC
  `).all();

  const sanitized = users.map(u => ({
    ...u,
    isLocked: u.LockoutEnd ? new Date(u.LockoutEnd) > new Date() : false
  }));

  const roles = db.prepare('SELECT * FROM Roles').all();

  res.json({
    success: true,
    users: sanitized,
    roles
  });
});

// POST /users (Create new user)
router.post('/', (req, res) => {
  const { Name, Email, Password, Role, Phone } = req.body;
  const errors = [];

  if (!Name || !Name.trim()) errors.push('Full Name is required.');
  if (!Email || !isValidEmail(Email)) errors.push('Enter a valid email address.');
  if (Phone && !isValidPhone(Phone)) errors.push('Enter a valid phone number.');

  const pwCheck = validatePasswordPolicy(Password);
  if (!pwCheck.isValid) errors.push(...pwCheck.errors);

  const validRoles = ['Admin', 'Manager', 'SalesExecutive'];
  if (!Role || !validRoles.includes(Role)) errors.push('A valid Role (Admin, Manager, SalesExecutive) is required.');

  // Check email uniqueness
  const existing = db.prepare('SELECT UserId FROM Users WHERE Email = ? COLLATE NOCASE').get(Email ? Email.trim() : '');
  if (existing) errors.push('A user with this email address already exists.');

  if (errors.length > 0) {
    return res.status(400).json({ success: false, error: errors[0], errors });
  }

  const saltRounds = 10;
  const hash = bcrypt.hashSync(Password, saltRounds);
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO Users (Name, Email, PasswordHash, Role, Phone, IsActive, FailedLoginCount, CreatedDate)
    VALUES (?, ?, ?, ?, ?, 1, 0, ?)
  `);

  const result = insert.run(Name.trim(), Email.trim(), hash, Role, Phone ? Phone.trim() : null, now);
  const newUserId = result.lastInsertRowid;
  const newUser = db.prepare('SELECT UserId, Name, Email, Role, Phone, IsActive, CreatedDate FROM Users WHERE UserId = ?').get(newUserId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'CREATE',
    entityName: 'User',
    recordId: newUserId,
    newValue: newUser,
    result: 'SUCCESS',
    details: `Admin created user ${Name} with role ${Role}.`,
    req
  });

  res.status(201).json({
    success: true,
    message: 'User created successfully.',
    user: newUser
  });
});

// PUT /users/:id (Update user details / Role / Active status)
router.put('/:id', (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Users WHERE UserId = ?').get(targetId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  const { Name, Phone, Role, IsActive } = req.body;

  const validRoles = ['Admin', 'Manager', 'SalesExecutive'];
  if (Role && !validRoles.includes(Role)) {
    return res.status(400).json({ success: false, error: 'Invalid Role specified.' });
  }

  const roleChanged = Role && Role !== existing.Role;
  const newRole = Role || existing.Role;
  const newIsActive = IsActive !== undefined ? (IsActive ? 1 : 0) : existing.IsActive;

  db.prepare(`
    UPDATE Users
    SET Name = ?, Phone = ?, Role = ?, IsActive = ?
    WHERE UserId = ?
  `).run(
    Name ? Name.trim() : existing.Name,
    Phone ? Phone.trim() : existing.Phone,
    newRole,
    newIsActive,
    targetId
  );

  const updated = db.prepare('SELECT UserId, Name, Email, Role, Phone, IsActive, CreatedDate FROM Users WHERE UserId = ?').get(targetId);

  if (roleChanged) {
    logAudit({
      userId: req.user.UserId,
      userEmail: req.user.Email,
      action: 'ROLE_CHANGE',
      entityName: 'User',
      recordId: targetId,
      oldValue: { Role: existing.Role },
      newValue: { Role: newRole },
      result: 'SUCCESS',
      details: `Role of ${existing.Name} changed from ${existing.Role} to ${newRole}.`,
      req
    });
  } else {
    logAudit({
      userId: req.user.UserId,
      userEmail: req.user.Email,
      action: 'UPDATE',
      entityName: 'User',
      recordId: targetId,
      oldValue: { Name: existing.Name, IsActive: existing.IsActive },
      newValue: { Name: updated.Name, IsActive: updated.IsActive },
      result: 'SUCCESS',
      details: `User ${existing.Email} details updated.`,
      req
    });
  }

  res.json({
    success: true,
    message: 'User updated successfully.',
    user: updated
  });
});

// POST /users/:id/reset-password
router.post('/:id/reset-password', (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Users WHERE UserId = ?').get(targetId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  const { newPassword } = req.body;
  const check = validatePasswordPolicy(newPassword);
  if (!check.isValid) {
    return res.status(400).json({ success: false, error: check.errors[0], errors: check.errors });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE Users SET PasswordHash = ?, FailedLoginCount = 0, LockoutEnd = NULL WHERE UserId = ?').run(hash, targetId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'SECURITY',
    entityName: 'User',
    recordId: targetId,
    result: 'SUCCESS',
    details: `Admin reset password for user ${existing.Email}.`,
    req
  });

  res.json({
    success: true,
    message: `Password reset successfully for ${existing.Name}.`
  });
});

// POST /users/:id/unlock (Unlock locked account)
router.post('/:id/unlock', (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Users WHERE UserId = ?').get(targetId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  db.prepare('UPDATE Users SET FailedLoginCount = 0, LockoutEnd = NULL WHERE UserId = ?').run(targetId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'SECURITY',
    entityName: 'User',
    recordId: targetId,
    oldValue: { LockoutEnd: existing.LockoutEnd, FailedLoginCount: existing.FailedLoginCount },
    newValue: { LockoutEnd: null, FailedLoginCount: 0 },
    result: 'SUCCESS',
    details: `Admin unlocked user account ${existing.Email}.`,
    req
  });

  res.json({
    success: true,
    message: `Account for ${existing.Name} has been unlocked.`
  });
});

module.exports = router;
