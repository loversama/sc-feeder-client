declare module 'chokidar' {
  interface WatchOptions {
    persistent?: boolean;
    ignoreInitial?: boolean;
    followSymlinks?: boolean;
    depth?: number;
    interval?: number;
    binaryInterval?: number;
    usePolling?: boolean;
    awaitWriteFinish?: {
      stabilityThreshold?: number;
      pollInterval?: number;
    } | boolean;
    [key: string]: any;
  }

  interface FSWatcher {
    on(event: 'add', listener: (path: string) => void): this;
    on(event: 'change', listener: (path: string) => void): this;
    on(event: 'unlink', listener: (path: string) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    close(): Promise<void>;
  }

  function watch(paths: string | string[], options?: WatchOptions): FSWatcher;
  
  export { watch, FSWatcher, WatchOptions };
}