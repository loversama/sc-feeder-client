import { ipcRenderer, contextBridge } from 'electron';

const MODULE_NAME = 'WebContentsHeaderPreload';
console.log(`${MODULE_NAME}: Header preload script loaded`);

// API for header controls (navigation and window management)
contextBridge.exposeInMainWorld('electronAPI', {
    // Navigation between sections
    navigateToSection: (section: string): void => {
        console.log(`${MODULE_NAME}: Navigation requested to: ${section}`);
        ipcRenderer.send('enhanced-navigation:change-section', section);
    },

    // Window controls
    windowControl: (action: string): void => {
        console.log(`${MODULE_NAME}: Window control action: ${action}`);
        switch (action) {
            case 'close':
                ipcRenderer.send('enhanced-window:close');
                break;
            case 'minimize':
                ipcRenderer.send('enhanced-window:minimize');
                break;
            case 'maximize':
                ipcRenderer.send('enhanced-window:maximize');
                break;
            default:
                console.warn(`${MODULE_NAME}: Unknown window control action: ${action}`);
        }
    },

    // Listen for section changes (to update active state)
    onSectionChange: (callback: (section: string) => void): (() => void) => {
        const listener = (_: any, section: string) => {
            console.log(`${MODULE_NAME}: Section changed to: ${section}`);
            callback(section);
        };
        ipcRenderer.on('enhanced-section-changed', listener);
        return () => {
            ipcRenderer.removeListener('enhanced-section-changed', listener);
        };
    }
});

console.log(`${MODULE_NAME}: Header preload script setup completed`);