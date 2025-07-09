/**
 * WebContentsView Compatibility Layer
 * 
 * This module provides backwards compatibility between the new WebContentsView architecture
 * and the legacy BrowserWindow webview approach. It handles graceful degradation and
 * feature detection to ensure smooth operation across different Electron versions.
 */

import { BrowserWindow, BaseWindow, WebContentsView, app } from 'electron';
import * as logger from './logger';

const MODULE_NAME = 'WebContentsCompatibility';

export interface CompatibilityInfo {
  webContentsViewSupported: boolean;
  baseWindowSupported: boolean;
  electronVersion: string;
  recommendedArchitecture: 'webcontentsview' | 'browserwindow';
  features: {
    webContentsView: boolean;
    baseWindow: boolean;
    webviewTag: boolean;
    nativeWindowCustomization: boolean;
  };
}

/**
 * Detect WebContentsView support in current Electron version
 */
export function detectWebContentsViewSupport(): boolean {
  try {
    // Check if WebContentsView constructor exists and is callable
    if (typeof WebContentsView === 'undefined') {
      logger.debug(MODULE_NAME, 'WebContentsView is undefined');
      return false;
    }

    // Try to access WebContentsView constructor
    if (typeof WebContentsView !== 'function') {
      logger.debug(MODULE_NAME, 'WebContentsView is not a constructor function');
      return false;
    }

    // Check for key methods that should exist on WebContentsView
    const hasRequiredMethods = [
      'setBounds',
      'getBounds'
    ].every(method => {
      return WebContentsView.prototype && typeof (WebContentsView.prototype as any)[method] === 'function';
    });

    if (!hasRequiredMethods) {
      logger.debug(MODULE_NAME, 'WebContentsView missing required methods');
      return false;
    }

    logger.info(MODULE_NAME, 'WebContentsView is supported');
    return true;
  } catch (error) {
    logger.warn(MODULE_NAME, 'Error detecting WebContentsView support:', error);
    return false;
  }
}

/**
 * Detect BaseWindow support in current Electron version
 */
export function detectBaseWindowSupport(): boolean {
  try {
    // Check if BaseWindow constructor exists and is callable
    if (typeof BaseWindow === 'undefined') {
      logger.debug(MODULE_NAME, 'BaseWindow is undefined');
      return false;
    }

    if (typeof BaseWindow !== 'function') {
      logger.debug(MODULE_NAME, 'BaseWindow is not a constructor function');
      return false;
    }

    // Check for key methods that should exist on BaseWindow
    const hasRequiredMethods = [
      'setBounds',
      'getBounds',
      'show',
      'hide'
    ].every(method => {
      return BaseWindow.prototype && typeof (BaseWindow.prototype as any)[method] === 'function';
    });

    if (!hasRequiredMethods) {
      logger.debug(MODULE_NAME, 'BaseWindow missing required methods');
      return false;
    }

    logger.info(MODULE_NAME, 'BaseWindow is supported');
    return true;
  } catch (error) {
    logger.warn(MODULE_NAME, 'Error detecting BaseWindow support:', error);
    return false;
  }
}

/**
 * Detect webview tag support
 */
export function detectWebviewTagSupport(): boolean {
  try {
    // This is harder to detect from main process, so we'll assume it's available
    // unless we're in a sandboxed environment or very old Electron version
    const electronVersion = process.versions.electron;
    const majorVersion = parseInt(electronVersion.split('.')[0], 10);
    
    // webview tag has been available since early Electron versions
    return majorVersion >= 4;
  } catch (error) {
    logger.warn(MODULE_NAME, 'Error detecting webview tag support:', error);
    return true; // Assume available for backwards compatibility
  }
}

/**
 * Get comprehensive compatibility information
 */
export function getCompatibilityInfo(): CompatibilityInfo {
  const webContentsViewSupported = detectWebContentsViewSupport();
  const baseWindowSupported = detectBaseWindowSupport();
  const webviewTagSupported = detectWebviewTagSupport();
  const electronVersion = process.versions.electron;

  // Determine recommended architecture
  let recommendedArchitecture: 'webcontentsview' | 'browserwindow' = 'browserwindow';
  
  if (webContentsViewSupported && baseWindowSupported) {
    recommendedArchitecture = 'webcontentsview';
    logger.info(MODULE_NAME, 'Recommending WebContentsView architecture');
  } else {
    logger.info(MODULE_NAME, 'Recommending BrowserWindow architecture (fallback)');
  }

  const info: CompatibilityInfo = {
    webContentsViewSupported,
    baseWindowSupported,
    electronVersion,
    recommendedArchitecture,
    features: {
      webContentsView: webContentsViewSupported,
      baseWindow: baseWindowSupported,
      webviewTag: webviewTagSupported,
      nativeWindowCustomization: baseWindowSupported && webContentsViewSupported
    }
  };

  logger.info(MODULE_NAME, 'Compatibility info:', info);
  return info;
}

/**
 * Validate that a window instance supports required methods for our use case
 */
export function validateWindowInstance(window: BrowserWindow | BaseWindow): {
  isValid: boolean;
  missingMethods: string[];
  windowType: 'BrowserWindow' | 'BaseWindow' | 'unknown';
} {
  const requiredMethods = ['show', 'hide', 'focus', 'getBounds', 'setBounds', 'isDestroyed'];
  const missingMethods: string[] = [];
  
  let windowType: 'BrowserWindow' | 'BaseWindow' | 'unknown' = 'unknown';
  
  try {
    if (window instanceof BrowserWindow) {
      windowType = 'BrowserWindow';
    } else if (window instanceof BaseWindow) {
      windowType = 'BaseWindow';
    }

    requiredMethods.forEach(method => {
      if (typeof (window as any)[method] !== 'function') {
        missingMethods.push(method);
      }
    });

    const isValid = missingMethods.length === 0;
    
    if (!isValid) {
      logger.warn(MODULE_NAME, `Window validation failed for ${windowType}. Missing methods:`, missingMethods);
    } else {
      logger.debug(MODULE_NAME, `Window validation passed for ${windowType}`);
    }

    return { isValid, missingMethods, windowType };
  } catch (error) {
    logger.error(MODULE_NAME, 'Error validating window instance:', error);
    return { isValid: false, missingMethods: requiredMethods, windowType };
  }
}

/**
 * Create a unified window interface that works with both BrowserWindow and BaseWindow
 */
export interface UnifiedWindow {
  show(): void;
  hide(): void;
  focus(): void;
  getBounds(): Electron.Rectangle;
  setBounds(bounds: Partial<Electron.Rectangle>): void;
  isDestroyed(): boolean;
  isMinimized?(): boolean;
  restore?(): void;
  close(): void;
  on(event: string, listener: (...args: any[]) => void): void;
  once(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
  webContents?: Electron.WebContents;
  contentView?: any; // For BaseWindow
}

/**
 * Wrap a window instance to provide a unified interface
 */
export function createUnifiedWindow(window: BrowserWindow | BaseWindow): UnifiedWindow {
  const validation = validateWindowInstance(window);
  
  if (!validation.isValid) {
    logger.warn(MODULE_NAME, `Creating unified window wrapper despite validation issues:`, validation.missingMethods);
  }

  return {
    show: () => window.show(),
    hide: () => window.hide(),
    focus: () => window.focus(),
    getBounds: () => window.getBounds(),
    setBounds: (bounds: Partial<Electron.Rectangle>) => window.setBounds(bounds),
    isDestroyed: () => window.isDestroyed(),
    isMinimized: () => (window as any).isMinimized?.(),
    restore: () => (window as any).restore?.(),
    close: () => window.close(),
    on: (event: string, listener: (...args: any[]) => void) => (window as any).on(event, listener),
    once: (event: string, listener: (...args: any[]) => void) => (window as any).once(event, listener),
    removeListener: (event: string, listener: (...args: any[]) => void) => (window as any).removeListener(event, listener),
    webContents: (window as any).webContents,
    contentView: (window as any).contentView
  };
}

/**
 * Migration helper to safely transition between architectures
 */
export class ArchitectureMigration {
  private static instance: ArchitectureMigration;
  private currentArch: 'webcontentsview' | 'browserwindow' | null = null;
  private migrationInProgress = false;

  static getInstance(): ArchitectureMigration {
    if (!ArchitectureMigration.instance) {
      ArchitectureMigration.instance = new ArchitectureMigration();
    }
    return ArchitectureMigration.instance;
  }

  async migrateToWebContentsView(): Promise<{ success: boolean; error?: string }> {
    if (this.migrationInProgress) {
      return { success: false, error: 'Migration already in progress' };
    }

    this.migrationInProgress = true;
    logger.info(MODULE_NAME, 'Starting migration to WebContentsView architecture');

    try {
      const compatibility = getCompatibilityInfo();
      
      if (!compatibility.webContentsViewSupported || !compatibility.baseWindowSupported) {
        throw new Error(`WebContentsView architecture not supported. WebContentsView: ${compatibility.webContentsViewSupported}, BaseWindow: ${compatibility.baseWindowSupported}`);
      }

      // Test create a WebContentsView to ensure it works
      const testView = new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          devTools: !app.isPackaged // Disable DevTools in production
        }
      });

      // Test create a BaseWindow to ensure it works
      const testWindow = new BaseWindow({
        show: false,
        width: 100,
        height: 100
      });

      // Clean up test instances
      testView.webContents.close();
      testWindow.close();

      this.currentArch = 'webcontentsview';
      logger.info(MODULE_NAME, 'Migration to WebContentsView completed successfully');
      
      return { success: true };
    } catch (error) {
      logger.error(MODULE_NAME, 'Migration to WebContentsView failed:', error);
      this.currentArch = 'browserwindow';
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown migration error' 
      };
    } finally {
      this.migrationInProgress = false;
    }
  }

  async migrateToBrowserWindow(): Promise<{ success: boolean; error?: string }> {
    if (this.migrationInProgress) {
      return { success: false, error: 'Migration already in progress' };
    }

    this.migrationInProgress = true;
    logger.info(MODULE_NAME, 'Starting migration to BrowserWindow architecture');

    try {
      // BrowserWindow should always be available
      if (typeof BrowserWindow === 'undefined') {
        throw new Error('BrowserWindow not available');
      }

      this.currentArch = 'browserwindow';
      logger.info(MODULE_NAME, 'Migration to BrowserWindow completed successfully');
      
      return { success: true };
    } catch (error) {
      logger.error(MODULE_NAME, 'Migration to BrowserWindow failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown migration error' 
      };
    } finally {
      this.migrationInProgress = false;
    }
  }

  getCurrentArchitecture(): 'webcontentsview' | 'browserwindow' | null {
    return this.currentArch;
  }

  isMigrationInProgress(): boolean {
    return this.migrationInProgress;
  }
}

/**
 * Error handling utilities for architecture-specific issues
 */
export class ArchitectureErrorHandler {
  static handleWebContentsViewError(error: any, context: string): {
    shouldFallback: boolean;
    fallbackReason: string;
    error: string;
  } {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(MODULE_NAME, `WebContentsView error in ${context}:`, errorMessage);

    // Check for specific errors that indicate WebContentsView is not supported
    const unsupportedIndicators = [
      'WebContentsView is not a constructor',
      'WebContentsView is not defined',
      'Cannot read property',
      'Cannot read properties of undefined',
      'BaseWindow is not a constructor',
      'BaseWindow is not defined'
    ];

    const shouldFallback = unsupportedIndicators.some(indicator => 
      errorMessage.includes(indicator)
    );

    return {
      shouldFallback,
      fallbackReason: shouldFallback ? 'WebContentsView not supported by current Electron version' : 'Transient error',
      error: errorMessage
    };
  }

  static handleBrowserWindowError(error: any, context: string): {
    isRecoverable: boolean;
    error: string;
  } {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(MODULE_NAME, `BrowserWindow error in ${context}:`, errorMessage);

    // Most BrowserWindow errors are recoverable since it's the stable fallback
    const unrecoverableIndicators = [
      'BrowserWindow is not a constructor',
      'BrowserWindow is not defined'
    ];

    const isRecoverable = !unrecoverableIndicators.some(indicator => 
      errorMessage.includes(indicator)
    );

    return {
      isRecoverable,
      error: errorMessage
    };
  }
}

// Export singleton instance
export const migrationManager = ArchitectureMigration.getInstance();