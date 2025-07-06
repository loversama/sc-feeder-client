# WebContentsView Authentication System

## Overview

The WebContentsView authentication system is the current implementation that successfully replaces the deprecated Electron `<webview>` tag with modern `WebContentsView` architecture. This system provides authenticated web content integration within the existing window structure while maintaining proper authentication flow.

## Architecture

### Core Components

1. **WebContentPage.vue** - Vue component that provides the UI framework
2. **WebContentsView** - Electron's modern web content container
3. **Enhanced IPC Handlers** - Direct communication between renderer and main process
4. **Authentication Layer** - Cookie injection and header management
5. **Window Management** - Integration with existing window system

### System Flow

```
KillFeed.vue Button Click
         ↓
Enhanced IPC Handler (openEnhancedWebContentWindow)
         ↓
Window Manager (createWebContentWindow)
         ↓
WebContentPage.vue Loads
         ↓
WebContentPage.vue Notifies Main Process Ready
         ↓
Enhanced IPC Handler (enhanced-window:attach-to-existing)
         ↓
createWebContentsViewForWindow()
         ↓
WebContentsView Created + Attached + Authenticated
         ↓
Navigate to Section URL
         ↓
User Sees Authenticated Content
```

## Key Files and Functions

### 1. WebContentPage.vue (`/src/pages/WebContentPage.vue`)
- **Purpose**: Provides the UI framework for the web content window
- **Key Features**:
  - Navigation header with Profile/Leaderboard/Map buttons
  - Container div (`webcontents-container`) where WebContentsView attaches
  - Loading placeholder that gets replaced when WebContentsView is ready
  - Section switching functionality

**Critical Function**: `notifyMainProcessReady()`
```javascript
const notifyMainProcessReady = async () => {
  setTimeout(async () => {
    const result = await window.logMonitorApi.openEnhancedWebContentWindow(activeSection.value);
    if (result.success) {
      // Clear loading message - WebContentsView is now attached
      document.getElementById('webcontents-container').innerHTML = '';
    }
  }, 500);
};
```

### 2. Enhanced IPC Handlers (`/electron/enhanced-ipc-handlers.ts`)
- **Purpose**: Handles communication between renderer and main process
- **Key Handler**: `enhanced-window:attach-to-existing`

**Critical Function**: `createWebContentsViewForWindow()`
```javascript
async function createWebContentsViewForWindow(targetWindow, section) {
  // Create WebContentsView with authentication session
  const webContentSession = session.fromPartition('persist:attached-webcontent');
  const webContentView = new WebContentsView({
    webPreferences: {
      session: webContentSession,
      preload: getPreloadPath('webcontents-view-preload.js')
    }
  });
  
  // Set up authentication and attach to window
  await setupAuthenticationForSession(webContentSession);
  targetWindow.contentView.addChildView(webContentView);
  
  // Navigate to section and position correctly
  await navigateWebContentsViewToSection(webContentView, section);
  positionWebContentsView(webContentView, targetWindow);
}
```

### 3. Authentication System

**Cookie Injection**: Matches the working external window pattern
```javascript
await webContentSession.cookies.set({
  url: urlObj.origin,
  name: 'access_token',
  value: currentTokens.accessToken,
  expirationDate: Date.now() / 1000 + (15 * 60)
});
```

**Header Injection**: Only for API requests, not static assets
```javascript
webContentSession.webRequest.onBeforeSendHeaders((details, callback) => {
  const isApiRequest = url.includes('/api/') && !url.includes('/_nuxt/');
  if (isApiRequest && !details.requestHeaders['Authorization']) {
    details.requestHeaders['Authorization'] = `Bearer ${currentTokens.accessToken}`;
  }
});
```

### 4. Window Management Integration

**Window Creation**: Uses existing BrowserWindow system
```javascript
export function createWebContentWindow(section) {
  const webContentWindow = new BrowserWindow({
    // Standard BrowserWindow configuration
    webPreferences: {
      preload: getPreloadPath('preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  // Load WebContentPage.vue
  webContentWindow.loadURL(`${devServer}//web-content.html#${section}`);
  
  // Attach custom titlebar
  attachTitlebarToWindow(webContentWindow);
}
```

## Authentication Flow

### 1. Initial Authentication
- User must be authenticated in main application
- Authentication tokens stored in AuthManager
- Tokens include: accessToken, refreshToken, user data

### 2. WebContentsView Session Setup
- Creates isolated session: `persist:attached-webcontent`
- Injects authentication cookies matching external window pattern
- Sets up request interception for Authorization headers
- Configures trusted domains for authentication

### 3. Request Authentication
- **Cookie-based**: For initial page load and session management
- **Header-based**: For API requests (`/api/` endpoints)
- **Filtered**: Only applies to API requests, not static assets (`/_nuxt/`)

### 4. Session Management
- Automatic token refresh when needed
- Broadcasts auth updates to all WebContentsViews
- Handles token expiration and renewal

## URL Structure

### Development Mode
```
Base URL: http://localhost:3001
Profile: http://localhost:3001/user/{username}?source=electron&embedded=true&auth=true
Leaderboard: http://localhost:3001/leaderboard?source=electron&embedded=true&auth=true
Map: http://localhost:3001/map?source=electron&embedded=true&auth=true
```

### Production Mode
```
Base URL: https://voidlog.gg
Profile: https://voidlog.gg/user/{username}?source=electron&embedded=true&auth=true
Leaderboard: https://voidlog.gg/leaderboard?source=electron&embedded=true&auth=true
Map: https://voidlog.gg/map?source=electron&embedded=true&auth=true
```

## Window Positioning

### Container-Based Positioning
```javascript
// Get container bounds from WebContentPage.vue
const container = document.getElementById('webcontents-container');
const rect = container.getBoundingClientRect();

// Position WebContentsView to fill container
webContentView.setBounds({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: Math.round(rect.width),
  height: Math.round(rect.height)
});
```

### Responsive Handling
- Automatically repositions on window resize
- Maintains aspect ratio and container fit
- Fallback positioning if container detection fails

## Section Navigation

### In-App Navigation
- Navigation buttons in WebContentPage.vue header
- Calls `setActiveSection()` which triggers WebContentsView navigation
- Seamless switching between Profile/Leaderboard/Map

### Navigation Function
```javascript
async function navigateWebContentsViewToSection(webContentView, section) {
  const baseUrl = isDevelopment ? 'http://localhost:3001' : 'https://voidlog.gg';
  let url = baseUrl;
  
  switch (section) {
    case 'profile':
      url += currentTokens?.user?.username ? `/user/${currentTokens.user.username}` : '/profile';
      break;
    case 'leaderboard':
      url += '/leaderboard';
      break;
    case 'map':
      url += '/map';
      break;
  }
  
  url += '?source=electron&embedded=true&auth=true';
  await webContentView.webContents.loadURL(url);
}
```

## Error Handling

### Window Finding
- Primary: Uses sender window if it matches title
- Fallback: Searches all windows for matching title
- Error: Throws clear error message if no window found

### Authentication Errors
- Graceful degradation if tokens unavailable
- Automatic retry on token refresh
- Clear error logging for debugging

### Network Errors
- Handles load failures in WebContentsView
- Provides user feedback on connection issues
- Automatic retry mechanisms

## Security Features

### Trusted Domains
```javascript
const trustedDomains = [
  'killfeed.sinfulshadows.com',
  'server-killfeed.sinfulshadows.com', 
  'voidlog.gg',
  'localhost'
];
```

### Context Isolation
- WebContentsView runs in isolated context
- No direct access to main process
- Communication through secure IPC channels

### Content Security Policy
- Restricts resource loading to trusted sources
- Prevents XSS and injection attacks
- Maintains security boundaries

## Performance Optimizations

### Session Persistence
- Uses persistent session partition
- Caches authentication state
- Reduces repeated authentication calls

### Resource Management
- Proper cleanup on window close
- Memory management for WebContentsView instances
- Efficient event handler registration

### Request Filtering
- Only authenticates API requests
- Reduces unnecessary header injection
- Improves performance for static assets

## Debugging and Logging

### Enhanced Logging
- Detailed logs for attachment process
- Authentication flow tracking
- Error details with stack traces
- Performance metrics

### Development Tools
- DevTools available in development mode
- Console logging in both main and renderer processes
- Network request monitoring

## Comparison with Previous Systems

### vs. Deprecated Webview
- **Old**: Complex IPC chain, unreliable authentication
- **New**: Direct IPC communication, reliable authentication
- **Result**: Faster, more stable, better security

### vs. External Windows
- **Old**: Separate windows, inconsistent UX
- **New**: Integrated within existing window system
- **Result**: Consistent UX, better resource management

## Future Enhancements

### Planned Features
1. Loading transitions and animations
2. Offline content caching
3. Enhanced error recovery
4. Performance monitoring
5. Advanced session management

### Migration Path
- Current system is fully functional
- No breaking changes required
- Gradual enhancement of features
- Backward compatibility maintained

## Troubleshooting

### Common Issues
1. **WebContentsView not attaching**: Check window title matching
2. **Authentication failures**: Verify token availability and validity
3. **Content not loading**: Check network connectivity and URL configuration
4. **Navigation errors**: Verify section parameter validity

### Debug Steps
1. Check logs for detailed error messages
2. Verify authentication status in main process
3. Confirm window creation and attachment
4. Test network connectivity to target URLs

## Conclusion

The WebContentsView authentication system successfully modernizes the web content integration while maintaining the existing window structure and user experience. It provides reliable authentication, efficient resource management, and a solid foundation for future enhancements.