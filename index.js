const url = require('url');
const http = require('http');
const WebSocket = require('ws');

class ProxyServer {
  constructor() {
    this.server = null;
    this.sessions = {};
  }

  listen(port, host) {
    port = parseInt(port);
    this.server = new WebSocket.Server({ host, port });
    this.server.on('connection', this.onServerConnection);
  }

  onServerConnection = (frontend, incomingMessage) => {
    frontend._socket.pause();
    const parsedUrl = url.parse(incomingMessage.url, true);

    const id = parsedUrl.pathname.slice(1);

    this.closeSession(id);
    const session = { frontend, backend: null };
    this.sessions[id] = session;
    this.getBackendUuid(id);
  };

  getBackendUuid(id) {
    const url = `http://192.168.1.39:${id}/json`;
    http
      .get(url, (resp) => {
        let rawData = '';
        resp.on('data', (chunk) => (rawData += chunk));
        resp.on('end', () => {
          const infos = JSON.parse(rawData);
          const count = infos.length;
          if (count > 1) {
            const msg = `Error: ${count} debuggerUrls on this port`;
            console.error(msg);
            this.closeSession(id);
            return;
          }

          const info = infos[0];
          const debuggerUrl = info.webSocketDebuggerUrl;
          if (!debuggerUrl) {
            const wsUrl = `ws://192.168.1.39:${id}/${info.id}`;
            const msg = `Error: a devTools has connected to ${wsUrl}`;
            console.error(msg);
            this.closeSession(id);
            return;
          }

          this.initBackend(id, debuggerUrl);
        });
      })
      .on('error', (e) => {
        console.error(`Error: ${e.message}`);
        this.closeSession(id);
      });
  }

  startSession(id) {
    const session = this.sessions[id];
    session.frontend.on('message', this.onFrontendMessage(id));
    session.backend.on('message', this.onBackendMessage(id));
    session.frontend.on('close', this.onFrontendClose(id));
    session.backend.on('close', this.onBackendClose(id));
    session.frontend._socket.resume();
    session.backend._socket.resume();
  }

  closeSession(id) {
    const session = this.sessions[id];
    if (!session) {
      return;
    }
    if (session.frontend) {
      session.frontend.close();
    }
    if (session.backend) {
      session.backend.close();
    }
    delete this.sessions[id];
  }

  onFrontendClose = (id) => () => {
    this.closeSession(id);
  };

  onBackendClose = (id) => () => {
    this.closeSession(id);
  };

  onFrontendMessage = (id) => (data) => {
    const session = this.sessions[id];
    if (session.backend) {
      session.backend.send(data);
    }
  };

  onBackendMessage = (id) => (data) => {
    const session = this.sessions[id];
    if (session.frontend) {
      session.frontend.send(data);
    }
  };

  initBackend(id, url) {
    const backend = new WebSocket(url);
    backend.on('open', () => {
      backend._socket.pause();
      const session = this.sessions[id];
      if (session) {
        session.backend = backend;
        this.startSession(id);
      } else {
        backend.close();
      }
    });
  }
}

const address = process.argv[2] || '192.168.1.39:9230';
const [host, port] = address.split(':');
const server = new ProxyServer();

console.info(`
Debugger Proxy listening on port ${port}.
To start debugging, open the following URL in Chrome:

devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&ws=192.168.1.39:${port}/\${inspect-port}

The suffix of the URL "\${inspect-port}" is the port which you want to proxy.
`);

server.listen(port, host);
