const DEV_SERVER_URL = 'ws://localhost:5324';
const PROD_SERVER_URL = 'wss://api.voidlog.gg';

// Assume production by default, only use development if explicitly set
const isDevelopment = process.env.NODE_ENV === 'development';

// Log environment for debugging
console.log(`[ServerConfig] NODE_ENV: "${process.env.NODE_ENV}"`);
console.log(`[ServerConfig] Is development: ${isDevelopment}`);

export const SERVER_URL = isDevelopment ? DEV_SERVER_URL : PROD_SERVER_URL;

console.log(`[ServerConfig] Selected server URL: ${SERVER_URL}`);

// Derive API URL from SERVER_URL (no /api suffix)
export const SERVER_API_URL = SERVER_URL
  .replace(/^ws/, 'http')
  .replace(/^wss/, 'https')
  .replace(/\/$/, '');