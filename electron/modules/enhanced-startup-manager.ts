import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as logger from './logger';
import { getLaunchOnStartup, setLaunchOnStartup } from './config-manager';

const MODULE_NAME = 'EnhancedStartupManager';

// Mutex to prevent concurrent startup operations
let isStartupOperationInProgress = false;

export interface StartupConfiguration {
  success: boolean;
  enabled: boolean;
  method: 'squirrel' | 'nsis' | 'standard' | 'disabled';
  path?: string;
  args?: string[];
  errors: string[];
  warnings: string[];
}

interface InstallationType {
  type: 'squirrel' | 'nsis' | 'portable' | 'development' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
}

/**
 * Detect Windows installation type (Squirrel vs NSIS vs Portable)
 */
function detectWindowsInstallationType(appFolder: string, exeName: string): InstallationType {
  const evidence: string[] = [];
  let type: InstallationType['type'] = 'unknown';
  let confidence: InstallationType['confidence'] = 'low';

  // Check for Squirrel indicators
  const squirrelPaths = [
    path.join(appFolder, '..', 'Update.exe'),
    path.join(appFolder, '..', '..', 'Update.exe'),
    path.join(appFolder, 'Update.exe'),
    path.join(appFolder, '..', '.nupkg'), // NuGet package directory
    path.join(appFolder, '..', 'packages'), // Squirrel packages directory
  ];

  let squirrelIndicators = 0;
  squirrelPaths.forEach(squirrelPath => {
    if (fs.existsSync(squirrelPath)) {
      evidence.push(`Found Squirrel indicator: ${squirrelPath}`);
      squirrelIndicators++;
    }
  });

  // Check for NSIS indicators
  const nsisIndicators = [
    path.join(appFolder, 'Uninstall.exe'),
    path.join(appFolder, '..', 'Uninstall.exe'),
    // Check if we're in Program Files (typical NSIS installation)
    appFolder.includes('Program Files'),
    appFolder.includes('Program Files (x86)'),
  ];

  let nsisCount = 0;
  nsisIndicators.forEach((indicator, index) => {
    const pathToCheck = typeof indicator === 'string' ? indicator : '';
    const isPath = index < 2;
    
    if (isPath && fs.existsSync(pathToCheck)) {
      evidence.push(`Found NSIS indicator: ${pathToCheck}`);
      nsisCount++;
    } else if (!isPath && indicator) {
      evidence.push(`Installation in system directory: ${appFolder}`);
      nsisCount++;
    }
  });

  // Development environment check
  if (process.env.NODE_ENV === 'development' || 
      appFolder.includes('node_modules') || 
      appFolder.includes('electron') ||
      exeName.includes('electron')) {
    type = 'development';
    confidence = 'high';
    evidence.push('Development environment detected');
  }
  // Squirrel detection (highest priority for production)
  else if (squirrelIndicators >= 1) {
    type = 'squirrel';
    confidence = squirrelIndicators >= 2 ? 'high' : 'medium';
  }
  // NSIS detection
  else if (nsisCount >= 1) {
    type = 'nsis';
    confidence = nsisCount >= 2 ? 'high' : 'medium';
  }
  // Portable detection (executable in user directory or removable drive)
  else if (appFolder.includes(require('os').homedir()) || 
           appFolder.match(/^[A-Z]:\\/)) {
    type = 'portable';
    confidence = 'medium';
    evidence.push('Executable in user directory or root drive - likely portable');
  }

  // Check if app is packaged
  if (!app.isPackaged) {
    type = 'development';
    confidence = 'high';
    evidence.push('App is not packaged - development mode');
  }

  return { type, confidence, evidence };
}

/**
 * Enhanced startup initialization with comprehensive error handling
 */
export async function initializeStartupSystem(): Promise<StartupConfiguration> {
  if (isStartupOperationInProgress) {
    logger.warn(MODULE_NAME, 'Startup operation already in progress, skipping...');
    return {
      success: false,
      enabled: false,
      method: 'disabled',
      errors: ['Startup operation already in progress'],
      warnings: []
    };
  }

  isStartupOperationInProgress = true;
  
  try {
    logger.info(MODULE_NAME, 'Initializing enhanced startup system...');
    
    // Skip in development
    if (process.env.NODE_ENV === 'development') {
      logger.info(MODULE_NAME, 'Development mode detected, skipping startup registration');
      return {
        success: true,
        enabled: false,
        method: 'disabled',
        errors: [],
        warnings: ['Development mode - startup disabled']
      };
    }

    const storedSetting = getLaunchOnStartup();
    logger.info(MODULE_NAME, `Stored launch setting: ${storedSetting}`);

    // Platform-specific setup
    if (process.platform === 'win32' && app.isPackaged) {
      return await setupWindowsStartup(storedSetting);
    } else {
      return await setupStandardStartup(storedSetting);
    }

  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to initialize startup system:', error);
    return {
      success: false,
      enabled: false,
      method: 'disabled',
      errors: [`Initialization failed: ${error}`],
      warnings: []
    };
  } finally {
    isStartupOperationInProgress = false;
  }
}

/**
 * Enhanced Windows startup setup with path validation and fallbacks
 * Supports both Squirrel and NSIS installations
 */
async function setupWindowsStartup(enabled: boolean): Promise<StartupConfiguration> {
  const appFolder = path.dirname(process.execPath);
  const exeName = path.basename(process.execPath);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Detect installation type first
  const installationType = detectWindowsInstallationType(appFolder, exeName);
  logger.info(MODULE_NAME, `Detected installation type: ${installationType.type}`);

  // Multiple stub path candidates in order of preference based on installation type
  let stubCandidates: string[] = [];
  
  if (installationType.type === 'squirrel') {
    stubCandidates = [
      path.resolve(appFolder, '..', exeName),           // Standard Squirrel layout
      path.resolve(appFolder, '..', '..', exeName),     // Nested Squirrel layout
      path.resolve(appFolder, 'Update.exe'),            // Squirrel updater
      path.resolve(appFolder, '..', 'Update.exe'),      // Parent Squirrel updater
    ];
  } else if (installationType.type === 'nsis') {
    stubCandidates = [
      process.execPath,                                 // Direct NSIS executable
      path.resolve(appFolder, exeName),                 // Same directory
      path.resolve(appFolder, '..', exeName),           // Parent directory (portable)
    ];
  } else {
    // Unknown or development - use conservative approach
    stubCandidates = [
      process.execPath,                                 // Direct executable
      path.resolve(appFolder, '..', exeName),           // One level up
      path.resolve(appFolder, exeName),                 // Same directory
    ];
  }

  // Always add process.execPath as final fallback
  stubCandidates.push(process.execPath);

  let selectedPath: string | null = null;
  let useSquirrelMode = false;

  // Find the best available path
  for (const candidate of stubCandidates) {
    if (fs.existsSync(candidate)) {
      selectedPath = candidate;
      useSquirrelMode = candidate !== process.execPath;
      logger.info(MODULE_NAME, `Using startup path: ${candidate} (Squirrel: ${useSquirrelMode})`);
      break;
    }
  }

  if (!selectedPath) {
    errors.push('No valid startup executable found');
    return { success: false, enabled: false, method: 'disabled', errors, warnings };
  }

  try {
    let loginItemConfig;
    
    // Configure based on installation type and selected path
    if (useSquirrelMode && installationType.type === 'squirrel') {
      // Squirrel-compatible configuration
      loginItemConfig = {
        openAtLogin: enabled,
        path: selectedPath,
        args: [
          '--processStart', `"${exeName}"`,
          '--process-start-args', '"--hidden"'
        ]
      };
      logger.info(MODULE_NAME, 'Using Squirrel startup configuration');
    } else if (installationType.type === 'nsis') {
      // NSIS direct executable configuration
      loginItemConfig = {
        openAtLogin: enabled,
        path: selectedPath,
        args: ['--hidden']
      };
      logger.info(MODULE_NAME, 'Using NSIS startup configuration');
    } else {
      // Standard/portable configuration
      loginItemConfig = {
        openAtLogin: enabled,
        path: selectedPath,
        args: ['--hidden']
      };
      logger.info(MODULE_NAME, 'Using standard startup configuration');
    }

    // Apply the configuration
    app.setLoginItemSettings(loginItemConfig);

    // Verify application
    const verification = app.getLoginItemSettings();
    if (verification.openAtLogin !== enabled) {
      warnings.push(`Verification failed: expected ${enabled}, got ${verification.openAtLogin}`);
    }

    logger.info(MODULE_NAME, `Windows startup configured successfully:`, {
      enabled,
      path: selectedPath,
      squirrelMode: useSquirrelMode,
      verification: verification.openAtLogin
    });

    // Determine method name for return value
    let method: StartupConfiguration['method'] = 'standard';
    if (installationType.type === 'squirrel') {
      method = 'squirrel';
    } else if (installationType.type === 'nsis') {
      method = 'nsis';
    }

    logger.info(MODULE_NAME, `Windows startup configured successfully: ${enabled} (${method})`, {
      installationType: installationType.type,
      confidence: installationType.confidence,
      evidence: installationType.evidence
    });

    return {
      success: true,
      enabled: verification.openAtLogin,
      method: method,
      path: selectedPath,
      args: loginItemConfig.args,
      errors,
      warnings
    };

  } catch (error) {
    const errorMsg = `Failed to configure Windows startup: ${error}`;
    errors.push(errorMsg);
    logger.error(MODULE_NAME, errorMsg, error);
    
    return {
      success: false,
      enabled: false,
      method: 'disabled',
      path: selectedPath,
      errors,
      warnings
    };
  }
}

/**
 * Standard startup setup for macOS and Linux
 */
async function setupStandardStartup(enabled: boolean): Promise<StartupConfiguration> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Verify executable exists
    if (!fs.existsSync(process.execPath)) {
      errors.push(`Executable not found: ${process.execPath}`);
      return { success: false, enabled: false, method: 'disabled', errors, warnings };
    }

    const loginItemConfig = {
      openAtLogin: enabled,
      args: ['--hidden']
    };

    app.setLoginItemSettings(loginItemConfig);

    // Verify application
    const verification = app.getLoginItemSettings();
    if (verification.openAtLogin !== enabled) {
      warnings.push(`Verification failed: expected ${enabled}, got ${verification.openAtLogin}`);
    }

    logger.info(MODULE_NAME, `Standard startup configured successfully:`, {
      enabled,
      verification: verification.openAtLogin,
      platform: process.platform
    });

    return {
      success: true,
      enabled: verification.openAtLogin,
      method: 'standard',
      path: process.execPath,
      args: loginItemConfig.args,
      errors,
      warnings
    };

  } catch (error) {
    const errorMsg = `Failed to configure standard startup: ${error}`;
    errors.push(errorMsg);
    logger.error(MODULE_NAME, errorMsg, error);
    
    return {
      success: false,
      enabled: false,
      method: 'disabled',
      errors,
      warnings
    };
  }
}

/**
 * Enhanced startup setting update with validation
 */
export async function updateStartupSetting(enabled: boolean): Promise<StartupConfiguration> {
  if (isStartupOperationInProgress) {
    return {
      success: false,
      enabled: false,
      method: 'disabled',
      errors: ['Another startup operation is in progress'],
      warnings: []
    };
  }

  logger.info(MODULE_NAME, `Updating startup setting to: ${enabled}`);
  
  // Update stored configuration first
  setLaunchOnStartup(enabled);
  
  // Apply OS-level changes
  const result = await initializeStartupSystem();
  
  // Verify configuration was applied correctly
  const finalVerification = app.getLoginItemSettings();
  if (finalVerification.openAtLogin !== enabled) {
    result.warnings.push(`Final verification mismatch: requested ${enabled}, actual ${finalVerification.openAtLogin}`);
  }

  return result;
}

/**
 * Check if app should start minimized with enhanced detection
 */
export function shouldStartMinimized(): boolean {
  const loginItemSettings = app.getLoginItemSettings();
  
  // Multiple conditions for startup minimization
  const wasLaunchedAtStartup = loginItemSettings.wasOpenedAtLogin && loginItemSettings.wasOpenedAsHidden;
  const hasHiddenArg = process.argv.includes('--hidden');
  const hasMinimizedArg = process.argv.includes('--minimized');
  const hasStartMinimizedArg = process.argv.includes('--start-minimized');
  
  const shouldMinimize = wasLaunchedAtStartup || hasHiddenArg || hasMinimizedArg || hasStartMinimizedArg;
  
  logger.info(MODULE_NAME, 'Minimization check:', {
    wasLaunchedAtStartup,
    hasHiddenArg,
    hasMinimizedArg,
    hasStartMinimizedArg,
    shouldMinimize,
    allArgs: process.argv
  });
  
  return shouldMinimize;
}

/**
 * Get comprehensive startup status
 */
export function getStartupStatus(): {
  configStored: boolean;
  osRegistered: boolean;
  inSync: boolean;
  isOperationInProgress: boolean;
  loginItemSettings: any;
} {
  const configStored = getLaunchOnStartup();
  const loginItemSettings = app.getLoginItemSettings();
  const osRegistered = loginItemSettings.openAtLogin;
  const inSync = configStored === osRegistered;
  
  return {
    configStored,
    osRegistered,
    inSync,
    isOperationInProgress: isStartupOperationInProgress,
    loginItemSettings
  };
}