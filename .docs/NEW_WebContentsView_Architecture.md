# NEW WebContentsView + BaseWindow Architecture

## Overview
This document describes the **new** WebContentsView + BaseWindow architecture that replaces the failing webview system while maintaining the exact same Steam-like embedded UI experience. This implementation leverages the successful authentication patterns from external windows while providing embedded functionality.

## Architecture Design

### Core Components

1. **WebContentsView Manager** - Manages embedded web content with authentication
2. **BaseWindow Integration** - Modern window management with embedded views
3. **Enhanced Session Management** - Cookie injection and session handling
4. **Simplified IPC Communication** - Direct communication without complex chains
5. **Robust Error Handling** - Comprehensive fallback mechanisms

## Technical Implementation

### 1. WebContentsView Manager
**File**: `electron/modules/webcontents-view-manager.ts`

**Core Class Structure**:
```typescript
export class WebContentsViewManager {
  private baseWindow: BaseWindow;
  private webContentsView: WebContentsView;
  private headerView: WebContentsView;
  private currentSection: 'profile' | 'leaderboard' | 'map' = 'profile';
  private authenticationEnabled: boolean = true;
  private sessionPartition: string = 'persist:enhanced-webcontent';
}
```

**Key Features**:
- **Dual-View Layout**: Header view (80px) + web content view
- **Authentication Integration**: Cookie injection like external windows
- **Section Navigation**: In-window navigation between profile/leaderboard/map
- **Session Management**: Proper session partitioning and cookie handling
- **Error Recovery**: Automatic fallback and retry mechanisms

### 2. BaseWindow Architecture
**File**: `electron/modules/webcontents-view-manager.ts:createWebContentWindow()`

**Window Structure**:
```typescript
private createBaseWindow(): void {
  this.baseWindow = new BaseWindow({
    width: savedBounds?.width || 1024,
    height: savedBounds?.height || 768,
    title: 'SC Feeder - Web Content',
    show: false,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    minWidth: 800,
    minHeight: 600
  });
}
```

**View Management**:
- **Header View**: Navigation controls with Steam-like tabbed interface
- **Web Content View**: Embedded web content with authentication
- **Bounds Management**: Automatic view sizing and positioning
- **Event Handling**: Proper window lifecycle management

### 3. Authentication System
**File**: `electron/modules/webcontents-view-manager.ts:setupAuthentication()`

**Cookie Injection** (mirrors external windows):
```typescript
private async setAuthenticationCookies(tokens: AuthTokens, url: string): Promise<void> {
  const urlObj = new URL(url);
  const domain = urlObj.hostname;
  
  // Same trusted domain validation as external windows
  const trustedDomains = [
    'killfeed.sinfulshadows.com',
    'voidlog.gg', 
    'localhost'
  ];
  
  const isTrustedDomain = trustedDomains.some(trusted => 
    domain === trusted || domain.endsWith(`.${trusted}`)
  );

  if (isTrustedDomain) {
    const viewSession = this.webContentsView.webContents.session;
    
    // Set same cookies as external windows
    await Promise.all([
      viewSession.cookies.set({
        url: urlObj.origin,
        name: 'access_token',
        value: tokens.accessToken,
        httpOnly: false,
        secure: urlObj.protocol === 'https:',
        sameSite: 'lax',
        expirationDate: Date.now() / 1000 + (15 * 60) // 15 minutes
      }),
      // ... refresh_token and user_data cookies
    ]);
  }
}
```

**Request Interception**:
```typescript
private setupRequestInterception(viewSession: Electron.Session, tokens: AuthTokens): void {
  viewSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const isApiRequest = details.url.includes('/api/') || 
                        this.trustedDomains.some(domain => details.url.includes(domain));

    if (isApiRequest && tokens.accessToken) {
      if (!details.requestHeaders['Authorization']) {
        details.requestHeaders['Authorization'] = `Bearer ${tokens.accessToken}`;
      }
    }

    callback({ requestHeaders: details.requestHeaders });
  });
}
```

### 4. Enhanced Preload Script
**File**: `electron/webcontents-view-preload.ts`

**Simplified Authentication API**:
```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // Direct authentication (no complex guest/host chain)
  getAuthData: (): Promise<AuthData> => {
    return ipcRenderer.invoke('enhanced-auth:get-data');
  },

  updateTokens: (tokens: TokenData): Promise<boolean> => {
    return ipcRenderer.invoke('enhanced-auth:update-tokens', tokens);
  },

  // Navigation within same window
  navigateToSection: (section: string): void => {
    ipcRenderer.send('enhanced-navigation:change-section', section);
  },

  // Listen for auth updates
  onAuthUpdate: (callback: (authData: AuthData) => void): (() => void) => {
    const listener = (_: any, authData: AuthData) => callback(authData);
    ipcRenderer.on('enhanced-auth:data-updated', listener);
    return () => ipcRenderer.removeListener('enhanced-auth:data-updated', listener);
  }
});
```

**Enhanced Fetch Interception**:
```typescript
// Automatic Authorization header injection
const originalFetch = window.fetch;
window.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  const url = request.url;
  
  const isApiRequest = url.includes('/api/') || 
                      url.includes('localhost') || 
                      url.includes('voidlog.gg');

  if (isApiRequest) {
    try {
      const authData = await window.electronAPI.getAuthData();
      if (authData.accessToken && !request.headers.get('Authorization')) {
        request.headers.set('Authorization', `Bearer ${authData.accessToken}`);
      }
    } catch (error) {
      console.warn('Failed to get auth data for request:', error);
    }
  }

  return originalFetch(request);
};
```

### 5. IPC Communication System
**File**: `electron/modules/enhanced-ipc-handlers.ts`

**Simplified Handlers**:
```typescript
export function registerEnhancedIPCHandlers(): void {
  // Direct auth data retrieval
  ipcMain.handle('enhanced-auth:get-data', async () => {
    const currentTokens = AuthManager.getCurrentAuthTokens();
    const authStatus = AuthManager.getAuthStatus();
    
    return {
      accessToken: currentTokens?.accessToken || null,
      refreshToken: currentTokens?.refreshToken || null,
      user: currentTokens?.user || null,
      isAuthenticated: authStatus.isAuthenticated
    };
  });

  // Token updates with session sync
  ipcMain.handle('enhanced-auth:update-tokens', async (_, tokens) => {
    const result = await AuthManager.storeTokens(tokens);
    
    if (result.success) {
      // Update all enhanced sessions
      await EnhancedSessionManager.getInstance().updateAllSessionAuthentication();
      
      // Broadcast to all windows
      broadcastAuthUpdate(tokens);
    }
    
    return result.success;
  });

  // Section navigation
  ipcMain.on('enhanced-navigation:change-section', (event, section) => {
    const enhancedWindow = getEnhancedWebContentWindow();
    enhancedWindow?.navigateToSection(section);
  });
}
```

### 6. Session Management
**File**: `electron/modules/enhanced-session-manager.ts`

**Session Configuration**:
```typescript
export class EnhancedSessionManager {
  private trustedDomains = [
    'killfeed.sinfulshadows.com',
    'voidlog.gg',
    'localhost'
  ];

  public getAuthenticatedSession(partition: string): Electron.Session {
    const webSession = session.fromPartition(partition);
    this.setupSessionAuthentication(webSession);
    return webSession;
  }

  private setupSessionAuthentication(webSession: Electron.Session): void {
    // Request interception for Authorization headers
    webSession.webRequest.onBeforeSendHeaders((details, callback) => {
      // Same pattern as external windows
      const currentTokens = AuthManager.getCurrentAuthTokens();
      
      if (currentTokens?.accessToken) {
        const isApiRequest = details.url.includes('/api/') || 
                            this.trustedDomains.some(domain => details.url.includes(domain));

        if (isApiRequest && !details.requestHeaders['Authorization']) {
          details.requestHeaders['Authorization'] = `Bearer ${currentTokens.accessToken}`;
        }
      }

      callback({ requestHeaders: details.requestHeaders });
    });

    // 401 response handling
    webSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.statusCode === 401) {
        this.handleUnauthorizedResponse(details.url);
      }
      callback({});
    });
  }
}
```

### 7. Error Handling & Fallbacks
**File**: `electron/modules/enhanced-error-handler.ts`

**Comprehensive Error Recovery**:
```typescript
export class EnhancedErrorHandler {
  // Authentication error recovery
  public async handleAuthenticationError(error: any, webContentsView: any, url: string): Promise<boolean> {
    const retryKey = `auth:${url}`;
    const attempts = this.retryAttempts.get(retryKey) || 0;

    if (attempts < this.maxRetries) {
      this.retryAttempts.set(retryKey, attempts + 1);
      
      // Attempt token refresh
      const refreshResult = await AuthManager.refreshToken();
      
      if (refreshResult) {
        // Re-inject cookies and retry
        const sessionManager = EnhancedSessionManager.getInstance();
        const session = webContentsView.webContents.session;
        await sessionManager.injectAuthenticationCookies(session, url);
        
        return true; // Recovery successful
      }
    }

    return false; // Recovery failed
  }

  // Network error handling with retries
  public async handleNetworkError(errorCode: number, errorDescription: string, url: string): Promise<{
    shouldRetry: boolean;
    fallbackUrl?: string;
  }> {
    switch (errorCode) {
      case -2: // ERR_FAILED
        return { shouldRetry: true };
      case -105: // ERR_NAME_NOT_RESOLVED
        return { shouldRetry: false, fallbackUrl: this.getFallbackUrl(url) };
      default:
        return { shouldRetry: false };
    }
  }

  // Fallback content for complete failures
  public getFallbackContent(error: string): string {
    return `<!DOCTYPE html>
      <html>
      <head><title>Connection Error</title></head>
      <body style="background: #1a1a1a; color: #ffffff; font-family: system-ui;">
        <div style="text-align: center; padding: 50px;">
          <h2>Connection Error</h2>
          <p>Unable to connect to the server.</p>
          <button onclick="location.reload()">Retry</button>
        </div>
      </body>
      </html>`;
  }
}
```

## Integration with Existing System

### 1. Window Manager Integration
**File**: `electron/modules/window-manager.ts`

**Enhanced Window Creation**:
```typescript
// New method that creates WebContentsView-based window
export async function createWebContentBaseWindow(
  section: 'profile' | 'leaderboard' | 'map' = 'profile'
): Promise<boolean> {
  try {
    if (webContentBaseWindow) {
      webContentBaseWindow.show();
      await webContentBaseWindow.navigateToSection(section);
      return true;
    }

    webContentBaseWindow = new WebContentsViewManager();
    await webContentBaseWindow.initialize();
    await webContentBaseWindow.navigateToSection(section);
    
    webContentBaseWindow.show();
    return true;
  } catch (error) {
    logger.error('WindowManager', 'Failed to create WebContent BaseWindow:', error);
    return false;
  }
}

// Updated main creation method with fallback
export async function createWebContentWindow(
  section: 'profile' | 'leaderboard' | 'map' = 'profile'
): Promise<boolean> {
  // Try WebContentsView first
  if (await createWebContentBaseWindow(section)) {
    return true;
  }
  
  // Fallback to old BrowserWindow method
  return createWebContentBrowserWindow(section);
}
```

### 2. IPC Handler Updates
**File**: `electron/modules/ipc-handlers.ts`

**Enhanced Handler Registration**:
```typescript
// Register enhanced handlers alongside existing ones
registerEnhancedIPCHandlers();

// Updated existing handler
ipcMain.handle('open-web-content-window', async (_, section: string) => {
  try {
    const success = await windowManager.createWebContentWindow(section as any);
    
    return {
      success,
      architecture: webContentBaseWindow ? 'webcontentsview' : 'browserwindow',
      section,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('IPCHandlers', 'Failed to open web content window:', error);
    return { success: false, error: error.message };
  }
});
```

### 3. Navigation Component Integration
**File**: `src/components/Navigation.vue`

**Updated Navigation Logic**:
```typescript
const openExternalSection = async (section: string, title?: string) => {
  try {
    // First try external window (best UX)
    const result = await window.logMonitorApi?.openExternalWebWindow?.(websiteUrl, {
      width: section === 'map' ? 1600 : 1400,
      height: section === 'map' ? 1000 : 900,
      title: title || `VOIDLOG.GG - ${section.charAt(0).toUpperCase() + section.slice(1)}`,
      enableAuth: true
    });
    
    if (!result?.success) {
      // Fallback to enhanced webcontentsview window
      await window.logMonitorApi?.openWebContentWindow?.(section);
    }
  } catch (error) {
    console.error(`Failed to open ${section}:`, error);
    // Final fallback to old webview system (automatic via window manager)
    await window.logMonitorApi?.openWebContentWindow?.(section);
  }
};
```

## Key Advantages

### 1. Authentication Success
- **Cookie-Based Auth**: Same proven cookie injection as external windows
- **Server Recognition**: Server properly recognizes authenticated requests
- **Token Refresh**: Automatic token refresh and re-injection
- **Trusted Domains**: Secure domain validation prevents auth leakage

### 2. Simplified Architecture
- **Direct IPC**: No complex webview guest/host chains
- **Reduced Race Conditions**: Fewer timing dependencies
- **Better Error Handling**: Clear error paths and recovery
- **Unified State**: Single source of truth for authentication

### 3. Enhanced User Experience
- **Steam-like Interface**: Maintains tabbed navigation experience
- **Faster Loading**: WebContentsView performance improvements
- **Better Integration**: Native window controls and management
- **Seamless Navigation**: In-window section switching

### 4. Future-Proof Design
- **Modern APIs**: Uses latest Electron WebContentsView architecture
- **Backwards Compatible**: Graceful fallback to legacy systems
- **Extensible**: Easy to add new features and sections
- **Maintainable**: Clean separation of concerns

## Migration Strategy

### Phase 1: Parallel Implementation
- Deploy new WebContentsView system alongside existing webview
- Use feature flags to control which system is used
- Monitor authentication success rates and performance

### Phase 2: Gradual Migration
- Migrate users to WebContentsView system gradually
- Monitor for issues and maintain fallback capability
- Collect user feedback and performance metrics

### Phase 3: Legacy Deprecation
- Remove old webview system once WebContentsView is proven stable
- Clean up legacy code and dependencies
- Update documentation and developer guides

---

**Result**: A robust, authenticated, embedded web content system that provides the exact same Steam-like user experience while leveraging proven authentication patterns and modern Electron APIs.