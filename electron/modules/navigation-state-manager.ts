import { BrowserWindow, ipcMain } from 'electron';
import * as logger from './logger';

const MODULE_NAME = 'NavigationStateManager';

// Navigation state interface
export interface NavigationState {
  webContentWindow: {
    isOpen: boolean;
    currentSection: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | null;
    currentUrl: string | null;
    architecture: 'webcontentsview' | 'browserwindow' | 'unknown';
    isLoading: boolean;
  };
  settingsWindow: {
    isOpen: boolean;
  };
  activeIcon: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'settings' | null;
  lastUpdate: number;
}

// Global navigation state
let navigationState: NavigationState = {
  webContentWindow: {
    isOpen: false,
    currentSection: null,
    currentUrl: null,
    architecture: 'unknown',
    isLoading: false,
  },
  settingsWindow: {
    isOpen: false,
  },
  activeIcon: null,
  lastUpdate: Date.now(),
};

// Debounce utility
function debounce<T extends (...args: any[]) => void>(func: T, wait: number): T {
  let timeout: NodeJS.Timeout;
  return ((...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
}

// State change listeners
const stateChangeListeners: Array<(state: NavigationState) => void> = [];

// Debounced state broadcast function
const debouncedBroadcast = debounce((state: NavigationState) => {
  logger.info(MODULE_NAME, 'Broadcasting navigation state update:', {
    webContentOpen: state.webContentWindow.isOpen,
    currentSection: state.webContentWindow.currentSection,
    activeIcon: state.activeIcon,
    architecture: state.webContentWindow.architecture,
  });

  // Update timestamp
  state.lastUpdate = Date.now();

  // Notify all listeners
  stateChangeListeners.forEach(listener => {
    try {
      listener(state);
    } catch (error) {
      logger.error(MODULE_NAME, 'Error in state change listener:', error);
    }
  });

  // Broadcast to all renderer processes
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('navigation-state-changed', state);
    }
  });
}, 100);

// URL-based section detection
export function detectSectionFromUrl(url: string): 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | null {
  if (!url) return null;
  
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('/user/') || urlLower.includes('/profile')) return 'profile';
  if (urlLower.includes('/leaderboard')) return 'leaderboard';
  if (urlLower.includes('/map')) return 'map';
  if (urlLower.includes('/events')) return 'events';
  if (urlLower.includes('/stats')) return 'stats';
  
  return null;
}

// State management functions
export function getNavigationState(): NavigationState {
  return { ...navigationState };
}

export function updateWebContentWindow(updates: Partial<NavigationState['webContentWindow']>): void {
  const oldState = { ...navigationState };
  
  logger.info(MODULE_NAME, '🔄 Updating web content window state:', {
    oldState: oldState.webContentWindow,
    updates: updates
  });
  
  navigationState.webContentWindow = {
    ...navigationState.webContentWindow,
    ...updates,
  };

  // Auto-detect section from URL if provided
  if (updates.currentUrl && !updates.currentSection) {
    const detectedSection = detectSectionFromUrl(updates.currentUrl);
    if (detectedSection) {
      logger.info(MODULE_NAME, `🔍 Auto-detected section from URL: ${detectedSection}`);
      navigationState.webContentWindow.currentSection = detectedSection;
    }
  }

  // Update active icon based on current section
  const oldActiveIcon = navigationState.activeIcon;
  if (navigationState.webContentWindow.isOpen && navigationState.webContentWindow.currentSection) {
    navigationState.activeIcon = navigationState.webContentWindow.currentSection;
  } else if (!navigationState.webContentWindow.isOpen) {
    navigationState.activeIcon = null;
  }

  logger.info(MODULE_NAME, '✅ Updated web content window state:', {
    changes: updates,
    newState: navigationState.webContentWindow,
    oldActiveIcon: oldActiveIcon,
    newActiveIcon: navigationState.activeIcon,
  });

  debouncedBroadcast(navigationState);
}

export function updateSettingsWindow(updates: Partial<NavigationState['settingsWindow']>): void {
  navigationState.settingsWindow = {
    ...navigationState.settingsWindow,
    ...updates,
  };

  // Update active icon for settings
  if (navigationState.settingsWindow.isOpen) {
    navigationState.activeIcon = 'settings';
  } else if (navigationState.activeIcon === 'settings') {
    // Reset active icon if settings was active
    navigationState.activeIcon = navigationState.webContentWindow.isOpen ? 
      navigationState.webContentWindow.currentSection : null;
  }

  logger.info(MODULE_NAME, 'Updated settings window state:', {
    changes: updates,
    newState: navigationState.settingsWindow,
    activeIcon: navigationState.activeIcon,
  });

  debouncedBroadcast(navigationState);
}

export function setActiveIcon(icon: NavigationState['activeIcon']): void {
  if (navigationState.activeIcon !== icon) {
    navigationState.activeIcon = icon;
    logger.info(MODULE_NAME, 'Updated active icon:', icon);
    debouncedBroadcast(navigationState);
  }
}

// State change listener management
export function addStateChangeListener(listener: (state: NavigationState) => void): () => void {
  stateChangeListeners.push(listener);
  
  // Return cleanup function
  return () => {
    const index = stateChangeListeners.indexOf(listener);
    if (index > -1) {
      stateChangeListeners.splice(index, 1);
    }
  };
}

// State validation and recovery
export function validateAndRecoverState(): NavigationState {
  logger.info(MODULE_NAME, 'Validating and recovering navigation state...');
  
  const currentState = { ...navigationState };
  let needsRecovery = false;

  // Validate web content window state
  if (currentState.webContentWindow.isOpen && currentState.webContentWindow.currentSection) {
    // Check if the stated section matches the active icon
    if (currentState.activeIcon !== currentState.webContentWindow.currentSection) {
      logger.warn(MODULE_NAME, 'State inconsistency detected: activeIcon vs currentSection');
      currentState.activeIcon = currentState.webContentWindow.currentSection;
      needsRecovery = true;
    }
  }

  // Validate settings window state
  if (currentState.settingsWindow.isOpen && currentState.activeIcon !== 'settings') {
    if (!currentState.webContentWindow.isOpen) {
      logger.warn(MODULE_NAME, 'State inconsistency detected: settings open but not active');
      currentState.activeIcon = 'settings';
      needsRecovery = true;
    }
  }

  if (needsRecovery) {
    logger.info(MODULE_NAME, 'Recovering navigation state:', currentState);
    navigationState = currentState;
    debouncedBroadcast(navigationState);
  }

  return currentState;
}

// Reset state (useful for cleanup)
export function resetNavigationState(): void {
  logger.info(MODULE_NAME, 'Resetting navigation state');
  
  navigationState = {
    webContentWindow: {
      isOpen: false,
      currentSection: null,
      currentUrl: null,
      architecture: 'unknown',
      isLoading: false,
    },
    settingsWindow: {
      isOpen: false,
    },
    activeIcon: null,
    lastUpdate: Date.now(),
  };

  debouncedBroadcast(navigationState);
}

// Initialize the navigation state manager
export function initializeNavigationStateManager(): void {
  logger.info(MODULE_NAME, 'Initializing navigation state manager...');

  // Set up IPC handlers for state queries
  ipcMain.handle('navigation:get-state', () => {
    return getNavigationState();
  });

  ipcMain.handle('navigation:validate-state', () => {
    return validateAndRecoverState();
  });

  logger.info(MODULE_NAME, 'Navigation state manager initialized successfully');
}

// Cleanup function
export function cleanupNavigationStateManager(): void {
  logger.info(MODULE_NAME, 'Cleaning up navigation state manager...');
  
  // Clear all listeners
  stateChangeListeners.length = 0;
  
  // Reset state
  resetNavigationState();
  
  logger.info(MODULE_NAME, 'Navigation state manager cleaned up');
}