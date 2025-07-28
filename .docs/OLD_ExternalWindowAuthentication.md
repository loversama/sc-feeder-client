# OLD External Window Authentication System (Working)

## Overview
This document describes the **working** external window authentication system that successfully creates separate BrowserWindows with proper authentication for trusted domains. This system is used as the foundation for the new WebContentsView implementation.

## Architecture

### Main Components

1. **WindowManager.createExternalWebWindow()** - Primary entry point
2. **_setExternalWebsiteCookies()** - Cookie injection mechanism  
3. **webview-preload.ts** - Authentication bridge for external windows
4. **Auth-Manager.getCurrentAuthTokens()** - Token retrieval

## Technical Implementation

### 1. External Window Creation
**File**: `electron/modules/window-manager.ts:232-357`

```typescript
public async createExternalWebWindow(url: string, options: { 
    width?: number, 
    height?: number, 
    title?: string,
    enableAuth?: boolean 
} = {}): Promise<BrowserWindow | null>
```

**Key Features**:
- Creates separate `BrowserWindow` instances
- Uses dedicated `webview-preload.mjs` preload script
- Supports authentication enabling/disabling
- Includes error handling and window lifecycle management
- Shows window only after content loads (prevents blank windows)

### 2. Cookie-Based Authentication
**File**: `electron/modules/window-manager.ts:360-420`

```typescript
private async _setExternalWebsiteCookies(window: BrowserWindow, url: string, tokens: AuthTokens): Promise<void>
```

**Authentication Flow**:
1. **Domain Validation**: Only trusted domains receive cookies
   ```typescript
   const trustedDomains = [
       'killfeed.sinfulshadows.com',
       'server-killfeed.sinfulshadows.com', 
       'voidlog.gg',
       'localhost' // For development
   ];
   ```

2. **Cookie Injection**: Three types of cookies are set
   - `access_token`: 15-minute expiration, httpOnly=false
   - `refresh_token`: 7-day expiration, httpOnly=true  
   - `user_data`: 24-hour expiration, JSON stringified user object

3. **Session Management**: Uses window's session.cookies.set() API
   ```typescript
   await window.webContents.session.cookies.set({
       url: urlObj.origin,
       name: 'access_token', 
       value: tokens.accessToken || '',
       httpOnly: false,
       secure: urlObj.protocol === 'https:',
       sameSite: 'lax',
       expirationDate: Date.now() / 1000 + (15 * 60)
   });
   ```

### 3. Preload Script Authentication
**File**: `electron/webview-preload.ts`

**Authentication Bridge**:
```typescript
contextBridge.exposeInMainWorld('electronAuthBridge', {
    notifyElectronOfNewTokens: (tokens) => {
        ipcRenderer.send('auth:store-tokens', tokens);
    },
    getStoredAuthData: () => {
        return ipcRenderer.invoke('auth:get-tokens');
    }
});
```

**Token Synchronization**:
1. **IPC Listening**: Receives `auth-tokens-updated` events
2. **LocalStorage Injection**: Stores tokens for web app consumption
   ```typescript
   localStorage.setItem('auth.accessToken', authData.accessToken);
   localStorage.setItem('auth.refreshToken', authData.refreshToken);
   localStorage.setItem('auth.user', JSON.stringify(authData.user));
   ```

3. **Cookie-to-LocalStorage Bridge**: Reads cookies on DOMContentLoaded
   ```typescript
   const accessTokenCookie = document.cookie.split(';')
       .find(cookie => cookie.trim().startsWith('access_token='));
   ```

### 4. Request Interception
**File**: `electron/webview-preload.ts:57-76`

**Automatic Authorization Headers**:
```typescript
const originalFetch = window.fetch;
window.fetch = function(input: RequestInfo | URL, init?: RequestInit) {
    const request = new Request(input, init);
    const url = request.url;
    
    const isApiRequest = url.includes('/api/') || 
        url.includes('localhost') || 
        url.includes('voidlog.gg') || 
        url.includes('killfeed.sinfulshadows.com');
    
    if (isApiRequest) {
        const accessToken = localStorage.getItem('auth.accessToken');
        if (accessToken && !request.headers.get('Authorization')) {
            request.headers.set('Authorization', `Bearer ${accessToken}`);
        }
    }
    
    return originalFetch(request);
};
```

## Authentication Flow Sequence

1. **Window Creation**: `createExternalWebWindow()` called with URL and options
2. **Token Retrieval**: Gets current tokens from `auth-manager.getCurrentAuthTokens()`  
3. **Cookie Injection**: Calls `_setExternalWebsiteCookies()` for trusted domains
4. **URL Loading**: Loads the target URL in the new window
5. **Preload Execution**: `webview-preload.ts` executes in window context
6. **IPC Token Sync**: Window receives `auth-tokens-updated` via IPC
7. **LocalStorage Sync**: Tokens stored in localStorage and cookies read
8. **Request Interception**: All API requests automatically get Authorization headers

## Why This System Works

### Strengths
1. **Direct Session Control**: Direct access to BrowserWindow session APIs
2. **Trusted Domain Security**: Only injects auth for validated domains
3. **Multiple Auth Methods**: Supports both cookies and Authorization headers
4. **Error Recovery**: Robust error handling and fallback mechanisms
5. **Token Refresh**: Automatic token refresh and re-injection
6. **IPC Simplicity**: Direct main→renderer IPC communication

### Security Features
1. **Domain Whitelisting**: Prevents auth leakage to untrusted sites
2. **Cookie Security**: Proper httpOnly, secure, and sameSite settings
3. **Token Expiration**: Appropriate expiration times for different token types
4. **Context Isolation**: Preload script runs in isolated context

## Usage Example

```typescript
// From Navigation.vue
const result = await window.logMonitorApi?.openExternalWebWindow?.(websiteUrl, {
    width: 1400,
    height: 900, 
    title: `VOIDLOG.GG - Profile`,
    enableAuth: true
});
```

## Integration Points

### IPC Handlers
- `auth:store-tokens` - Store new tokens from web content
- `auth:get-tokens` - Retrieve current tokens for injection
- `webview-ready-for-token` - Signal readiness for token injection

### Auth Manager Integration
- `getCurrentAuthTokens()` - Token retrieval for cookie injection
- Token refresh triggers automatic re-injection to all windows

## Limitations

1. **Separate Windows**: Creates floating windows instead of embedded content
2. **Window Management**: Users must manage multiple window instances
3. **Context Switching**: User experience differs from embedded Steam-like experience
4. **Resource Usage**: Each window consumes additional memory/resources

---

**Next**: See `OLD_WebviewAuthentication.md` for the failing embedded system that this document aims to replace with WebContentsView architecture.