const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, enforceSalesScope } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { validateFollowUpPayload, getTodayISODate } = require('../utils/validation');

// GET /followups
router.get('/', requireAuth, (req, res) => {
  const { status, type, date, assignedTo } = req.query;
  const user = req.user;
  const isSalesExecutive = user.Role === 'SalesExecutive';

  let query = `
    SELECT f.*, u.Name as AssignedUserName,
           c.CustomerName, c.CustomerCode,
           l.LeadName, l.LeadCode,
           o.OpportunityName
    FROM FollowUps f
    LEFT JOIN Users u ON f.AssignedTo = u.UserId
    LEFT JOIN Customers c ON f.CustomerId = c.CustomerId
    LEFT JOIN Leads l ON f.LeadId = l.LeadId
    LEFT JOIN Opportunities o ON f.OpportunityId = o.OpportunityId
    WHERE 1=1
  `;
  const params = [];

  if (isSalesExecutive) {
    query += ` AND f.AssignedTo = ?`;
    params.push(user.UserId);
  } else if (assignedTo && assignedTo !== 'All') {
    query += ` AND f.AssignedTo = ?`;
    params.push(parseInt(assignedTo, 10));
  }

  if (status && status !== 'All') {
    query += ` AND f.Status = ?`;
    params.push(status);
  }

  if (type && type !== 'All') {
    query += ` AND f.FollowUpType = ?`;
    params.push(type);
  }

  if (date) {
    query += ` AND f.FollowUpDate = ?`;
    params.push(date);
  }

  query += ` ORDER BY f.FollowUpDate ASC, f.FollowUpId DESC`;

  const followups = db.prepare(query).all(...params);

  res.json({
    success: true,
    total: followups.length,
    followups
  });
});

// POST /followups (Create follow-up)
router.post('/', requireAuth, (req, res) => {
  const errors = validateFollowUpPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: errors[0],
      errors
    });
  }

  const { CustomerId, LeadId, OpportunityId, FollowUpDate, FollowUpType = 'Call', Subject, Remarks, AssignedTo, Status = 'Planned' } = req.body;

  const assignedToId = AssignedTo ? parseInt(AssignedTo, 10) : req.user.UserId;
  const createdDate = new Date().toISOString().replace('T', ' ').substring(0, 19);

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
    Remarks ? Remarks.trim() : null,
    Status,
    assignedToId,
    createdDate
  );

  const newId = result.lastInsertRowid;
  const createdFollowup = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(newId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'CREATE',
    entityName: 'FollowUp',
    recordId: newId,
    newValue: createdFollowup,
    result: 'SUCCESS',
    details: `Follow-up '${Subject}' scheduled for ${FollowUpDate}.`,
    req
  });

  res.status(201).json({
    success: true,
    message: 'Follow-up scheduled successfully.',
    followup: createdFollowup
  });
});

// PUT /followups/:id/complete (Quick action: Complete Follow-up)
router.put('/:id/complete', requireAuth, (req, res) => {
  const followUpId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(followUpId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Follow-up not found.' });
  }

  if (!enforceSalesScope(req, existing.AssignedTo)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You cannot modify this follow-up.' });
  }

  const completedDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const remarks = req.body.remarks ? `${existing.Remarks ? existing.Remarks + ' | ' : ''}Completion Note: ${req.body.remarks}` : existing.Remarks;

  db.prepare(`
    UPDATE FollowUps
    SET Status = 'Completed', CompletedDate = ?, Remarks = ?
    WHERE FollowUpId = ?
  `).run(completedDate, remarks, followUpId);

  // Also log an Activity record automatically
  db.prepare(`
    INSERT INTO Activities (ActivityType, Subject, Description, ActivityDate, CustomerId, LeadId, AssignedTo, Status, CreatedDate)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Completed', ?)
  `).run(
    existing.FollowUpType,
    `Completed Follow-Up: ${existing.Subject}`,
    remarks,
    completedDate.split(' ')[0],
    existing.CustomerId,
    existing.LeadId,
    existing.AssignedTo,
    completedDate
  );

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'UPDATE',
    entityName: 'FollowUp',
    recordId: followUpId,
    oldValue: { Status: existing.Status },
    newValue: { Status: 'Completed', CompletedDate: completedDate },
    result: 'SUCCESS',
    details: `Follow-up ${existing.Subject} marked as Completed.`,
    req
  });

  res.json({
    success: true,
    message: 'Follow-up marked as Completed.'
  });
});

// PUT /followups/:id (Update or Reschedule)
router.put('/:id', requireAuth, (req, res) => {
  const followUpId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(followUpId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Follow-up not found.' });
  }

  if (!enforceSalesScope(req, existing.AssignedTo)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You cannot modify this follow-up.' });
  }

  const { FollowUpDate, FollowUpType, Subject, Remarks, Status, AssignedTo } = req.body;

  // Validation if date changed or active
  if (FollowUpDate && FollowUpDate !== existing.FollowUpDate) {
    const today = getTodayISODate();
    if (FollowUpDate < today && Status !== 'Completed') {
      return res.status(400).json({
        success: false,
        error: 'Follow-up date cannot be earlier than today for a new/planned activity.'
      });
    }
  }

  const assignedToId = AssignedTo !== undefined ? parseInt(AssignedTo, 10) : existing.AssignedTo;

  db.prepare(`
    UPDATE FollowUps
    SET FollowUpDate = ?, FollowUpType = ?, Subject = ?, Remarks = ?, Status = ?, AssignedTo = ?
    WHERE FollowUpId = ?
  `).run(
    FollowUpDate || existing.FollowUpDate,
    FollowUpType || existing.FollowUpType,
    Subject || existing.Subject,
    Remarks !== undefined ? Remarks : existing.Remarks,
    Status || existing.Status,
    assignedToId,
    followUpId
  );

  const updated = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(followUpId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'UPDATE',
    entityName: 'FollowUp',
    recordId: followUpId,
    oldValue: existing,
    newValue: updated,
    result: 'SUCCESS',
    details: `Follow-up updated / rescheduled.`,
    req
  });

  res.json({
    success: true,
    message: 'Follow-up updated successfully.',
    followup: updated
  });
});

// DELETE /followups/:id
router.delete('/:id', requireAuth, (req, res) => {
  const followUpId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(followUpId);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Follow-up not found.' });
  }

  if (!enforceSalesScope(req, existing.AssignedTo)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You cannot delete this follow-up.' });
  }

  db.prepare('DELETE FROM FollowUps WHERE FollowUpId = ?').run(followUpId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'DELETE',
    entityName: 'FollowUp',
    recordId: followUpId,
    oldValue: existing,
    result: 'SUCCESS',
    details: `Follow-up ${existing.Subject} deleted.`,
    req
  });

  res.json({
    success: true,
    message: 'Follow-up deleted successfully.'
  });
});

module.exports = router;
