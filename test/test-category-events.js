/**
 * Test script for generating events with dynamic categories
 * This can be used with a test server to verify the category system
 */

const testCategories = [
  {
    id: 'org_event',
    name: 'Organization Event',
    icon: '🏢',
    color: '#FF6B6B',
    priority: 1
  },
  {
    id: 'proximity_event', 
    name: 'Proximity Event',
    icon: '📍',
    color: '#4ECDC4',
    priority: 2
  },
  {
    id: 'bounty_event',
    name: 'Bounty Event',
    icon: '💰',
    color: '#FFE66D',
    priority: 3
  },
  {
    id: 'system_event',
    name: 'System Event',
    icon: '⚡',
    color: '#95E1D3',
    priority: 4
  }
];

// Generate a test event with a random category
function generateTestEvent() {
  const eventId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const hasCategory = Math.random() > 0.2; // 80% chance of having a category
  
  const event = {
    id: eventId,
    type: 'PLAYER_KILL',
    timestamp: new Date().toISOString(),
    data: {
      killers: [`TestPlayer${Math.floor(Math.random() * 100)}`],
      victims: [`TestVictim${Math.floor(Math.random() * 100)}`],
      weapon: 'TestWeapon',
      location: 'TestLocation'
    }
  };

  // Add category metadata
  if (hasCategory) {
    event.category = testCategories[Math.floor(Math.random() * testCategories.length)];
  }

  return event;
}

// Generate multiple test events
function generateTestEventBatch(count = 10) {
  const events = [];
  for (let i = 0; i < count; i++) {
    events.push(generateTestEvent());
  }
  return events;
}

// Example usage for testing
console.log('Test Event Examples:');
console.log('\n1. Event with category:');
console.log(JSON.stringify(generateTestEvent(), null, 2));

console.log('\n2. Batch of events:');
const batch = generateTestEventBatch(5);
batch.forEach((event, index) => {
  console.log(`\nEvent ${index + 1}:`, {
    id: event.id,
    hasCategory: !!event.category,
    categoryId: event.category?.id || 'none',
    categoryName: event.category?.name || 'Uncategorized'
  });
});

// Export for use in other test files
module.exports = {
  testCategories,
  generateTestEvent,
  generateTestEventBatch
};