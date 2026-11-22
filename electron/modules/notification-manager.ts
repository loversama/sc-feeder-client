import { app, nativeImage, Notification } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url'; // Added for ESM __dirname
import { getShowNotifications } from './config-manager.ts'; // Added .ts
import { getMainWindow } from './window-manager.ts'; // To send status as fallback - Added .ts
import * as logger from './logger'; // Import the logger utility

// Define __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODULE_NAME = 'NotificationManager'; // Define module name for logger

// --- Constants ---
// Resolved lazily (VITE_PUBLIC is set once the app is ready): public/ in dev, <app>/dist when packaged (app.asar).
const iconPath = () =>
  path.join(process.env.VITE_PUBLIC || path.join(app.getAppPath(), app.isPackaged ? 'dist' : 'public'), 'voidlog-icon.png');

// --- Function ---

export function showNotification(title: string, body: string) {
    // Check user preference first
    const shouldShow = getShowNotifications();
    const win = getMainWindow();

    if (!shouldShow) {
        // Still log it and potentially send to renderer as status update
        logger.info(MODULE_NAME, `Notification suppressed by user setting: "${title} - ${body}"`);
        win?.webContents.send('log-status', `Notification (Suppressed): ${title} - ${body}`);
        return;
    }

    if (Notification.isSupported()) {
        const notification = new Notification({
            title: title,
            body: body,
            icon: nativeImage.createFromPath(iconPath()), // reads from app.asar too
            silent: false // Make noise unless configured otherwise
        });

        notification.show();
        logger.info(MODULE_NAME, `Shown: "${title} - ${body}"`);

        // Optional: Implement tray flashing or other indicators if window not focused
        // if (tray && win && !win.isFocused()) {
        //   // tray.flash() or similar logic
        // }

    } else {
        logger.warn(MODULE_NAME, 'Notifications not supported on this system.');
        // Send a status message to the renderer as fallback
        win?.webContents.send('log-status', `Notification (Not Supported): ${title} - ${body}`);
    }
}

// Example of a specific notification type (could be called by event-processor)
// import { KillEvent } from '../../shared/types';
// export function showKillNotification(killEvent: KillEvent) {
//     if (!killEvent || !killEvent.eventDescription) return;
//     logger.info(MODULE_NAME, `Showing notification for event: ${killEvent.eventDescription}`);
//
//     let title = 'Event Detected'; // Default title
//     if (['Combat', 'Soft', 'Hard'].includes(killEvent.deathType)) {
//         title = 'Combat Event';
//     } else if (['Collision', 'Crash'].includes(killEvent.deathType)) {
//         title = 'Collision/Crash Event';
//     } else if (['BleedOut', 'Suffocation'].includes(killEvent.deathType)) {
//         title = 'Environmental Event';
//     }
//
//     showNotification(title, killEvent.eventDescription);
// }