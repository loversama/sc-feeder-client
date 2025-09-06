import { ipcMain, BrowserWindow } from 'electron';
import * as logger from './logger';
import { 
  getNavigationState, 
  updateWebContentWindow, 
  updateSettingsWindow,
  setActiveIcon,
  addStateChangeListener,
  NavigationState 
} from './navigation-state-manager';
import { 
  createWebContentWindow, 
  createSettingsWindow, 
  getMainWindow,
  closeWebContentWindow,
  closeSettingsWindow,
  getWebContentWindow,
  getSettingsWindow 
} from './window-manager';
import { getCurrentAuthTokens } from './auth-manager';
import { getLastLoggedInUser } from './config-manager';

const MODULE_NAME = 'NavigationController';

// Request queue to prevent race conditions
interface NavigationRequest {
  id: string;
  type: 'open' | 'close' | 'switch';
  section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'settings' | null;
  timestamp: number;
  resolve: (result: NavigationResult) => void;
  reject: (error: Error) => void;
}

interface NavigationResult {
  success: boolean;
  section?: string;
  error?: string;
  state?: NavigationState;
}

let requestQueue: NavigationRequest[] = [];
let isProcessingRequest = false;
let requestCounter = 0;

// Timeout for navigation requests
const REQUEST_TIMEOUT = 5000;

// Generate unique request ID
function generateRequestId(): string {
  return `nav_${Date.now()}_${++requestCounter}`;
}

// Queue a navigation request
async function queueNavigationRequest(
  type: NavigationRequest['type'],
  section: NavigationRequest['section']
): Promise<NavigationResult> {
  return new Promise((resolve, reject) => {
    const request: NavigationRequest = {
      id: generateRequestId(),
      type,
      section,
      timestamp: Date.now(),
      resolve,
      reject,
    };

    requestQueue.push(request);
    logger.info(MODULE_NAME, `Queued navigation request: ${request.id} (${type} ${section})`);

    // Set timeout for request
    setTimeout(() => {
      const index = requestQueue.findIndex(r => r.id === request.id);
      if (index > -1) {
        requestQueue.splice(index, 1);
        request.reject(new Error(`Navigation request ${request.id} timed out`));
      }
    }, REQUEST_TIMEOUT);

    // Process queue
    processRequestQueue();
  });
}

// Process the request queue
async function processRequestQueue(): Promise<void> {
  if (isProcessingRequest || requestQueue.length === 0) {
    return;
  }

  isProcessingRequest = true;
  const request = requestQueue.shift()!;

  try {
    logger.info(MODULE_NAME, `Processing navigation request: ${request.id} (${request.type} ${request.section})`);
    
    const result = await executeNavigationRequest(request);
    request.resolve(result);
    
  } catch (error) {
    logger.error(MODULE_NAME, `Failed to process navigation request ${request.id}:`, error);
    request.reject(error as Error);
  } finally {
    isProcessingRequest = false;
    
    // Process next request in queue
    if (requestQueue.length > 0) {
      setImmediate(() => processRequestQueue());
    }
  }
}

// Execute a navigation request
async function executeNavigationRequest(request: NavigationRequest): Promise<NavigationResult> {
  const currentState = getNavigationState();
  
  switch (request.type) {
    case 'open':
      return await handleOpenRequest(request.section!, currentState);
    case 'close':
      return await handleCloseRequest(request.section!, currentState);
    case 'switch':
      return await handleSwitchRequest(request.section!, currentState);
    default:
      throw new Error(`Unknown request type: ${request.type}`);
  }
}

// Handle open requests
async function handleOpenRequest(
  section: NonNullable<NavigationRequest['section']>, 
  currentState: NavigationState
): Promise<NavigationResult> {
  
  if (section === 'settings') {
    return await handleSettingsOpen(currentState);
  } else {
    return await handleWebContentOpen(section, currentState);
  }
}

// Handle close requests
async function handleCloseRequest(
  section: NonNullable<NavigationRequest['section']>, 
  currentState: NavigationState
): Promise<NavigationResult> {
  
  if (section === 'settings') {
    return await handleSettingsClose(currentState);
  } else {
    return await handleWebContentClose(currentState);
  }
}

// Handle switch requests (navigate existing window if possible, else close and open new)
async function handleSwitchRequest(
  section: NonNullable<NavigationRequest['section']>, 
  currentState: NavigationState
): Promise<NavigationResult> {
  
  if (section === 'settings') {
    // Settings is always a separate window, so close current and open settings
    if (currentState.webContentWindow.isOpen) {
      await handleWebContentClose(currentState);
    }
    return await handleSettingsOpen(getNavigationState());
  } else {
    // For web content sections, try to navigate existing window instead of closing
    if (currentState.webContentWindow.isOpen && currentState.webContentWindow.architecture === 'webcontentsview') {
      logger.info(MODULE_NAME, `🔄 Switching WebContentsView from ${currentState.webContentWindow.currentSection} to ${section} (keeping window open)`);
      
      // Navigate the existing WebContentsView to the new section
      try {
        const webContentWindow = getWebContentWindow();
        if (webContentWindow && !webContentWindow.isDestroyed()) {
          // Add a guard to prevent crashes from destroyed windows
          try {
            if (webContentWindow.isDestroyed()) {
              logger.warn(MODULE_NAME, `Window was destroyed during navigation check, aborting switch to ${section}`);
              return { success: false, error: 'Window was destroyed' };
            }
            
            // Update state to show we're loading the new section
            updateWebContentWindow({
              isLoading: true,
              currentSection: section,
            });
          } catch (destroyedError) {
            logger.error(MODULE_NAME, `Window check failed, likely destroyed:`, destroyedError);
            return { success: false, error: 'Window no longer available' };
          }

          // Load the new URL in the existing window using WebContentsView URL pattern
          const isDevelopment = process.env.NODE_ENV === 'development';
          const webAppBaseUrl = isDevelopment ? 'http://localhost:3001' : 'https://voidlog.gg';
          
          const currentTokens = getCurrentAuthTokens();
          let url = webAppBaseUrl;
          
          switch (section) {
            case 'profile':
              if (currentTokens?.user?.username) {
                url += `/user/${currentTokens.user.username}`;
              } else {
                // Use last known username when not authenticated
                const lastKnownUser = getLastLoggedInUser();
                if (lastKnownUser) {
                  url += `/user/${lastKnownUser}`;
                } else {
                  url += '/profile';
                }
              }
              break;
            case 'leaderboard':
              url += '/leaderboard';
              break;
            case 'map':
              url += '/map';
              break;
            case 'events':
              url += '/events';
              break;
            case 'stats':
              url += '/stats';
              break;
          }
          
          url += '?source=electron&embedded=true';
          if (currentTokens?.accessToken) {
            url += '&auth=true';
          }

          // For switching, we need to tell the enhanced system to navigate the WebContentsView
          // Instead of navigating the main window, trigger the WebContentsView navigation
          logger.info(MODULE_NAME, `🔄 Delegating WebContentsView switch to enhanced system`);
          
          // First try the embedded manager
          const { getEmbeddedWebContentManager } = await import('./embedded-webcontents-manager');
          const manager = getEmbeddedWebContentManager();
          
          if (manager && manager.isOverlayVisible()) {
            // Use the embedded manager if available and visible
            logger.info(MODULE_NAME, `🔄 Using embedded WebContentsView manager for section: ${section}`);
            await manager.navigateToSection(section);
          } else {
            // Fallback: Use the WebContentsView attached to the window
            logger.info(MODULE_NAME, `🔄 Using attached WebContentsView for section: ${section}`);
            
            // Import the navigation function from enhanced handlers
            const { navigateWebContentsViewForWindow } = await import('../enhanced-ipc-handlers');
            
            // Navigate the WebContentsView attached to this window
            const success = await navigateWebContentsViewForWindow(webContentWindow.id, section);
            
            if (!success) {
              logger.warn(MODULE_NAME, `Failed to navigate WebContentsView for window ${webContentWindow.id}, section may not be attached properly`);
            }
          }
          
          // Update state to reflect the new section
          updateWebContentWindow({
            isLoading: false,
            currentSection: section as 'profile' | 'leaderboard' | 'map' | 'events' | 'stats',
            // Keep the main window URL the same, only the WebContentsView URL changes
          });

          logger.info(MODULE_NAME, `✅ Successfully delegated WebContentsView switch to ${section}`);
          return { success: true, section, state: getNavigationState() };
        }
      } catch (error) {
        logger.error(MODULE_NAME, `Failed to switch WebContentsView to ${section}:`, error);
        // Fall back to close/open approach
      }
    }

    // Settings window takes priority over web content
    if (currentState.settingsWindow.isOpen) {
      await handleSettingsClose(currentState);
    }
    
    // Close web content if switching failed or not using WebContentsView
    if (currentState.webContentWindow.isOpen) {
      await handleWebContentClose(currentState);
    }

    // Open the new section
    return await handleWebContentOpen(section, getNavigationState());
  }
}

// Settings window handlers
async function handleSettingsOpen(currentState: NavigationState): Promise<NavigationResult> {
  try {
    if (currentState.settingsWindow.isOpen) {
      // Settings already open, just focus
      const settingsWindow = getSettingsWindow();
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return { success: true, section: 'settings', state: getNavigationState() };
      }
    }

    // Close web content window if open
    if (currentState.webContentWindow.isOpen) {
      await handleWebContentClose(currentState);
    }

    // Create settings window
    const settingsWindow = await createSettingsWindow();
    if (settingsWindow) {
      updateSettingsWindow({ isOpen: true });
      
      // Set up window event handlers
      settingsWindow.on('closed', () => {
        updateSettingsWindow({ isOpen: false });
      });

      return { success: true, section: 'settings', state: getNavigationState() };
    } else {
      throw new Error('Failed to create settings window');
    }
  } catch (error) {
    logger.error(MODULE_NAME, 'Error opening settings window:', error);
    return { success: false, error: (error as Error).message };
  }
}

async function handleSettingsClose(currentState: NavigationState): Promise<NavigationResult> {
  try {
    if (currentState.settingsWindow.isOpen) {
      await closeSettingsWindow();
      updateSettingsWindow({ isOpen: false });
    }
    return { success: true, state: getNavigationState() };
  } catch (error) {
    logger.error(MODULE_NAME, 'Error closing settings window:', error);
    return { success: false, error: (error as Error).message };
  }
}

// Web content window handlers
async function handleWebContentOpen(
  section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats',
  currentState: NavigationState
): Promise<NavigationResult> {
  try {
    // Close settings window if open
    if (currentState.settingsWindow.isOpen) {
      await handleSettingsClose(currentState);
    }

    // Check if web content window is already open with the same section
    if (currentState.webContentWindow.isOpen && currentState.webContentWindow.currentSection === section) {
      // Already open to the correct section, just focus
      const webContentWindow = getWebContentWindow();
      if (webContentWindow && !webContentWindow.isDestroyed()) {
        webContentWindow.focus();
        return { success: true, section, state: getNavigationState() };
      }
    }

    // Update loading state
    updateWebContentWindow({ isLoading: true });

    // Create or navigate web content window
    const window = await createWebContentWindow(section);
    if (window) {
      updateWebContentWindow({
        isOpen: true,
        currentSection: section,
        architecture: 'webcontentsview', // Adjust based on actual implementation
        isLoading: false,
      });

      // Set up window event handlers
      window.on('closed', () => {
        updateWebContentWindow({
          isOpen: false,
          currentSection: null,
          currentUrl: null,
          isLoading: false,
        });
      });

      // Set up navigation tracking
      if (window.webContents) {
        window.webContents.on('did-navigate', (event, url) => {
          const detectedSection = detectSectionFromUrl(url);
          updateWebContentWindow({
            currentUrl: url,
            currentSection: detectedSection || section,
            isLoading: false,
          });
        });

        window.webContents.on('did-start-loading', () => {
          updateWebContentWindow({ isLoading: true });
        });

        window.webContents.on('did-finish-load', () => {
          updateWebContentWindow({ isLoading: false });
        });
      }

      return { success: true, section, state: getNavigationState() };
    } else {
      throw new Error('Failed to create web content window');
    }
  } catch (error) {
    logger.error(MODULE_NAME, `Error opening web content window for ${section}:`, error);
    updateWebContentWindow({ isLoading: false });
    return { success: false, error: (error as Error).message };
  }
}

async function handleWebContentClose(currentState: NavigationState): Promise<NavigationResult> {
  try {
    if (currentState.webContentWindow.isOpen) {
      await closeWebContentWindow();
      updateWebContentWindow({
        isOpen: false,
        currentSection: null,
        currentUrl: null,
        isLoading: false,
      });
    }
    return { success: true, state: getNavigationState() };
  } catch (error) {
    logger.error(MODULE_NAME, 'Error closing web content window:', error);
    return { success: false, error: (error as Error).message };
  }
}

// URL section detection helper
function detectSectionFromUrl(url: string): 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | null {
  if (!url) return null;
  
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('/user/') || urlLower.includes('/profile')) return 'profile';
  if (urlLower.includes('/leaderboard')) return 'leaderboard';
  if (urlLower.includes('/map')) return 'map';
  if (urlLower.includes('/events')) return 'events';
  if (urlLower.includes('/stats')) return 'stats';
  
  return null;
}

// Public API for navigation requests
export async function requestNavigation(
  section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'settings'
): Promise<NavigationResult> {
  const currentState = getNavigationState();
  
  logger.info(MODULE_NAME, `🔍 Navigation request for: ${section}`);
  logger.info(MODULE_NAME, `📊 Current state:`, {
    webContentOpen: currentState.webContentWindow.isOpen,
    currentSection: currentState.webContentWindow.currentSection,
    settingsOpen: currentState.settingsWindow.isOpen,
    activeIcon: currentState.activeIcon
  });
  
  // Determine request type based on current state
  if (section === 'settings') {
    if (currentState.settingsWindow.isOpen) {
      logger.info(MODULE_NAME, `🔒 Settings already open, will CLOSE`);
      return await queueNavigationRequest('close', 'settings');
    } else {
      logger.info(MODULE_NAME, `🔒 Settings closed, will OPEN`);
      return await queueNavigationRequest('open', 'settings');
    }
  } else {
    if (currentState.webContentWindow.isOpen && currentState.webContentWindow.currentSection === section) {
      // Same section is open, close it
      logger.info(MODULE_NAME, `⚠️  Same section (${section}) already open, will CLOSE`);
      return await queueNavigationRequest('close', section);
    } else if (currentState.webContentWindow.isOpen || currentState.settingsWindow.isOpen) {
      // Different window is open, switch to new section
      logger.info(MODULE_NAME, `🔄 Different window open, will SWITCH to ${section}`);
      return await queueNavigationRequest('switch', section);
    } else {
      // No window open, just open the requested section
      logger.info(MODULE_NAME, `📖 No window open, will OPEN ${section}`);
      return await queueNavigationRequest('open', section);
    }
  }
}

// Initialize the navigation controller
export function initializeNavigationController(): void {
  logger.info(MODULE_NAME, 'Initializing navigation controller...');

  // Set up IPC handlers
  ipcMain.handle('navigation:request', async (event, section: string) => {
    try {
      return await requestNavigation(section as any);
    } catch (error) {
      logger.error(MODULE_NAME, 'Error handling navigation request:', error);
      return { 
        success: false, 
        error: (error as Error).message 
      };
    }
  });

  ipcMain.handle('navigation:close', async (event, section?: string) => {
    try {
      const currentState = getNavigationState();
      
      if (section === 'settings' && currentState.settingsWindow.isOpen) {
        return await queueNavigationRequest('close', 'settings');
      } else if (currentState.webContentWindow.isOpen) {
        return await queueNavigationRequest('close', currentState.webContentWindow.currentSection);
      }
      
      return { success: true, section: null, state: currentState };
    } catch (error) {
      logger.error(MODULE_NAME, 'Error handling navigation close:', error);
      return { 
        success: false, 
        error: (error as Error).message 
      };
    }
  });

  logger.info(MODULE_NAME, 'Navigation controller initialized successfully');
}

// Cleanup function
export function cleanupNavigationController(): void {
  logger.info(MODULE_NAME, 'Cleaning up navigation controller...');
  
  // Cancel all pending requests
  requestQueue.forEach(request => {
    request.reject(new Error('Navigation controller is shutting down'));
  });
  requestQueue = [];
  isProcessingRequest = false;
  
  logger.info(MODULE_NAME, 'Navigation controller cleaned up');
}