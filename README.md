# VOIDLOG.GG - Log Monitor Client

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/loversama/sc-feeder-client?style=flat-square)](https://github.com/loversama/sc-feeder-client/releases/latest)
[![License](https://img.shields.io/github/license/loversama/sc-feeder-client?style=flat-square)](LICENSE) <!-- Add a LICENSE file if applicable -->

**VOIDLOG.GG** is a desktop application designed to monitor your Star Citizen `Game.log` file in real-time. It automatically detects and processes in-game events such as kills, deaths, vehicle destructions, and more.

![VOIDLOG.GG Screenshot](placeholder.png) <!-- Replace placeholder.png with an actual screenshot path/URL if available -->

## Features

*   **Real-time Log Monitoring:** Automatically detects your Star Citizen log file location (or allows manual selection) and watches for changes.
*   **Event Feed:** Displays a live feed of detected events, including kills, deaths (combat, environmental, crashes), and vehicle destructions.
*   **Player/Global View:** Toggle between viewing only events involving you or seeing all detected events.
*   **Event Details:** Click on an event to view detailed information, including involved players/ships and potentially RSI profile data (if enabled).
*   **Server Integration:** Securely uploads processed events to the central VOIDLOG.GG server to populate leaderboards and player statistics on the companion website.
*   **Session Tracking:** Automatically detects new game sessions.
*   **Notifications:** Provides optional desktop notifications for significant events involving your player.
*   **Auto-Updates:** Automatically checks for and installs updates when new releases are published.

## Getting Started

### Recommended Method: Download Installer

The easiest way to get started is to download the latest installer for your operating system from the **[GitHub Releases](https://github.com/loversama/sc-feeder-client/releases/latest)** page.

Installers are available for:

*   Windows (`.exe`)
*   macOS (`.dmg`)
*   Linux (`.AppImage`)

Download the appropriate file, run the installer, and launch the application. The app will guide you through locating your `Game.log` file if needed.

### Building from Source

If you prefer to build the application yourself, follow these steps:

**Prerequisites:**

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) (usually included with Node.js)
*   [Git](https://git-scm.com/)

**Steps:**

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/loversama/sc-feeder-client.git
    cd sc-feeder-client/log-monitor-client
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Build the application:**
    *   **For Development (Run locally without packaging):**
        ```bash
        npm run dev
        ```
    *   **For Production (Build installers):**
        *   Windows: `npm run build:win`
        *   macOS: `npm run build:mac`
        *   Linux: `npm run build:linux`

    The built installers will be located in the `log-monitor-client/release/<version>` directory.

## Configuration

The application settings can be accessed via the gear icon (⚙️) in the main window. Here you can:

*   Verify or change the path to your `Game.log` file.
*   Configure API settings for connecting to the VOIDLOG.GG server (URL and optional API Key).
*   Enable/disable desktop notifications.
*   Enable/disable automatic fetching of RSI profile data.
*   Manage CSV logging options.
*   And more...

## How it Works

The client application uses Electron, Vue.js, and TypeScript.

1.  It monitors the `Game.log` file specified in the settings.
2.  New log lines are parsed using regular expressions to identify key game events.
3.  Events are processed, correlated (e.g., linking vehicle destruction to player death logs), and enriched with data (like player ship, game version).
4.  (Optional) RSI profile data for involved players is fetched via scraping.
5.  Processed events are displayed in the user interface (the event feed).
6.  Events are securely sent to the configured backend API server for aggregation.
7.  (Optional) Events are logged locally to a CSV file.

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request. (Add contribution guidelines if desired).

## License

(Specify license details here if applicable, e.g., MIT License. Create a LICENSE file.)
