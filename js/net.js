// Transport. Every message of a room goes through a public MQTT broker over
// WebSocket, so the site itself stays a passive static page.
//
// Topics, all under chemgame/1/<room>/ :
//   state      host -> everyone, retained, the full public snapshot
//   act        player -> host, actions (hello, play, bye)
//   p/<id>     host -> one player, retained, that player's own hand
//
// ?broker=wss://host:port/path overrides the list, for a self-hosted broker.
//
// Several public brokers, because a network that blocks one of these ports
// blocks the game. The host holds a connection to every broker it can reach
// and repeats everything on all of them, so a player needs only one broker in
// common with the host. The first in the list listens on 443, which is the
// port a restrictive network is least likely to close.

export const BROKERS = [
  'wss://mqtt.eclipseprojects.io/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

export function brokerList() {
  const chosen = new URLSearchParams(location.search).get('broker');
  return chosen ? [chosen] : BROKERS;
}

export function createBus({ url, room, clientId, isHost, onMessage, onStatus }) {
  const base = `chemgame/1/${room}`;
  const topics = [`${base}/state`, `${base}/p/${clientId}`];
  if (isHost) topics.push(`${base}/act`);

  const client = mqtt.connect(url, {
    clientId: `cg_${clientId}_${Math.random().toString(36).slice(2, 8)}`,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
  });

  client.on('connect', () => {
    client.subscribe(topics, { qos: 0 }, (err) => {
      onStatus(err ? 'err' : 'on');
    });
  });
  client.on('reconnect', () => onStatus('wait'));
  client.on('close', () => onStatus('wait'));
  client.on('error', () => onStatus('err'));

  client.on('message', (topic, payload) => {
    const text = payload.toString();
    if (!text) return; // an empty retained message is a clear, not data
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    onMessage(topic.slice(base.length + 1), msg);
  });

  const pub = (sub, obj, retain) =>
    client.publish(`${base}/${sub}`, JSON.stringify(obj), { qos: 0, retain: !!retain });

  return {
    url,
    act: (obj) => pub('act', obj, false),
    state: (obj) => pub('state', obj, true),
    toPlayer: (id, obj, retain = true) => pub(`p/${id}`, obj, retain),
    clearPlayer: (id) => client.publish(`${base}/p/${id}`, '', { qos: 0, retain: true }),
    clearState: () => client.publish(`${base}/state`, '', { qos: 0, retain: true }),
    stop: () => client.end(true),
  };
}
