const db = require('./index');

function resetAllData() {
  console.log('[Reset] Removing all dummy CRM data...');

  db.pragma('foreign_keys = OFF');

  db.exec(`
    DELETE FROM FollowUps;
    DELETE FROM Activities;
    DELETE FROM Opportunities;
    DELETE FROM Leads;
    DELETE FROM Customers;
    DELETE FROM AuditLogs;

    DELETE FROM sqlite_sequence WHERE name IN ('FollowUps', 'Activities', 'Opportunities', 'Leads', 'Customers', 'AuditLogs');
  `);

  db.pragma('foreign_keys = ON');

  console.log('[Reset] All dummy CRM data cleared successfully!');
  console.log('[Reset] Table counts:');
  console.log(' - Customers:', db.prepare('SELECT COUNT(*) as c FROM Customers').get().c);
  console.log(' - Leads:', db.prepare('SELECT COUNT(*) as c FROM Leads').get().c);
  console.log(' - Opportunities:', db.prepare('SELECT COUNT(*) as c FROM Opportunities').get().c);
  console.log(' - FollowUps:', db.prepare('SELECT COUNT(*) as c FROM FollowUps').get().c);
  console.log(' - Activities:', db.prepare('SELECT COUNT(*) as c FROM Activities').get().c);
  console.log(' - AuditLogs:', db.prepare('SELECT COUNT(*) as c FROM AuditLogs').get().c);
  console.log(' - Users remaining:', db.prepare('SELECT COUNT(*) as c FROM Users').get().c);
}

if (require.main === module) {
  resetAllData();
}

module.exports = { resetAllData };
