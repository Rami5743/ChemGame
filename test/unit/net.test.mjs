// The address of a message server, and what is read out of it.
import { BROKERS, credentials, shownAs } from '../../js/net.js';

export default async function run({ check }) {
  check('the list starts with the two that listen on 443',
    BROKERS.slice(0, 2).every((u) => !/:\d+\//.test(u.replace('wss://', ''))),
    BROKERS.slice(0, 2).join(' '));
  check('and holds a few more on ports of their own', BROKERS.length >= 4);

  const plain = credentials('wss://mqtt.eclipseprojects.io/mqtt');
  check('an address with nobody named is left as it is',
    plain.url === 'wss://mqtt.eclipseprojects.io/mqtt' && !plain.username);

  const named = credentials('wss://public:public@public.cloud.shiftr.io');
  check('a name and a word are taken out of the address',
    named.username === 'public' && named.password === 'public', JSON.stringify(named));
  check('and the address handed on no longer carries them',
    !named.url.includes('public:public@'), named.url);

  const odd = credentials('wss://a%40b:p%2Fw@host/mqtt');
  check('both are unescaped, so a name may hold any character',
    odd.username === 'a@b' && odd.password === 'p/w', JSON.stringify(odd));

  check('what is shown of an address never holds the word',
    !shownAs('wss://public:secret@host/mqtt').includes('secret'),
    shownAs('wss://public:secret@host/mqtt'));
  check('but it does say who is being named',
    shownAs('wss://public:secret@host/mqtt').startsWith('public@'));
  check('an address with nobody named is shown whole',
    shownAs('ws://127.0.0.1:9123/mqtt') === 'ws://127.0.0.1:9123/mqtt');

  check('nothing is thrown at an address that makes no sense',
    credentials('not an address').url === 'not an address');
}
