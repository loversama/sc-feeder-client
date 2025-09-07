// Debug helper for navigation state
// Copy and paste this into the browser console to debug navigation issues

// Check current navigation state
window.debugNavigation = () => {
  const state = window.__navigationState;
  if (!state) {
    console.error('Navigation state not found. Make sure the app is loaded.');
    return;
  }
  
  console.group('🧭 Navigation State Debug');
  console.log('Current Section:', state.currentSection?.value || 'none');
  console.log('Is Navigating:', state.isNavigating?.value || false);
  console.log('Window Open:', state.webContentWindowOpen?.value || false);
  console.log('Active States:', {
    profile: state.isProfileActive?.value || false,
    leaderboard: state.isLeaderboardActive?.value || false,
    map: state.isMapActive?.value || false,
    events: state.isEventsActive?.value || false,
    stats: state.isStatsActive?.value || false
  });
  console.groupEnd();
};

// Monitor navigation state changes
window.watchNavigation = () => {
  console.log('🔍 Watching navigation state changes...');
  
  // Listen for IPC events
  if (window.logMonitorApi?.onWebContentWindowStatus) {
    window.logMonitorApi.onWebContentWindowStatus((event, status) => {
      console.log('📡 IPC Status Update:', status);
    });
  }
  
  // Listen for custom events
  window.addEventListener('navigation-state-update', (event) => {
    console.log('📮 Navigation State Update Event:', event.detail);
  });
  
  // Listen for WebContentsView navigation
  window.addEventListener('message', (event) => {
    if (event.data.type === 'webcontents-view-navigated') {
      console.log('🌐 WebContentsView Navigated:', event.data);
    }
  });
};

console.log('Navigation debug helpers loaded. Use:');
console.log('- window.debugNavigation() to check current state');
console.log('- window.watchNavigation() to monitor changes');