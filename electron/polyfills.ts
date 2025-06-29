// Polyfills for CommonJS compatibility in ES modules
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Define __filename and __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Make them available globally for CommonJS dependencies like better-sqlite3
(global as any).__filename = __filename;
(global as any).__dirname = __dirname;

// Additional workaround for modules that check __filename in module scope
if (typeof globalThis.__filename === 'undefined') {
  Object.defineProperty(globalThis, '__filename', {
    get() {
      // Try to return the calling module's filename
      const err = new Error();
      const stack = err.stack?.split('\n');
      if (stack && stack.length > 2) {
        const match = stack[2].match(/file:\/\/\/(.*?):/);
        if (match) {
          return match[1].replace(/\//g, path.sep);
        }
      }
      return __filename;
    },
    configurable: true
  });
}

if (typeof globalThis.__dirname === 'undefined') {
  Object.defineProperty(globalThis, '__dirname', {
    get() {
      return path.dirname(globalThis.__filename);
    },
    configurable: true
  });
}

export {};