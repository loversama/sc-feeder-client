import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as logger from './logger';
import { getLaunchOnStartup } from './config-manager';

const MODULE_NAME = 'StartupDiagnostics';

export interface StartupDiagnosticResult {
  isConfigured: boolean;
  osRegistered: boolean;
  pathExists: boolean;
  errors: string[];
  warnings: string[];
  recommendations: string[];
  platformDetails: {
    platform: string;
    isPackaged: boolean;
    execPath: string;
    computedStubPath?: string;
  };
}

/**
 * Comprehensive startup system diagnostics
 */
export async function diagnoseStartupSystem(): Promise<StartupDiagnosticResult> {
  const result: StartupDiagnosticResult = {
    isConfigured: false,
    osRegistered: false,
    pathExists: false,
    errors: [],
    warnings: [],
    recommendations: [],
    platformDetails: {
      platform: process.platform,
      isPackaged: app.isPackaged,
      execPath: process.execPath
    }
  };

  logger.info(MODULE_NAME, 'Starting comprehensive startup diagnostics...');

  try {
    // Check stored configuration
    result.isConfigured = getLaunchOnStartup();
    logger.info(MODULE_NAME, `Stored configuration: launchOnStartup = ${result.isConfigured}`);

    // Get current OS registration status
    const loginItemSettings = app.getLoginItemSettings();
    result.osRegistered = loginItemSettings.openAtLogin;
    
    logger.info(MODULE_NAME, 'Current login item settings:', {
      openAtLogin: loginItemSettings.openAtLogin,
      executableWillLaunchAtLogin: loginItemSettings.executableWillLaunchAtLogin,
      wasOpenedAtLogin: loginItemSettings.wasOpenedAtLogin,
      wasOpenedAsHidden: loginItemSettings.wasOpenedAsHidden,
      launchItems: loginItemSettings.launchItems
    });

    // Platform-specific path validation
    if (process.platform === 'win32' && app.isPackaged) {
      await diagnoseWindowsSquirrelSetup(result);
    } else {
      await diagnoseStandardSetup(result);
    }

    // Check for common issues
    await checkCommonIssues(result);

    // Configuration mismatch detection
    if (result.isConfigured !== result.osRegistered) {
      result.warnings.push(`Configuration mismatch: stored setting (${result.isConfigured}) != OS registration (${result.osRegistered})`);
      result.recommendations.push('Re-apply startup settings to synchronize configuration');
    }

    // Generate summary
    if (result.errors.length === 0 && result.warnings.length === 0) {
      logger.success(MODULE_NAME, 'Startup system diagnostics: PASSED');
    } else {
      logger.warn(MODULE_NAME, `Startup system diagnostics: ${result.errors.length} errors, ${result.warnings.length} warnings`);
    }

  } catch (error) {
    const errorMsg = `Diagnostic process failed: ${error}`;
    result.errors.push(errorMsg);
    logger.error(MODULE_NAME, errorMsg, error);
  }

  return result;
}

/**
 * Windows Squirrel-specific diagnostics
 */
async function diagnoseWindowsSquirrelSetup(result: StartupDiagnosticResult): Promise<void> {
  const appFolder = path.dirname(process.execPath);
  const exeName = path.basename(process.execPath);
  const stubLauncher = path.resolve(appFolder, '..', exeName);
  
  result.platformDetails.computedStubPath = stubLauncher;
  
  logger.info(MODULE_NAME, 'Windows Squirrel diagnostics:', {
    appFolder,
    exeName,
    computedStubPath: stubLauncher,
    execPath: process.execPath
  });

  // Check if computed stub path exists
  try {
    result.pathExists = fs.existsSync(stubLauncher);
    if (!result.pathExists) {
      result.errors.push(`Squirrel stub launcher not found at: ${stubLauncher}`);
      result.recommendations.push('Verify app installation integrity or use alternative startup method');
    } else {
      logger.info(MODULE_NAME, `Stub launcher verified at: ${stubLauncher}`);
    }
  } catch (error) {
    result.errors.push(`Failed to check stub launcher path: ${error}`);
  }

  // Alternative path detection
  if (!result.pathExists) {
    const alternativePaths = [
      path.resolve(appFolder, '..', '..', exeName),
      path.resolve(appFolder, exeName),
      path.resolve(appFolder, '..', 'Update.exe')
    ];
    
    logger.info(MODULE_NAME, 'Checking alternative stub paths...');
    for (const altPath of alternativePaths) {
      if (fs.existsSync(altPath)) {
        result.warnings.push(`Alternative stub path found: ${altPath}`);
        result.recommendations.push(`Consider using alternative path: ${altPath}`);
        break;
      }
    }
  }

  // Registry permission check (basic)
  await checkWindowsPermissions(result);
}

/**
 * Standard setup diagnostics (macOS, Linux, dev)
 */
async function diagnoseStandardSetup(result: StartupDiagnosticResult): Promise<void> {
  result.pathExists = fs.existsSync(process.execPath);
  
  if (!result.pathExists) {
    result.errors.push(`Executable path does not exist: ${process.execPath}`);
  }

  logger.info(MODULE_NAME, 'Standard setup diagnostics passed');
}

/**
 * Check Windows registry permissions (basic test)
 */
async function checkWindowsPermissions(result: StartupDiagnosticResult): Promise<void> {
  try {
    // Try to get current settings as a permission test
    const settings = app.getLoginItemSettings();
    if (settings) {
      logger.info(MODULE_NAME, 'Registry read access confirmed');
    }
  } catch (error) {
    result.errors.push('Failed to access Windows startup registry - possible permission issue');
    result.recommendations.push('Try running as administrator or check UAC settings');
  }
}

/**
 * Check for common startup issues
 */
async function checkCommonIssues(result: StartupDiagnosticResult): Promise<void> {
  // Development mode check
  if (process.env.NODE_ENV === 'development') {
    result.warnings.push('Running in development mode - startup registration is disabled');
  }

  // Argument parsing check
  const hasHiddenArg = process.argv.includes('--hidden');
  const loginItemSettings = app.getLoginItemSettings();
  
  if (loginItemSettings.wasOpenedAtLogin) {
    if (!loginItemSettings.wasOpenedAsHidden && !hasHiddenArg) {
      result.warnings.push('App was launched at startup but not in hidden mode');
      result.recommendations.push('Check startup arguments configuration');
    }
    logger.info(MODULE_NAME, `Startup launch detected: hidden=${loginItemSettings.wasOpenedAsHidden}, hasHiddenArg=${hasHiddenArg}`);
  }

  // Process path validation
  if (process.execPath.includes('node.exe') || process.execPath.includes('electron.exe')) {
    result.warnings.push('Running from development executable - startup may not work in production');
  }
}

/**
 * Apply recommended fixes for common issues
 */
export async function applyStartupFixes(diagnosticResult: StartupDiagnosticResult): Promise<boolean> {
  logger.info(MODULE_NAME, 'Applying startup fixes based on diagnostic results...');
  
  try {
    // Fix configuration mismatch
    if (diagnosticResult.isConfigured !== diagnosticResult.osRegistered) {
      logger.info(MODULE_NAME, 'Fixing configuration mismatch...');
      const shouldEnable = diagnosticResult.isConfigured;
      
      if (process.platform === 'win32' && app.isPackaged && diagnosticResult.pathExists) {
        const appFolder = path.dirname(process.execPath);
        const exeName = path.basename(process.execPath);
        const stubLauncher = path.resolve(appFolder, '..', exeName);
        
        app.setLoginItemSettings({
          openAtLogin: shouldEnable,
          path: stubLauncher,
          args: [
            '--processStart', `"${exeName}"`,
            '--process-start-args', '"--hidden"'
          ]
        });
      } else {
        app.setLoginItemSettings({
          openAtLogin: shouldEnable,
          args: ['--hidden']
        });
      }
      
      logger.info(MODULE_NAME, `Applied startup fix: openAtLogin = ${shouldEnable}`);
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to apply startup fixes:', error);
    return false;
  }
}

/**
 * Test startup functionality with comprehensive logging
 */
export async function testStartupFunctionality(): Promise<void> {
  logger.info(MODULE_NAME, '=== STARTUP FUNCTIONALITY TEST ===');
  
  const diagnostic = await diagnoseStartupSystem();
  
  logger.info(MODULE_NAME, 'Diagnostic Results:', {
    isConfigured: diagnostic.isConfigured,
    osRegistered: diagnostic.osRegistered,
    pathExists: diagnostic.pathExists,
    errorCount: diagnostic.errors.length,
    warningCount: diagnostic.warnings.length
  });

  if (diagnostic.errors.length > 0) {
    logger.error(MODULE_NAME, 'ERRORS FOUND:');
    diagnostic.errors.forEach((error, i) => logger.error(MODULE_NAME, `${i + 1}. ${error}`));
  }

  if (diagnostic.warnings.length > 0) {
    logger.warn(MODULE_NAME, 'WARNINGS:');
    diagnostic.warnings.forEach((warning, i) => logger.warn(MODULE_NAME, `${i + 1}. ${warning}`));
  }

  if (diagnostic.recommendations.length > 0) {
    logger.info(MODULE_NAME, 'RECOMMENDATIONS:');
    diagnostic.recommendations.forEach((rec, i) => logger.info(MODULE_NAME, `${i + 1}. ${rec}`));
  }

  // Test fix application if needed
  if (diagnostic.errors.length > 0 || diagnostic.warnings.length > 0) {
    const fixApplied = await applyStartupFixes(diagnostic);
    if (fixApplied) {
      logger.info(MODULE_NAME, 'Fixes applied, re-running diagnostics...');
      const newDiagnostic = await diagnoseStartupSystem();
      logger.info(MODULE_NAME, 'Post-fix diagnostic:', {
        errorCount: newDiagnostic.errors.length,
        warningCount: newDiagnostic.warnings.length
      });
    }
  }
  
  logger.info(MODULE_NAME, '=== TEST COMPLETE ===');
}