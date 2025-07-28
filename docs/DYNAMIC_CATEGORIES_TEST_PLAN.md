# Dynamic Event Categories - Test Plan

## Overview
This document outlines the test plan for the dynamic event categories feature in the log-monitor-client application.

## Feature Description
The dynamic event categories system allows the server to send event categories (e.g., "org event", "proximity event") with events. The client dynamically discovers these categories and allows users to filter events by them without hardcoding category types.

## Test Scenarios

### 1. Category Discovery
**Test Steps:**
1. Start the application
2. Connect to the server
3. Receive events with different categories from the server

**Expected Results:**
- Categories are automatically discovered and stored in the config
- Category count is tracked and updated
- Categories appear in the filter dropdown

**Verification:**
- Check `discoveredCategories` in electron-store config
- Verify UI shows all discovered categories

### 2. Category Filtering
**Test Steps:**
1. Open the KillFeed view
2. Click the "Categories" button (shows when categories are discovered)
3. Select one or more categories
4. Observe the event list

**Expected Results:**
- Only events matching selected categories are shown
- "Uncategorized" option filters events without categories
- Event count updates based on filter

### 3. Filter Persistence
**Test Steps:**
1. Select specific categories in the filter
2. Restart the application
3. Check the filter state

**Expected Results:**
- Selected categories remain checked after restart
- Events are filtered according to saved preferences
- Category selections persist in config store

### 4. Server Event Categories
**Test Steps:**
1. Configure server to send events with category metadata:
```json
{
  "id": "event_123",
  "type": "PLAYER_KILL",
  "category": {
    "id": "org_event",
    "name": "Organization Event",
    "icon": "🏢",
    "color": "#FF6B6B",
    "priority": 1
  }
}
```

**Expected Results:**
- Category is extracted and stored
- Event displays with category metadata
- Category appears in filter options

### 5. Multiple Category Selection
**Test Steps:**
1. Select multiple categories in the filter
2. Verify event filtering logic (OR operation)
3. Clear all filters using "Clear All" link

**Expected Results:**
- Events from ANY selected category are shown
- Clear All resets to show all events
- UI updates to reflect selection state

### 6. UI/UX Testing
**Test Elements:**
- Category button shows count of selected filters
- Button changes to primary color when filters active
- Popover displays categories with counts
- Icons and colors display correctly
- Checkbox interactions work smoothly

### 7. Edge Cases
**Test Scenarios:**
1. No categories discovered - filter button should not appear
2. Very long category names - UI should handle gracefully
3. Many categories (20+) - scrollable list should work
4. Category with no events - should still appear in list
5. Rapid category toggling - no UI glitches

## Implementation Verification

### Code Components to Verify:
1. **Types** (`shared/types.ts`):
   - `EventCategory` interface exists
   - `KillEvent.metadata.category` field exists

2. **Config Store** (`electron/modules/config-manager.ts`):
   - `discoveredCategories` schema defined
   - `selectedCategoryFilters` schema defined
   - CRUD methods implemented

3. **Server Connection** (`electron/modules/server-connection.ts`):
   - Category extraction from server events
   - `addDiscoveredCategory` called on new categories

4. **Event Processor** (`electron/modules/event-processor.ts`):
   - Category metadata preserved in events
   - Category discovery triggered

5. **IPC Handlers** (`electron/enhanced-ipc-handlers.ts`):
   - All category config handlers implemented
   - Proper error handling

6. **Frontend** (`src/components/KillFeed.vue`):
   - Category filter UI renders correctly
   - Filter logic in `currentEvents` computed
   - Persistence methods called on mount

## Testing Commands

### Manual Testing:
1. Start the application: `npm run dev`
2. Connect to a test server that sends categorized events
3. Perform the test scenarios above

### Debugging:
- Check browser console for category-related logs
- Inspect electron-store config file for persisted data
- Use Chrome DevTools to verify UI state

## Success Criteria
- [ ] Categories are discovered dynamically from server events
- [ ] Users can filter events by multiple categories
- [ ] Filter selections persist across app restarts
- [ ] UI provides clear feedback on active filters
- [ ] No hardcoded category types in the client code
- [ ] Performance remains smooth with many categories

## Notes
- The "uncategorized" option is a special client-side filter
- Categories are stored with metadata (icon, color, priority)
- The system is designed to handle unknown categories gracefully