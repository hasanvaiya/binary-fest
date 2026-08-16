-- Binary Fest 2026 Ticketing System - Initial Schema

-- Admin / Issuer accounts (super admin, counter issuers, gate verifiers)
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super', 'counter', 'gate')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME,
  approved_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_username ON admins(username);
CREATE INDEX IF NOT EXISTS idx_admins_status ON admins(status);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  university_id TEXT NOT NULL,
  university_email TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('CSE', 'Others', 'Outsiders')),
  batch TEXT,
  section TEXT,
  price REAL NOT NULL DEFAULT 1000,
  bus_point TEXT NOT NULL,
  qr_payload TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  boarded INTEGER NOT NULL DEFAULT 0,
  boarded_at DATETIME,
  boarded_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_code ON tickets(ticket_code);
CREATE INDEX IF NOT EXISTS idx_tickets_bus_point ON tickets(bus_point);
CREATE INDEX IF NOT EXISTS idx_tickets_boarded ON tickets(boarded);
CREATE INDEX IF NOT EXISTS idx_tickets_issued_by ON tickets(issued_by);

-- Seed the Super Admin account
-- Username: admin_cse | Password: admin123
-- password_hash/password_salt below are PBKDF2-SHA256 (100000 iterations, 32-byte key) of "admin123"
INSERT OR IGNORE INTO admins (username, full_name, password_hash, password_salt, role, status, approved_at, approved_by)
VALUES (
  'admin_cse',
  'Super Admin (CSE Committee)',
  'c06b76af2601cb7546cb25e85bc75c3bca5951f551ce02cd43367e048de89e10',
  'f08144960d5a6a3ef74113dd8427fc35',
  'super',
  'approved',
  CURRENT_TIMESTAMP,
  'system'
);
