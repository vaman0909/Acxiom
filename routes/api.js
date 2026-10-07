const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, enforceSalesScope, generateToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const bcrypt = require('bcryptjs');
const {
  validateCustomerPayload,
  validateLeadPayload,
  validateOpportunityPayload,
  validateFollowUpPayload,
  getTodayISODate
} = require('../utils/validation');

// --- REST API AUTH ENDPOINTS ---
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM Users WHERE Email = ? COLLATE NOCASE').get(email.trim());
  if (!user || !user.IsActive) {
    return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
  }

  if (user.LockoutEnd && new Date(user.LockoutEnd) > new Date()) {
    return res.status(423).json({ error: 'Account is temporarily locked due to repeated failed login attempts.' });
  }

  const isMatch = bcrypt.compareSync(password, user.PasswordHash);
  if (!isMatch) {
    const failedCount = (user.FailedLoginCount || 0) + 1;
    if (failedCount >= 5) {
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.prepare('UPDATE Users SET FailedLoginCount = ?, LockoutEnd = ? WHERE UserId = ?').run(failedCount, lockUntil, user.UserId);
      return res.status(423).json({ error: 'Account locked for 15 minutes due to too many failed attempts.' });
    }
    db.prepare('UPDATE Users SET FailedLoginCount = ? WHERE UserId = ?').run(failedCount, user.UserId);
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  // Reset lockout
  db.prepare('UPDATE Users SET FailedLoginCount = 0, LockoutEnd = NULL WHERE UserId = ?').run(user.UserId);

  const { PasswordHash, ...safeUser } = user;
  const token = generateToken(safeUser);

  logAudit({
    userId: user.UserId,
    userEmail: user.Email,
    action: 'API_LOGIN',
    entityName: 'Auth',
    recordId: user.UserId,
    result: 'SUCCESS',
    details: 'Authenticated via REST API.',
    req
  });

  return res.json({
    token,
    user: safeUser
  });
});

router.post('/auth/logout', requireAuth, (req, res) => {
  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'API_LOGOUT',
    entityName: 'Auth',
    recordId: req.user.UserId,
    result: 'SUCCESS',
    details: 'Logged out via REST API.',
    req
  });
  res.json({ message: 'Successfully logged out.' });
});

// --- REST API CUSTOMERS ---
router.get('/customers', requireAuth, (req, res) => {
  const user = req.user;
  const isSales = user.Role === 'SalesExecutive';
  const query = `
    SELECT c.CustomerId, c.CustomerCode, c.CustomerName, c.Email, c.Phone, c.CompanyName,
           c.Address, c.City, c.State, c.Status, c.CreatedDate, u.Name as AssignedToName
    FROM Customers c
    LEFT JOIN Users u ON c.AssignedTo = u.UserId
    ${isSales ? `WHERE (c.AssignedTo = ${user.UserId} OR c.CreatedBy = ${user.UserId})` : ''}
    ORDER BY c.CustomerId DESC
  `;
  const customers = db.prepare(query).all();
  res.json(customers);
});

router.get('/customers/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = db.prepare(`
    SELECT c.CustomerId, c.CustomerCode, c.CustomerName, c.Email, c.Phone, c.CompanyName,
           c.Address, c.City, c.State, c.Status, c.CreatedDate, c.AssignedTo, c.CreatedBy,
           u.Name as AssignedToName
    FROM Customers c
    LEFT JOIN Users u ON c.AssignedTo = u.UserId
    WHERE c.CustomerId = ?
  `).get(id);

  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  if (!enforceSalesScope(req, c.AssignedTo, c.CreatedBy)) {
    return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
  }
  res.json(c);
});

router.post('/customers', requireAuth, (req, res) => {
  const errors = validateCustomerPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { CustomerName, Email, Phone, CompanyName, Address, City, State, Status = 'Active', AssignedTo, Notes } = req.body;
  const maxRow = db.prepare('SELECT MAX(CustomerId) as maxId FROM Customers').get();
  const nextId = (maxRow?.maxId || 1000) + 1;
  const customerCode = req.body.CustomerCode || `CUST-${nextId}`;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const assigned = AssignedTo ? parseInt(AssignedTo, 10) : req.user.UserId;

  const insert = db.prepare(`
    INSERT INTO Customers (CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy, AssignedTo, Notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(customerCode, CustomerName.trim(), Email.trim(), Phone.trim(), CompanyName || null, Address || null, City || null, State || null, Status, now, req.user.UserId, assigned, Notes || null);
  const created = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(result.lastInsertRowid);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'CREATE',
    entityName: 'Customer',
    recordId: result.lastInsertRowid,
    newValue: created,
    details: 'Created via REST API.',
    req
  });

  res.status(201).json(created);
});

router.put('/customers/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Customer not found.' });

  if (!enforceSalesScope(req, existing.AssignedTo, existing.CreatedBy)) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  const errors = validateCustomerPayload(req.body, id);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { CustomerName, Email, Phone, CompanyName, Address, City, State, Status, AssignedTo, Notes } = req.body;
  const assigned = AssignedTo !== undefined ? parseInt(AssignedTo, 10) : existing.AssignedTo;

  db.prepare(`
    UPDATE Customers
    SET CustomerName = ?, Email = ?, Phone = ?, CompanyName = ?, Address = ?, City = ?, State = ?, Status = ?, AssignedTo = ?, Notes = ?
    WHERE CustomerId = ?
  `).run(CustomerName.trim(), Email.trim(), Phone.trim(), CompanyName || null, Address || null, City || null, State || null, Status || existing.Status, assigned, Notes || null, id);

  const updated = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(id);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'UPDATE',
    entityName: 'Customer',
    recordId: id,
    oldValue: existing,
    newValue: updated,
    details: 'Updated via REST API.',
    req
  });

  res.json(updated);
});

router.delete('/customers/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Customer not found.' });

  if (req.user.Role !== 'Admin' && req.user.Role !== 'Manager') {
    return res.status(403).json({ error: 'Forbidden: Only Admin and Manager can delete customers.' });
  }

  db.prepare('DELETE FROM Customers WHERE CustomerId = ?').run(id);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'DELETE',
    entityName: 'Customer',
    recordId: id,
    oldValue: existing,
    details: 'Deleted via REST API.',
    req
  });

  res.status(200).json({ message: 'Customer deleted successfully.' });
});

// --- REST API LEADS ---
router.get('/leads', requireAuth, (req, res) => {
  const user = req.user;
  const isSales = user.Role === 'SalesExecutive';
  const query = `
    SELECT l.LeadId, l.LeadCode, l.LeadName, l.Email, l.Phone, l.CompanyName, l.Source,
           l.Status, l.Priority, l.ExpectedValue, l.CreatedDate, u.Name as AssignedToName
    FROM Leads l
    LEFT JOIN Users u ON l.AssignedTo = u.UserId
    ${isSales ? `WHERE l.AssignedTo = ${user.UserId}` : ''}
    ORDER BY l.LeadId DESC
  `;
  const leads = db.prepare(query).all();
  res.json(leads);
});

router.post('/leads', requireAuth, (req, res) => {
  const errors = validateLeadPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { LeadName, Email, Phone, CompanyName, Source, Status = 'New', Priority = 'Medium', ExpectedValue = 0, AssignedTo, Notes } = req.body;
  const maxRow = db.prepare('SELECT MAX(LeadId) as maxId FROM Leads').get();
  const nextId = (maxRow?.maxId || 2000) + 1;
  const leadCode = `LEAD-${nextId}`;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const assigned = AssignedTo ? parseInt(AssignedTo, 10) : req.user.UserId;

  const insert = db.prepare(`
    INSERT INTO Leads (LeadCode, LeadName, Email, Phone, CompanyName, Source, Status, Priority, ExpectedValue, CreatedDate, AssignedTo, Notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(leadCode, LeadName.trim(), Email.trim(), Phone.trim(), CompanyName || null, Source || 'Website', Status, Priority, parseFloat(ExpectedValue) || 0, now, assigned, Notes || null);
  const created = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(result.lastInsertRowid);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'CREATE',
    entityName: 'Lead',
    recordId: result.lastInsertRowid,
    newValue: created,
    details: 'Created via REST API.',
    req
  });

  res.status(201).json(created);
});

// --- REST API OPPORTUNITIES ---
router.get('/opportunities', requireAuth, (req, res) => {
  const user = req.user;
  const isSales = user.Role === 'SalesExecutive';
  const query = `
    SELECT o.OpportunityId, o.OpportunityName, o.CustomerId, c.CustomerName, o.Amount,
           o.Stage, o.Probability, o.ExpectedCloseDate, o.Status, o.CreatedDate,
           ROUND(o.Amount * (o.Probability / 100.0), 2) as WeightedAmount,
           u.Name as AssignedToName
    FROM Opportunities o
    INNER JOIN Customers c ON o.CustomerId = c.CustomerId
    LEFT JOIN Users u ON o.AssignedTo = u.UserId
    ${isSales ? `WHERE o.AssignedTo = ${user.UserId}` : ''}
    ORDER BY o.OpportunityId DESC
  `;
  const opps = db.prepare(query).all();
  res.json(opps);
});

router.post('/opportunities', requireAuth, (req, res) => {
  const errors = validateOpportunityPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, AssignedTo, Notes } = req.body;
  let oppStatus = 'Open';
  let probVal = parseFloat(Probability);
  if (Stage === 'Won') { oppStatus = 'Won'; probVal = 100; }
  else if (Stage === 'Lost') { oppStatus = 'Lost'; probVal = 0; }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const assigned = AssignedTo ? parseInt(AssignedTo, 10) : req.user.UserId;

  const insert = db.prepare(`
    INSERT INTO Opportunities (OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, CreatedDate, AssignedTo, Notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(OpportunityName.trim(), parseInt(CustomerId, 10), LeadId ? parseInt(LeadId, 10) : null, parseFloat(Amount), Stage, probVal, ExpectedCloseDate, oppStatus, now, assigned, Notes || null);
  const created = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(result.lastInsertRowid);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'CREATE',
    entityName: 'Opportunity',
    recordId: result.lastInsertRowid,
    newValue: created,
    details: 'Created via REST API.',
    req
  });

  res.status(201).json(created);
});

// --- REST API FOLLOW-UPS ---
router.get('/followups', requireAuth, (req, res) => {
  const user = req.user;
  const isSales = user.Role === 'SalesExecutive';
  const query = `
    SELECT f.FollowUpId, f.FollowUpDate, f.FollowUpType, f.Subject, f.Remarks, f.Status,
           c.CustomerName, l.LeadName, o.OpportunityName, u.Name as AssignedToName
    FROM FollowUps f
    LEFT JOIN Customers c ON f.CustomerId = c.CustomerId
    LEFT JOIN Leads l ON f.LeadId = l.LeadId
    LEFT JOIN Opportunities o ON f.OpportunityId = o.OpportunityId
    LEFT JOIN Users u ON f.AssignedTo = u.UserId
    ${isSales ? `WHERE f.AssignedTo = ${user.UserId}` : ''}
    ORDER BY f.FollowUpDate ASC
  `;
  const followups = db.prepare(query).all();
  res.json(followups);
});

router.post('/followups', requireAuth, (req, res) => {
  const errors = validateFollowUpPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { CustomerId, LeadId, OpportunityId, FollowUpDate, FollowUpType = 'Call', Subject, Remarks, AssignedTo, Status = 'Planned' } = req.body;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const assigned = AssignedTo ? parseInt(AssignedTo, 10) : req.user.UserId;

  const insert = db.prepare(`
    INSERT INTO FollowUps (CustomerId, LeadId, OpportunityId, FollowUpDate, FollowUpType, Subject, Remarks, Status, AssignedTo, CreatedDate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    CustomerId ? parseInt(CustomerId, 10) : null,
    LeadId ? parseInt(LeadId, 10) : null,
    OpportunityId ? parseInt(OpportunityId, 10) : null,
    FollowUpDate,
    FollowUpType,
    Subject.trim(),
    Remarks || null,
    Status,
    assigned,
    now
  );

  const created = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// --- REST API PIPELINE REPORT ---
router.get('/reports/pipeline', requireAuth, (req, res) => {
  const user = req.user;
  const isSales = user.Role === 'SalesExecutive';
  const scope = isSales ? `WHERE o.AssignedTo = ${user.UserId}` : '';

  const stages = db.prepare(`
    SELECT o.Stage, COUNT(*) as Count,
           COALESCE(SUM(o.Amount), 0) as TotalAmount,
           COALESCE(ROUND(SUM(o.Amount * (o.Probability / 100.0)), 2), 0) as WeightedAmount
    FROM Opportunities o
    ${scope}
    GROUP BY o.Stage
  `).all();

  res.json({ stages });
});

module.exports = router;
