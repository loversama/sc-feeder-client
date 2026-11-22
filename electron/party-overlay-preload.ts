import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/** Minimal bridge for the party overlay: receives state pushes and reports its content height. */
contextBridge.exposeInMainWorld('partyOverlayApi', {
  onState: (cb: (state: any) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, state: any) => cb(state);
    ipcRenderer.on('party-overlay-state', listener);
    return () => ipcRenderer.removeListener('party-overlay-state', listener);
  },
  reportHeight: (h: number) => ipcRenderer.send('party-overlay:content-height', h),
});
