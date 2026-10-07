const bcrypt = require('bcryptjs');
const db = require('./index');

function seedDatabase() {
  // 1. Seed Roles
  const roles = [
    { RoleName: 'Admin', Description: 'Full application administration, users, roles, audit logs and CRM data.' },
    { RoleName: 'Manager', Description: 'Team pipeline monitoring, CRM record management and management reports.' },
    { RoleName: 'SalesExecutive', Description: 'Management of assigned customers, leads, opportunities and follow-ups.' }
  ];

  const insertRole = db.prepare(`
    INSERT OR IGNORE INTO Roles (RoleName, Description) VALUES (?, ?)
  `);

  for (const role of roles) {
    insertRole.run(role.RoleName, role.Description);
  }

  // 2. Seed Initial Administrative Users (if table empty)
  const userCount = db.prepare('SELECT COUNT(*) as count FROM Users').get().count;
  if (userCount === 0) {
    const saltRounds = 10;
    const adminHash = bcrypt.hashSync('Admin@12345', saltRounds);
    const mgrHash = bcrypt.hashSync('Manager@12345', saltRounds);
    const salesHash = bcrypt.hashSync('Sales@12345', saltRounds);

    const now = new Date().toISOString();

    const insertUser = db.prepare(`
      INSERT INTO Users (Name, Email, PasswordHash, Role, Phone, IsActive, FailedLoginCount, CreatedDate)
      VALUES (?, ?, ?, ?, ?, 1, 0, ?)
    `);

    insertUser.run('Arthur Vance (Admin)', 'admin@acxiom.com', adminHash, 'Admin', '+91 9876543210', now);
    insertUser.run('Morgan Reed (Manager)', 'manager@acxiom.com', mgrHash, 'Manager', '+91 9876543211', now);
    insertUser.run('Samira Patel (Sales Rep)', 'sales@acxiom.com', salesHash, 'SalesExecutive', '+91 9876543212', now);
  }
}

seedDatabase();

module.exports = { seedDatabase };
