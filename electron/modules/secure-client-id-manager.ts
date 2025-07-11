import { safeStorage } from 'electron';
import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import * as logger from './logger';

const MODULE_NAME = 'SecureClientIdManager';

// Storage keys
const SAFE_STORAGE_KEY = 'secure_client_id';
const ELECTRON_STORE_KEY = 'clientId';
const VALIDATION_KEY = 'clientId_checksum';

// Storage integrity validation
interface StorageValidation {
    clientId: string;
    timestamp: number;
    checksum: string;
}

/**
 * Secure Client ID Manager
 * 
 * Implements multi-layer storage strategy:
 * 1. Primary: Electron safeStorage (encrypted, OS-level security)
 * 2. Fallback: electron-store (performance, backward compatibility) 
 * 3. Validation: Cross-verification and tamper detection
 * 4. Migration: Seamless upgrade from legacy storage
 */
export class SecureClientIdManager {
    private static instance: SecureClientIdManager | null = null;
    private memoryCache: string | null = null;
    private store: Store;
    private isInitialized: boolean = false;

    private constructor() {
        this.store = new Store({ name: 'auth-state' });
    }

    /**
     * Singleton pattern to ensure consistent client ID across the application
     */
    public static getInstance(): SecureClientIdManager {
        if (!SecureClientIdManager.instance) {
            SecureClientIdManager.instance = new SecureClientIdManager();
        }
        return SecureClientIdManager.instance;
    }

    /**
     * Get the client ID with automatic initialization and caching
     * This is the primary method that should be used throughout the application
     */
    public async getClientId(): Promise<string> {
        if (this.memoryCache) {
            return this.memoryCache;
        }

        if (!this.isInitialized) {
            await this.initialize();
        }

        return this.memoryCache!;
    }

    /**
     * Initialize the secure storage system
     * Handles migration, validation, and fallback logic
     */
    private async initialize(): Promise<void> {
        logger.info(MODULE_NAME, 'Initializing secure client ID storage...');

        try {
            // Step 1: Try to get client ID from secure storage layers
            const clientId = await this.getSecurePersistedClientId();
            
            // Step 2: Validate storage integrity
            const isValid = await this.validateStorageIntegrity(clientId);
            
            if (isValid) {
                this.memoryCache = clientId;
                logger.info(MODULE_NAME, 'Client ID loaded successfully from secure storage');
            } else {
                // Storage integrity failed - regenerate and re-store
                logger.warn(MODULE_NAME, 'Storage integrity validation failed, regenerating client ID');
                const newClientId = await this.regenerateClientId();
                this.memoryCache = newClientId;
            }

            this.isInitialized = true;
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to initialize secure client ID storage:', error);
            // Fallback to generate temporary ID for current session
            this.memoryCache = uuidv4();
            logger.warn(MODULE_NAME, 'Using temporary client ID for current session');
            this.isInitialized = true;
        }
    }

    /**
     * Multi-layer client ID retrieval with migration support
     */
    private async getSecurePersistedClientId(): Promise<string> {
        let secureId: string | null = null;
        let storeId: string | null = null;

        // Try secure storage first (most secure)
        try {
            secureId = await this.getFromSafeStorage();
        } catch (error) {
            logger.debug(MODULE_NAME, 'SafeStorage read failed:', error);
        }

        // Try electron-store fallback
        try {
            storeId = this.getFromElectronStore();
        } catch (error) {
            logger.debug(MODULE_NAME, 'Electron-store read failed:', error);
        }

        // Logic for reconciling multiple storage layers
        if (secureId && storeId) {
            if (secureId === storeId) {
                // Both storages agree - all good
                return secureId;
            } else {
                // Mismatch detected - prefer secure storage
                logger.warn(MODULE_NAME, 'Storage mismatch detected, preferring secure storage');
                await this.updateElectronStore(secureId);
                return secureId;
            }
        }

        // Migration: existing electron-store only (legacy clients)
        if (storeId && !secureId) {
            logger.info(MODULE_NAME, 'Migrating from legacy electron-store to secure storage');
            await this.saveToSafeStorage(storeId);
            await this.saveValidationData(storeId);
            return storeId;
        }

        // Secure storage only
        if (secureId && !storeId) {
            await this.updateElectronStore(secureId);
            return secureId;
        }

        // New installation - generate new ID
        logger.info(MODULE_NAME, 'New installation detected, generating new client ID');
        const newId = uuidv4();
        await this.saveToSafeStorage(newId);
        await this.updateElectronStore(newId);
        await this.saveValidationData(newId);
        
        return newId;
    }

    /**
     * Save client ID to Electron's secure storage (encrypted)
     */
    private async saveToSafeStorage(clientId: string): Promise<void> {
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                throw new Error('Encryption not available on this system');
            }

            const encrypted = safeStorage.encryptString(clientId);
            this.store.set(SAFE_STORAGE_KEY, Array.from(encrypted));
            logger.debug(MODULE_NAME, 'Client ID saved to secure storage');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to save to secure storage:', error);
            throw error;
        }
    }

    /**
     * Retrieve client ID from Electron's secure storage
     */
    private async getFromSafeStorage(): Promise<string | null> {
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                return null;
            }

            const encryptedArray = this.store.get(SAFE_STORAGE_KEY) as number[] | undefined;
            if (!encryptedArray) {
                return null;
            }

            const encrypted = Buffer.from(encryptedArray);
            const decrypted = safeStorage.decryptString(encrypted);
            
            if (!decrypted || typeof decrypted !== 'string') {
                throw new Error('Invalid decrypted data format');
            }

            return decrypted;
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to read from secure storage:', error);
            throw error;
        }
    }

    /**
     * Save client ID to electron-store (fallback storage)
     */
    private async updateElectronStore(clientId: string): Promise<void> {
        try {
            this.store.set(ELECTRON_STORE_KEY, clientId);
            logger.debug(MODULE_NAME, 'Client ID updated in electron-store');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to update electron-store:', error);
            throw error;
        }
    }

    /**
     * Retrieve client ID from electron-store
     */
    private getFromElectronStore(): string | null {
        try {
            const stored = this.store.get(ELECTRON_STORE_KEY) as string | undefined;
            return stored || null;
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to read from electron-store:', error);
            return null;
        }
    }

    /**
     * Generate validation checksum for storage integrity
     */
    private generateChecksum(clientId: string): string {
        // Simple checksum using the client ID and current timestamp
        const data = `${clientId}_${Date.now()}`;
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Save validation data for storage integrity checking
     */
    private async saveValidationData(clientId: string): Promise<void> {
        try {
            const validation: StorageValidation = {
                clientId: clientId,
                timestamp: Date.now(),
                checksum: this.generateChecksum(clientId)
            };
            
            this.store.set(VALIDATION_KEY, validation);
            logger.debug(MODULE_NAME, 'Validation data saved');
        } catch (error) {
            logger.warn(MODULE_NAME, 'Failed to save validation data:', error);
            // Non-critical error - don't throw
        }
    }

    /**
     * Validate storage integrity to detect tampering
     */
    private async validateStorageIntegrity(clientId: string): Promise<boolean> {
        try {
            const validation = this.store.get(VALIDATION_KEY) as StorageValidation | undefined;
            
            if (!validation) {
                // No validation data - save it for future checks
                await this.saveValidationData(clientId);
                return true;
            }

            // Check if client ID matches validation data
            if (validation.clientId !== clientId) {
                logger.warn(MODULE_NAME, 'Client ID mismatch in validation data');
                return false;
            }

            // Check if checksum is valid
            const expectedChecksum = this.generateChecksum(validation.clientId);
            if (validation.checksum !== expectedChecksum) {
                logger.warn(MODULE_NAME, 'Validation checksum mismatch');
                return false;
            }

            // Check if validation data is not too old (more than 90 days)
            const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
            if (Date.now() - validation.timestamp > ninetyDaysMs) {
                logger.info(MODULE_NAME, 'Validation data is old, refreshing...');
                await this.saveValidationData(clientId);
            }

            return true;
        } catch (error) {
            logger.error(MODULE_NAME, 'Storage integrity validation failed:', error);
            return false;
        }
    }

    /**
     * Regenerate client ID and update all storage layers
     */
    private async regenerateClientId(): Promise<string> {
        const newClientId = uuidv4();
        
        try {
            await this.saveToSafeStorage(newClientId);
        } catch (error) {
            logger.warn(MODULE_NAME, 'Failed to save new client ID to secure storage:', error);
        }

        try {
            await this.updateElectronStore(newClientId);
        } catch (error) {
            logger.warn(MODULE_NAME, 'Failed to save new client ID to electron-store:', error);
        }

        await this.saveValidationData(newClientId);
        
        logger.info(MODULE_NAME, 'Client ID regenerated and stored');
        return newClientId;
    }

    /**
     * Reset the client ID (for testing or manual reset scenarios)
     * This method should be used very carefully
     */
    public async resetClientId(): Promise<string> {
        logger.warn(MODULE_NAME, 'Client ID reset requested');
        
        this.memoryCache = null;
        this.isInitialized = false;
        
        // Clear all storage layers
        try {
            this.store.delete(SAFE_STORAGE_KEY);
            this.store.delete(ELECTRON_STORE_KEY);
            this.store.delete(VALIDATION_KEY);
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to clear storage during reset:', error);
        }

        // Initialize with new ID
        await this.initialize();
        return this.memoryCache!;
    }

    /**
     * Get storage status for diagnostics
     */
    public async getStorageStatus(): Promise<{
        hasSecureStorage: boolean;
        hasElectronStore: boolean;
        hasValidation: boolean;
        isEncryptionAvailable: boolean;
        lastValidationTime: number | null;
    }> {
        const hasSecureStorage = !!this.store.get(SAFE_STORAGE_KEY);
        const hasElectronStore = !!this.store.get(ELECTRON_STORE_KEY);
        const validation = this.store.get(VALIDATION_KEY) as StorageValidation | undefined;
        
        return {
            hasSecureStorage,
            hasElectronStore,
            hasValidation: !!validation,
            isEncryptionAvailable: safeStorage.isEncryptionAvailable(),
            lastValidationTime: validation?.timestamp || null
        };
    }
}

// Export a convenience function for backward compatibility
export async function getSecureClientId(): Promise<string> {
    const manager = SecureClientIdManager.getInstance();
    return await manager.getClientId();
}