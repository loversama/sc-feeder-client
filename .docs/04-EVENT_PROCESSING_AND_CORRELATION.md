
# Event Processing and Correlation

This document details the process that occurs after a raw log line has been parsed into a partial event object. The `event-processor.ts` module takes this partial data, enriches it, and performs correlation with other events to create a complete and accurate picture of the in-game action.

## 1. Event Processing (`event-processor.ts`)

The `processKillEvent()` function is the main entry point for this module. It takes a partial `KillEvent` object and performs the following steps:

### a. Data Enrichment

1.  **RSI Profile Data:** If the event involves players, the processor fetches their RSI profile data using the `rsi-scraper.ts` module. This includes the player's enlisted date, RSI record number, organization affiliation, and profile picture URL.
2.  **Entity Name Resolution:** The processor uses the `definitionsService.ts` to resolve the technical names of entities (e.g., ships, weapons) into their user-friendly, readable names.

### b. Event Correlation

The `correlateDeathWithDestruction()` function attempts to correlate a player death event (from a corpse log) with a recent vehicle destruction event. This is necessary because the game logs these events separately. The correlation is performed based on the timestamp and the player's name.

### c. Description Formatting

The `formatKillEventDescription()` function creates a human-readable description of the event based on the event type, killers, victims, and other data. This description is what is displayed in the client's kill feed.

### d. State Management

The `addOrUpdateEvent()` function adds the new or updated event to the in-memory `killEvents` and `globalKillEvents` arrays. It also sends an IPC message to the renderer process to update the kill feed UI.

## 2. CSV Logging (`csv-logger.ts`)

The `csv-logger.ts` module is responsible for logging kill events to a local CSV file. This provides a persistent record of the user's combat activity.

### a. CSV Formatting

The `logKillToCsv()` function takes a `KillEvent` object and formats it into a CSV row. It escapes any special characters to ensure the CSV is well-formed.

### b. File I/O

The module handles the creation and appending of the CSV file. It will create the file with a header row if it doesn't exist, and it will append new rows for each subsequent kill event.

### c. Historic Tally

The `loadHistoricKillTally()` function reads the CSV file and calculates the number of kills for the current month. This tally is displayed in the client's UI.

## 3. Data Flow Summary

1.  The **`event-processor`** receives a partial `KillEvent` from the **`log-parser`**.
2.  The processor enriches the event with RSI profile data and resolves entity names.
3.  The processor attempts to correlate the event with other recent events.
4.  A human-readable description is generated for the event.
5.  The event is added to the in-memory event lists and sent to the UI for display.
6.  The event is logged to the local CSV file by the **`csv-logger`**.
