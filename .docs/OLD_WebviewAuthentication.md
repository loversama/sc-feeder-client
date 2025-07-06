# OLD Webview Authentication System (Failing)

## Overview
This document describes the **failing** webview authentication system that attempts to provide embedded browser functionality within the main application window. The system experiences authentication failures (401 errors, "No user cookie found") due to complex multi-layer IPC communication and race conditions.

## Architecture Problems

### Current Implementation Issues

1. **Complex IPC Chain**: Main Process → WebContentPage.vue → Webview Guest → Web App
2. **Race Conditions**: Guest preload readiness vs token availability 
3. **Context Isolation**: Multiple isolated contexts with difficult token synchronization
4. **Missing Cookie Injection**: Unlike external windows, webviews don't get cookies set
5. **Authentication State Desync**: Token state can become inconsistent across contexts

## Technical Implementation (Failing)

### 1. WebContentPage.vue Host System
**File**: `src/pages/WebContentPage.vue`

**Template Structure**:
```vue
<webview
  ref="webviewRef"
  :src="webviewSrc"
  :preload="guestPreloadScriptPath"
  style="width: 100%; height: 100%;"
  partition="persist:logmonitorweb"
  allowpopups
  @dom-ready="onWebviewDomReady"
  @ipc-message="handleIpcMessage"
></webview>
```

**Authentication Flow Issues**:
1. **URL-Based Auth**: Uses `?auth=true` parameter (insufficient for server-side auth)
   ```typescript
   url = `${webAppBaseUrl}/user/${currentUsername.value}?source=electron&auth=true`;
   ```

2. **Complex Token Fetching**: Multiple layers of token retrieval
   ```typescript
   const sendAuthDataToWebviewGuest = async (reason: string) => {
     // Multiple readiness checks that often fail
     if (!webviewRef.value) return;
     if (!isGuestPreloadReady) return; 
     if (webviewRef.value.isLoading()) return;
     
     // Uses electronAuthBridge to get tokens
     const authData = await window.electronAuthBridge.getStoredAuthData();
     // Then sends to guest via IPC
     webviewRef.value.send('to-guest-auth-data', authData);
   };
   ```

3. **Race Condition Management**: Attempts to manage readiness state
   ```typescript
   let isGuestPreloadReady = false;
   
   // Reset on navigation (creates more race conditions)
   watch([activeSection, isAuthenticated], () => {
     isGuestPreloadReady = false;
     if (webviewRef.value) {
       webviewRef.value.loadURL(webviewSrc.value);
     }
   });
   ```

### 2. Guest Preload System
**File**: `electron/guest-preload.mjs`

**IPC Message Handling**:
```javascript
const guestApi = {
  // Webview → Host communication
  notifyHostOfNewTokens: (tokens) => {
    ipcRenderer.sendToHost('guest-new-tokens', tokens);
  },
  
  // Host → Webview communication  
  _receiveAuthDataFromHost: (tokens) => {
    if (tokens.accessToken) localStorage.setItem('accessToken', tokens.accessToken);
    if (tokens.refreshToken) localStorage.setItem('refreshToken', tokens.refreshToken);
    if (tokens.user) localStorage.setItem('user', JSON.stringify(tokens.user));
    
    // Notify web app via custom event
    window.dispatchEvent(new CustomEvent('guest-auth-data-updated', { detail: tokens }));
  }
};

// Listen for host messages
ipcRenderer.on('to-guest-auth-data', (_event, tokens) => {
  guestApi._receiveAuthDataFromHost(tokens);
});
```

**Bridge Exposure**:
```javascript
contextBridge.exposeInMainWorld('guestAuthBridge', {
  notifyHostOfNewTokens: guestApi.notifyHostOfNewTokens,
  requestInitialAuthDataFromHost: guestApi.requestInitialAuthDataFromHost,
  getStoredAuthData: guestApi.getStoredAuthData
});
```

### 3. Authentication State Management
**File**: `src/pages/WebContentPage.vue:227-253`

**Multiple Auth Listeners**:
```typescript
// Listen for auth status changes
if (window.logMonitorApi && window.logMonitorApi.onAuthStatusChanged) {
  window.logMonitorApi.onAuthStatusChanged((_event, status) => {
    isAuthenticated.value = status.isAuthenticated;
    currentUsername.value = status.username;
  });
}

// Listen for auth updates from main process
if (window.logMonitorApi && window.logMonitorApi.onMainAuthUpdate) {
  window.logMonitorApi.onMainAuthUpdate(async (_event, authData) => {
    await updateAuthStatus();
    
    if (webviewRef.value && isGuestPreloadReady) {
      if (authData && (authData.accessToken || authData.refreshToken)) {
        webviewRef.value.send('to-guest-auth-data', authData);
      } else {
        webviewRef.value.send('to-guest-clear-auth-data');
      }
    }
  });
}
```

## Failure Points Analysis

### 1. Token Synchronization Failures

**Problem**: Multi-step token passing creates points of failure
```
Main Process (Auth Manager) 
    ↓ IPC
WebContentPage.vue (Host) 
    ↓ webview.send()
Guest Preload Script 
    ↓ localStorage
Web Application
```

**Race Conditions**:
- Guest preload loads before tokens are available
- Navigation resets readiness state mid-authentication
- IPC messages can be lost during webview reloads

### 2. Missing Cookie Authentication

**Unlike External Windows**, webviews don't receive:
- Server-side authentication cookies
- Automatic session management  
- Direct session API access

**Result**: Server sees requests as unauthenticated even with client-side tokens

### 3. Complex State Management

**Multiple Readiness Flags**:
```typescript
let isGuestPreloadReady = false;
const isAuthenticated = ref(false);
const currentUsername = ref<string | null>(null);
```

**State Synchronization Issues**:
- Host auth state vs Guest auth state
- URL computation based on stale auth state
- Navigation triggering state resets

### 4. Error Recovery Limitations

**No Robust Retry Mechanisms**:
- If guest preload fails to load, no automatic retry
- If token sync fails, user must manually refresh
- No fallback authentication methods

**Limited Error Visibility**:
- Token sync failures happen silently
- Server 401 errors not handled gracefully
- No user feedback for authentication issues

## Debugging Evidence

### Console Outputs (Failing Sequence)
```
[WebContentPage] Attempting to send auth data to webview GUEST. Reason: guest-preload-loaded.
[WebContentPage] Auth data from main bridge: {accessToken: "...", refreshToken: "...", user: {...}}
[WebContentPage] Sending "to-guest-auth-data" to webview GUEST with payload: {...}
[GuestPreload] IPC "to-guest-auth-data" received from host. {...}
[GuestPreload] Auth data stored in guest localStorage.

// Later, server still returns 401 errors:
[Server] GET /api/user/profile - 401 Unauthorized - No user cookie found
```

### Root Cause
**Cookies are never set** in the webview session, even though:
1. Tokens are successfully passed to guest context
2. Tokens are stored in localStorage
3. Guest preload script receives and processes tokens correctly

The server expects **HTTP cookies** for authentication, but the webview session never receives them.

## Comparison with Working External Windows

| Feature | External Windows (✅ Working) | Webview (❌ Failing) |
|---------|------------------------------|----------------------|
| Session Management | Direct `session.cookies.set()` | No session access |
| Cookie Injection | ✅ Automatic for trusted domains | ❌ Not implemented |
| IPC Complexity | Simple main → window | Complex multi-layer |
| Race Conditions | Minimal | Many timing issues |
| Error Recovery | Robust with fallbacks | Limited and fragile |
| Token Sync | Direct IPC + cookies | localStorage only |
| Server Auth | ✅ Cookies + headers | ❌ Headers only (insufficient) |

## Why External Windows Work vs Webviews Fail

### External Windows Success Factors:
1. **Direct Session Control**: Can call `webContents.session.cookies.set()`
2. **Cookie + Header Auth**: Both server cookies and client headers
3. **Simple IPC**: Direct main process → window communication
4. **Robust Error Handling**: Multiple fallback mechanisms

### Webview Failure Factors:
1. **No Session Control**: Guest context cannot set session cookies
2. **LocalStorage Only**: Server doesn't see authentication cookies
3. **Complex IPC Chain**: Many points of failure in communication
4. **Race Conditions**: Timing issues with preload readiness

## Migration Requirements

To fix this system with WebContentsView:

1. **Replace webview with WebContentsView** for direct session control
2. **Implement cookie injection** similar to external windows
3. **Simplify IPC communication** to reduce race conditions
4. **Add robust error recovery** with fallback mechanisms
5. **Maintain embedded experience** while fixing authentication

---

**Next**: See the new WebContentsView implementation that addresses these issues while maintaining the embedded Steam-like experience.