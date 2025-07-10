const DEV_SERVER_URL = 'ws://localhost:5324';
const PROD_SERVER_URL = 'wss://api.voidlog.gg';

export const SERVER_URL = process.env.NODE_ENV === 'development' ? DEV_SERVER_URL : PROD_SERVER_URL;

// Derive API URL from SERVER_URL (no /api suffix)
export const SERVER_API_URL = SERVER_URL
  .replace(/^ws/, 'http')
  .replace(/^wss/, 'https')
  .replace(/\/$/, '');