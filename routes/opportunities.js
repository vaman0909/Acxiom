const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, enforceSalesScope } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { validateOpportunityPayload } = require('../utils/validation');

// GET /opportunities (List with search & filter)
router.get('/', requireAuth, (req, res) => {
  const { search, stage, status, assignedTo } = req.query;
  const user = req.user;
  const isSalesExecutive = user.Role === 'SalesExecutive';

  let query = `
    SELECT o.*, c.CustomerName, c.CustomerCode, u.Name as AssignedUserName,
           ROUND(o.Amount * (o.Probability / 100.0), 2) as WeightedAmount
    FROM Opportunities o
    INNER JOIN Customers c ON o.CustomerId = c.CustomerId
    LEFT JOIN Users u ON o.AssignedTo = u.UserId
    WHERE 1=1
  `;
  const params = [];

  if (isSalesExecutive) {
    query += ` AND o.AssignedTo = ?`;
    params.push(user.UserId);
  } else if (assignedTo && assignedTo !== 'All') {
    query += ` AND o.AssignedTo = ?`;
    params.push(parseInt(assignedTo, 10));
  }

  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query += ` AND (o.OpportunityName LIKE ? OR c.CustomerName LIKE ? OR o.Notes LIKE ?)`;
    params.push(s, s, s);
  }

  if (stage && stage !== 'All') {
    query += ` AND o.Stage = ?`;
    params.push(stage);
  }

  if (status && status !== 'All') {
    query += ` AND o.Status = ?`;
    params.push(status);
  }

  query += ` ORDER BY o.OpportunityId DESC`;

  const opportunities = db.prepare(query).all(...params);

  res.json({
    success: true,
    total: opportunities.length,
    opportunities
  });
});

// GET /opportunities/:id
router.get('/:id', requireAuth, (req, res) => {
  const oppId = parseInt(req.params.id, 10);
  const opp = db.prepare(`
    SELECT o.*, c.CustomerName, c.CustomerCode, c.Email as CustomerEmail, c.Phone as CustomerPhone,
           u.Name as AssignedUserName,
           ROUND(o.Amount * (o.Probability / 100.0), 2) as WeightedAmount
    FROM Opportunities o
    INNER JOIN Customers c ON o.CustomerId = c.CustomerId
    LEFT JOIN Users u ON o.AssignedTo = u.UserId
    WHERE o.OpportunityId = ?
  `).get(oppId);

  if (!opp) {
    return res.status(404).json({ success: false, error: 'Opportunity not found.' });
  }

  if (!enforceSalesScope(req, opp.AssignedTo)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You do not have permission to view this opportunity.' });
  }

  const followups = db.prepare(`
    SELECT f.*, u.Name as AssignedUserName
    FROM FollowUps f
    LEFT JOIN Users u ON f.AssignedTo = u.UserId
    WHERE f.OpportunityId = ?
    ORDER BY f.FollowUpDate DESC
  `).all(oppId);

  res.json({
    success: true,
    opportunity: opp,
    followups
  });
});

// POST /opportunities (Create opportunity)
router.post('/', requireAuth, (req, res) => {
  const errors = validateOpportunityPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: errors[0],
      errors
    });
  }

  const { OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, AssignedTo, Notes } = req.body;

  let oppStatus = 'Open';
  let probVal = parseFloat(Probability);
  if (Stage === 'Won') {
    oppStatus = 'Won';
    probVal = 100;
  } else if (Stage === 'Lost') {
    oppStatus = 'Lost';
    probVal = 0;
  }

  const assignedToId = AssignedTo ? parseInt(AssignedTo, 10) : req.user.UserId;
  const createdDate = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const insert = db.prepare(`
    INSERT INTO Opportunities (OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, CreatedDate, AssignedTo, Notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    OpportunityName.trim(),
    parseInt(CustomerId, 10),
    LeadId ? parseInt(LeadId, 10) : null,
    parseFloat(Amount),
    Stage,
    probVal,
    ExpectedCloseDate,
    oppStatus,
    createdDate,
    assignedToId,
    Notes ? Notes.trim() : null
  );

  const newId = result.lastInsertRowid;
  const createdOpp = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(newId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'CREATE',
    entityName: 'Opportunity',
    recordId: newId,
    newValue: createdOpp,
    result: 'SUCCESS',
    details: `Opportunity ${OpportunityName} created ($${Amount}, Stage: ${Stage}).`,
    req
  });

  res.status(201).json({
    success: true,
    message: 'Opportunity created successfully.',
    opportunity: createdOpp
  });
});

// PUT /opportunities/:id (Update opportunity)
router.put('/:id', requireAuth, (req, res) => {
  const oppId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(oppId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Opportunity not found.' });
  }

  if (!enforceSalesScope(req, existing.AssignedTo)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You cannot modify this opportunity.' });
  }

  const errors = validateOpportunityPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: errors[0],
      errors
    });
  }

  const { OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, AssignedTo, Notes } = req.body;

  let oppStatus = 'Open';
  let probVal = parseFloat(Probability);
  if (Stage === 'Won') {
    oppStatus = 'Won';
    probVal = 100;
  } else if (Stage === 'Lost') {
    oppStatus = 'Lost';
    probVal = 0;
  }

  const assignedToId = AssignedTo !== undefined ? parseInt(AssignedTo, 10) : existing.AssignedTo;

  const update = db.prepare(`
    UPDATE Opportunities
    SET OpportunityName = ?, CustomerId = ?, LeadId = ?, Amount = ?, Stage = ?, Probability = ?, ExpectedCloseDate = ?, Status = ?, AssignedTo = ?, Notes = ?
    WHERE OpportunityId = ?
  `);

  update.run(
    OpportunityName.trim(),
    parseInt(CustomerId, 10),
    LeadId ? parseInt(LeadId, 10) : null,
    parseFloat(Amount),
    Stage,
    probVal,
    ExpectedCloseDate,
    oppStatus,
    assignedToId,
    Notes ? Notes.trim() : null,
    oppId
  );

  const updatedOpp = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(oppId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'UPDATE',
    entityName: 'Opportunity',
    recordId: oppId,
    oldValue: existing,
    newValue: updatedOpp,
    result: 'SUCCESS',
    details: `Opportunity ${OpportunityName} updated (Stage: ${Stage}, Amount: $${Amount}).`,
    req
  });

  res.json({
    success: true,
    message: 'Opportunity updated successfully.',
    opportunity: updatedOpp
  });
});

// DELETE /opportunities/:id
router.delete('/:id', requireAuth, (req, res) => {
  const oppId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(oppId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Opportunity not found.' });
  }

  if (req.user.Role !== 'Admin' && req.user.Role !== 'Manager') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Only Admin and Manager roles can delete opportunities.'
    });
  }

  db.prepare('DELETE FROM FollowUps WHERE OpportunityId = ?').run(oppId);
  db.prepare('DELETE FROM Opportunities WHERE OpportunityId = ?').run(oppId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'DELETE',
    entityName: 'Opportunity',
    recordId: oppId,
    oldValue: existing,
    result: 'SUCCESS',
    details: `Opportunity ${existing.OpportunityName} deleted.`,
    req
  });

  res.json({
    success: true,
    message: 'Opportunity deleted successfully.'
  });
});

module.exports = router;
