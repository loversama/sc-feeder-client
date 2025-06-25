
# Log Processing and Event Parsing

This document provides a detailed explanation of how the `log-monitor-client` monitors the Star Citizen `Game.log` file, parses events from the raw log data, and prepares them for further processing.

## 1. Log Monitoring (`log-watcher.ts`)

The core of the log monitoring functionality resides in the `log-watcher.ts` module. It is responsible for detecting changes to the `Game.log` file and reading the new content.

### Key Technologies

*   **`chokidar`**: A library that provides a more reliable and efficient way to watch for file system changes compared to the native `fs.watch`.

### Workflow

1.  **`startWatchingLogFile()`**: This function is the entry point for the log monitoring process. It retrieves the configured log file path from the `config-manager` and initializes a `chokidar` watcher.
2.  **Initial Read**: When the watcher is initialized, it performs an initial read of the entire log file. This is done to process any existing events that may have occurred before the client was started. This initial read is performed in "silent mode" to avoid sending notifications for old events.
3.  **File Change Detection**: The `chokidar` watcher monitors the log file for changes. When a change is detected, the `_readNewLogContent()` function is called to read the new content.
4.  **Content Reading**: The `_readNewLogContent()` function reads the new content from the log file based on the last read size. It handles cases where the file has been truncated or replaced, and it will reset the read position accordingly.
5.  **Content Parsing**: The new content is then passed to the `parseLogContent()` function in the `log-parser.ts` module for processing.

## 2. Event Parsing (`log-parser.ts`)

The `log-parser.ts` module is responsible for parsing the raw log lines and converting them into structured `KillEvent` objects. It uses a series of regular expressions to identify and extract data from the log lines.

### Key Regular Expressions

The module defines a set of regular expressions to match different types of events, including:

*   `loginRegex`, `legacyLoginRegex`: Detects player logins.
*   `sessionStartRegex`: Detects the start of a new game session.
*   `puModeRegex`, `acModeRegex`, `frontendModeRegex`: Detects changes in the game mode.
*   `vehicleDestructionRegex`: Detects vehicle destructions.
*   `corpseLogRegex`: Detects player deaths.
*   `killPatternRegex`: Detects detailed combat kills.
*   `environmentDeathRegex`: Detects environmental deaths.

### Workflow

1.  **`parseLogContent()`**: This function receives the new log content from the `log-watcher` and splits it into individual lines.
2.  **Line-by-Line Processing**: Each line is then matched against the defined regular expressions.
3.  **Event Creation**: When a match is found, the relevant data is extracted from the log line and used to create a partial `KillEvent` object.
4.  **Event Processing**: The partial `KillEvent` object is then passed to the `processKillEvent()` function in the `event-processor.ts` module for further processing, including data enrichment and correlation.

## 3. Data Flow Summary

1.  The **`log-watcher`** detects a change in the `Game.log` file.
2.  The new content is read and passed to the **`log-parser`**.
3.  The **`log-parser`** identifies an event and creates a partial `KillEvent` object.
4.  The partial event is sent to the **`event-processor`** for enrichment and correlation.
5.  The processed event is then sent to the **`log-monitor-server`** via a WebSocket connection.
