// Stand-ins for the Electron-bound modules log-parser.ts imports, so the parser runs under plain node.
export const emitted: Array<{ event: any; level: number }> = [];
export const clearEmitted = () => { emitted.length = 0; };
