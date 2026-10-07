const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /reports/pipeline
router.get('/pipeline', (req, res) => {
  const user = req.user;
  const isSales = user.Role === 'SalesExecutive';
  const scope = isSales ? `WHERE o.AssignedTo = ${user.UserId}` : '';

  // Stage-wise pipeline
  const stageStats = db.prepare(`
    SELECT o.Stage, COUNT(*) as Count,
           COALESCE(SUM(o.Amount), 0) as TotalAmount,
           COALESCE(ROUND(SUM(o.Amount * (o.Probability / 100.0)), 2), 0) as WeightedAmount
    FROM Opportunities o
    ${scope}
    GROUP BY o.Stage
  `).all();

  // Owner-wise pipeline
  const ownerStats = db.prepare(`
    SELECT u.Name as OwnerName, u.Email, COUNT(o.OpportunityId) as DealCount,
           COALESCE(SUM(o.Amount), 0) as TotalAmount,
           COALESCE(ROUND(SUM(o.Amount * (o.Probability / 100.0)), 2), 0) as WeightedAmount
    FROM Users u
    LEFT JOIN Opportunities o ON u.UserId = o.AssignedTo
    ${isSales ? `WHERE u.UserId = ${user.UserId}` : ''}
    GROUP BY u.UserId
  `).all();

  res.json({
    success: true,
    stageStats,
    ownerStats
  });
});

// GET /reports/conversion
router.get('/conversion', (req, res) => {
  const user = req.user;
  const isSales = user.Role === 'SalesExecutive';
  const scope = isSales ? `WHERE AssignedTo = ${user.UserId}` : '';

  const totalLeads = db.prepare(`SELECT COUNT(*) as count FROM Leads ${scope}`).get().count;
  const convertedLeads = db.prepare(`SELECT COUNT(*) as count FROM Leads ${scope ? scope + ' AND' : 'WHERE'} Status = 'Converted'`).get().count;
  const lostLeads = db.prepare(`SELECT COUNT(*) as count FROM Leads ${scope ? scope + ' AND' : 'WHERE'} Status = 'Lost'`).get().count;

  const totalOpps = db.prepare(`SELECT COUNT(*) as count FROM Opportunities ${scope}`).get().count;
  const wonOpps = db.prepare(`SELECT COUNT(*) as count FROM Opportunities ${scope ? scope + ' AND' : 'WHERE'} Status = 'Won' OR Stage = 'Won'`).get().count;
  const lostOpps = db.prepare(`SELECT COUNT(*) as count FROM Opportunities ${scope ? scope + ' AND' : 'WHERE'} Status = 'Lost' OR Stage = 'Lost'`).get().count;

  const leadConversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;
  const oppWinRate = totalOpps > 0 ? Math.round((wonOpps / totalOpps) * 100) : 0;

  res.json({
    success: true,
    leads: {
      total: totalLeads,
      converted: convertedLeads,
      lost: lostLeads,
      conversionRate: leadConversionRate
    },
    opportunities: {
      total: totalOpps,
      won: wonOpps,
      lost: lostOpps,
      winRate: oppWinRate
    }
  });
});

// GET /reports/user-activities
router.get('/user-activities', (req, res) => {
  if (req.user.Role === 'SalesExecutive') {
    return res.status(403).json({ success: false, error: 'Access restricted to Manager and Admin.' });
  }

  const activitiesByUser = db.prepare(`
    SELECT u.Name, u.Email, u.Role,
           COUNT(a.ActivityId) as TotalActivities,
           SUM(CASE WHEN a.ActivityType = 'Call' THEN 1 ELSE 0 END) as Calls,
           SUM(CASE WHEN a.ActivityType = 'Meeting' THEN 1 ELSE 0 END) as Meetings,
           SUM(CASE WHEN a.ActivityType = 'Email' THEN 1 ELSE 0 END) as Emails,
           SUM(CASE WHEN a.ActivityType = 'Task' THEN 1 ELSE 0 END) as Tasks
    FROM Users u
    LEFT JOIN Activities a ON u.UserId = a.AssignedTo
    GROUP BY u.UserId
  `).all();

  res.json({
    success: true,
    activitiesByUser
  });
});

// GET /reports/export (CSV export)
router.get('/export', (req, res) => {
  const { type = 'customers' } = req.query;
  const user = req.user;
  const isSales = user.Role === 'SalesExecutive';

  let csv = '';
  let filename = `${type}_report_${Date.now()}.csv`;

  if (type === 'customers') {
    const scope = isSales ? `WHERE c.AssignedTo = ${user.UserId} OR c.CreatedBy = ${user.UserId}` : '';
    const records = db.prepare(`
      SELECT c.CustomerCode, c.CustomerName, c.Email, c.Phone, c.CompanyName, c.Status, c.CreatedDate, u.Name as AssignedUser
      FROM Customers c
      LEFT JOIN Users u ON c.AssignedTo = u.UserId
      ${scope}
      ORDER BY c.CustomerId DESC
    `).all();

    csv = 'Customer Code,Name,Email,Phone,Company,Status,Created Date,Assigned To\n' +
      records.map(r => `"${r.CustomerCode}","${r.CustomerName}","${r.Email}","${r.Phone}","${r.CompanyName || ''}","${r.Status}","${r.CreatedDate}","${r.AssignedUser || ''}"`).join('\n');

  } else if (type === 'leads') {
    const scope = isSales ? `WHERE l.AssignedTo = ${user.UserId}` : '';
    const records = db.prepare(`
      SELECT l.LeadCode, l.LeadName, l.Email, l.Phone, l.CompanyName, l.Source, l.Status, l.Priority, l.ExpectedValue, l.CreatedDate, u.Name as AssignedUser
      FROM Leads l
      LEFT JOIN Users u ON l.AssignedTo = u.UserId
      ${scope}
      ORDER BY l.LeadId DESC
    `).all();

    csv = 'Lead Code,Name,Email,Phone,Company,Source,Status,Priority,Expected Value,Created Date,Assigned To\n' +
      records.map(r => `"${r.LeadCode}","${r.LeadName}","${r.Email}","${r.Phone}","${r.CompanyName || ''}","${r.Source}","${r.Status}","${r.Priority}",${r.ExpectedValue},"${r.CreatedDate}","${r.AssignedUser || ''}"`).join('\n');

  } else if (type === 'opportunities') {
    const scope = isSales ? `WHERE o.AssignedTo = ${user.UserId}` : '';
    const records = db.prepare(`
      SELECT o.OpportunityName, c.CustomerName, o.Amount, o.Stage, o.Probability, o.ExpectedCloseDate, o.Status, u.Name as AssignedUser
      FROM Opportunities o
      INNER JOIN Customers c ON o.CustomerId = c.CustomerId
      LEFT JOIN Users u ON o.AssignedTo = u.UserId
      ${scope}
      ORDER BY o.OpportunityId DESC
    `).all();

    csv = 'Opportunity Name,Customer,Amount,Stage,Probability (%),Expected Close Date,Status,Assigned To\n' +
      records.map(r => `"${r.OpportunityName}","${r.CustomerName}",${r.Amount},"${r.Stage}",${r.Probability},"${r.ExpectedCloseDate}","${r.Status}","${r.AssignedUser || ''}"`).join('\n');
  } else {
    return res.status(400).send('Invalid export type.');
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
});

module.exports = router;
