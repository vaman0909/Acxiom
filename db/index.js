const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'crm.sqlite');
const db = new Database(dbPath);

// Enable foreign keys and WAL mode for reliability & performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  // Roles table
  db.exec(`
    CREATE TABLE IF NOT EXISTS Roles (
      RoleId INTEGER PRIMARY KEY AUTOINCREMENT,
      RoleName TEXT UNIQUE NOT NULL,
      Description TEXT
    );
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      UserId INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      PasswordHash TEXT NOT NULL,
      Role TEXT NOT NULL,
      Phone TEXT,
      IsActive INTEGER NOT NULL DEFAULT 1,
      FailedLoginCount INTEGER NOT NULL DEFAULT 0,
      LockoutEnd TEXT,
      CreatedDate TEXT NOT NULL,
      FOREIGN KEY (Role) REFERENCES Roles(RoleName)
    );
  `);

  // Customers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS Customers (
      CustomerId INTEGER PRIMARY KEY AUTOINCREMENT,
      CustomerCode TEXT UNIQUE NOT NULL,
      CustomerName TEXT NOT NULL,
      Email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      Phone TEXT UNIQUE NOT NULL,
      CompanyName TEXT,
      Address TEXT,
      City TEXT,
      State TEXT,
      Status TEXT NOT NULL DEFAULT 'Active',
      CreatedDate TEXT NOT NULL,
      CreatedBy INTEGER NOT NULL,
      AssignedTo INTEGER,
      Notes TEXT,
      FOREIGN KEY (CreatedBy) REFERENCES Users(UserId),
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId)
    );
  `);

  // Leads table
  db.exec(`
    CREATE TABLE IF NOT EXISTS Leads (
      LeadId INTEGER PRIMARY KEY AUTOINCREMENT,
      LeadCode TEXT UNIQUE NOT NULL,
      LeadName TEXT NOT NULL,
      Email TEXT NOT NULL COLLATE NOCASE,
      Phone TEXT NOT NULL,
      CompanyName TEXT,
      Source TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'New',
      Priority TEXT NOT NULL DEFAULT 'Medium',
      ExpectedValue REAL NOT NULL DEFAULT 0,
      CreatedDate TEXT NOT NULL,
      AssignedTo INTEGER NOT NULL,
      ConvertedCustomerId INTEGER,
      ConvertedOpportunityId INTEGER,
      Notes TEXT,
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId),
      FOREIGN KEY (ConvertedCustomerId) REFERENCES Customers(CustomerId),
      FOREIGN KEY (ConvertedOpportunityId) REFERENCES Opportunities(OpportunityId)
    );
  `);

  // Opportunities table
  db.exec(`
    CREATE TABLE IF NOT EXISTS Opportunities (
      OpportunityId INTEGER PRIMARY KEY AUTOINCREMENT,
      OpportunityName TEXT NOT NULL,
      CustomerId INTEGER NOT NULL,
      LeadId INTEGER,
      Amount REAL NOT NULL,
      Stage TEXT NOT NULL DEFAULT 'Qualification',
      Probability REAL NOT NULL DEFAULT 10,
      ExpectedCloseDate TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Open',
      CreatedDate TEXT NOT NULL,
      AssignedTo INTEGER NOT NULL,
      Notes TEXT,
      FOREIGN KEY (CustomerId) REFERENCES Customers(CustomerId),
      FOREIGN KEY (LeadId) REFERENCES Leads(LeadId),
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId)
    );
  `);

  // Follow-Ups table
  db.exec(`
    CREATE TABLE IF NOT EXISTS FollowUps (
      FollowUpId INTEGER PRIMARY KEY AUTOINCREMENT,
      CustomerId INTEGER,
      LeadId INTEGER,
      OpportunityId INTEGER,
      FollowUpDate TEXT NOT NULL,
      FollowUpType TEXT NOT NULL DEFAULT 'Call',
      Subject TEXT NOT NULL,
      Remarks TEXT,
      Status TEXT NOT NULL DEFAULT 'Planned',
      AssignedTo INTEGER NOT NULL,
      CreatedDate TEXT NOT NULL,
      CompletedDate TEXT,
      FOREIGN KEY (CustomerId) REFERENCES Customers(CustomerId),
      FOREIGN KEY (LeadId) REFERENCES Leads(LeadId),
      FOREIGN KEY (OpportunityId) REFERENCES Opportunities(OpportunityId),
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId)
    );
  `);

  // Activities table
  db.exec(`
    CREATE TABLE IF NOT EXISTS Activities (
      ActivityId INTEGER PRIMARY KEY AUTOINCREMENT,
      ActivityType TEXT NOT NULL,
      Subject TEXT NOT NULL,
      Description TEXT,
      ActivityDate TEXT NOT NULL,
      CustomerId INTEGER,
      LeadId INTEGER,
      AssignedTo INTEGER NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Completed',
      CreatedDate TEXT NOT NULL,
      FOREIGN KEY (CustomerId) REFERENCES Customers(CustomerId),
      FOREIGN KEY (LeadId) REFERENCES Leads(LeadId),
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId)
    );
  `);

  // AuditLog table
  db.exec(`
    CREATE TABLE IF NOT EXISTS AuditLogs (
      AuditLogId INTEGER PRIMARY KEY AUTOINCREMENT,
      UserId INTEGER,
      UserEmail TEXT,
      Action TEXT NOT NULL,
      EntityName TEXT NOT NULL,
      RecordId TEXT,
      OldValue TEXT,
      NewValue TEXT,
      Result TEXT DEFAULT 'SUCCESS',
      Details TEXT,
      IpAddress TEXT,
      CreatedDate TEXT NOT NULL,
      FOREIGN KEY (UserId) REFERENCES Users(UserId)
    );
  `);

  // Create indexes for high performance search & filtering
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_customers_code ON Customers(CustomerCode);
    CREATE INDEX IF NOT EXISTS idx_customers_email ON Customers(Email);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON Customers(Phone);
    CREATE INDEX IF NOT EXISTS idx_customers_assigned ON Customers(AssignedTo);
    CREATE INDEX IF NOT EXISTS idx_leads_code ON Leads(LeadCode);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON Leads(Status);
    CREATE INDEX IF NOT EXISTS idx_leads_assigned ON Leads(AssignedTo);
    CREATE INDEX IF NOT EXISTS idx_opps_stage ON Opportunities(Stage);
    CREATE INDEX IF NOT EXISTS idx_opps_assigned ON Opportunities(AssignedTo);
    CREATE INDEX IF NOT EXISTS idx_followups_date ON FollowUps(FollowUpDate);
    CREATE INDEX IF NOT EXISTS idx_followups_status ON FollowUps(Status);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON AuditLogs(CreatedDate);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON AuditLogs(EntityName);
  `);
}

initSchema();

module.exports = db;
