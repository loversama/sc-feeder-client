const isProduction = process.env.NODE_ENV === 'production';
const DEV_SERVER_URL = 'ws://localhost:5324';
const PROD_SERVER_URL = 'wss://server-killfeed.sinfulshadows.com';

export const SERVER_URL = isProduction ? PROD_SERVER_URL : DEV_SERVER_URL;

// Derive API URL from SERVER_URL (no /api suffix)
export const SERVER_API_URL = SERVER_URL
  .replace(/^ws/, 'http')
  .replace(/^wss/, 'https')
  .replace(/\/$/, '');