
# Server Communication

This document explains how the `log-monitor-client` communicates with the `log-monitor-server` using WebSockets. The core logic for this is handled by the `server-connection.ts` module.

## 1. WebSocket Connection (`socket.io-client`)

The client uses the `socket.io-client` library to establish and maintain a persistent WebSocket connection to the server. This connection is used for sending log data and receiving real-time updates.

### a. Connection Management

*   **`connectToServer()`**: This function initializes the WebSocket connection. It determines whether to use a user's access token or a guest token for authentication and includes it in the handshake.
*   **`disconnectFromServer()`**: This function gracefully disconnects the WebSocket.
*   **Reconnection Logic**: The module includes a custom reconnection strategy with an exponential backoff delay. If the connection is lost, it will automatically try to reconnect at increasing intervals.

### b. Authentication

Authentication is handled during the initial WebSocket handshake. The client sends either an access token or a guest token. The server validates the token and, if successful, sends an `authenticated` event back to the client. The client will not send any sensitive data until it has received this confirmation.

If authentication fails, or if the token expires, the server will send a `retry_auth` event, prompting the client to attempt a token refresh and reconnect.

## 2. Data Transmission

### a. Sending Log Chunks

*   **`ensureConnectedAndSendLogChunk()`**: This is the primary function for sending log data. It ensures that the client is both connected and authenticated before sending the data.
*   **Buffering**: If the client is offline or not yet authenticated, log chunks are buffered in memory. Once the connection is established and authenticated, the `flushLogBuffer()` function sends all the buffered chunks to the server.
*   **Payload**: Each log chunk is sent with the client's persistent ID, allowing the server to associate the data with the correct client instance.

### b. Receiving Events

The client listens for several events from the server:

*   **`authenticated`**: Confirms that the WebSocket connection is authenticated.
*   **`guestToken`**: Provides a new guest token if the client connected without a valid user token.
*   **`retry_auth`**: Instructs the client to refresh its authentication token and reconnect.

## 3. Status Updates

The `sendConnectionStatus()` function is used to broadcast the connection status to all renderer windows. This allows the UI to display the current connection state (e.g., 'connecting', 'connected', 'disconnected') to the user.
