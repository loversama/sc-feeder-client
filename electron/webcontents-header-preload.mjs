import { ipcRenderer, contextBridge } from 'electron';

const MODULE_NAME = 'WebContentsHeaderPreload';
console.log(`${MODULE_NAME}: Header preload script loaded`);

// Expose header navigation API
contextBridge.exposeInMainWorld('electronAPI', {
    // Navigation within WebContentsView
    navigateToSection: (section) => {
        console.log(`${MODULE_NAME}: Navigation requested to: ${section}`);
        ipcRenderer.send('enhanced-navigation:change-section', section);
    },

    // Window controls
    windowControl: (action) => {
        console.log(`${MODULE_NAME}: Window control: ${action}`);
        if (action === 'close') {
            ipcRenderer.send('enhanced-window:close');
        } else if (action === 'minimize') {
            ipcRenderer.send('enhanced-window:minimize');
        } else if (action === 'maximize') {
            ipcRenderer.send('enhanced-window:maximize');
        }
    },

    // Listen for section changes
    onSectionChange: (callback) => {
        const listener = (_, section) => {
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