// Test navigation sync across components
console.log('=== Testing Navigation State Sync ===\n');

// Function to check all navigation states
function checkAllStates() {
  console.log('\n🔍 Current Navigation States:');
  
  // Event bus state
  const busState = window.__navBusDebug?.getState();
  console.log('Event Bus:', {
    currentSection: busState?.currentSection,
    isWindowOpen: busState?.isWindowOpen
  });
  
  // Composable state
  console.log('Composable:', {
    currentSection: window.__navigationState?.currentSection?.value,
    isNavigating: window.__navigationState?.isNavigating?.value,
    webContentWindowOpen: window.__navigationState?.webContentWindowOpen?.value
  });
  
  // Active states
  console.log('Active States:', {
    profile: window.__navigationState?.isProfileActive?.value,
    leaderboard: window.__navigationState?.isLeaderboardActive?.value,
    map: window.__navigationState?.isMapActive?.value,
    events: window.__navigationState?.isEventsActive?.value,
    stats: window.__navigationState?.isStatsActive?.value
  });
  
  // Check DOM for active classes
  console.log('\n🎨 DOM Active Classes:');
  
  // KillFeed buttons
  const killFeedButtons = document.querySelectorAll('.status-icon-button');
  killFeedButtons.forEach(btn => {
    const isActive = btn.classList.contains('active');
    const tooltip = btn.querySelector('.v-popper')?.textContent || 'unknown';
    if (isActive) {
      console.log(`KillFeed button "${tooltip}": ACTIVE`);
    }
  });
  
  // Navigation menu items
  const navItems = document.querySelectorAll('.menu-item');
  navItems.forEach(item => {
    const isActive = item.classList.contains('active');
    const text = item.textContent?.trim();
    if (isActive && text) {
      console.log(`Navigation menu "${text}": ACTIVE`);
    }
  });
}

// Function to simulate navigation
function simulateNavigation(section) {
  console.log(`\n🚀 Simulating navigation to: ${section}`);
  window.__navBusDebug?.emit({
    type: 'navigate',
    section: section,
    isOpen: true,
    source: 'test-script'
  });
  
  // Check states after a delay
  setTimeout(() => {
    checkAllStates();
  }, 100);
}

// Monitor all navigation events
let eventCount = 0;
const cleanup = window.__navigationEventBus?.on('all', (event) => {
  eventCount++;
  console.log(`\n📡 Event #${eventCount}:`, event);
  
  // Auto-check states after each event
  setTimeout(checkAllStates, 50);
});

console.log('✅ Navigation sync test ready!');
console.log('\nCommands:');
console.log('- checkAllStates() - Check current state across all components');
console.log('- simulateNavigation("leaderboard") - Simulate navigation to a section');
console.log('- cleanup() - Stop monitoring events');

// Initial state check
checkAllStates();

// Store functions globally
window.navTest = {
  checkAllStates,
  simulateNavigation,
  cleanup
};