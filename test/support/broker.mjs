// A local MQTT broker over WebSocket, so the tests never touch a public one.
import { Aedes } from 'aedes';
import { createServer } from 'aedes-server-factory';

export async function startBroker(port) {
  const broker = new Aedes();
  await broker.listen();
  const server = createServer(broker, { ws: true });
  await new Promise((res) => server.listen(port, '127.0.0.1', res));
  return {
    url: `ws://127.0.0.1:${port}/mqtt`,
    async close() {
      // A websocket that is still up would hold server.close() open for ever.
      server.closeAllConnections?.();
      await Promise.race([
        new Promise((res) => server.close(res)),
        new Promise((res) => setTimeout(res, 3000)),
      ]);
      await Promise.race([
        new Promise((res) => broker.close(res)),
        new Promise((res) => setTimeout(res, 3000)),
      ]);
    },
  };
}
