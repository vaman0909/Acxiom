const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, enforceSalesScope } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { validateCustomerPayload } = require('../utils/validation');

// GET /customers (List with search & filter)
router.get('/', requireAuth, (req, res) => {
  const { search, status, page = 1, limit = 50 } = req.query;
  const user = req.user;
  const isSalesExecutive = user.Role === 'SalesExecutive';

  let query = `
    SELECT c.*, u.Name as AssignedUserName, creator.Name as CreatedByName
    FROM Customers c
    LEFT JOIN Users u ON c.AssignedTo = u.UserId
    LEFT JOIN Users creator ON c.CreatedBy = creator.UserId
    WHERE 1=1
  `;
  const params = [];

  // Scoping for Sales Executive
  if (isSalesExecutive) {
    query += ` AND (c.AssignedTo = ? OR c.CreatedBy = ?)`;
    params.push(user.UserId, user.UserId);
  }

  // Search filter across Name, Email, Phone, Company
  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query += ` AND (c.CustomerName LIKE ? OR c.Email LIKE ? OR c.Phone LIKE ? OR c.CompanyName LIKE ? OR c.CustomerCode LIKE ?)`;
    params.push(s, s, s, s, s);
  }

  // Status filter
  if (status && status !== 'All') {
    query += ` AND c.Status = ?`;
    params.push(status);
  }

  query += ` ORDER BY c.CustomerId DESC`;

  const customers = db.prepare(query).all(...params);

  // Return JSON for AJAX or API calls
  res.json({
    success: true,
    total: customers.length,
    customers
  });
});

// GET /customers/:id (Details view with related records)
router.get('/:id', requireAuth, (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  const customer = db.prepare(`
    SELECT c.*, u.Name as AssignedUserName, creator.Name as CreatedByName
    FROM Customers c
    LEFT JOIN Users u ON c.AssignedTo = u.UserId
    LEFT JOIN Users creator ON c.CreatedBy = creator.UserId
    WHERE c.CustomerId = ?
  `).get(customerId);

  if (!customer) {
    return res.status(404).json({ success: false, error: 'Customer not found.' });
  }

  // Role check
  if (!enforceSalesScope(req, customer.AssignedTo, customer.CreatedBy)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You do not have permission to view this customer.' });
  }

  // Associated Opportunities
  const opportunities = db.prepare(`
    SELECT o.*, u.Name as AssignedUserName
    FROM Opportunities o
    LEFT JOIN Users u ON o.AssignedTo = u.UserId
    WHERE o.CustomerId = ?
    ORDER BY o.OpportunityId DESC
  `).all(customerId);

  // Associated Follow-ups
  const followups = db.prepare(`
    SELECT f.*, u.Name as AssignedUserName
    FROM FollowUps f
    LEFT JOIN Users u ON f.AssignedTo = u.UserId
    WHERE f.CustomerId = ?
    ORDER BY f.FollowUpDate DESC
  `).all(customerId);

  // Associated Activities
  const activities = db.prepare(`
    SELECT a.*, u.Name as AssignedUserName
    FROM Activities a
    LEFT JOIN Users u ON a.AssignedTo = u.UserId
    WHERE a.CustomerId = ?
    ORDER BY a.ActivityDate DESC
  `).all(customerId);

  res.json({
    success: true,
    customer,
    opportunities,
    followups,
    activities
  });
});

// POST /customers (Create new customer)
router.post('/', requireAuth, (req, res) => {
  const { CustomerName, Email, Phone, CompanyName, Address, City, State, Status = 'Active', AssignedTo, Notes } = req.body;

  // Validation
  const errors = validateCustomerPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: errors[0],
      errors
    });
  }

  // Generate CustomerCode
  const maxRow = db.prepare('SELECT MAX(CustomerId) as maxId FROM Customers').get();
  const nextId = (maxRow?.maxId || 1000) + 1;
  const customerCode = req.body.CustomerCode || `CUST-${nextId}`;

  const assignedToId = AssignedTo ? parseInt(AssignedTo, 10) : req.user.UserId;
  const createdDate = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const insert = db.prepare(`
    INSERT INTO Customers (CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy, AssignedTo, Notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    customerCode,
    CustomerName.trim(),
    Email.trim(),
    Phone.trim(),
    CompanyName ? CompanyName.trim() : null,
    Address ? Address.trim() : null,
    City ? City.trim() : null,
    State ? State.trim() : null,
    Status,
    createdDate,
    req.user.UserId,
    assignedToId,
    Notes ? Notes.trim() : null
  );

  const newId = result.lastInsertRowid;
  const createdCustomer = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(newId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'CREATE',
    entityName: 'Customer',
    recordId: newId,
    newValue: createdCustomer,
    result: 'SUCCESS',
    details: `Customer ${CustomerName} (${customerCode}) created.`,
    req
  });

  res.status(201).json({
    success: true,
    message: 'Customer created successfully.',
    customer: createdCustomer
  });
});

// PUT /customers/:id (Update customer)
router.put('/:id', requireAuth, (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(customerId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Customer not found.' });
  }

  if (!enforceSalesScope(req, existing.AssignedTo, existing.CreatedBy)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You cannot modify this customer.' });
  }

  const errors = validateCustomerPayload(req.body, customerId);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: errors[0],
      errors
    });
  }

  const { CustomerName, Email, Phone, CompanyName, Address, City, State, Status, AssignedTo, Notes } = req.body;
  const assignedToId = AssignedTo !== undefined ? parseInt(AssignedTo, 10) : existing.AssignedTo;

  const update = db.prepare(`
    UPDATE Customers
    SET CustomerName = ?, Email = ?, Phone = ?, CompanyName = ?, Address = ?, City = ?, State = ?, Status = ?, AssignedTo = ?, Notes = ?
    WHERE CustomerId = ?
  `);

  update.run(
    CustomerName.trim(),
    Email.trim(),
    Phone.trim(),
    CompanyName ? CompanyName.trim() : null,
    Address ? Address.trim() : null,
    City ? City.trim() : null,
    State ? State.trim() : null,
    Status || existing.Status,
    assignedToId,
    Notes ? Notes.trim() : null,
    customerId
  );

  const updatedCustomer = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(customerId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'UPDATE',
    entityName: 'Customer',
    recordId: customerId,
    oldValue: existing,
    newValue: updatedCustomer,
    result: 'SUCCESS',
    details: `Customer ${CustomerName} updated.`,
    req
  });

  res.json({
    success: true,
    message: 'Customer updated successfully.',
    customer: updatedCustomer
  });
});

// DELETE /customers/:id (Delete or Deactivate)
router.delete('/:id', requireAuth, (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(customerId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Customer not found.' });
  }

  // Deletion is restricted to Admin or Manager
  if (req.user.Role !== 'Admin' && req.user.Role !== 'Manager') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Only Admin and Manager roles can delete customer records.'
    });
  }

  // Check if foreign dependencies exist
  const oppCount = db.prepare('SELECT COUNT(*) as count FROM Opportunities WHERE CustomerId = ?').get(customerId).count;
  if (oppCount > 0) {
    // Soft-deactivate if active opportunities exist
    db.prepare("UPDATE Customers SET Status = 'Inactive' WHERE CustomerId = ?").run(customerId);

    logAudit({
      userId: req.user.UserId,
      userEmail: req.user.Email,
      action: 'UPDATE',
      entityName: 'Customer',
      recordId: customerId,
      oldValue: existing,
      newValue: { Status: 'Inactive' },
      result: 'SUCCESS',
      details: `Customer ${existing.CustomerName} deactivated due to active linked opportunities.`,
      req
    });

    return res.json({
      success: true,
      message: 'Customer has associated opportunities, so the record was marked Inactive instead of permanently removed.'
    });
  }

  // Otherwise, remove record
  db.prepare('DELETE FROM FollowUps WHERE CustomerId = ?').run(customerId);
  db.prepare('DELETE FROM Activities WHERE CustomerId = ?').run(customerId);
  db.prepare('DELETE FROM Customers WHERE CustomerId = ?').run(customerId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'DELETE',
    entityName: 'Customer',
    recordId: customerId,
    oldValue: existing,
    result: 'SUCCESS',
    details: `Customer ${existing.CustomerName} (${existing.CustomerCode}) permanently removed.`,
    req
  });

  res.json({
    success: true,
    message: 'Customer deleted successfully.'
  });
});

module.exports = router;
