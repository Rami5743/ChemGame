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

// The two at the head listen on 443, the port a network that closes
// everything else still leaves open; the rest listen on ports of their own,
// which a strict network is likely to shut. A name and a word may be written
// into the address, as the one at shiftr.io asks for.
export const BROKERS = [
  'wss://mqtt.eclipseprojects.io/mqtt',
  'wss://public:public@public.cloud.shiftr.io',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

// ?broker=... takes one address, or several separated by commas.
export function brokerList() {
  const chosen = new URLSearchParams(location.search).get('broker');
  if (!chosen) return BROKERS;
  return chosen.split(',').map((u) => u.trim()).filter(Boolean);
}

// A broker that wants a name and a word takes them from the address itself,
// the way a browser does: wss://name:word@host/path. They are taken out of
// the address and handed over on their own, since not every client library
// reads them from there.
export function credentials(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return { url };
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    parsed.username = '';
    parsed.password = '';
    return { url: parsed.toString(), username, password };
  } catch {
    return { url };
  }
}

// What the diagnostic shows for a broker: the address without the word.
export function shownAs(url) {
  const { url: bare, username } = credentials(url);
  return username ? `${username}@${bare.replace(/^wss?:\/\//, '')}` : bare;
}

export function createBus({ url, room, clientId, isHost, onMessage, onStatus }) {
  const base = `chemgame/1/${room}`;
  const topics = [`${base}/state`, `${base}/p/${clientId}`];
  if (isHost) topics.push(`${base}/act`);

  const who = credentials(url);
  const client = mqtt.connect(who.url, {
    clientId: `cg_${clientId}_${Math.random().toString(36).slice(2, 8)}`,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    ...(who.username ? { username: who.username, password: who.password } : {}),
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
