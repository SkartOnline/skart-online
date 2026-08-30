# SkartCF

Browser prototype for **Skart 2**: a two-player tactical card game where you fight for
locations one at a time. Units go down under a cost cap until both players stop, the
board is revealed at Mustra, then the battle opens and spells are traded openly until
both players stop again. Whoever has the higher total takes the location.

This folder is the new direction. It shares no code with `../SkartTG`, which is kept
only for preservation.

```
npm install
npm run dev        # http://localhost:5173 — hotseat game + card editor
npm test           # engine test suite
npm run sim -- --games 2000
npm run build      # static build into dist/
```

## The documents

| File | What it is |
|---|---|
| `docs/szabaly-teljes.md` | **The rulebook.** Numbered, quotable, decides disputes. The engine follows it, and the in-app Szabály screen renders it. |
| `docs/szabaly-gyors.md` | The quick rules, enough to sit down and play. |
| `docs/abilities.md` | Every card text traced back to the parameterised primitive that implements it. |
| `docs/design-notes.md` | Why the rules are what they are, plus the technical notes. Not a rulebook. |
| `docs/bot.md` | The self-play opponent. |

`docs/rules-v2.md` is gone. Its rules half was superseded by the full rulebook; its
design half moved to `docs/design-notes.md`.

## The card set

The full set is in: **88 units, 64 spells, 15 battlefields**, plus 21 attachment cards
and one token (the Nyúl a Lépumorf leaves behind). `docs/abilities.md` is the ability
inventory — every card text traced back to the parameterised primitive that implements
it, and the short list of abilities that deliberately stayed as flavour text.

Three things about this set are worth knowing before you read the data:

- **Six schools: Mágus, Feketemágus, Harcos, Zsivány, Druida, Bestia.** Two old names are
  gone. The `Állat` *caster school* was folded into Bestia, and `Ravaszság` was renamed
  `Zsivány` after the class it belongs to. Both survive as keywords, never as pools.
- **A spell may name more than one school** (`schools: ["Harcos", "Zsivány"]`). One caster
  covers the whole cost out of one pool — naming two schools widens who *can* pay, it
  never adds two pools together.
- **Eredet, Rend and Faj are keywords.** `origin`, `order` and `race` are separate fields
  for the editor's sake, but `cardKeywords()` folds all three into the same list every
  filter reads, so "minden szövetséges Kalóz" and "dobj el egy Állatot vagy Bestiát" need
  no special case and no knowledge of which column the word came from.

## What works right now

The site opens on a main menu with three ways in.

- **Játék** — hotseat. One fixed-viewport screen, no page scroll, you control both
  players. Full location loop: the units phase with its stop flags and face-down units,
  Mustra, the battle phase with caster/target/destination picks, totaling, six
  battlefields plus A Zóna on a tie.
- **Gyűjtemény** — the collection. Build your own decks: thirty units, thirty spells,
  three battlefields. Saved to the browser and live in the deck picker straight away.
  The shipped decks are starting points, nothing more.
- **Kártyaműhely** — the card editor. Units, spells, battlefields and attachments.
  Effects come from a form generated out of the engine's own schema, so what you set is
  exactly what the engine plays.
- **Online parti** — a room, from the deck picker. One player opens a room and reads
  out six digits, the other types them in; both pick a deck, the host deals. See
  *Playing across a room* below.

Not built yet: card art, AI worth playing against.

## Architecture

The rules engine is pure functions in `src/engine/`, with **zero React imports**. React
only renders state and dispatches actions. That split is not tidiness — it is what lets
a headless script play ten thousand games and report win rate by battlefield, which is
the actual payoff of building this rather than printing more paper.

```
src/
  engine/
    types.ts      state, card, effect type definitions
    grid.ts       slot adjacency, 12×12 range matrix (BFS, built once)
    schema.ts     declaration of every effect / static / location-effect kind
    cards.ts      the card registry and card-set validation
    power.ts      basePower() and power(), statics computed on read
    effects.ts    one handler per effect kind
    resolve.ts    the spell resolution machine, Belépő firing
    prompts.ts    the queue for the abilities that have to ask the player
    interactions.ts
                  what happens once they are answered, plus traps and portals
    reducer.ts    applyAction(state, action) => state, legalActions()
    setup.ts      createGame(), rule config defaults
    totaling.ts   final board sum
  data/           units, spells, locations, attachments, decks — all JSON
  ui/             React. Game screen and card editor.
  sim/            headless runner and its policy
```

### Cards are data, never code

Every card is a JSON row naming an effect `kind` plus parameters. There are no
card-specific branches anywhere in the engine — `effects.ts` is a table keyed by kind.

```json
{
  "id": "bergyilkos",
  "name": "Bérgyilkos",
  "cost": 5,
  "power": 4,
  "order": "Orgyilkos",
  "spellpower": { "Zsivány": 3 },
  "belepo": {
    "target": { "scope": "columnEnemy", "compare": "weakerThanSelf", "pick": "weakest" },
    "effects": [{ "kind": "destroy" }]
  }
}
```

Rebalancing is editing a number in JSON, not editing code.

The set comes out of fourteen static kinds, thirty-two effect kinds and sixteen location
effects, because the variation lives in the parameters rather than in the table. Five
different "kill a unit" spells are all one `destroy` effect with different target
filters:

| Card | Filter |
|---|---|
| Óriásölő | `minPower: 8` |
| Fojtás | `maxPower: 3` |
| Rajtaütés | `isolated: true` |
| Kegyelemdöfés | `damaged: true` |
| Carnifex (Belépő) | `maxBasePower: 4` |

Two conventions do most of the compression work. Every "+X, ha …" unit is one
`powerBonus` static plus a value from a shared condition enum (`isolated`, `enemyHalf`,
`opposedWeaker`, `graveyardAtLeast`, …), and every effect accepts the same optional `if`
gate off that enum — which is how a Belépő that reads "if nobody else is out there, +2"
stays data instead of becoming a new effect kind.

### Gyűrű

Some abilities grant power for a condition that has *already happened*, and the grantee
keeps it after the granter leaves the board. Bodur kapitány is the example: an ally that
moves takes +1 with it, and Bodur dying does not take it back.

That is a **gyűrű**, and it is a separate number from `powerDelta` for exactly that
reason — `UnitInstance.rings`, granted by the `grantRing` effect, drawn on the card with
a ⊙ mark. Vaskarom is the spell version: an attachment flagged `ring: true`, which wears
the same mark.

Rings come from triggers, which are the other half of the mechanism: `onAnyDeath`,
`onAllyMove`, `onMustra`, `onLocationWon` (Diadal) and `onLocationLost` (Vigasz). A
trigger is an event name, a target set and an effect list — the same shape a Belépő has.

There is deliberately no self-death trigger. Vigasz turned out not to be one, and a
genuine "when I die" effect would have to act on a unit `sweepDead` has already taken off
the board.

### Spells sit on units

Every spell that resolves onto a unit is recorded in `UnitInstance.placed`, whether or
not it left a lasting effect. A lasting one also names an `attachment`, and taking the
card off takes the effect off — there is no duration to track anywhere.

Attachments carry the same `statics` array units do. That is why Falanx, Vérszomj,
Halálfélelem, Csordaszellem and Morál need no code at all: they are a card with one
static on it.

On the board a laden unit shows a `✦n` count and a coloured edge; hovering it fans out
every card lying on it, spent one-shots included.

### Adding a new effect kind

Exactly two edits, in adjacent files:

1. A `KindSpec` block in `src/engine/schema.ts` — label, one-line summary, and the
   parameter fields with their types and defaults.
2. A handler in `EFFECT_HANDLERS` in `src/engine/effects.ts`.

The card editor renders the form from the spec, and `validateCardSet` starts checking
it, both for free. Nothing else needs to know the kind exists.

### The two stat accessors

`basePower(unit)` is the printed value (or a set-power overwrite). `power(unit, state)`
is printed plus positional plus location plus statics plus tokens, clamped at 0. Every
effect declares which one it reads, taken straight from the card text — threshold AoE
and kill checks are where this bites.

Static abilities are never applied as state mutations. They are computed on read inside
`power()`, which is what makes "killing a unit buffs the survivors" fall out for free.
Every static therefore reads only printed values, keywords and slot occupancy — never
`power()`, or the computation would recurse.

### The three phases

A location runs **units → Mustra → battle → scored**, and the phase is the thing that
decides what is playable:

| Phase | What is on offer | Ends when |
|---|---|---|
| `units` | one unit per turn, or *units done* | both `unitsClosed` |
| `mustra` | nothing — it flips every hidden unit at once, then walks the tiles firing Belépő and Mustra abilities one at a time | immediately |
| `battle` | one spell per turn, or *spells done* | both `spellsClosed` |
| `scored` | Diadal and Vigasz have fired; *next location* | — |

The two stop flags belong to different phases and are never live at the same time. That
is the whole shape: `legalActions` returns an empty array for a player who has stopped in
the phase that is running, and the turn loop skips them rather than ending it early.
Auto-closing (empty hand, six slots filled, empty spell hand, an Omen on the board) is
applied by the engine, not the UI, so the simulator and the hotseat agree.

### Spell resolution

Spells are played **open and resolve on the spot**, one per turn. There is no stack and
nothing is face-down: you nominate caster and target as you play it, it goes off, the
turn passes.

Resolution is still a machine rather than a function call, because caster and target are
chosen mid-resolution. The engine advances until it needs input, parks a `ChoiceRequest`
in `state.resolution.pending`, and stops; the caller supplies a choice and it advances
again. `state.spellsCast` is the ordered record of what has been cast, and the resolution
cursor points at the entry currently going off.

Fizzle is not a special case: it is "no viable caster", which advances the cursor without
asking anyone. Under the old face-down stack that made an uncastable spell a legal bluff;
now it is simply a wasted card, which is why the sim's bot no longer plays one.

### The abilities that ask

Most abilities do not need to. When the card says "one" and the choice is not interesting,
the data can say *which* one and the ability resolves without stopping anyone: Bérgyilkos
takes the weakest in its column, Carnifex the strongest it is allowed to kill. That is what
`AutoTargetSpec.pick` is for, and it is what the bulk of the set uses.

When the choosing *is* the ability, it asks. A tutor that picks for you is not a search, it
is a draw with extra steps; Griff has to see what he took before he can decide what it is
worth giving up for; Fuedrax commits a spell out of hand onto a tile.

Such an ability pushes a **`Prompt`** onto `state.prompts` and stops. Nothing in the game may
happen while one is standing — `settle` returns early, `legalActions` offers the picks and
nothing else, and only the player being asked is offered anything at all.

The answer arrives as an ordinary action (`answerPrompt`, `finishPrompt`), which is the
whole trick: **the bot and the simulator play these cards without knowing any of this
exists.** They enumerate legal actions and pick, the same as anywhere else.

A prompt is data and its completion is a handler keyed by `kind`, in `interactions.ts`,
exactly like an effect. Never a closure — every action does a `structuredClone`, and the
bot evaluates a move by cloning the position it leads to, so a prompt holding a function
would break the opponent rather than the rules.

| Effect | The question | Cards |
|---|---|---|
| `searchDeck` | which card comes out of the listed pile | Sírásó, Feltámadás, Lingadori könyvtár |
| `handSwap` | which cards you take, then which you hand back | Griff, a hamiskártyás |
| `setTrap` | which spell goes down, and on which enemy tile | Fuedrax |

These are the first abilities to ask, not the only ones the machinery is for. A new one is
a prompt `kind` and a completion handler in `interactions.ts` — the same two-edit shape
adding an effect kind has, and nothing else in the engine needs to know it exists.

Where the question is *put* follows where the cards already are. Cards in your own hand
are picked out of the hand, because that is where they are; a pile nobody can see — a deck
being searched, a graveyard, an opponent's hand Griff has opened — gets the ledger-shaped
panel on the right, since the right rail already teaches a counted column as the way to
read a pile.

### Reveals

The engine had nowhere to put information. Gréta, Mágusinkvizítor and Leskelődés are pure
information, so all three wrote a chronicle line and stopped, on the grounds that hotseat
has a "Mindent mutat" switch — which made them abilities that did nothing you could point
at, since a switch you could have flicked yourself is not an ability.

So a peek now records a **`Reveal`**: what was seen, and who is entitled to have seen it.
The theatre holds it up for one long beat and nobody else ever reads it — which is what
keeps a bot peeking at a hand from showing that hand to the person it is playing against.
A trap going off is the one kind marked `open`, because a spell resolving is public and
the player whose unit just died is owed an explanation.

Fejvadász is the version with a verdict on it: one card out of the hand, rolled off the
game seed rather than taken off the top, and the reveal carries whether it beat him.

### Two zones the rules do not have

**Fuedrax's trap** is a spell committed face down onto an empty enemy tile. It lives on
`state.traps` rather than on a unit, because the tile it watches may never be occupied at
all. Springing is *pulled*, not pushed: a unit arrives on a tile from six directions —
placement, a move, a swap, a summon, a revive, a transform — and hooking all six would be
six chances to forget one, so `settle` asks "is anybody standing on my tile" once the dust
is down. It does not check whose unit it is; that is the risk of setting one. A spell that
could never have named whoever walked in fizzles, and anything else the spell wants — a
destination — is rolled for.

**Felix's portal** is the other. Losing the battle owes him a place on the next
battlefield rather than a place in the graveyard: the same tile, or the nearest of his own
if he ended up across the line, arriving clean — no damage, no modifiers, no rings,
nothing placed, spellpower pools untouched — and outside the cost cap. Outside it again
the next time he loses, too, because nothing about the arrival records that it has
happened before.

### The theatre has a clock

Beats used to all start at once, which was wrong the moment a card had a Belépő. The
engine settles a whole chain inside one action — Bérgyilkos goes down, reaches across the
column and kills — and the diff arrives with the arrival and the death in the same list.
Played together they read as a single event: the card appears and something is already
gone, and a player meeting that card for the first time cannot tell what killed what.

So a beat carries a lead as well as a lifetime. The play lands first and gets long enough
to read, the strike lands on top of it, and the death comes last — its own animation marks
the tile, named and ringed in red, before anything is taken off it. The board still renders
the true position throughout; only the flourish over it is scheduled.

The machine waits for all of it. It moves once the theatre is quiet rather than after a
fixed pause, so it can never talk over the consequences of its own last move.

### The prologue

A game used to open on a board that was already running: the first battlefield decided,
drawn in the rail, and the machine usually a turn in before the fade had finished.
Everything that makes the first minute legible happened off screen.

Now it happens on screen, in the order a table would do it in — show the six boards both
players brought, turn them face down, shuffle where everyone can see, turn the top one
over and hold it long enough to read a cap and a rules box. Nothing else may move until it
is over. Clicking skips it.

The shuffle decides nothing: `createGame` shuffled the locations before the screen existed
and the answer is already in `state.locations[0]`, which is exactly why it is safe to show.

## Playing across a room

Two people, two machines, one match. `src/net/` is the whole of it, and it is built on
a claim `src/engine/view.ts` had already made: whoever holds the state applies the
actions and sends everybody else `redact(state, them)`.

### Who is the server

**The host's browser.** It holds the one real `GameState` and is the only thing that
calls `applyAction`. The guest holds a picture and sends requests.

The relay in `server/relay.ts` is not a game server. It pairs two sockets by a
six-digit code and forwards bytes between them — it never imports the engine, holds no
game state and has no database, so it is deployed once and then has no reason to change
again. That is the point of putting the truth in the host rather than in the server:
**cards are data and the data is local.** Both players have a workshop and a
localStorage overlay, and an authoritative server would need the host's card set
uploaded to it or redeployed into it every time somebody edited a card. Instead the
host sends its overlay down the room on arrival, the guest installs it for the duration
of the match, and the server stays ignorant.

The price is stated plainly because it is real: a host who opens a debugger can read
the guest's hand out of the `HostMatch` object. The guest is fully protected — nothing
that crosses the wire towards them has ever contained a card they are not entitled to
— and the host is on their honour. For a game two friends arrange between themselves,
that is the right trade.

Both screens render `redact(truth, theirSeat)`, including the host's. Nothing in either
React tree ever holds the opponent's hand, and `GameView` has no idea which end of the
wire it is on: online play is the hotseat screen with a fixed seat and a different sink
for its actions.

### The layers

```
protocol.ts     frames (client↔relay) and room messages (player↔player)
room.ts         what the game sees: a code, a seat, a way to speak
link.ts         the seam: a duplex of frames, plus the handshake over it
relayCore.ts    the matchmaking, with no socket in it
  loopback.ts     …wired up in-process, for the tests
  channel.ts      …over a BroadcastChannel, for two tabs of one browser
  socket.ts       …over a WebSocket, for two people in two houses
match.ts        HostMatch holds the truth; GuestMatch holds a picture
```

One `Relay` class serves all three transports, so the matchmaking is tested once, in
milliseconds, without opening a port. `src/net/match.test.ts` plays a **whole game to a
winner across a room**, with both sides choosing their moves from `legalActions` on
their own redacted view — which is the question hotseat never has to answer.

### Two things that are not obvious

**`applyAction` does not throw on an illegal action.** It quietly does nothing, or
worse, something: `doToss` will throw away a card belonging to whoever the action names.
So "apply it and see" is not a validation strategy, and every action arriving at the
host is instead tested for membership of `legalActions(state, sender)` — the same
enumeration the bot and the simulator pick from. The host's own moves go through it too.
That ought to be dead code, which is exactly why it is there.

**A redacted position cannot be asked about the other player.** It answers `legalActions`
for its own seat perfectly well — the full game in the suite is played that way — but
asking it for the opponent's moves walks into a hand of blanks, and every card lookup in
the engine throws on a blank. Hotseat never notices, because hotseat holds the truth.
`GameView` therefore enumerates only for the seat it is sitting in, and `bare`
(reveal-all) is forced off online for the same reason.

### Running one

With no relay configured the lobby still works, between two tabs of one browser, over a
`BroadcastChannel`, and says so on screen. That is how the feature was built and it is
still the fastest way to see it work: open the game twice, create in one tab, paste the
code into the other.

For two machines:

```
npm run relay                              # port 8787, or $PORT
npm run smoke                              # two clients, real sockets, eight checks
npm run smoke -- wss://relay.example.com   # or against a deployed one
```

The client reads `VITE_RELAY_URL` **at build time** — vite resolves `import.meta.env`
into the bundle, and the published site is static files with nowhere to look up a
config at runtime. Locally that means a `.env` file; for the published site, set the
repository variable `RELAY_URL` and the Pages workflow bakes it in.

Any host that runs Node and terminates TLS will do; the relay wants a `wss://` address
because the site is served over HTTPS and a browser will not open a plaintext socket
from a secure page. It answers `GET /health` for whatever the host wants to poll.

### What is deliberately not there

Reconnection into a game in progress. `HostMatch` will send the position to a guest who
arrives to a room already playing, so the pieces are in place, but nothing holds the
room open while a socket is down: an empty room is deleted, because the relay holding a
position is exactly the thing that would stop it being something you deploy once and
forget. Undo is gone online for the same family of reasons — it would rewind a move the
other player has already watched.

## The simulator

```
npm run sim -- --games 2000
npm run sim -- --games 500 --decks felindori,bestia
npm run sim -- --games 500 --fold 4
npm run sim -- --games 2000 --policy greedy --stop-margin 0,2,4
```

Reports match win rate, how often games reach A Zóna, and win rate per deck per
battlefield. Any deck over 75% on any single battlefield is flagged `BROKEN` — that is
the hard failure condition from the rules doc, and the number this script exists to
measure.

Three policies can play the games. The default is the **baseline** in
`src/sim/baseline.ts`: deterministic, no randomness anywhere. It computes the
theoretical maximum total it can still reach — through the real engine, so auras and
battlefield effects count — from what a player could actually know (the battlefield,
its own hands, the visible enemy units), builds the strongest board with the fewest
cards, and stops only when the opponent has stopped and the board is won, or when even
the theoretical maximum is `--fold` short of the enemy's total. `--policy greedy` is
the old randomised heuristic (kept as the bot's sparring partner; `--stop-margin`
applies only to it), and `--policy bot` plays the trained model.

## Damage versus power debuffs

These are two different things and the engine keeps them apart.

**A power debuff shifts the comparison.** `modifyPower −3` takes three points off what
the unit contributes at totaling, immediately.

**Damage buys nothing until it kills.** Sebzés accumulates on the unit as a wound count
and does not reduce its power. A unit at 6 power carrying 5 damage still counts 6 on the
scoreboard. It dies the moment damage reaches its current power — so a debuff landing
afterwards can finish what the damage started.

`power()` therefore does not subtract damage; `isDead()` compares the two. Explar is a
damaging spell (`2-t sebződik`), so playing it into a big unit and not
killing it gains you nothing at all.

## Settled rules

These were open questions and no longer are. They are constants, not options, and there
is no UI to change them:

- Unit deck **30**, spell deck 30.
- Positional keywords live in one table, `POSITIONAL_KEYWORDS` in `power.ts`: **Melee**
  front row +1, **Távolsági** back row +2. No unit in the current set carries Melee — the
  Excel never marked any — so the front-row bonus is live code with no cards on it yet.
- **No limit** on face-down units per location — the only gate is being able to pay,
  since hiding discards a unit card and you cannot pay with the last card in hand.
- Playing a spell **ends your turn**: nothing can follow it, so the turn passes on its
  own once the spell has finished asking for picks.
- **Leszerelés is a step you play**, not a book-keeping pass: 12.5 lets both players throw
  away as much of either hand as they like *before* 12.6 refills to seven. Tossing is
  never forced, and it is not free either — you refill from a finite deck, so it buys card
  quality with deck depth.
- Both phases open with the player who **brought the battlefield**. Going first costs
  information in each: on units you reveal intent a step ahead, in the battle you show a
  spell and its target before the reply. Whether that is a cost or a tempo advantage
  depends on the board — striking first can delete a caster's whole payload.
- **Mustra reveals as one moment and then fires in a queue.** Every hidden unit turns
  over together, so nobody acts on a half-built board; then the Belépő and Mustra
  abilities run one at a time in tile order — E1, E2, E3, H1, H2, H3 — alternating
  between the players, starting with the one who brought the battlefield (7.5). This
  replaced genuine simultaneity, which needed a board snapshot, picks that followed a
  unit that had since walked off, a deferred death sweep and a tiebreak for two abilities
  reaching for the same empty tile. The queue is a rule you can read off the board, and
  it almost never changes an outcome — the abilities that fire here rarely contend.

Still genuinely open, and still a switch:

| Question | Where |
|---|---|
| Does a transformed unit keep its abilities | `keepAbilities` on the `transform` effect, default off |

## Wording

Cards speak in the first person. A unit describes its own ability — *„+1-et kapok minden
szomszédos szövetséges Állat után."* A spell speaks as whoever is casting it — *„1-et
sebzek egy egységbe."* — because a spell is, in effect, an ability the caster borrows.

**Mustra** is the reveal step between the two phases. **Csata** is the battle phase that
follows it. The thirty-card spell deck a player brings is the **varázslatpakli**; what
has already been cast this location is shown as **elsült varázslatok**. There is no
*rakás* any more — that was the face-down pile the old design committed spells into, and
nothing in the engine plays that role now.

## Known gaps and judgement calls

- **Face-down units are resolved against their true values.** A Belépő landing into a
  column checks the actual card sitting across from it even while it is face-down. The
  alternative — treating a concealed unit as untargetable — would make hiding far
  stronger than the rules intend.
- **Three units still have no printed power in the source spreadsheet** — Dérföldi
  Deoren, Charon, Calcas. They are in the set at the cost-curve baseline (`cost + 1`),
  tagged `wip`, with the placeholder said out loud in their card text. Calcas had no
  printed cost either and is a guess at 5. Replace the numbers in the editor when they
  are decided. Sir Ton, Elfina and A Faarcú have been finished and are no longer `wip`.
- **Tűz and Fagy tags were assigned, not printed.** No spell in the spreadsheet names its
  element, so Explar and Lánglándzsa were tagged `Tűz` and Jéghegy `Fagy` from their card
  text. Tűzköpeny, Fagypáncél, Explodus and Erif mester all read those tags, so moving a
  tag moves four cards' worth of behaviour.
- **A Belépő that resolves without asking still has to say which one.** `pick` decides:
  Bérgyilkos takes the `weakest` in its column, Carnifex the `strongest` it is allowed to
  kill, Azman the `weakest` ally, Mágiacenzor the `highestSpellpower` enemy in its column.
  A Belépő that should ask instead pushes a `Prompt` — see *The abilities that ask*.
- **Varj discards "any number" by discarding all of it.** The card lets the player
  choose how many, and this one does not ask, so it empties the unit hand and keeps a ring per
  card. Vadász and Chupacabra pick the cheapest for the same reason.
- **The cost cap is enforced at placement, not audited at Mustra.** 7.4 has the cap
  checked at the reveal, with the whole battlefield forfeit for overshooting it. The
  engine makes overshooting illegal instead, so the bust can never happen: it is the only
  thing that has to be enforced and the only thing a player needs to know, and it keeps
  the sidebar from having to show a number that 1.5.3 calls hidden.
- **Októ-abnormitás devours at Mustra.** The spreadsheet dropped its `Belépő:` prefix and
  the ability weighs the units diagonally touching it, which wants a finished board — so
  it reads the board at the reveal step, the timing 10.2 exists for.
- **Omen says "nem lehet varázslatot kijátszani".** The printed card still says *a
  rakásra*, a zone the rules no longer have; the effect is unchanged.
- **1.3.6's knockout tiebreak is not implemented.** Total power across the battles decides
  who advances in an elimination bracket; a friendly game just ends in a draw.
- **A Zóna's first player** is picked at random at setup, which is what 3.8 asks
  for ("sorsolással").
- **One ability is still text only.** Gouraldir names the Three Relics, and that card
  does not exist in the set, so it keeps its `note` effect. The four that used to sit
  beside it are built — see *The abilities that ask*.
- **The shipped decks are starting points.** Eight archetypes, assembled to exercise the
  set rather than to be balanced. The simulator already flags a couple of battlefields
  over the 75% line; that is tuning work, not a bug.

  The first five are single-school: Felindori sereg, Csempészgyűrű, Varázslótanács,
  Vadállatok, Élettelen menet. The three after them are **mixed**, and mixed means one
  school in the front rank and a different one behind it, because 8.3.4 pays a spell out
  of one caster's pool and a rank that fights is not a rank that can afford to hold a big
  pool. They exist to put pressure on exactly that:

  | Deck | Front / back | How it takes a battlefield |
  |---|---|---|
  | **Vasgárda** | Harcos / Mágus | A front rank that is not worth removing. Bol'Jin stands behind a column and makes the unit in front of him Sérthetetlen; Nehézvért and Pajzs make everything else expensive to shift; the Mágus rank never fights, it draws and it burns — Explodus takes a gold off every Tűz spell and Erif mester puts a point of damage back on. Iniquus pays a point to every other Felindori on the board. |
  | **Csordajárás** | Bestia / Druida | Rings, on copies. Csatacsorda blesses an Állat *and every allied copy of it*, so the herd is deliberately built four Patkány and four Farkas deep rather than one of everything; Növekedés and Falkavezér stack on top, Kivirágzás rings the whole board, and Elfina adds a ring to any allied Állat a spell so much as touches. Faun and A Faarcú are the reason it survives being answered: one floors every ally at its base power, the other caps any single effect at 2 damage. |
  | **Vérszerződés** | Zsivány / Feketemágus | Kill things and get paid for it. The Csempész and Orgyilkos rank does the killing cheaply — Bérgyilkos, Fojtás, Rajtaütés, Tőrhajítás — and the Garabonciás rank converts the result into power: Vérdíj hands three rings to whoever collects, Csontvért reads the graveyard the deck has been filling all game, Élősködés takes two off them and gives two to the caster. Malom and Umbra are brought on purpose; both feed it. |

  All three are 30/30 and inside 14.2, and `npm run decks` reports no unplayable spell and
  no mute caster in any of them.

- **14.1 and 14.2 are enforced by `validateCardSet`, not by the collection screen.** The
  copy limit used to live in `ui/card/model.ts` and be applied by the + button, so a
  decklist written straight into `decks.json` walked round it — which three of these decks
  did. The table sits in `schema.ts` now and the validator reads it, which means
  `npm test` fails on an illegal decklist.

  Enforcing 14.1 turned up an older bug worth knowing about: `sizeTo` pads and trims a list
  to thirty, which is right for a half-written deck in the editor and silent for a shipped
  one, and three decks were over. The overflow is the *tail* of the JSON object, and the
  tail is where the singletons live — Varázslótanács had never played Valóságtörés or
  Csábítás, and Vadállatok had never played Faun, which was one of its only three Druida
  pools, so eleven of its thirty spells could not be paid for in any game it had ever
  played. Both are now written out to thirty with every named card kept and duplicate
  copies of cheap utility cut instead. That changes what those two decks put on the table.
