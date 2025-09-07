// Debug script to fix navigation icon clicking issues
console.log('=== Debugging Navigation Icons ===\n');

// Function to reset navigation state
function resetNavigationState() {
  if (window.__navigationState) {
    window.__navigationState.isNavigating.value = false;
    window.__navigationState.lastNavigationTime.value = 0;
    console.log('✅ Reset navigation state flags');
  }
  
  if (window.__navBusDebug) {
    console.log('Current state:', window.__navBusDebug.getState());
  }
}

// Function to simulate clicking through all navigation buttons
async function testAllNavButtons() {
  console.log('\n🧪 Testing navigation through all buttons...\n');
  
  const sections = ['profile', 'leaderboard', 'map', 'events', 'stats'];
  
  for (const section of sections) {
    console.log(`\n➡️  Navigating to ${section}...`);
    
    // Find and click the button
    const buttons = document.querySelectorAll('.status-icon-button');
    let found = false;
    
    buttons.forEach(btn => {
      const title = btn.getAttribute('title')?.toLowerCase();
      if (title === section || (section === 'stats' && title === 'statistics')) {
        console.log(`   Clicking button: ${title}`);
        btn.click();
        found = true;
      }
    });
    
    if (!found) {
      console.log(`   ⚠️  Button for ${section} not found`);
    }
    
    // Wait a bit between clicks
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Check current state
    console.log(`   Current section: ${window.__navigationState?.currentSection?.value}`);
    console.log(`   Is navigating: ${window.__navigationState?.isNavigating?.value}`);
    console.log(`   ${section} active: ${window.__navigationState[`is${section.charAt(0).toUpperCase() + section.slice(1)}Active`]?.value}`);
  }
  
  console.log('\n✅ Navigation test complete');
}

// Function to monitor navigation state changes
function monitorNavigation() {
  console.log('\n👁️  Monitoring navigation state changes...\n');
  
  let lastState = {
    section: null,
    isNavigating: false
  };
  
  setInterval(() => {
    const currentState = {
      section: window.__navigationState?.currentSection?.value,
      isNavigating: window.__navigationState?.isNavigating?.value
    };
    
    if (currentState.section !== lastState.section || currentState.isNavigating !== lastState.isNavigating) {
      console.log(`[${new Date().toLocaleTimeString()}] State changed:`, {
        section: currentState.section,
        isNavigating: currentState.isNavigating,
        activeStates: {
          profile: window.__navigationState?.isProfileActive?.value,
          leaderboard: window.__navigationState?.isLeaderboardActive?.value,
          map: window.__navigationState?.isMapActive?.value,
          events: window.__navigationState?.isEventsActive?.value,
          stats: window.__navigationState?.isStatsActive?.value
        }
      });
      
      lastState = currentState;
    }
    
    // Auto-reset if stuck
    if (currentState.isNavigating && window.__navigationState?.lastNavigationTime?.value) {
      const timeSinceNav = Date.now() - window.__navigationState.lastNavigationTime.value;
      if (timeSinceNav > 2000) {
        console.warn('⚠️  Navigation stuck for over 2 seconds, auto-resetting...');
        resetNavigationState();
      }
    }
  }, 100);
  
  console.log('Use Ctrl+C or close console to stop monitoring');
}

// Check current issues
console.log('Current Navigation State:');
console.log('- Current section:', window.__navigationState?.currentSection?.value);
console.log('- Is navigating:', window.__navigationState?.isNavigating?.value);
console.log('- Last nav time:', window.__navigationState?.lastNavigationTime?.value);
console.log('- Time since last nav:', window.__navigationState?.lastNavigationTime?.value ? Date.now() - window.__navigationState.lastNavigationTime.value : 'N/A');

console.log('\nAvailable commands:');
console.log('- resetNavigationState() - Reset stuck navigation flags');
console.log('- testAllNavButtons() - Test clicking through all nav buttons');
console.log('- monitorNavigation() - Monitor state changes in real-time');

// Auto-reset if stuck on load
if (window.__navigationState?.isNavigating?.value) {
  const timeSinceNav = Date.now() - (window.__navigationState?.lastNavigationTime?.value || 0);
  if (timeSinceNav > 2000) {
    console.warn('\n⚠️  Navigation appears to be stuck, auto-resetting...');
    resetNavigationState();
  }
}

// Export functions
window.navFix = {
  reset: resetNavigationState,
  testAll: testAllNavButtons,
  monitor: monitorNavigation
};