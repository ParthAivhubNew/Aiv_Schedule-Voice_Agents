export class WebSocketClient {
  constructor(url, onMessage, onOpen, onClose) {
    this.url = url || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/live`;
    this.onMessage = onMessage;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.socket = null;
    this.reconnectTimer = null;
    this.connect();
  }

  connect() {
    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        console.log('[WS] Connected to live event stream');
        if (this.onOpen) this.onOpen();
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (this.onMessage) this.onMessage(data);
        } catch (e) {
          console.warn('[WS] Received non-JSON payload:', event.data);
        }
      };

      this.socket.onclose = () => {
        console.log('[WS] Disconnected. Reconnecting in 3s...');
        if (this.onClose) this.onClose();
        this.scheduleReconnect();
      };

      this.socket.onerror = (err) => {
        console.error('[WS] Error:', err);
        this.socket.close();
      };
    } catch (err) {
      console.error('[WS] Connect error:', err);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 3000);
  }

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) this.socket.close();
  }
}
