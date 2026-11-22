/**
 * Who may call game-control IPC: only the app's own top-level pages (main + settings windows).
 *
 * The app also hosts remote voidlog.gg content in WebContentsViews / webviews and exposes a generic
 * ipcRenderer bridge, so the check is on the sending frame, not just the window: it must be a main
 * frame, belong to a trusted webContents, and be served from the app's own file:// root or the
 * dev server origin. Pure function so it is tested without Electron.
 */
export type SenderInfo = {
  webContentsId: number;
  frameUrl: string | null | undefined;
  isMainFrame: boolean;
};

export type TrustPolicy = {
  trustedWebContentsIds: number[];
  /** file:// URL of the renderer dist directory, e.g. file:///C:/app/resources/app.asar/dist/ */
  appFileRoot?: string | null;
  /** Vite dev server URL in development, e.g. http://localhost:5173/ */
  devServerUrl?: string | null;
};

export function isTrustedControlSender(sender: SenderInfo, policy: TrustPolicy): boolean {
  if (!sender || !sender.isMainFrame) return false;
  if (!policy.trustedWebContentsIds.includes(sender.webContentsId)) return false;
  let url: URL;
  try {
    url = new URL(String(sender.frameUrl ?? ''));
  } catch {
    return false;
  }
  if (url.protocol === 'file:' && policy.appFileRoot) {
    let root: URL;
    try {
      root = new URL(policy.appFileRoot.endsWith('/') ? policy.appFileRoot : `${policy.appFileRoot}/`);
    } catch {
      return false;
    }
    // Compare decoded, case-insensitively (Windows paths); reject path traversal.
    const p = decodeURIComponent(url.pathname).toLowerCase();
    const r = decodeURIComponent(root.pathname).toLowerCase();
    return !p.includes('/../') && p.startsWith(r);
  }
  if ((url.protocol === 'http:' || url.protocol === 'https:') && policy.devServerUrl) {
    try {
      return url.origin === new URL(policy.devServerUrl).origin;
    } catch {
      return false;
    }
  }
  return false;
}
