# KillFeed Infinite Scroll Implementation

## Overview

The KillFeed component (`src/components/KillFeed.vue`) implements infinite scroll functionality to dynamically load more kill events as the user scrolls down. This document details the implementation, the critical bug that was discovered, and the solution.

## Architecture

### Event Storage and Pagination
- **EventStore**: Manages events in memory and provides pagination through the database
- **EventProcessor**: Handles loading more events via `loadMoreEvents()` function
- **IPC Communication**: Renderer communicates with main process via `window.logMonitorApi.loadMoreEvents()`

### Scroll Detection System
The infinite scroll system consists of several key components:

1. **Scroll Container**: `.kill-feed-scroll-area` - The main scrollable container
2. **Scroll Handler**: `handleScroll()` - Detects when user is near bottom
3. **Load Trigger**: `loadMoreEvents()` - Fetches and appends new events
4. **State Management**: Tracks loading state and whether more events exist

## Implementation Details

### HTML Structure
```vue
<div class="kill-feed-scroll-area" 
     ref="killFeedListRef"
     tabindex="0"
     style="outline: none;">
  <transition-group name="feed-anim" tag="div" class="feed-items-container">
    <div v-for="event in sortedFilteredEvents" :key="event.id">
      <!-- Event content -->
    </div>
  </transition-group>
</div>
```

**Critical Elements:**
- `ref="killFeedListRef"` - Vue ref for accessing the DOM element
- `tabindex="0"` - Makes element focusable (required for scroll events)
- `style="outline: none;"` - Removes focus outline for better UX

### CSS Configuration
```css
.kill-feed-scroll-area {
  flex: 1 1 auto;
  overflow-y: auto !important;
  overflow-x: hidden;
  min-height: 0;
  scroll-behavior: smooth;
}
```

### Scroll Detection Logic
```javascript
const handleScroll = (event: Event) => {
  const container = event.target as HTMLElement;
  const scrollTop = container.scrollTop;
  const scrollHeight = container.scrollHeight;
  const clientHeight = container.clientHeight;
  
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
  
  // Trigger when within 200px of bottom OR at 90% scroll
  const isNearBottom = distanceFromBottom <= 200 || scrollPercentage >= 0.90;
  
  if (isNearBottom && !isLoadingMore.value && hasMoreEvents.value) {
    loadMoreEvents();
  }
};
```

### Event Loading Process
```javascript
const loadMoreEvents = async () => {
  if (isLoadingMore.value || !hasMoreEvents.value) return;
  
  try {
    isLoadingMore.value = true;
    const offset = allEvents.value.length;
    const results = await window.logMonitorApi.loadMoreEvents(25, offset);
    
    // Append new events avoiding duplicates
    const newEventIds = new Set(allEvents.value.map(e => e.id));
    const uniqueNewEvents = results.events.filter(e => !newEventIds.has(e.id));
    allEvents.value = [...allEvents.value, ...uniqueNewEvents];
    
    hasMoreEvents.value = results.hasMore;
  } finally {
    isLoadingMore.value = false;
  }
};
```

## Critical Bug and Solution

### The Problem
The infinite scroll was not working for manual user scrolling, despite programmatic scrolling (via test buttons) working perfectly. The issue persisted for over an hour of debugging.

### Root Cause Discovery
The critical issue was discovered in the logs:
```
[RENDERER] ⚠️ ERROR: killFeedListRef.value is null, cannot add scroll listener
```

**The scroll event listener was never being attached** because `killFeedListRef.value` was `null` when Vue's `onMounted` + `nextTick()` tried to set it up.

### Why This Happened
This is a **Vue reactivity timing issue** where:
1. `onMounted()` fires when the component is mounted
2. `nextTick()` waits for the next DOM update cycle
3. However, the DOM element referenced by `ref="killFeedListRef"` wasn't available yet
4. The conditional `if (killFeedListRef.value)` failed silently
5. No scroll listeners were attached
6. Manual scrolling produced zero events

### The Solution
Implemented a robust retry mechanism with progressive delays:

```javascript
const setupScrollListeners = () => {
  if (killFeedListRef.value) {
    // Add all scroll listeners
    killFeedListRef.value.addEventListener('scroll', handleScroll, { passive: true });
    // ... additional listeners
    return true; // Success
  }
  return false; // Failed
};

const trySetupWithRetries = (maxRetries = 5, delay = 100) => {
  let attempts = 0;
  const attemptSetup = () => {
    attempts++;
    
    if (setupScrollListeners()) {
      console.log('✅ Scroll listeners setup successful!');
      return;
    }
    
    if (attempts < maxRetries) {
      setTimeout(attemptSetup, delay * attempts); // Increasing delay
    } else {
      console.error('❌ Failed to setup scroll listeners after all retries');
    }
  };
  
  nextTick(attemptSetup);
};
```

**Key Improvements:**
1. **Retry Logic**: Attempts setup up to 5 times with increasing delays (100ms, 200ms, 300ms, etc.)
2. **Explicit Success Tracking**: Returns boolean to confirm listener attachment
3. **Progressive Delays**: Handles slow DOM updates and complex component hierarchies
4. **Comprehensive Logging**: Clear success/failure messages for debugging

### Why The Fix Worked
- **Timing Resilience**: Multiple attempts handle various DOM timing scenarios
- **Progressive Delays**: Each retry waits longer, accommodating slower DOM updates
- **Explicit Validation**: Confirms the DOM element exists before attempting listener attachment
- **Focusable Element**: `tabindex="0"` ensures the container can receive scroll events

## Event Flow

### Normal Scroll Flow
1. User scrolls in `.kill-feed-scroll-area`
2. `scroll` event fires → `handleScroll()` called
3. Calculate distance from bottom and scroll percentage
4. If near bottom → call `loadMoreEvents()`
5. Load new events via IPC → EventStore
6. Append to `allEvents` array
7. Vue reactivity updates the DOM
8. User can continue scrolling

### Search Mode Flow
When searching, the flow changes:
1. Search query triggers `searchEvents()` via EventStore
2. Results populate `searchResults` array instead of `allEvents`
3. Infinite scroll loads more search results with increasing offset
4. Clear search returns to normal event loading

## State Management

### Key Reactive Variables
```javascript
const isLoadingMore = ref<boolean>(false);      // Prevents duplicate requests
const hasMoreEvents = ref<boolean>(true);       // Whether more events exist
const allEvents = ref<KillEvent[]>([]);         // Main events array
const searchResults = ref<KillEvent[]>([]);     // Search-specific results
const isUsingSearch = ref<boolean>(false);      // Current mode flag
```

### Loading States
- **Initial Load**: `loadKillEvents()` on component mount
- **Infinite Scroll**: `loadMoreEvents()` triggered by scroll detection
- **Search Mode**: `searchEvents()` with debounced input
- **Search Pagination**: `loadMoreEvents()` with search offset

## Performance Considerations

### Throttling
```javascript
const scrollThrottleMs = 100; // Limit scroll event processing
const lastScrollTime = ref<number>(0);

if (now - lastScrollTime.value < scrollThrottleMs) {
  return; // Skip this scroll event
}
```

### Memory Management
- Events are loaded in chunks of 25
- EventStore manages memory vs. database storage
- Old events are moved to database storage when memory limits are reached

### Event Deduplication
```javascript
const newEventIds = new Set(allEvents.value.map(e => e.id));
const uniqueNewEvents = results.events.filter(e => !newEventIds.has(e.id));
```

## Debugging Features

### Visual Indicators
- Green border: Scroll detection ready
- Yellow border: Scroll detection not ready
- Loading spinner: Events being loaded

### Debug Tools
- Test buttons to manually trigger loading
- Scroll state logging to main process
- Container dimension monitoring
- Real-time scroll position tracking

## Best Practices Learned

1. **Never assume DOM elements are available in `onMounted`**
   - Use retry logic for critical DOM interactions
   - Validate element existence before accessing

2. **Implement comprehensive event debugging**
   - Test wheel events, touch events, and scroll events separately
   - Log to main process for Electron apps

3. **Make scroll containers focusable**
   - Use `tabindex="0"` for proper event handling
   - Remove outline with CSS for better UX

4. **Use progressive delays for DOM timing issues**
   - First retry: 100ms, second: 200ms, etc.
   - Handles various loading scenarios gracefully

5. **Validate scroll detection thoroughly**
   - Test both percentage and pixel-based triggers
   - Account for different screen sizes and content heights

## Common Issues and Solutions

### Issue: Scroll events not firing
**Solution**: Ensure element has `tabindex="0"` and implement retry logic for listener attachment

### Issue: Double loading of events
**Solution**: Implement proper loading state management with `isLoadingMore` flag

### Issue: Events not appearing at bottom
**Solution**: Check `hasMoreEvents` flag and EventStore pagination logic

### Issue: Performance problems with many events
**Solution**: Use EventStore memory management and implement proper throttling

This implementation provides a robust, user-friendly infinite scroll experience that handles the complexities of Vue timing, Electron IPC, and event management.