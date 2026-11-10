// Every word the game says, in both languages. The chosen language lives in
// ?lang= and in localStorage. Switching does not reload the page: the words
// are replaced where they stand, so a game going on goes on — a reload would
// cost the host his game.

export const LANGS = ['he', 'en'];
export const DIR = { he: 'rtl', en: 'ltr' };

export function storedLang() {
  const asked = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(asked)) return asked;
  try {
    const kept = localStorage.getItem('cg_lang');
    if (LANGS.includes(kept)) return kept;
  } catch { /* a browser that forbids storage still gets a language */ }
  return 'he';
}

let LANG = storedLang();
export const lang = () => LANG;

// Whoever has words on the screen says so here, and is called after a switch.
const watchers = new Set();
export const onLang = (fn) => watchers.add(fn);

export function setLang(next) {
  if (!LANGS.includes(next) || next === LANG) return;
  LANG = next;
  try { localStorage.setItem('cg_lang', next); } catch { /* ignore */ }
  const url = new URL(location.href);
  url.searchParams.set('lang', next);
  history.replaceState(null, '', url);
  applyStaticWords();
  for (const fn of watchers) fn(next);
}

const WORDS = {
  he: {
    'status.on': 'מחובר',
    'status.wait': 'מתחבר',
    'status.err': 'תקלת חיבור',
    'status.off': 'מנותק',

    'nav.rules': 'חוקי המשחק',
    'nav.facts': 'על הקלפים',
    'nav.factsLong': 'הפיזיקה, הכימיה והביולוגיה שמאחורי הקלפים',
    'nav.buyLead': 'אפשר גם לקנות את',
    'nav.buy': 'המשחק בגרסה מודפסת',
    'nav.buyShort': 'הגרסה המודפסת',
    'nav.he': 'עברית',
    'nav.en': 'אנגלית',

    'entry.newTitle': 'משחק חדש',
    'entry.joinTitle': 'הצטרפות למשחק',
    'entry.nameLabel': 'השם שלך, אם בא לך',
    'entry.namePh': 'אפשר להשאיר ריק',
    'entry.create': 'צור משחק',
    'entry.join': 'הצטרף',
    'entry.fresh': 'פתח משחק חדש במקום',

    'lobby.title': 'חדר המתנה',
    'lobby.linkLabel': 'הקישור למשחק',
    'lobby.copy': 'העתק',
    'lobby.copied': 'הועתק',
    'lobby.share': 'שלח את הקישור לכל מי שאתה רוצה שישחק.',
    'lobby.players': 'שחקנים',
    'lobby.atomsPer': 'קלפי אטום לכל שחקן',
    'lobby.molsPer': 'קלפי מולקולה לכל שחקן',
    'lobby.start': 'התחל משחק',
    'lobby.startNext': 'התחל משחק נוסף',
    'lobby.noSpecials': 'בלי הקלפים המיוחדים',
    'lobby.withoutSpecials': 'קלף ההיתוך הגרעיני וקלף האלקאנים אינם במשחק הזה.',
    'lobby.orderNote': 'הסדר ברשימה הוא סדר התורות. עם ההתחלה החדר ננעל.',
    'lobby.hostWaiting': 'ממתין לשחקנים. אתה המארח.',
    'lobby.drag': 'גרור כדי לשנות את סדר המשחק',
    'lobby.addBot': 'הוסף רובוט',
    'lobby.dropBot': 'הסר את הרובוט',
    'lobby.dropPlayer': 'הסר את השחקן',
    'lobby.dropped': 'המארח הוציא אותך מהחדר. אפשר לפתוח משחק משלך.',
    'lobby.playRobots': 'פתח משחק משלך ושחק מול רובוטים',
    'lobby.botName': 'שם הרובוט',
    'lobby.guestWaiting': 'ממתין שהמארח יתחיל את המשחק.',
    'lobby.connecting': 'מתחבר לשרת ההודעות…',
    'lobby.deal': 'לכל שחקן יחולקו: {atoms} קלפי אטום, {molecules} קלפי מולקולה.',
    'lobby.needTwo': 'צריך לפחות שני שחקנים כדי להתחיל.',
    'lobby.noHost': 'לא נמצא מארח לחדר הזה. ייתכן שהמארח סגר את הדף, או שהקישור אינו נכון.',
    'lobby.tooManyAtoms': 'אין מספיק קלפי אטום בחפיסה. יש {deck}, ולכן לכל היותר {max} לכל שחקן.',
    'lobby.tooManyMols': 'אין מספיק קלפי מולקולה בחפיסה. יש {deck}, ולכן לכל היותר {max} לכל שחקן.',

    'seat.name': 'שחקן {n}',
    'seat.you': 'אתה',
    'seat.host': 'מארח',
    'seat.offline': 'מנותק',
    'seat.counts': 'קלפי אטום · קלפי מולקולה',

    'game.area': 'אזור המשחק',
    'view.shape': 'נוסחת מבנה',
    'view.formula': 'נוסחת מולקולה',
    'game.yourCards': 'הקלפים שלך',
    'game.seatOrder': 'סדר השחקנים',
    'game.spectator': 'המשחק כבר התחיל והחדר נעול. אתה צופה בלבד.',
    'game.youWon': 'ניצחת.',
    'game.someoneWon': '{name} ניצח.',
    'game.waitingFor': 'ממתינים ל{name}.',
    'game.noMolecule': 'אין מולקולה על השולחן.',
    'game.takeBack': 'קח בחזרה',
    'game.somebody': 'שחקן',
    'game.missing': 'חסר {el}',

    'prompt.opening': 'תורך לפתוח מולקולה, או למשוך חמישה קלפים ולבחור אחד.',
    'prompt.building': 'תורך.',
    'prompt.picking': 'בחר קלף אחד מתוך החמישה.',
    'prompt.takeback': 'אתה יכול לקחת קלף חזרה או לוותר על זה.',
    'step.moleculeOpen': 'בחר מהיד את קלף המולקולה שתרצה לפתוח בה.',
    'step.moleculeSwap': 'בחר מהיד את קלף המולקולה שיחליף את זו שעל השולחן.',
    'step.place': 'תורך. בחר קלף אטום והוא יונח.',
    'step.withMolecule': 'בחר קלף אטום, והמהלך ייעשה.',
    'step.alkane': 'הכרז על מספר אטומי הפחמן, ואז בחר קלף אטום.',
    'step.fusing': 'בחר קלפי אטומים להיתוך.',
    'step.table': 'אתה יכול לקחת קלף חזרה או לוותר על זה.',

    'act.open': 'פתח מולקולה',
    'act.fiveMolecules': 'בחר מולקולה',
    'act.fiveAtoms': 'בחר אטום',
    'act.place': 'הנח',
    'act.swap': 'החלף מולקולה',
    'act.draw': 'משוך קלף אטום',
    'act.pass': 'ויתור על התור',
    'act.takeNothing': 'לא לקחת כלום',
    'act.confirm': 'אשר',
    'act.cancel': 'בטל',
    'act.again': 'משחק חדש, אותם שחקנים',
    'act.room': 'חזרה לחדר ההמתנה',
    'field.carbons': 'אטומי פחמן',

    'score.title': 'ניצחונות בחדר הזה:',

    'deck.atoms': 'קופת אטומים',
    'deck.atomsUsed': 'אטומים משומשים',
    'deck.molecules': 'קופת מולקולות',
    'deck.moleculesUsed': 'מולקולות משומשות',
    'deck.empty': 'ריקה',

    'overlay.pickAtom': 'בחר קלף אטום אחד מתוך החמישה. השאר יושלכו.',
    'overlay.pickMolecule': 'בחר קלף מולקולה אחד מתוך החמישה. השאר יושלכו.',

    'alert.hostGone': 'המארח אינו מחובר. המשחק ממתין לו, או שאפשר לפתוח משחק חדש.',
    'alert.noBroker':
      'לא הצלחתי להגיע לאף שרת הודעות מהרשת הזאת. רשת של מוסד או של מקום עבודה ' +
      'חוסמת לרוב את כל היציאה חוץ מגלישה רגילה. לחיצה על הכיתוב "מנותק" ' +
      'שלמעלה מראה מה ענה ומה לא. אפשר גם לנסות רשת אחרת, למשל לעבור מרשת ' +
      'סלולרית לרשת אלחוטית או להפך, או לצרף לכתובת ?broker= עם שרת משלך. ' +
      'בלי שרת הודעות אי אפשר להגיע למארח, אבל אפשר לפתוח כאן משחק משלך ' +
      'ולשחק מול רובוטים — לזה אין צורך ברשת בכלל.',
    'alert.noBrokerHost':
      'לא הצלחתי להגיע לאף שרת הודעות מהרשת הזאת, ולכן שחקנים אחרים אינם ' +
      'יכולים להצטרף. המשחק עצמו יושב בדף הזה, ולכן אפשר להוסיף רובוטים ' +
      'ולשחק מולם כאן גם בלי רשת. רשת של מוסד או של מקום עבודה חוסמת לרוב ' +
      'את כל היציאה חוץ מגלישה רגילה. לחיצה על הכיתוב שלמעלה מראה מה ענה ' +
      'ומה לא, ואפשר לנסות רשת אחרת או לצרף לכתובת ?broker= עם שרת משלך.',
    'links.title': 'החיבור לשרתי ההודעות:',
    'links.on': 'מחובר',
    'links.wait': 'מנסה',
    'links.err': 'נכשל',
    'links.dead': 'לא ענה',
    'links.none': 'אין חיבור לאף שרת הודעות',

    'move.noAnswer': 'אין תשובה מהמארח',

    'err.gameOver': 'המשחק נגמר',
    'err.waitingTakeback': 'ממתינים להחזרת קלפים',
    'err.notYourTurn': 'לא תורך',
    'err.unknownMove': 'מהלך לא מוכר',
    'err.cannotOpenNow': 'אי אפשר לפתוח מולקולה עכשיו',
    'err.moleculeNotInHand': 'קלף המולקולה אינו בידך',
    'err.declareCarbons': 'צריך להכריז על מספר אטומי פחמן בין {min} ל {max}',
    'err.fiveOnlyAtStart': 'אפשר למשוך חמישה רק בתחילת מולקולה',
    'err.deckEmpty': 'הקופה והערמה ריקות',
    'err.nothingToPick': 'אין מה לבחור',
    'err.notAmongFive': 'הקלף אינו בין החמישה',
    'err.noMoleculeOnTable': 'אין מולקולה על השולחן',
    'err.noMoleculeToSwap': 'אין מולקולה להחליף',
    'err.tableDoesNotFitNew': 'האטומים שכבר על השולחן אינם משתלבים במולקולה החדשה',
    'err.cannotDrawNow': 'אי אפשר למשוך עכשיו',
    'err.atomDeckEmpty': 'קופת האטומים והערמה ריקות',
    'err.cannotPassNow': 'אי אפשר לוותר על התור עכשיו',
    'err.atomsStillAvailable': 'יש עדיין קלפי אטום, אפשר למשוך',
    'err.notAContributor': 'אינך בין מי שהניחו קלפים',
    'err.notYourPlacedCard': 'הקלף אינו מהקלפים שהנחת',
    'err.cannotTakeBackFusion': 'אי אפשר לקחת בחזרה קלף היתוך גרעיני',
    'err.noCardsChosen': 'לא נבחרו קלפים',
    'err.oneFusionOnly': 'אפשר להניח רק קלף היתוך אחד בכל יחידה',
    'err.oneAtomOnly': 'אפשר להניח רק קלף אטום אחד בכל פעם',
    'err.fusionNeedsAtom': 'קלף היתוך מונח יחד עם קלף אטום אחד לפחות',
    'err.noSuchSum': 'סכום המספרים האטומיים הוא {z}, ואין במשחק אטום כזה',
    'err.sameCardTwice': 'אותו קלף נבחר פעמיים',
    'err.cardNotInHand': 'הקלף אינו בידך',
    'err.doesNotFit': '{el} אינו משתלב במולקולה שעל השולחן',
  },

  en: {
    'status.on': 'connected',
    'status.wait': 'connecting',
    'status.err': 'connection trouble',
    'status.off': 'offline',

    'nav.rules': 'Rules',
    'nav.facts': 'About the cards',
    'nav.factsLong': 'The physics, chemistry and biology behind the cards',
    'nav.buyLead': 'You can also buy',
    'nav.buy': 'the printed game',
    'nav.buyShort': 'The printed game',
    'nav.he': 'Hebrew',
    'nav.en': 'English',

    'entry.newTitle': 'New game',
    'entry.joinTitle': 'Join a game',
    'entry.nameLabel': 'Your name, if you like',
    'entry.namePh': 'you can leave this empty',
    'entry.create': 'Create a game',
    'entry.join': 'Join',
    'entry.fresh': 'Start a new game instead',

    'lobby.title': 'Waiting room',
    'lobby.linkLabel': 'The link to the game',
    'lobby.copy': 'Copy',
    'lobby.copied': 'Copied',
    'lobby.share': 'Send the link to everyone you want to play with.',
    'lobby.players': 'Players',
    'lobby.atomsPer': 'Atom cards each',
    'lobby.molsPer': 'Molecule cards each',
    'lobby.start': 'Start the game',
    'lobby.startNext': 'Start another game',
    'lobby.noSpecials': 'Without the special cards',
    'lobby.withoutSpecials': 'The nuclear fusion card and the alkanes card are out of this game.',
    'lobby.orderNote': 'The order on the list is the order of turns. Starting locks the room.',
    'lobby.hostWaiting': 'Waiting for players. You are the host.',
    'lobby.drag': 'Drag to change the order of play',
    'lobby.addBot': 'Add a robot',
    'lobby.dropBot': 'Take the robot away',
    'lobby.dropPlayer': 'Take the player out',
    'lobby.dropped': 'The host took you out of the room. You can open a game of your own.',
    'lobby.playRobots': 'Open a game of your own and play against robots',
    'lobby.botName': 'The robot\u2019s name',
    'lobby.guestWaiting': 'Waiting for the host to start.',
    'lobby.connecting': 'Connecting to the message server…',
    'lobby.deal': 'Each player is dealt {atoms} atom cards and {molecules} molecule cards.',
    'lobby.needTwo': 'Two players at least are needed to start.',
    'lobby.noHost': 'No host was found for this room. The host may have closed the page, or the link is wrong.',
    'lobby.tooManyAtoms': 'There are not enough atom cards. The deck holds {deck}, so at most {max} each.',
    'lobby.tooManyMols': 'There are not enough molecule cards. The deck holds {deck}, so at most {max} each.',

    'seat.name': 'Player {n}',
    'seat.you': 'you',
    'seat.host': 'host',
    'seat.offline': 'away',
    'seat.counts': 'atom cards · molecule cards',

    'game.area': 'The table',
    'view.shape': 'Structural formula',
    'view.formula': 'Molecular formula',
    'game.yourCards': 'Your cards',
    'game.seatOrder': 'Order of play',
    'game.spectator': 'The game has started and the room is locked. You are watching.',
    'game.youWon': 'You won.',
    'game.someoneWon': '{name} won.',
    'game.waitingFor': 'Waiting for {name}.',
    'game.noMolecule': 'No molecule on the table.',
    'game.takeBack': 'take it back',
    'game.somebody': 'a player',
    'game.missing': 'missing: {el}',

    'prompt.opening': 'Your turn to open a molecule, or to draw five cards and keep one.',
    'prompt.building': 'Your turn.',
    'prompt.picking': 'Keep one of the five.',
    'prompt.takeback': 'You can take a card back, or let it go.',
    'step.moleculeOpen': 'Choose the molecule card to open with.',
    'step.moleculeSwap': 'Choose the molecule card to put in place of the one on the table.',
    'step.place': 'Your turn. Choose an atom card and it goes down.',
    'step.withMolecule': 'Choose an atom card, and the move is made.',
    'step.alkane': 'Declare how many carbon atoms, then choose an atom card.',
    'step.fusing': 'Choose the atom cards to fuse.',
    'step.table': 'You can take a card back, or let it go.',

    'act.open': 'Open a molecule',
    'act.fiveMolecules': 'Pick a molecule',
    'act.fiveAtoms': 'Pick an atom',
    'act.place': 'Lay it',
    'act.swap': 'Swap the molecule',
    'act.draw': 'Draw an atom card',
    'act.pass': 'Pass the turn',
    'act.takeNothing': 'Take nothing',
    'act.confirm': 'Confirm',
    'act.cancel': 'Cancel',
    'act.again': 'New game, same players',
    'act.room': 'Back to the waiting room',
    'field.carbons': 'Carbon atoms',

    'score.title': 'Wins in this room:',

    'deck.atoms': 'Atom deck',
    'deck.atomsUsed': 'Atoms used',
    'deck.molecules': 'Molecule deck',
    'deck.moleculesUsed': 'Molecules used',
    'deck.empty': 'empty',

    'overlay.pickAtom': 'Keep one of these five atom cards. The rest are discarded.',
    'overlay.pickMolecule': 'Keep one of these five molecule cards. The rest are discarded.',

    'alert.hostGone': 'The host is not connected. The game is waiting, or you can start a new one.',
    'alert.noBroker':
      'No message server could be reached from this network. The network of an ' +
      'institution or a workplace usually closes everything but ordinary ' +
      'browsing. Tapping "disconnected" above shows what answered and what did ' +
      'not. You can also try another network, a mobile one instead of wireless ' +
      'or the other way round, or add ?broker= to the address with a server of ' +
      'your own. Without one there is no reaching the host, but a game of your ' +
      'own against robots can be opened right here, and that needs no network ' +
      'at all.',
    'alert.noBrokerHost':
      'No message server could be reached from this network, so nobody else ' +
      'can join. The game itself sits in this page, so robots can be added and ' +
      'played against here with no network at all. The network of an ' +
      'institution or a workplace usually closes everything but ordinary ' +
      'browsing. Tapping the words above shows what answered and what did not, ' +
      'and you can try another network or add ?broker= to the address with a ' +
      'server of your own.',
    'links.title': 'The message servers:',
    'links.on': 'connected',
    'links.wait': 'trying',
    'links.err': 'failed',
    'links.dead': 'no answer',
    'links.none': 'no message server is connected',

    'move.noAnswer': 'no answer from the host',

    'err.gameOver': 'the game is over',
    'err.waitingTakeback': 'waiting for the cards to be taken back',
    'err.notYourTurn': 'not your turn',
    'err.unknownMove': 'unknown move',
    'err.cannotOpenNow': 'a molecule cannot be opened now',
    'err.moleculeNotInHand': 'that molecule card is not in your hand',
    'err.declareCarbons': 'declare between {min} and {max} carbon atoms',
    'err.fiveOnlyAtStart': 'five cards may be drawn only at the start of a molecule',
    'err.deckEmpty': 'the deck and the discard are both empty',
    'err.nothingToPick': 'there is nothing to pick',
    'err.notAmongFive': 'that card is not among the five',
    'err.noMoleculeOnTable': 'there is no molecule on the table',
    'err.noMoleculeToSwap': 'there is no molecule to swap',
    'err.tableDoesNotFitNew': 'the atoms already on the table do not fit the new molecule',
    'err.cannotDrawNow': 'nothing can be drawn now',
    'err.atomDeckEmpty': 'the atom deck and its discard are both empty',
    'err.cannotPassNow': 'the turn cannot be passed now',
    'err.atomsStillAvailable': 'there are still atom cards to draw',
    'err.notAContributor': 'you did not lay any of these cards',
    'err.notYourPlacedCard': 'that is not one of the cards you laid',
    'err.cannotTakeBackFusion': 'a nuclear fusion card cannot be taken back',
    'err.noCardsChosen': 'no cards were chosen',
    'err.oneFusionOnly': 'only one fusion card may go into a group',
    'err.oneAtomOnly': 'only one atom card may be laid at a time',
    'err.fusionNeedsAtom': 'a fusion card goes down with at least one atom card',
    'err.noSuchSum': 'the atomic numbers add up to {z}, and no atom of this game has that number',
    'err.sameCardTwice': 'the same card was chosen twice',
    'err.cardNotInHand': 'that card is not in your hand',
    'err.doesNotFit': '{el} does not fit the molecule on the table',
  },
};

export function t(key, params) {
  const word = WORDS[LANG][key] ?? WORDS.he[key] ?? key;
  if (!params) return word;
  return word.replace(/\{(\w+)\}/g, (whole, name) =>
    params[name] === undefined ? whole : String(params[name])
  );
}

// Fills every element that names a word of the dictionary.
export function applyStaticWords(root = document) {
  document.documentElement.lang = LANG;
  document.documentElement.dir = DIR[LANG];
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of root.querySelectorAll('[data-t-ph]')) el.placeholder = t(el.dataset.tPh);
  for (const el of root.querySelectorAll('[data-t-title]')) el.title = t(el.dataset.tTitle);
}
