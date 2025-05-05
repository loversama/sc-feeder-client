// log-monitor-client/src/types/vuex.d.ts
declare module 'vuex' {
  // export * from '../../node_modules/vuex/types/index.d.ts';
  // If the above doesn't work, try exporting specific members needed
  export { createStore, Store, ActionContext } from '../../node_modules/vuex/types/index.d.ts';
}