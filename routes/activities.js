const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, enforceSalesScope } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// GET /activities
router.get('/', requireAuth, (req, res) => {
  const { type, status, assignedTo } = req.query;
  const user = req.user;
  const isSalesExecutive = user.Role === 'SalesExecutive';

  let query = `
    SELECT a.*, u.Name as AssignedUserName,
           c.CustomerName, c.CustomerCode,
           l.LeadName, l.LeadCode
    FROM Activities a
    LEFT JOIN Users u ON a.AssignedTo = u.UserId
    LEFT JOIN Customers c ON a.CustomerId = c.CustomerId
    LEFT JOIN Leads l ON a.LeadId = l.LeadId
    WHERE 1=1
  `;
  const params = [];

  if (isSalesExecutive) {
    query += ` AND a.AssignedTo = ?`;
    params.push(user.UserId);
  } else if (assignedTo && assignedTo !== 'All') {
    query += ` AND a.AssignedTo = ?`;
    params.push(parseInt(assignedTo, 10));
  }

  if (type && type !== 'All') {
    query += ` AND a.ActivityType = ?`;
    params.push(type);
  }

  if (status && status !== 'All') {
    query += ` AND a.Status = ?`;
    params.push(status);
  }

  query += ` ORDER BY a.ActivityDate DESC, a.ActivityId DESC`;

  const activities = db.prepare(query).all(...params);

  res.json({
    success: true,
    total: activities.length,
    activities
  });
});

// POST /activities
router.post('/', requireAuth, (req, res) => {
  const { ActivityType = 'Call', Subject, Description, ActivityDate, CustomerId, LeadId, AssignedTo, Status = 'Completed' } = req.body;

  if (!Subject || !Subject.trim()) {
    return res.status(400).json({ success: false, error: 'Activity Subject is required.' });
  }

  const actDate = ActivityDate || new Date().toISOString().split('T')[0];
  const assignedToId = AssignedTo ? parseInt(AssignedTo, 10) : req.user.UserId;
  const createdDate = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const insert = db.prepare(`
    INSERT INTO Activities (ActivityType, Subject, Description, ActivityDate, CustomerId, LeadId, AssignedTo, Status, CreatedDate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    ActivityType,
    Subject.trim(),
    Description ? Description.trim() : null,
    actDate,
    CustomerId ? parseInt(CustomerId, 10) : null,
    LeadId ? parseInt(LeadId, 10) : null,
    assignedToId,
    Status,
    createdDate
  );

  const newId = result.lastInsertRowid;
  const created = db.prepare('SELECT * FROM Activities WHERE ActivityId = ?').get(newId);

  logAudit({
    userId: req.user.UserId,
    userEmail: req.user.Email,
    action: 'CREATE',
    entityName: 'Activity',
    recordId: newId,
    newValue: created,
    result: 'SUCCESS',
    details: `Activity ${ActivityType}: ${Subject} logged.`,
    req
  });

  res.status(201).json({
    success: true,
    message: 'Activity logged successfully.',
    activity: created
  });
});

module.exports = router;
