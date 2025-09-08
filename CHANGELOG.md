# Changelog

## Version 0.1.9-alpha

### Features

#### Navigation System Enhancements
- **WebContentPage Window**: Implemented proper WebContentPage popup window with VOIDLOG.GG branding, search bar, and navigation header
- **Fast Navigation**: Added instant section switching without page reloads for improved performance
- **Toggle Functionality**: Navigation icons in KillFeed now toggle windows (click active icon to close)
- **Smart Toggle**: Toggle-close only works from KillFeed icons, not from navigation within WebContentPage
- **Keyboard Shortcuts**: Added keyboard shortcuts to all navigation items for power users
- **Events & Stats Sections**: Added Events and Stats navigation options to the menu
- **Quick Settings**: Enhanced navigation menu with quick settings toggles for better UX

#### Search System
- **Full-Screen Search**: Implemented full-screen search overlay with automatic WebContentsView management
- **Smart Overlay**: Search overlay replaces WebContentsView area instead of covering full screen
- **Search Reliability**: Improved search overlay reliability and performance

#### Authentication & Connection
- **Auth Persistence**: Fixed authentication state persistence across app restarts
- **Connection Status**: Improved connection status messaging and real-time updates
- **Reconnect Functionality**: Fixed reconnect button issues and improved connection recovery
- **Login Flow**: Fixed initial login popup to properly update main app authentication state
- **Guest Mode**: Proper handling of guest mode authentication

#### Sound System
- **Custom Sounds**: Support for custom sound files per event type
- **Volume Control**: Individual volume controls for each event type
- **Default Sounds**: Properly configured default sounds for all event types
- **Sound Testing**: Test button for each sound configuration

### Bug Fixes

#### Navigation Fixes
- Fixed navigation state synchronization between WebContentsView header and KillFeed icons
- Fixed WebContentsView window not reopening after being closed
- Fixed navigation active state not clearing when window is closed
- Fixed navigation to always use proper WebContentPage window instead of embedded manager
- Fixed WebContentsView preload script path references (.js to .mjs)
- Fixed navigation menu alignment and layout issues
- Fixed navigation button focus styles and borders

#### Window Management
- Fixed WebContentsView window being destroyed on navigation
- Fixed window creation failures and error handling
- Fixed auth token decryption spam in console logs
- Fixed WebContentsView toggle functionality
- Improved window bounds saving and restoration

#### Connection & Socket Issues
- Fixed socket disconnection issues during navigation
- Fixed connection status mismatch between actual state and UI
- Fixed connection error state handling
- Prevented app quit during initialization when login window closes

#### UI/UX Fixes
- Fixed search dropdown debugging features
- Fixed sound file button display in settings
- Fixed location history timestamps and clear functionality
- Fixed location history UI design and display
- Adjusted menu section borders for better visual hierarchy
- Fixed initial connection status display on app launch

### Technical Improvements

#### Performance
- Optimized WebContentsView loading performance
- Implemented lazy loading for web content
- Reduced IPC message overhead
- Improved navigation state management with unified composable

#### Code Quality
- Refactored navigation system with unified state management
- Updated dependencies for Vite 7 compatibility
- Fixed ESLint and build warnings
- Improved error handling throughout the application

#### Build System
- Updated @vitejs/plugin-vue to v6.0.1 for Vite 7 support
- Updated electron-vite to v4.0.0 for Vite 7 support
- Added @swc/core as required dependency
- Ensured public/sounds directory is included in builds
- Fixed default sound file references to use existing files

### Known Issues
- Push functionality requires GitHub authentication setup
- Some Windows-specific file permission issues in development

---

## Previous Versions

### Version 0.1.8-alpha and earlier
- Initial alpha releases with core functionality
- Basic kill feed tracking
- Authentication system implementation
- Settings management
- Sound preferences
- Auto-update system