import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/** Minimal bridge for the in-game overlay: it only receives state pushes. */
contextBridge.exposeInMainWorld('overlayApi', {
  onState: (cb: (state: any) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, state: any) => cb(state);
    ipcRenderer.on('overlay-state', listener);
    return () => ipcRenderer.removeListener('overlay-state', listener);
  },
});
