import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, getSpell, loadCardSet } from "../engine/cards";
import type { SpellCard } from "../engine/types";
import { components, interaction, interacts, spellTouches } from "./combo";

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

/** A spell built from parts, for the cases the card set does not happen to hold. */
function spell(id: string, over: Partial<SpellCard>): SpellCard {
  return {
    id,
    name: id,
    kind: "spell",
    schools: ["Mágus"],
    cost: 1,
    target: { side: "enemy", range: 2 },
    effects: [],
    ...over,
  } as SpellCard;
}

const touches = (card: SpellCard) => spellTouches(card);
const linked = (a: SpellCard, b: SpellCard, classes?: Parameters<typeof interacts>[2]) =>
  interacts(spellTouches(a), spellTouches(b), classes);

describe("the combo graph, on the cases that decide the design", () => {
  const debuff = spell("debuff", { effects: [{ kind: "modifyPower", amount: -3 }] });
  const sweepPower = spell("sweepPower", {
    target: null,
    effects: [{ kind: "thresholdAoe", stat: "power", atMost: 3, amount: -9, side: "enemy" }],
  });
  const sweepBase = spell("sweepBase", {
    target: null,
    effects: [{ kind: "massDestroy", stat: "basePower", atMost: 3, side: "enemy" }],
  });
  const setPower = spell("setPower", { effects: [{ kind: "setPower", value: 1 }] });

  it("connects a debuff to a sweep that reads current power", () => {
    // The 3/6/9 case: −3 onto the 6 is only correct because the sweep is there,
    // and no per-cast scoring can see that.
    expect(linked(debuff, sweepPower)).toBe(true);
    expect(interaction(touches(debuff), touches(sweepPower))).toBe("value");
  });

  it("does not connect it to a sweep that reads printed power", () => {
    // `stat: "basePower"` is declared on the card, and it means no amount of −X
    // sets this up. This is the distinction the graph exists to make.
    expect(interaction(touches(debuff), touches(sweepBase), ["value"])).toBeNull();
  });

  it("connects a set-power to that same printed-power sweep", () => {
    // 9.1.2: setting power overwrites the printed value, so it does reach.
    expect(interaction(touches(setPower), touches(sweepBase), ["value"])).toBe("value");
  });

  it("leaves a friendly buff and an enemy damage spell apart", () => {
    const buff = spell("buff", {
      target: { side: "ally", range: 1 },
      effects: [{ kind: "modifyPower", amount: 2 }],
    });
    const hit = spell("hit", { effects: [{ kind: "damage", amount: 3 }] });
    // Same quantity, opposite sides. Two independent additions, not a combo.
    expect(interaction(touches(buff), touches(hit), ["value"])).toBeNull();
  });

  it("stacks two damage spells, because damage accumulates towards a threshold", () => {
    const a = spell("a", { effects: [{ kind: "damage", amount: 3 }] });
    const b = spell("b", { effects: [{ kind: "damage", amount: 3 }] });
    expect(interaction(touches(a), touches(b), ["value"])).toBe("value");
  });

  it("does not stack two flat debuffs, because neither reads anything", () => {
    const a = spell("a", { effects: [{ kind: "modifyPower", amount: -2 }] });
    const b = spell("b", { effects: [{ kind: "modifyPower", amount: -2 }] });
    expect(interaction(touches(a), touches(b), ["value"])).toBeNull();
  });
});

describe("the combo graph, on real cards", () => {
  it("finds Infiltráció → Hátbaszúrás", () => {
    // The combo the one-ply agent has never found: the move has no power on it,
    // and its whole value is that it puts the caster where the range reaches.
    // The edge is `legality`, not `value`, which is exactly why scoring the
    // afterstate of the move looks like nothing happened.
    const move = getSpell("infiltracio");
    const stab = getSpell("hatbaszuras");
    expect(interaction(spellTouches(move), spellTouches(stab), ["value"])).toBeNull();
    expect(interaction(spellTouches(move), spellTouches(stab), ["enable"])).toBe("enable");
  });

  it("finds damage → Kegyelemdöfés, which needs a damaged target", () => {
    // Legal on 0 of 452 turns in the last measurement, because nothing was
    // setting it up. Its target filter declares the read, so the graph sees it.
    const hit = getSpell("hatbaszuras");
    const finisher = getSpell("kegyelemdofes");
    expect(interaction(spellTouches(hit), spellTouches(finisher), ["enable"])).toBe("enable");
  });

  it("splits a hand into the bundles worth enumerating together", () => {
    const hand = ["infiltracio", "hatbaszuras", "kegyelemdofes"].map(getSpell);
    const groups = components(hand, spellTouches);
    // All three chain: the move enables the stab, the stab enables the finisher.
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("keeps every base-set spell classifiable", () => {
    // Not an assertion about the graph so much as about the table: a kind with
    // no entry silently drops out of every bundle, which is the failure mode
    // that would be hardest to notice.
    for (const card of BASE_CARD_SET.spells) {
      const t = spellTouches(card);
      expect(t.reads.length).toBeGreaterThan(0);
    }
  });
});

describe("the caster's own tile is not a combo on its own", () => {
  /**
   * Every targeted spell reads where its caster stands, because that is what
   * decides range (4.7.3). Classing that read as `enable` made one move spell a
   * partner of every spell in the deck: Teleport came out with 15 partners of a
   * possible 16 in the Mágus deck, and the graph stopped being sparse.
   *
   * The distinction that survives is whether the spell *pays off* for position,
   * not whether a caster could be moved — every caster can be moved.
   */
  it("does not link a move spell to a spell that only needs range", () => {
    expect(
      interaction(spellTouches(getSpell("teleport")), spellTouches(getSpell("langlandzsa"))),
    ).toBeNull();
    expect(
      interaction(spellTouches(getSpell("teleport")), spellTouches(getSpell("nemitas"))),
    ).toBeNull();
  });

  it("still links the move that sets up a positional payoff", () => {
    // Infiltráció → Hátbaszúrás is the combo this whole graph was built for:
    // Hátbaszúrás reads a tile for value (`altIf: "backRow"`), so a move that
    // changes what the caster can reach is a real setup for it.
    expect(
      interaction(spellTouches(getSpell("infiltracio")), spellTouches(getSpell("hatbaszuras"))),
    ).not.toBeNull();
  });

  it("keeps the graph sparse enough to be worth having", () => {
    // A card that partners everything carries no information. The worst case in
    // any shipped deck should stay well under the deck's spell count.
    const magus = ["explar", "szellokes", "tuzkopeny", "fagypancel", "alomfogo", "vaskarom",
      "langlandzsa", "nemitas", "elfeledes", "teleport", "jeghegy", "idezes"];
    const touches = magus.map((id) => spellTouches(getSpell(id)));
    const worst = Math.max(
      ...touches.map((a, i) => touches.filter((b, j) => i !== j && interacts(a, b)).length),
    );
    expect(worst).toBeLessThan(magus.length / 2);
  });
});
