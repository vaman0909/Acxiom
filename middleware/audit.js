const db = require('../db');

function logAudit({
  userId = null,
  userEmail = 'Anonymous',
  action,
  entityName,
  recordId = null,
  oldValue = null,
  newValue = null,
  result = 'SUCCESS',
  details = null,
  req = null
}) {
  try {
    let ipAddress = '127.0.0.1';
    if (req) {
      ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1';
      if (!userId && req.session?.user) {
        userId = req.session.user.UserId;
        userEmail = req.session.user.Email;
      } else if (!userId && req.user) {
        userId = req.user.UserId;
        userEmail = req.user.Email;
      }
    }

    const createdDate = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO AuditLogs (UserId, UserEmail, Action, EntityName, RecordId, OldValue, NewValue, Result, Details, IpAddress, CreatedDate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      userId,
      userEmail,
      String(action).toUpperCase(),
      entityName,
      recordId ? String(recordId) : null,
      typeof oldValue === 'object' && oldValue !== null ? JSON.stringify(oldValue) : (oldValue ? String(oldValue) : null),
      typeof newValue === 'object' && newValue !== null ? JSON.stringify(newValue) : (newValue ? String(newValue) : null),
      result,
      details,
      ipAddress,
      createdDate
    );
  } catch (err) {
    console.error('[AuditLog Error]', err);
  }
}

module.exports = { logAudit };
