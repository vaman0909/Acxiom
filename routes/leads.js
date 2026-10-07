const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, enforceSalesScope } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { validateLeadPayload, getTodayISODate } = require('../utils/validation');

// GET /leads (List with search & filters)
router.get('/', requireAuth, (req, res) => {
  const { search, status, source, assignedTo } = req.query;
  const user = req.user;
  const isSalesExecutive = user.Role === 'SalesExecutive';

  let query = `
    SELECT l.*, u.Name as AssignedUserName, c.CustomerName as ConvertedCustomerName
    FROM Leads l
    LEFT JOIN Users u ON l.AssignedTo = u.UserId
    LEFT JOIN Customers c ON l.ConvertedCustomerId = c.CustomerId
    WHERE 1=1
  `;
  const params = [];

  if (isSalesExecutive) {
    query += ` AND l.AssignedTo = ?`;
    params.push(user.UserId);
  } else if (assignedTo && assignedTo !== 'All') {
    query += ` AND l.AssignedTo = ?`;
    params.push(parseInt(assignedTo, 10));
  }

  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query += ` AND (l.LeadName LIKE ? OR l.Email LIKE ? OR l.Phone LIKE ? OR l.CompanyName LIKE ? OR l.LeadCode LIKE ?)`;
    params.push(s, s, s, s, s);
  }

  if (status && status !== 'All') {
    query += ` AND l.Status = ?`;
    params.push(status);
  }

  if (source && source !== 'All') {
    query += ` AND l.Source = ?`;
    params.push(source);
  }

  query += ` ORDER BY l.LeadId DESC`;

  const leads = db.prepare(query).all(...params);

  res.json({
    success: true,
    total: leads.length,
    leads
  });
});

// GET /leads/:id (Details)
router.get('/:id', requireAuth, (req, res) => {
  const leadId = parseInt(req.params.id, 10);
  const lead = db.prepare(`
    SELECT l.*, u.Name as AssignedUserName, c.CustomerName as ConvertedCustomerName, o.OpportunityName as ConvertedOpportunityName
    FROM Leads l
    LEFT JOIN Users u ON l.AssignedTo = u.UserId
    LEFT JOIN Customers c ON l.ConvertedCustomerId = c.CustomerId
    LEFT JOIN Opportunities o ON l.ConvertedOpportunityId = o.OpportunityId
    WHERE l.LeadId = ?
  `).get(leadId);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  if (!enforceSalesScope(req, lead.AssignedTo)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You do not have permission to view this lead.' });
  }

  const followups = db.prepare(`
    SELECT f.*, u.Name as AssignedUserName
    FROM FollowUps f
    LEFT JOIN Users u ON f.AssignedTo = u.UserId
    WHERE f.LeadId = ?
    ORDER BY f.FollowUpDate DESC
  `).all(leadId);

  const activities = db.prepare(`
    SELECT a.*, u.Name as AssignedUserName
    FROM Activities a
    LEFT JOIN Users u ON a.AssignedTo = u.UserId
    WHERE a.LeadId = ?
    ORDER BY a.ActivityDate DESC
  `).all(leadId);

  res.json({
    success: true,
    lead,
    followups,
    activities
  });
});

// POST /leads (Create lead)
router.post('/', requireAuth, (req, res) => {
  const errors = validateLeadPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: errors[0],
      errors
    });
  }

  const { LeadName, Email, Phone, CompanyName, Source, Status = 'New', Priority = 'Medium', ExpectedValue = 0, AssignedTo, Notes } = req.body;

  const maxRow = db.prepare('SELECT MAX(LeadId) as maxId FROM Leads').get();
  const nextId = (maxRow?.maxId || 2000) + 1;
  const leadCode = req.body.LeadCode || `LEAD-${nextId}`;

  const assignedToId = AssignedTo ? parseInt(AssignedTo, 10) : req.user.UserId;
  const createdDate = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const insert = db.prepare(`
    INSERT INTO Leads (LeadCode, LeadName, Email, Phone, CompanyName, Source, Status, Priority, ExpectedValue, CreatedDate, AssignedTo, Notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    leadCode,
    LeadName.trim(),
    Email.trim(),
    Phone.trim(),
    CompanyName ? CompanyName.trim() : null,
    Source || 'Website',
    Status,
    Priority,
    parseFloat(ExpectedValue) || 0,
    createdDate,
    assignedToId,
    Notes ? Notes.trim() : null
  );

  const newId = result.lastInsertRowid;
  const createdLead = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(newId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'CREATE',
    entityName: 'Lead',
    recordId: newId,
    newValue: createdLead,
    result: 'SUCCESS',
    details: `Lead ${LeadName} (${leadCode}) created.`,
    req
  });

  res.status(201).json({
    success: true,
    message: 'Lead created successfully.',
    lead: createdLead
  });
});

// PUT /leads/:id (Update lead)
router.put('/:id', requireAuth, (req, res) => {
  const leadId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(leadId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  if (!enforceSalesScope(req, existing.AssignedTo)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You cannot modify this lead.' });
  }

  // Prevent transition if already Converted
  if (existing.Status === 'Converted' && req.body.Status && req.body.Status !== 'Converted') {
    return res.status(400).json({
      success: false,
      error: 'Converted leads cannot be transitioned back to previous statuses.'
    });
  }

  const errors = validateLeadPayload(req.body, leadId);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: errors[0],
      errors
    });
  }

  const { LeadName, Email, Phone, CompanyName, Source, Status, Priority, ExpectedValue, AssignedTo, Notes } = req.body;
  const assignedToId = AssignedTo !== undefined ? parseInt(AssignedTo, 10) : existing.AssignedTo;

  const update = db.prepare(`
    UPDATE Leads
    SET LeadName = ?, Email = ?, Phone = ?, CompanyName = ?, Source = ?, Status = ?, Priority = ?, ExpectedValue = ?, AssignedTo = ?, Notes = ?
    WHERE LeadId = ?
  `);

  update.run(
    LeadName.trim(),
    Email.trim(),
    Phone.trim(),
    CompanyName ? CompanyName.trim() : null,
    Source || existing.Source,
    Status || existing.Status,
    Priority || existing.Priority,
    parseFloat(ExpectedValue) || 0,
    assignedToId,
    Notes ? Notes.trim() : null,
    leadId
  );

  const updatedLead = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(leadId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'UPDATE',
    entityName: 'Lead',
    recordId: leadId,
    oldValue: existing,
    newValue: updatedLead,
    result: 'SUCCESS',
    details: `Lead ${LeadName} updated. Status: ${Status || existing.Status}`,
    req
  });

  res.json({
    success: true,
    message: 'Lead updated successfully.',
    lead: updatedLead
  });
});

// POST /leads/:id/convert (Convert Lead into Customer & Opportunity)
router.post('/:id/convert', requireAuth, (req, res) => {
  const leadId = parseInt(req.params.id, 10);
  const lead = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(leadId);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  if (!enforceSalesScope(req, lead.AssignedTo)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You cannot convert this lead.' });
  }

  if (lead.Status === 'Converted') {
    return res.status(400).json({ success: false, error: 'This lead has already been converted.' });
  }

  const { createOpportunity = true, opportunityAmount, expectedCloseDate } = req.body;

  // Run transaction for atomicity
  const convertTransaction = db.transaction(() => {
    // 1. Check if customer with this email or phone already exists
    let existingCustomer = db.prepare('SELECT * FROM Customers WHERE Email = ? OR Phone = ?').get(lead.Email, lead.Phone);
    let customerId;

    if (existingCustomer) {
      customerId = existingCustomer.CustomerId;
    } else {
      // Create new Customer
      const maxCust = db.prepare('SELECT MAX(CustomerId) as maxId FROM Customers').get();
      const nextCustId = (maxCust?.maxId || 1000) + 1;
      const customerCode = `CUST-${nextCustId}`;
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

      const custInsert = db.prepare(`
        INSERT INTO Customers (CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy, AssignedTo, Notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?)
      `);

      const custRes = custInsert.run(
        customerCode,
        lead.LeadName,
        lead.Email,
        lead.Phone,
        lead.CompanyName,
        '',
        '',
        '',
        now,
        req.user.UserId,
        lead.AssignedTo,
        `Converted from Lead ${lead.LeadCode} (${lead.LeadName}). ${lead.Notes || ''}`
      );
      customerId = custRes.lastInsertRowid;
    }

    // 2. Optionally create Opportunity
    let opportunityId = null;
    if (createOpportunity) {
      const amount = parseFloat(opportunityAmount) || lead.ExpectedValue || 10000;
      const closeDate = expectedCloseDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d.toISOString().split('T')[0];
      })();
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

      const oppInsert = db.prepare(`
        INSERT INTO Opportunities (OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, CreatedDate, AssignedTo, Notes)
        VALUES (?, ?, ?, ?, 'Qualification', 20, ?, 'Open', ?, ?, ?)
      `);

      const oppRes = oppInsert.run(
        `${lead.CompanyName || lead.LeadName} - Deal`,
        customerId,
        lead.LeadId,
        amount,
        closeDate,
        now,
        lead.AssignedTo,
        `Generated from converted lead ${lead.LeadCode}`
      );
      opportunityId = oppRes.lastInsertRowid;
    }

    // 3. Mark Lead as Converted
    db.prepare(`
      UPDATE Leads
      SET Status = 'Converted', ConvertedCustomerId = ?, ConvertedOpportunityId = ?
      WHERE LeadId = ?
    `).run(customerId, opportunityId, leadId);

    return { customerId, opportunityId };
  });

  try {
    const { customerId, opportunityId } = convertTransaction();

    logAudit({
      userId: req.user.UserId,
      userEmail: req.user.Email,
      action: 'LEAD_CONVERSION',
      entityName: 'Lead',
      recordId: leadId,
      oldValue: { Status: lead.Status },
      newValue: { Status: 'Converted', CustomerId: customerId, OpportunityId: opportunityId },
      result: 'SUCCESS',
      details: `Lead ${lead.LeadCode} converted into Customer ID ${customerId} and Opportunity ID ${opportunityId || 'None'}.`,
      req
    });

    res.json({
      success: true,
      message: 'Lead converted successfully!',
      customerId,
      opportunityId
    });
  } catch (err) {
    console.error('Lead conversion error:', err);
    res.status(500).json({ success: false, error: 'Conversion failed: ' + err.message });
  }
});

// DELETE /leads/:id
router.delete('/:id', requireAuth, (req, res) => {
  const leadId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(leadId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  if (req.user.Role !== 'Admin' && req.user.Role !== 'Manager') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Only Admin and Manager roles can delete lead records.'
    });
  }

  db.prepare('DELETE FROM FollowUps WHERE LeadId = ?').run(leadId);
  db.prepare('DELETE FROM Activities WHERE LeadId = ?').run(leadId);
  db.prepare('DELETE FROM Leads WHERE LeadId = ?').run(leadId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'DELETE',
    entityName: 'Lead',
    recordId: leadId,
    oldValue: existing,
    result: 'SUCCESS',
    details: `Lead ${existing.LeadName} (${existing.LeadCode}) deleted.`,
    req
  });

  res.json({
    success: true,
    message: 'Lead deleted successfully.'
  });
});

module.exports = router;
