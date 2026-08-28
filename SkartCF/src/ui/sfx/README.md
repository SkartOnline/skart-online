# Sound

Drop one file in here named after the cue and it plays. Nothing else needs
changing — the glob is resolved at build time, so an empty folder costs nothing
and adding one file is the whole workflow. A cue with no file is silent, so the
set can be filled in one sound at a time and a half-finished set never breaks a
match.

    src/ui/sfx/land.ogg     ->  plays when a unit is set down
    src/ui/sfx/fall.ogg     ->  plays when one dies

`.ogg`, `.mp3`, `.wav`, `.m4a` and `.webm` are all picked up. Prefer **`.ogg` at
around 64–96 kbps**: it is small, it loops without the gap mp3 leaves at the
head of a file, and everything except very old Safari decodes it. Keep cues
under a second unless the table says otherwise, trim the silence off the front
or the sound will lag the beat it belongs to, and normalise to about −6 dBFS so
one cue is not four times louder than its neighbour.

The pitch of every cue is wobbled ±4% on each play, so the same sample fired
five times in a row does not sound like a machine gun. Do not pre-bake variants.

## The cues

Twelve beats, one file each. The timings are what `BEAT_MS` in
[`../game/theatre.ts`](../game/theatre.ts) gives each beat on screen — a cue
much longer than its beat will still be playing over the next one.

| File | Beat lasts | What it is |
|---|---|---|
| `battlefield.ogg` | 4400 ms | A new battlefield turned over. The biggest moment in the game: a struck bell, a horn, something with a tail on it. |
| `step.ogg` | 2600 ms | The scoring step. Low, sustained, conclusive. |
| `done.ogg` | 2400 ms | A player declares they have finished. A wooden gavel — final, because it is. |
| `cast.ogg` | 2600 ms | A spell. The fallback when the school files below are missing. |
| `land.ogg` | 2200 ms | A unit set down face up. Wood on wood, with weight. |
| `veil.ogg` | 2000 ms | A unit set down face down. Cloth, a card turned away. |
| `reveal.ogg` | 1800 ms | Mustra turns a hidden card over. A paper snap. |
| `fall.ogg` | 1500 ms | A unit dies. Short, low, final. Not a scream. |
| `march.ogg` | 800 ms | A unit walks to another tile. Leather and gravel. |
| `strike.ogg` | 1000 ms | Something landed and left it standing. An impact. |
| `draw.ogg` | 650 ms | Cards into a hand. Paper sliding on paper. |
| `toss.ogg` | 420 ms | A card thrown away at leszerelés. A flick. |

### Spells, by school

Optional, and the best value in the set: a cast is the loudest thing either
player does, and six of them are far more memorable than one played six times.
Any that are missing fall back to `cast.ogg`.

`cast-magus.ogg` · `cast-feketemagus.ogg` · `cast-harcos.ogg` ·
`cast-zsivany.ogg` · `cast-druida.ogg` · `cast-bestia.ogg`

### Room tone

Three loops, one per kind of place, crossfading when the battlefield changes.
These are the only files that should be long — a minute or two, seamless, and
quiet enough to forget. They do more for the game feeling finished than any
single effect.

| File | Battlefields |
|---|---|
| `room-varos.ogg` | Sikátor, Feketepiac, A Pék hídja, Lingadori könyvtár, Kikötő, Malom |
| `room-vadon.ogg` | Akáczos, Holdfényes tisztás, Bőségkert, Plázs, Ködrét, Végtelen puszta |
| `room-atok.ogg` | Máguskör, Elátkozott rengeteg, Umbra |

### Interface

Two only, deliberately. Everything else a gesture does already has a beat
describing it, and a press plus a lift plus a landing for one dragged card is
two sounds too many.

| File | What it is |
|---|---|
| `ui-press.ogg` | Any button, anywhere in the game. Quiet and dry — it fires constantly, so anything with a tail on it will drive you mad by the third match. |
| `ui-lift.ogg` | A card picked up out of the hand. Paper coming off paper. The drop has no cue: the unit landing is already `land` or `veil`. |

## Where to get them

Freesound (filter to CC0) and Kenney's free packs cover nearly all of this
without an attribution obligation. Check the licence on anything from anywhere
else before it goes in the repo.
