// Debug script for navigation event bus
// Run this in the browser console to debug navigation state issues

// Check event bus state
console.log('Navigation Event Bus State:');
console.log(window.__navBusDebug?.getState());

// Check listeners
console.log('\nEvent Listeners:');
console.log(window.__navBusDebug?.getListeners());

// Check navigation state (composable)
console.log('\nNavigation State (composable):');
console.log({
  currentSection: window.__navigationState?.currentSection?.value,
  isNavigating: window.__navigationState?.isNavigating?.value,
  webContentWindowOpen: window.__navigationState?.webContentWindowOpen?.value,
  activeStates: {
    profile: window.__navigationState?.isProfileActive?.value,
    leaderboard: window.__navigationState?.isLeaderboardActive?.value,
    map: window.__navigationState?.isMapActive?.value,
    events: window.__navigationState?.isEventsActive?.value,
    stats: window.__navigationState?.isStatsActive?.value
  }
});

// Test navigation
console.log('\nTo test navigation sync:');
console.log('1. Emit a test navigation event:');
console.log("   window.__navBusDebug.emit({ type: 'navigate', section: 'leaderboard', isOpen: true, source: 'debug' })");
console.log('2. Check if all components update their active states');
console.log('3. Navigate from different components and verify sync');

// Monitor events
console.log('\nTo monitor navigation events in real-time:');
console.log(`
window.monitorNavEvents = () => {
  const cleanup = window.__navigationEventBus.on('all', (event) => {
    console.log('[NavEvent]', new Date().toLocaleTimeString(), event);
  });
  console.log('Monitoring navigation events... Call window.stopMonitorNavEvents() to stop.');
  window.stopMonitorNavEvents = cleanup;
};
window.monitorNavEvents();
`);