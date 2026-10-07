const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

// Audit logs accessible by Admin and Manager (Admin full, Manager limited view)
router.use(requireRole('Admin', 'Manager'));

// GET /audit
router.get('/', (req, res) => {
  const { user, action, entity, dateFrom, dateTo, limit = 100 } = req.query;

  let query = `
    SELECT a.*, u.Name as UserName
    FROM AuditLogs a
    LEFT JOIN Users u ON a.UserId = u.UserId
    WHERE 1=1
  `;
  const params = [];

  // If Manager, filter out sensitive security events
  if (req.user.Role === 'Manager') {
    query += ` AND a.Action NOT IN ('ROLE_CHANGE', 'SECURITY')`;
  }

  if (user && user !== 'All') {
    query += ` AND a.UserId = ?`;
    params.push(parseInt(user, 10));
  }

  if (action && action !== 'All') {
    query += ` AND a.Action = ?`;
    params.push(action);
  }

  if (entity && entity !== 'All') {
    query += ` AND a.EntityName = ?`;
    params.push(entity);
  }

  if (dateFrom) {
    query += ` AND date(a.CreatedDate) >= ?`;
    params.push(dateFrom);
  }

  if (dateTo) {
    query += ` AND date(a.CreatedDate) <= ?`;
    params.push(dateTo);
  }

  query += ` ORDER BY a.AuditLogId DESC LIMIT ?`;
  params.push(parseInt(limit, 10));

  const logs = db.prepare(query).all(...params);

  res.json({
    success: true,
    total: logs.length,
    logs
  });
});

module.exports = router;
