-- Migration 001: React Admin backend support
-- Run against the fulcrum PostgreSQL database via psql or a migration runner

-- New tables
CREATE TABLE IF NOT EXISTS license_activations (
    id SERIAL PRIMARY KEY,
    license_id INTEGER REFERENCES licenses(id) ON DELETE CASCADE,
    org_id VARCHAR(255) NOT NULL,
    org_name VARCHAR(255),
    activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_phone_home TIMESTAMP,
    salesforce_org_type VARCHAR(50),
    seats_used INTEGER DEFAULT 0,
    version VARCHAR(50),
    ip_address INET,
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    admin_user VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100),
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    full_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'admin',
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);

-- Add columns to existing tables (use IF NOT EXISTS pattern)
DO $$ BEGIN
    ALTER TABLE customers ADD COLUMN status VARCHAR(20) DEFAULT 'active';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customers ADD COLUMN notes TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customers ADD COLUMN company_size VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customers ADD COLUMN website VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customers ADD COLUMN industry VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE licenses ADD COLUMN notes TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE licenses ADD COLUMN license_type VARCHAR(50) DEFAULT 'standard';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_licenses_customer_id ON licenses(customer_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_activations_license_id ON license_activations(license_id);
CREATE INDEX IF NOT EXISTS idx_activations_org_id ON license_activations(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_user ON audit_logs(admin_user);

-- Seed initial admin user (password: "marginarc2024!" hashed with bcrypt)
-- The actual password will be set via SSM, this is just a placeholder
INSERT INTO admin_users (username, password_hash, email, full_name, role)
VALUES ('admin', '$2a$12$placeholder', 'admin@marginarc.com', 'Admin User', 'super_admin')
ON CONFLICT (username) DO NOTHING;

-- Seed default settings
INSERT INTO settings (key, value, description) VALUES
('general.app_name', '"MarginArc"', 'Application name'),
('general.support_email', '"support@marginarc.com"', 'Support email'),
('security.session_timeout_hours', '24', 'Session timeout in hours'),
('security.max_login_attempts', '5', 'Max failed login attempts before lockout'),
('license.default_seats', '25', 'Default seat count for new licenses'),
('license.default_expiry_days', '365', 'Default license expiry in days')
ON CONFLICT (key) DO NOTHING;
