-- MarginArc Mothership Database Schema
-- PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    sales_rep VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_customers_email ON customers(contact_email);
CREATE INDEX idx_customers_created ON customers(created_at DESC);

-- Licenses table
CREATE TABLE IF NOT EXISTS licenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    license_key VARCHAR(20) UNIQUE NOT NULL,
    seats_licensed INTEGER NOT NULL CHECK (seats_licensed > 0),
    expiry_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'active', 'expired', 'revoked')),
    activated_at TIMESTAMP,
    last_validated_at TIMESTAMP,
    org_id VARCHAR(18), -- Salesforce org ID (15 or 18 chars)
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_licenses_key ON licenses(license_key);
CREATE INDEX idx_licenses_customer ON licenses(customer_id);
CREATE INDEX idx_licenses_org_id ON licenses(org_id);
CREATE INDEX idx_licenses_status ON licenses(status);
CREATE INDEX idx_licenses_expiry ON licenses(expiry_date);

-- Customer configuration table
CREATE TABLE IF NOT EXISTS customer_config (
    customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    gemini_api_key VARCHAR(255),
    fulcrum_api_url VARCHAR(500) DEFAULT 'https://api.marginarc.com/api/recommend',
    phone_home_interval_days INTEGER DEFAULT 7 CHECK (phone_home_interval_days >= 1),
    features JSONB DEFAULT '{}'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_customer_config_updated ON customer_config(updated_at DESC);

-- Telemetry events table
CREATE TABLE IF NOT EXISTS telemetry_events (
    id BIGSERIAL PRIMARY KEY,
    license_key VARCHAR(20) NOT NULL REFERENCES licenses(license_key) ON DELETE CASCADE,
    org_id VARCHAR(18) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_telemetry_license ON telemetry_events(license_key);
CREATE INDEX idx_telemetry_org ON telemetry_events(org_id);
CREATE INDEX idx_telemetry_received ON telemetry_events(received_at DESC);
CREATE INDEX idx_telemetry_type ON telemetry_events(event_type);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_config_updated_at
    BEFORE UPDATE ON customer_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- View for customer summary with license info
CREATE OR REPLACE VIEW customer_summary AS
SELECT
    c.id,
    c.name,
    c.contact_email,
    c.sales_rep,
    c.created_at,
    l.license_key,
    l.seats_licensed,
    l.expiry_date,
    l.status AS license_status,
    l.activated_at,
    l.org_id
FROM customers c
LEFT JOIN licenses l ON c.id = l.customer_id;

-- View for active licenses
CREATE OR REPLACE VIEW active_licenses AS
SELECT
    l.*,
    c.name AS customer_name,
    c.contact_email,
    CASE
        WHEN l.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN l.status = 'revoked' THEN 'revoked'
        ELSE l.status
    END AS computed_status
FROM licenses l
JOIN customers c ON l.customer_id = c.id
WHERE l.status IN ('pending', 'active');

COMMENT ON TABLE customers IS 'Customer organizations using MarginArc';
COMMENT ON TABLE licenses IS 'License keys issued to customers';
COMMENT ON TABLE customer_config IS 'Per-customer configuration and API keys';
COMMENT ON TABLE telemetry_events IS 'Phone-home telemetry data from Salesforce orgs';

-- Product catalog (OEM GPL data for BOM builder)
CREATE TABLE IF NOT EXISTS product_catalog (
    id BIGSERIAL PRIMARY KEY,
    manufacturer VARCHAR(100) NOT NULL,
    part_number VARCHAR(100) NOT NULL,
    description TEXT,
    product_category VARCHAR(100),
    product_family VARCHAR(200),
    list_price DECIMAL(12,2),
    gsa_price DECIMAL(12,2),
    source VARCHAR(200),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(manufacturer, part_number)
);

CREATE INDEX IF NOT EXISTS idx_catalog_manufacturer ON product_catalog(manufacturer);
CREATE INDEX IF NOT EXISTS idx_catalog_part_number ON product_catalog(part_number);
CREATE INDEX IF NOT EXISTS idx_catalog_category ON product_catalog(product_category);
CREATE INDEX IF NOT EXISTS idx_catalog_search ON product_catalog
    USING gin(to_tsvector('english', coalesce(part_number, '') || ' ' || coalesce(description, '')));

COMMENT ON TABLE product_catalog IS 'OEM product catalog from GPL data for BOM builder';
