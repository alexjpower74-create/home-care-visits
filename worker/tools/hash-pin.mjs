// Prints a PIN hash for the agency row: PBKDF2-SHA256, 100 000 iterations, random 16-byte salt (base64).
// Used once to write migrations/0002_agency.sql and src/sample.js. Usage: node tools/hash-pin.mjs 4826
const pin = process.argv[2]
if (!/^\d{4,8}$/.test(pin || '')) {
  console.error('PIN must be 4-8 digits')
  process.exit(1)
}
const salt = crypto.getRandomValues(new Uint8Array(16))
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
const b64 = (u) => Buffer.from(u).toString('base64')
console.log(JSON.stringify({ hash: b64(new Uint8Array(bits)), salt: b64(salt), iterations: 100000 }))
