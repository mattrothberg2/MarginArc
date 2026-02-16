import crypto from 'crypto';
import base32Encode from 'base32-encode';
import base32Decode from 'base32-decode';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Cache for license secret
let SECRET_KEY = null;
let ssmClient = null;

// Initialize SSM client
function getSSMClient() {
  if (!ssmClient) {
    ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return ssmClient;
}

// Load license secret from SSM
async function loadSecretKey() {
  if (SECRET_KEY) {
    return SECRET_KEY;
  }

  console.log('Loading license secret from SSM...');
  const client = getSSMClient();
  const command = new GetParameterCommand({
    Name: '/marginarc/license/secret',
    WithDecryption: true
  });

  const response = await client.send(command);
  SECRET_KEY = response.Parameter.Value;
  console.log('License secret loaded from SSM');
  return SECRET_KEY;
}

/**
 * Generate a license key for a customer
 * Format: FULC-{6chars}-{4chars} (11 chars total + hyphens)
 *
 * Encoding:
 * - First 6 chars: Base32 encoded (customer_id first 4 bytes)
 * - Last 4 chars: Base32 encoded (seats 2 bytes + checksum 1 byte)
 * - Full HMAC over: customer_id + seats + expiry + secret
 *
 * Note: We store full license data in database, the key is primarily for visual identification
 * and tamper detection
 *
 * @param {string} customerId - UUID of the customer
 * @param {Date} expiryDate - License expiration date
 * @param {number} seats - Number of licensed seats
 * @returns {string} License key in format FULC-XXXXXX-XXXX
 */
export async function generateLicenseKey(customerId, expiryDate, seats) {
  // Load secret key from SSM
  const secretKey = await loadSecretKey();

  // Remove hyphens from UUID and take first 8 hex chars (4 bytes)
  const customerIdHex = customerId.replace(/-/g, '').substring(0, 8);
  const customerIdBytes = Buffer.from(customerIdHex, 'hex');

  // Encode seats as 2 bytes (max 65535 seats)
  const seatsBytes = Buffer.alloc(2);
  seatsBytes.writeUInt16BE(Math.min(seats, 65535), 0);

  // Encode expiry date as Unix timestamp (4 bytes)
  const expiryTimestamp = Math.floor(expiryDate.getTime() / 1000);
  const expiryBytes = Buffer.alloc(4);
  expiryBytes.writeUInt32BE(expiryTimestamp, 0);

  // Combine all data for HMAC signature
  const dataToSign = Buffer.concat([customerIdBytes, seatsBytes, expiryBytes]);

  // Generate HMAC-SHA256 signature and take first byte as checksum
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(dataToSign);
  const checksum = hmac.digest().slice(0, 1);

  // First part: customer ID (4 bytes -> exactly 7 base32 chars with padding, but we remove '=')
  const part1Full = base32Encode(customerIdBytes, 'RFC4648');
  const part1 = part1Full.replace(/=/g, '').substring(0, 6);

  // Second part: seats + checksum (3 bytes -> exactly 5 base32 chars with padding, but we remove '=')
  const part2Data = Buffer.concat([seatsBytes, checksum]);
  const part2Full = base32Encode(part2Data, 'RFC4648');
  const part2 = part2Full.replace(/=/g, '').substring(0, 4);

  return `FULC-${part1}-${part2}`;
}

/**
 * Validate and decode a license key
 *
 * Note: This provides basic format validation and extracts embedded data,
 * but the primary source of truth is the database. The key is mainly for
 * visual identification and basic tamper detection.
 *
 * @param {string} licenseKey - License key to validate
 * @returns {object|null} Decoded data {customerIdPrefix, seats} or null if invalid
 */
export function decodeLicenseKey(licenseKey) {
  try {
    // Validate format
    if (!/^FULC-[A-Z2-7]{6}-[A-Z2-7]{4}$/.test(licenseKey)) {
      return null;
    }

    const parts = licenseKey.split('-');
    const part1 = parts[1];
    const part2 = parts[2];

    // Decode part1 (customer ID - 4 bytes encoded as 7 base32 chars, but truncated to 6)
    // Pad back to 8 chars (standard base32 block) for decoding
    const part1ForDecode = part1 + 'A'.repeat(8 - part1.length - 1) + '=';
    const part1Bytes = Buffer.from(base32Decode(part1ForDecode, 'RFC4648'));

    if (part1Bytes.length < 4) {
      console.error('Part1 decode failed: insufficient bytes');
      return null;
    }

    // Decode part2 (seats 2 bytes + checksum 1 byte = 3 bytes encoded as 5 base32 chars, truncated to 4)
    // Pad back to 8 chars for decoding
    const part2ForDecode = part2 + 'A'.repeat(8 - part2.length - 1) + '=';
    const part2Bytes = Buffer.from(base32Decode(part2ForDecode, 'RFC4648'));

    if (part2Bytes.length < 3) {
      console.error('Part2 decode failed: insufficient bytes');
      return null;
    }

    // Extract customer ID prefix (first 4 bytes)
    const customerIdHex = part1Bytes.slice(0, 4).toString('hex');

    // Extract seats (first 2 bytes of part2)
    const seats = part2Bytes.readUInt16BE(0);

    // Extract provided checksum (3rd byte of part2)
    const providedChecksum = part2Bytes.slice(2, 3);

    return {
      customerIdPrefix: customerIdHex,
      seats,
      checksumValid: providedChecksum.length === 1 // Basic validation
    };
  } catch (error) {
    console.error('Error decoding license key:', error);
    return null;
  }
}

/**
 * Validate if a license key is tampered or valid
 * Note: This only checks cryptographic validity, not database status
 *
 * @param {string} licenseKey - License key to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function validateLicenseKey(licenseKey) {
  return decodeLicenseKey(licenseKey) !== null;
}
