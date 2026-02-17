import pg from 'pg';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const { Pool } = pg;

// Cache for SSM parameters
let dbConfig = null;
let ssmClient = null;

// Initialize SSM client
function getSSMClient() {
  if (!ssmClient) {
    ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return ssmClient;
}

// Helper to get SSM parameter
async function getSSMParameter(name, decrypt = true) {
  const client = getSSMClient();
  const command = new GetParameterCommand({
    Name: name,
    WithDecryption: decrypt
  });

  try {
    const response = await client.send(command);
    return response.Parameter.Value;
  } catch (error) {
    console.error(`Error fetching SSM parameter ${name}:`, error);
    throw error;
  }
}

// Load database configuration from SSM
async function loadDBConfig() {
  if (dbConfig) {
    return dbConfig;
  }

  console.log('Loading database configuration from SSM...');

  const [host, user, password, database] = await Promise.all([
    getSSMParameter('/marginarc/db/host', false),
    getSSMParameter('/marginarc/db/user', false),
    getSSMParameter('/marginarc/db/password', true),
    getSSMParameter('/marginarc/db/name', false)
  ]);

  dbConfig = {
    host,
    port: 5432,
    user,
    password,
    database,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    // Enforce SSL for all DB connections. RDS uses Amazon root CA which is
    // included in the Node.js trust store, so rejectUnauthorized: true works.
    // If connecting to a dev instance with a self-signed cert, override via
    // the PGSSLMODE=no-verify env var instead of weakening this setting.
    ssl: { rejectUnauthorized: true },
  };

  console.log(`Database config loaded: ${user}@${host}/${database}`);
  return dbConfig;
}

// PostgreSQL connection pool (lazy-initialized)
let pool = null;

async function getPool() {
  if (!pool) {
    const config = await loadDBConfig();
    pool = new Pool(config);

    // Test connection on startup
    pool.on('connect', () => {
      console.log('Database connection established');
    });

    pool.on('error', (err) => {
      console.error('Unexpected database error:', err);
    });
  }
  return pool;
}

// Helper function to execute queries
export async function query(text, params) {
  const start = Date.now();
  const poolInstance = await getPool();
  const res = await poolInstance.query(text, params);
  const duration = Date.now() - start;
  console.log('Executed query', { text: text.substring(0, 100), duration, rows: res.rowCount });
  return res;
}

// Helper to get a client from the pool (for transactions)
export async function getClient() {
  const poolInstance = await getPool();
  const client = await poolInstance.connect();
  const originalQuery = client.query;
  const originalRelease = client.release;

  // Monkey patch query to log execution time
  client.query = (...args) => {
    const start = Date.now();
    return originalQuery.apply(client, args).then(res => {
      const duration = Date.now() - start;
      console.log('Client query', { duration, rows: res.rowCount });
      return res;
    });
  };

  // Handle release properly
  client.release = () => {
    client.query = originalQuery;
    client.release = originalRelease;
    return originalRelease.apply(client);
  };

  return client;
}

// Exported SSM helper for other modules (OAuth, etc.)
export { getSSMParameter };

// ---------------------------------------------------------------------------
// Schema migrations — idempotent, safe to call on every cold start
// ---------------------------------------------------------------------------

export async function ensureSalesforceSchema() {
  const pool = await getPool();

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS salesforce_connections (
        id SERIAL PRIMARY KEY,
        license_id UUID REFERENCES licenses(id),
        org_id TEXT NOT NULL UNIQUE,
        instance_url TEXT NOT NULL,
        access_token_enc TEXT,
        refresh_token_enc TEXT,
        token_expires_at TIMESTAMPTZ,
        connected_by TEXT,
        connected_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        status TEXT DEFAULT 'active'
      )
    `);
  } catch (err) {
    // Table may already exist — safe to ignore
    console.log('salesforce_connections table:', err.message.includes('already exists') ? 'exists' : err.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS demo_data_jobs (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        size TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        total_records INTEGER DEFAULT 0,
        records_created INTEGER DEFAULT 0,
        error_message TEXT,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);
  } catch (err) {
    console.log('demo_data_jobs table:', err.message.includes('already exists') ? 'exists' : err.message);
  }

  console.log('Salesforce schema tables ensured');
}

export async function ensureDocsSchema() {
  const pool = await getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS doc_users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      company VARCHAR(255),
      status VARCHAR(20) DEFAULT 'pending',
      customer_id UUID,
      approved_by VARCHAR(100),
      approved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      last_login TIMESTAMP
    )
  `);

  // Migrate customer_id from INTEGER to UUID if needed (existing deployments)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE doc_users ALTER COLUMN customer_id TYPE UUID USING NULL;
    EXCEPTION WHEN others THEN NULL; END $$
  `);

  console.log('Docs schema tables ensured');
}

/**
 * Ensure the api_key column exists on the customers table for per-customer
 * API key support (Epic 10A). Idempotent — safe to call on every cold start.
 */
export async function ensureApiKeySchema() {
  const pool = await getPool();
  try {
    await pool.query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS api_key VARCHAR(50) UNIQUE
    `);
    console.log('customers.api_key column ensured');
  } catch (err) {
    // IF NOT EXISTS may not be supported on older PG — ignore if column already present
    if (err.message && err.message.includes('already exists')) {
      console.log('customers.api_key column already exists');
    } else {
      console.error('Failed to add api_key column:', err.message);
    }
  }
}

// Export a default pool getter
export default getPool;
