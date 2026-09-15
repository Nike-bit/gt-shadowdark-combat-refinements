# GT Combat Refinements

A Foundry VTT module of optional combat tools for the Shadowdark RPG system.

> **Renamed in 1.0.** This module was previously published as **GT-NPC Multiattack**
> (`gt-npc-multiattack`). On first load, settings, favourites, custom attack rules,
> custom attack rules and swallow state are migrated automatically from the old
> identity. See [Migrating from GT-NPC Multiattack](#migrating-from-gt-npc-multiattack).

When a normal Shadowdark `NPC Attack` has a Num. Attacks value greater than one,
the native attack dialog gains a compact selected/max quantity control. The
selector starts at `1/N` by default. A client setting can instead make it start at
`N/N`.

Pressing Roll executes exactly the selected number of independent Shadowdark
attack rolls. Every roll uses the same target, advantage state, roll mode, attack
formula, and damage formula selected in the dialog. Each remains a separate roll
and chat resolution.

By default, the attack dialog stays open and the remaining attack pool decreases
after each batch. Selecting `2/3` changes the counter to `1/1` after those two
attacks resolve. The dialog closes automatically after the final attack, or it can
be closed manually at any time. Opening a new attack dialog starts a new pool from
the NPC Attack's current Num. Attacks value.

The client setting **Enable Attack Autocounter** can turn this session counter off.
When disabled, the selector retains its original behavior: the chosen attacks roll
as one batch and the native dialog closes immediately.

## Target selection

The optional NPC **Target** row always opens in **Select** mode, including for an
attack whose maximum quantity is one. The visible rows are the active target
assignment. **Random** is the sole mode toggle; unchecking it immediately returns
the dialog to Select mode.

**Sees Hidden** is scoped to the open NPC attack dialog. When checked, hidden NPC
and Player tokens become eligible in the Select and Random pools. Turning it off
removes hidden tokens from those pools without changing their Foundry visibility.

Select mode shows NPC/PC filters and target rows.
Every row contains a unique visible-scene target, an independent roll mode
(`kh.` advantage, `-` normal, or `kl.` disadvantage), and a `- number +` attack
allocation. The initial roll mode is inherited from the dialog's single-target
selection. The sum of the row allocations controls the main selected/max Attack
Quantity counter.

Hovering an eligible scene Token and pressing Foundry's target key (`T`) adds it
to the Select rows, using the same native targeting event as Random mode. Pressing
`T` again over that same Token increases its planned attacks up to the dialog's
remaining-attack maximum. Attack quantities can also be adjusted with the row's
`+` and `-` buttons. Pressing `-` while a target has one planned attack removes
that target; a sole row returns to its empty target placeholder. Keyboard
targeting honors the same NPC/PC filters, unique-target rule, and remaining-attack
maximum as the drop-down controls. The drop-down workflow remains available
alongside keyboard targeting.

Two configurable Foundry controls provide direct hovered-target adjustment in
Select mode: `Shift+.` increases the planned attacks and `Shift+,` decreases them
(or removes a target when one attack remains). Both shortcuts can be reassigned
from the module settings through **Targeting Keys → Configure Controls**, which
opens Foundry's native conflict-aware controls editor.

The row and add-button limits use the dialog's current remaining attack pool. For
example, after one attack from an initial pool of four has resolved, no more than
three attacks can be distributed among target rows. Adding a row creates an
unselected **Select a Target...** drop-down with one allocated attack. The add and
increase buttons are disabled when all remaining attacks are allocated.

Target choices normally come only from non-hidden NPC and Player tokens on the
active scene; **Sees Hidden** explicitly expands that set. The selector does not
read the combat tracker or initiative order. Each
independent attack receives the selected row's TokenDocument UUID and current AC,
and attacks resolve in target-row order according to the displayed allocations.
Target option names do not include NPC/PC suffixes. Client settings independently
choose bold or italic styling and a font color for NPC and PC target names.
The selector updates while its attack dialog remains open when tokens are created,
deleted, hidden, revealed, or renamed. Actor changes such as AC updates are also
reflected. If an allocated target becomes hidden or is deleted, that row returns
to **Select a Target...** without losing its attack allocation.

Choosing **Random** opens an ordered pool that may contain more targets than the
current attack count. Targets can be added from the visible-scene menu or by using
Foundry's normal `T` targeting while the dialog is open. Right-clicking a pool
entry removes it. Hidden or deleted tokens are removed automatically.

For `k` selected attacks and `N` pool entries, Random evaluates `k` independent
`1dN` selections. A GM-whispered chat summary lists every numbered pool target and
how many attacks it received; zero allocations are left blank. The individual
Shadowdark attacks then resolve normally at their selected roll visibility against
the chosen tokens using the dialog's main advantage state.

## Player targeting

Foundry's Target tool replaces the previous target unless Shift is held, so
the **Area** and **Random** pools accumulate instead of mirroring the canvas:
every token you target is added to the pool (and, for Area, marked again on
the canvas), and a right-click on a chip removes it.

Optional Player attack targeting adds a compact target pool to Shadowdark's native
attack dialog. Its single header row contains **Target**, **Sees Hidden** and
**Random**. **Sees Hidden** is scoped to the open dialog and makes hidden tokens
eligible without changing their Foundry visibility, matching the NPC selector;
eligible hidden tokens are shown dimmed. With
Random off, the most recently targeted token
is retained. With Random on, each newly targeted visible token is added to a
module-owned pool, so Foundry's ordinary single-target gesture does not discard
earlier pool entries. Right-clicking a target chip removes it. One pool entry is
selected randomly when Roll is pressed; its current AC becomes authoritative for
that attack.

Optional spell targeting adds the same target pool to Player spell dialogs. Its
header contains **Target**, **Area**, and **Random**. With both modes off, the most
recent target is retained. Area keeps every selected target and displays them on
the spell chat card. Random instead accumulates targeted tokens in the same
module-owned pool used by Player attacks and chooses one target at roll time.
Area and Random are mutually exclusive. A spell whose range is **Self** targets
its caster: the panel shows the caster's own token as the single, locked target
and the chat card names them, whatever was targeted on the canvas — for NPC
casters too. Damage Area spells expose a
GM-only apply-damage button per target; non-damage spell effects continue through
Shadowdark's normal/manual workflow.

## Chat reroll modes

The optional chat reroll feature adds full-size, mutually exclusive `kh.` and `kl.`
buttons beside Shadowdark's main reroll icon on successful and failed attacks,
spellcasting checks, and attribute checks. A roll originally made with advantage
or disadvantage defaults to that mode; its reroll rolls two new d20s and keeps
the selected result.

For a supported roll originally made with one normal d20, `kh.` or `kl.` rolls exactly
one new d20 and compares it with the original d20, keeping the higher or lower
result. Attempting this comparison reroll without selecting a mode produces an
error instead of silently making a normal reroll. The client setting **Enable
Single-Roll Comparison Rerolls** can disable this behavior; neutral rolls then
retain Shadowdark's normal failed-roll reroll behavior and do not gain module
controls on successful rolls. Damage rerolls are unchanged, and Shadowdark's
author/GM permissions remain authoritative. A player's `kh.` reroll spends a
luck token as Shadowdark's own reroll does; a `kl.` reroll **never** does — a
roll with disadvantage may be the correction of a mistake, not a favour from
fortune — and a GM never pays.

A reroll made by mistake can be **undone**: the reroll's card carries an undo
button (author or GM) that removes that card, refunds the luck token it cost —
in either luck mode — and re-applies the original roll's consequences: a spell
lost or kept, a wand broken or not, and any attack features re-evaluated from
the original result. A note in chat records the withdrawal. Damage a
third-party module already applied from the reroll is not reversed; the note
says so. Spell
rerolls also preserve Shadowdark's lost-spell and broken-wand updates.

## Choosing the weapon or spell in the roll dialog

Shadowdark's roll dialog is where the module puts the choice of *what* to
roll, so the same controls appear however the dialog was opened — from the
character sheet, from the module's Token HUD buttons, from MK-Shadowdark's
token equipment icons, or from a macro.

**Attack dialogs** show the creature's attacks as rows of buttons above the
attack roll: a *Melee* row, then a *Ranged* row (thrown weapons appear in
both; NPCs get their NPC Attacks). Each button carries the Item's art, its
name and `+bonus · damage · range`; the attack being rolled is highlighted, and
hovering a button shows the same description-and-qualities preview the
palette shows. Choosing another attack reopens the dialog for it in the same
place on screen — it is not edited in place, because Shadowdark's own
`rollAttack` keeps the chosen weapon in hand after the roll (ammunition) and
must be started again for the new one. The module's attack counter, target
rows and Conditional Features start fresh for the new attack.

**Spell dialogs** grow a left column that is the quick-spell palette: All /
Tier tabs, **Wand** and **Scroll** filters, Favorites first, the ⭐ star to
change them, lost spells struck through, hover previews, and a list that
scrolls past a fixed height rather than growing the dialog. The spell being
cast is highlighted; clicking another reopens the dialog for it (double-click
or Shift-click casts it at once). A focus-duration spell gets a **Cast with
focus** checkbox under the cast roll. Wand and scroll spells reopen with the
right source in hand, so lost-spell, scroll-consumption and wand-breakage
handling stay Shadowdark's.

**Unarmed attacks** — world setting **Include unarmed attacks** (off by
default) adds an *Unarmed* button to every player character's Melee row: `1d2`
damage, rolled with Strength; a Thief uses Dexterity, a Fighter the higher of
the two (class read from the character's Class Item, core names in any of the
module's languages). The attack goes through Shadowdark's dialog and roll
pipeline like any weapon, honouring melee attack bonuses and advantage from
active effects.

Choosing another entry does not blink: the new dialog is launched first and,
because every Shadowdark roll dialog shares one element id, its first render
swaps in where the old one stands in a single paint; the old dialog is then
retired without its closing animation.

Client setting **Attack and spell interface** chooses between the two designs.
*Merged* (default): the roll dialog carries the weapon rows / spell column, and
the Token HUD's Quick Attack and Quick Spell open it directly for the last
attack or spell used on that token — else the first melee attack, else the
first favourite spell — with Shift-click skipping the prompt. *Separate*: the
hover palettes on the Token HUD and Shadowdark's plain roll dialog, as before
1.1.

## Quick attacks

The optional quick-attack launcher adds a hand-fist button to the right side of
the Token HUD. The button opens a native-looking palette positioned dynamically
beside the fist button and divided into Melee and Ranged sections. Each row shows
the Item's image when one is set, plus its effective attack modifier, damage
formula, and range. Hovering a row opens a preview above the palette for every
entry, not only those with qualities. The preview shows the Item's name, then its
own description in light grey italics if it has one, then any resolved weapon
qualities and their descriptions.

For NPCs, the palette lists embedded `NPC Attack` Items. For PCs, it lists attacks
from equipped Weapon Items using Shadowdark's normal melee/ranged construction;
thrown weapons can therefore appear as both melee and ranged choices. Every entry
opens Shadowdark's native attack dialog and does not replace its roll mechanics.
Palette positioning compensates for the Token HUD's canvas zoom scale.

## Quick spells

The optional quick-spell launcher adds a hand-sparkles button to the Token HUD
for owned NPCs and PCs that have spells. Its palette defaults to All known spells
and also offers Tier 1 through Tier 5 tabs (retaining any nonstandard tiers found
on the Actor). Scroll and Wand spells stay hidden unless their source button is
active or the spell is a favorite. Both source buttons can be active together.
The selected All/Tier view and source buttons are remembered per token for each
client user. Hovering over a spell opens a compact description preview above the
quick-spell palette. The shared tooltip delay defaults to half a second and can
be changed from zero to ten seconds in client settings. Palette positioning
compensates for the Token HUD's canvas zoom.

NPCs list their embedded Spell Items. PCs list learned spells plus identified
wand and scroll spells. Lost spells remain visible for context but are disabled.
Focus-duration spells show a brain button that uses Shadowdark's native focus
casting path. PC entries also show a star button; favorites appear in a dedicated
section at the top regardless of the selected tier. The
same favorite star is injected into each PC spell-sheet row, after its focus,
cast, or learn controls and immediately before Shadowdark's lost-spell toggle.
Favorited rows use a golden-yellow gradient. Learned spells, individual spells
provided by identified wands, and identified scroll spells can all be favorited;
their state stays synchronized through the Actor's module-owned favorites flag.
The Quick Spell palette preserves its open state while that flag update rerenders
the Token HUD.

Favorites also appear on the character sheet itself: the **Abilities** tab gains
a **Favorite Spells** box at the end of the attacks column — under Special
Abilities, or under Ranged Attacks for a character without any — drawn in the
sheet's own style, listing each favorite with its tier, range, duration and source. Clicking a
row casts it through Shadowdark's normal spell dialog (Shift-click skips the
prompt); focus spells get a brain button and the star removes the favorite. The
box exists only while the character has favorites, so non-casters see nothing.
Client setting **Favorite Spells on the Abilities tab** (under the Quick Spell
toggle) turns it off.
Selecting an available entry calls Shadowdark's native `castSpell()` method, so
casting checks, lost-spell handling, scroll consumption, wand breakage, damage,
healing, hooks, and the native roll dialog remain authoritative. Shift-clicking
an entry asks Shadowdark to use its normal prompt-skipping path.

## Quick abilities

The optional Quick Ability button appears above Quick Spell and Quick Attack on
owned NPC and PC Token HUDs. NPC Special Attacks and Features are kept in separate
palette sections; rollable Special Attacks use Shadowdark's native NPC attack path,
while descriptive entries use its native Item card. PC Class Abilities use
Shadowdark's native `useAbility()` path and show limited uses when applicable.
Hovering an entry shows its enriched description above the quick-ability palette
using the shared tooltip delay.

## Quick attributes

The optional PC-only Quick Attribute launcher adds a d20 button above Quick
Ability on the Token HUD. Its two-column palette reads Shadowdark's current six
ability keys and their configured labels, then shows the Actor's live modifier
beside each label. Selecting an entry calls Shadowdark's native
`rollStatCheck()` method.

Every Player attribute check dialog—including checks opened from the normal
character sheet—gains a **Difficulty** combo field between Check Roll and the
advantage controls. It defaults to 15, offers 9, 12, 15, and 18, and also accepts
a positive custom integer. The chosen DC is stored only in the current native
roll configuration. Result cards state the checked attribute and its critical
failure, failure, success, or critical success result, and use the existing
attack-result gradient toggle and colors.

## Custom attack rules

The world setting **Enable Custom Attack Rules** adds an opt-in **Attack
Features** section to the native `NPC Attack` Item edit sheet, directly below
Shadowdark's own *Attack Features* field. The two are one list: a feature
applied here is automated by the module *and* its name is written into the
system's field, so the attack card names it and — if the creature has an NPC
Feature of the same name — quotes that feature's text. Removing or renaming an
applied feature updates the field; anything typed there by hand is left alone.
A preset can be added from the library, and every applied feature appears as a
plain-language checkbox with a remove button. The raw JSON editor is kept in an
optional **Script** panel for advanced editing and opens automatically when saved
rules are invalid. Invalid text is preserved so it can be corrected, but it never
executes and never prevents the normal attack.

Version 1 deliberately supports a small, declarative rule set rather than
arbitrary JavaScript. Rules can be automatic or manual. Manual rules appear as
localized checkboxes in the attack roll dialog and apply only while selected. The
schema now supports fixed damage bonuses, advantage, self-damage, safe damage-die
replacement, quantity-aware Item destruction/theft, and a structured Swallow
state in addition to the original derived extra-damage effects.

```json
{
  "version": 1,
  "rules": [
    {
      "id": "gore",
      "name": "Gore",
      "enabled": true,
      "trigger": "afterAttackBatch",
      "scope": "attackSession",
      "conditions": [
        { "type": "sameTargetHits", "minimum": 2 }
      ],
      "effects": [
        {
          "type": "extraDamageDie",
          "count": 1,
          "oncePerTarget": true
        }
      ]
    }
  ]
}
```

`attackSession` counts successful hits cumulatively for the lifetime of the open
attack dialog. `currentBatch` restricts the count to the attacks made by the most
recent press of Roll. With `oncePerTarget` omitted or `true`, a particular effect
fires only once for each qualifying target in that dialog session. Setting it to
`false` permits it to fire again after later qualifying batches.

Attack rerolls remain linked to their original attack result for up to one hour in
the current client session. A failed attack that rerolls into a success therefore
updates that result and can satisfy `sameTargetHits`; repeatedly rerolling the same
attack never creates additional ledger entries. The transient link does not
survive a world reload or transfer the in-memory session to another connected
client.

Extra damage uses Shadowdark's damage-roll and chat-card workflow, targets the
qualifying token, and remains a separate damage roll. The module does not execute
arbitrary scripts or add a general expression language. Specific validated effects
may update HP, Items, Token visibility, and module-owned state as documented below.
Rule names entered by users are world-authored content and are therefore not
translated; built-in preset terminology is localized when the preset is copied.

The schema retains explicit `extraDamage` formulas and also supports
`extraDamageDie` and `extraBaseDamage`. These derive additional dice or a multiple
of the Attack Item's current base damage. Standard formulas such as `1d6`, `2d8`,
and `1d12+3` are supported. Compound expressions are preserved but produce a
warning instead of an unreliable derived roll. Manual rules may also declare an
`attackLimit`; Charge limits the current batch to one attack and adds twice the
base damage, producing three times total damage on a hit. Shatter declares
none: every attack in a batch with Shatter switched on is a shattering blow.

### Preset library

The module settings place the GM-only **Custom Attack Preset Library** directly
under **Enable Custom Attack Rules** and hide it when the feature is disabled
without deleting saved presets. Seventeen localized presets are built in and
read-only: Gore, Crush, Charge, Rampage, Ambush, Backstab, Assassinate,
Algae-Eater, Shatter, Mob, Pod Hunter, Swallow, Grab, Rage, Greedy, Poison, and Sever.
Duplicate
any preset to create an editable world preset. Custom presets contain a name,
description, category,
comma-separated tags, schema version, and a validated version 1 rules document.

The library supports creating, editing, duplicating, deleting, searching, copying,
and importing or exporting JSON. A complete custom library can also be exported as
one file. Imported preset IDs are made unique without overwriting existing entries,
and invalid imports are rejected with a property path and validation reason.

The NPC Attack Item sheet lists built-in and custom presets whenever Custom rules
are enabled. **Add** appends a preset and safely renames duplicate rule IDs.
Applying a preset copies a snapshot into the Item rather than linking it to the
library, so later library edits or deletion cannot silently change existing
creatures. Applied rules can be enabled, disabled, or removed without opening the
raw JSON.

The Custom section also provides **Reset**. After an explicit Yes/Cancel
confirmation, Reset replaces the Item's rule source with the empty version 1
document while leaving the Custom enablement choice intact.

An importable generic collection is bundled at
`presets/shadowdark-monster-attack-library.json`, generated from the built-in
profiles by `node tools/export-preset-library.mjs`. It contains the same seventeen
mechanical profiles without duplicating them for individual monsters.

The Sever profile records the kept natural d20 result. A successful natural 18+
rolls 1d6 and posts a localized result: head on 1, arm on 2–4, or leg on 5–6. It
reports the severed limb but deliberately does not invent further injury rules.

### Inventory and Swallow effects

Shatter selects one piece of nonmagical **gear** on the target — equipped or
carried, but never magic items, scrolls, potions, wands, gems or treasure — and
destroys it instead of dealing damage — once per hit, so two hits in a batch
ruin two pieces. A stack of N loses `1dN` (eleven of twenty arrows, say). The ruined gear is copied onto the attacking NPC, flagged
as destroyed, and linked from its Description under *Destroyed on*; no world
folder, since ruined gear is not loot. Grab selects one Item at random from the
target's **Carried Gear** or **Gems** — the same partition the
character sheet uses, so equipped and stashed Items are never taken. Both respect
Item quantity: one unit is removed from a stack, otherwise the Item document is
removed. These document-changing effects require update permission for both
Actors, and both built-ins carry `targetActorTypes: ["Player"]`, so they leave
other monsters alone.

**Greedy** replaces the automatic pick with a GM decision. On a hit against a
player character it replaces the attack's damage and opens a GM-only window
listing everything the target carries, grouped as **Carried Gear** (treasure
included), **Gems** and **Coins** (one row per denomination held). The GM
highlights whatever the creature could plausibly grab and presses **Steal!**; one
highlighted entry is chosen by a `1dN` roll, or taken directly if only one was
highlighted. A coin entry yields `1d100` coins of that denomination, never more
than the target holds. **Steal nothing**, or closing the window, resolves the
attack with nothing taken. Either way a whispered card records the outcome. If
the target carries nothing at all — no gear, no gems, no coins — Greedy does not
fire and the attack deals normal damage.

A stolen Item is written in two places on purpose. One copy is embedded on the
attacking NPC, which is the honest model but which the Shadowdark NPC sheet never
displays. A second copy is created in the world **Items** directory inside a grey
folder named **Stolen**, created on first use, so the GM can actually find it.
The NPC's Description gains an entry naming the victim and linking both copies.
Coins are not Items and NPCs have no coin pool, so a stolen sum is recorded only
in that Description entry.

### Saves

The `save` effect makes the **target** roll a Shadowdark ability check against a
DC after a hit, and applies a consequence on failure. It fires once per
qualifying hit rather than once per target, so a creature with two attacks that
lands both forces two checks — every built-in save preset, lethal poison
included, works this way. The **Once per target** parameter on an applied
feature narrows it to one check per target per attack session. The check goes through Shadowdark's own generator, so
its card gets the module's tint and reroll controls like any other check.

```json
{ "type": "save", "ability": "con", "dc": 12, "damage": "1d4" }
```

`ability` is one of `str`, `dex`, `con`, `int`, `wis`, `cha`; `dc` is 1–40;
`damage` is any valid roll formula and is rolled with the attacker's roll data.
The built-in **Poison** preset is exactly the example above. Only damage is
supported as a consequence so far; conditions and delayed effects are intended
to be added as further optional fields on the same effect.

Every effect accepts an optional `targetActorTypes` array (`"Player"`, `"NPC"`)
restricting which Actors it may act on; `stealGear` additionally takes
`"selection": "random"` (default, used by Grab) or `"prompt"` (used by Greedy).

### Saves and their consequences

Shadowdark's monster features are mostly one shape — *make a check or suffer X*
— under many names: Toxin, Poison, Venom, Paralyze, Petrify, Knock. The module
models that shape once, as the `save` effect, and ships one preset per
**consequence** rather than one per name. The parts that vary between monsters
are edited on the attack itself (see *Parameters* below), so a single
**Poison (Paralyze)** serves the giant centipede at DC 12 and the ghoul at DC 15,
and can be renamed "Toxin" on either.

```jsonc
{
  "type": "save",
  "ability": "con",           // str, dex, con, int, wis, cha
  "dc": 12,
  "onFailure": {              // exactly one consequence:
    "damage": "1d4",                                            // Poison (Damage)
    "condition": "paralysis",                                   // Poison (Paralyze), Poison (Sleep), Petrify, Knock
      "duration": { "formula": "1d4", "unit": "rounds" },       //   optional; rounds | hours | days
      "limb": false,                                            //   optional; Petrify a random limb only
    "setHp": 0, "deathTimer": "1",                              // Poison (Lethal); timer is a formula, e.g. "1 + @abilities.con.mod"
    "abilityDamage": { "ability": "wis", "formula": "1d6" },    // saveless variant is the abilityDamage effect
    "note": "Pushed a close distance."                          // optional free text shown on the result card
  },
  "oncePerTarget": false      // default for saves: every hit is a fresh check
}
```

The pre-release shorthand `"damage": "1d4"` on a `save` is still accepted.

`"abilityDamage"` is also an effect of its own — `{ "type": "abilityDamage",
"ability": "con", "formula": "1d4", "note": "…" }` — for Drain and Life Drain,
which reduce an ability score with no check. Scores never drop below 0; what
happens at 0 is the note's job, because Shadowdark makes it narrative.

Conditions are Foundry status effects: `paralysis`, `sleep`, `prone`,
`unconscious`, `stun`, `restrain`, `blind`, `fear` and `poison` come from core;
`petrified` is registered by this module. A failed save adds the status as an
ActiveEffect. Round durations are stamped onto the effect and counted by Foundry
while a combat runs; hour and day durations are recorded but **not expired
automatically** — Foundry core never removes an expired effect — so clear them
when they end.

**Who rolls.** By default the check is **handed to the player**. When a rule
calls for one, a request card appears under the attack — *Victim must pass a
CON check (DC 12) or suffer: 1d4 damage* — with a **Roll** button and a grey
**Cancel** button. Only the target's owner or a GM can press either; for
everyone else the buttons are greyed out. Roll opens the system's usual roll
prompt for that character (advantage, roll mode; the DC is fixed by the rule),
and the check lands in chat as an ordinary Shadowdark check card. The
**active GM's client** then settles the request: the card is rewritten with
*Resisted* or *Failed to resist*, and only on a failure is the consequence
applied and its record posted. Cancel withdraws a misfire — a player's cancel
is carried to the GM over the module socket. A hidden attack (`gmroll`,
`blindroll`) whispers its request to the GM and the target's owner only.

World setting **Ability checks asked of targets** switches this to **Roll
automatically**, where the engine rolls the check on the
spot. Swallow's STR check follows the same setting. Player characters are
always asked — in a world where the GM is the only user, the GM presses Roll
for them. A monster no player owns is rolled on the spot, since there is
nobody to ask.

A luck-token reroll of an already settled check is *not* re-adjudicated; the
new result shows on the check card for the GM to act on by hand.

**Chat.** The save card's heading names what is at stake — *CON check (DC 12) —
resisting: paralyzed for 1d4 rounds* — and the result card says *Resisted:* or
*Failed to resist:* with the same label instead of a bare pass/fail. A separate
whispered card records the consequence actually applied, with any duration or
limb rolled and the effect's note.

Knock reports "pushed a close distance" for the GM to apply by hand. Tokens are
never moved automatically.

**Death timers.** `deathTimer` is rolled against the *target* when the lethal
save fails, so `"1 + @abilities.con.mod"` works. The result is parked on the
actor as a one-shot `pendingDeathTimer` flag. With **MK-Shadowdark** installed,
the next press of its Death Timer button on that actor starts the timer at
exactly that value instead of rolling `1d4 + CON`; every later tick, and every
timer on an unpoisoned character, goes to MK untouched. The flag is consumed by
that first start, and cleared if the character is healed above 0 HP before it
happens, so one lethal poison forces exactly one timer. Without MK the value is
only reported on the consequence card. The **Poison (Lethal)** preset ships
with a death timer of `1`; the field is always shown on a lethal feature, and
clearing it leaves the timer to the system.

The built-in presets are listed alphabetically by their localized name. The
library window keeps its list scrolled where it was, and its search filter,
when a preset is selected.

### Parameters

Every applied feature on an NPC Attack Item shows its editable values directly
beneath its checkbox: the display name, and per effect the check ability, DC,
damage or duration formula, condition, duration unit, the Petrify limb toggle,
death timer, drained ability and note — whichever that effect actually carries
— and a **Once per target** switch on every effect that can be so narrowed.
Extra-damage dice, multipliers, bonuses, die replacement and Swallow's numbers
are editable the same way. Each change is validated against the schema before
it is written back; an invalid value is refused with the validation reason and
the field reverts.

Swallow uses a module-owned flag on the swallowed Token, hides that Token, and
adds a module status effect after a failed automatic DC 12 STR check. On each later
turn of the swallower it deals 1d8 HP damage. Standard Shadowdark chat-card damage
dealt from inside the gullet is accumulated by combat round; reaching 15 releases
all swallowed targets. A GM can also release a swallowed Token from its Token HUD.
Its previous hidden state is restored on release.

## Module settings

The module's tab in Game Settings is divided into six sections, in the order
of this README, each with a one-line description of the part of play it
touches. World-scoped settings (chosen by the GM, applying to every player)
carry a **World** badge; everything else is a per-user preference.

**NPC multiattacks** — one dialog counting a monster's attacks down.

- Enable Attack Autocounter
- Default number of chosen attacks: `1` or `All`

**Targeting** — target pools in the dialogs, and how target names are drawn.

- Enable Target Selector (NPC attacks), with the Targeting Keys button and the
  NPC / PC target font style and color rows (visible while the selector is on)
- Enable PC Attack Targeting
- Enable Spell Targeting
- Yield to MK-Shadowdark Targeting Assistant (hides its duplicate panel and
  mirrors this module's targets onto the canvas so its roll gate passes)

**Roll dialog and Token HUD** — choosing what to roll.

- Attack and spell interface: *Merged* (choose inside the roll dialog; the
  HUD's quick buttons open it) or *Separate* (HUD palettes and plain dialogs)
- Include unarmed attacks (world)
- Enable Quick Attack Button
- Enable Quick Spell Button
- Favorite Spells on the Abilities tab (shown while Quick Spell is enabled)
- Enable Quick Ability Button
- Enable Quick Attribute Button (PCs)
- Tooltip Hover Window Delay, shared by Quick Attack, Quick Spell, and Quick Ability
  (visible while any of those launchers is enabled; default 0.5 seconds, minimum 0)

**Chat cards** — rerolls, numbering and result colours.

- Enable Chat Reroll Modes
- Enable Single-Roll Comparison Rerolls
- Number Multiattack Messages
- Tint Attack and Attribute Results and four configurable result colors
- Tint Spellcasting Results and four configurable result colors

**Spell mishaps** (world)

- Enable Automatic Spell Mishaps
- Spell Mishap Tables (GM-only configuration window)

**Attack Features** (world)

- Enable Custom Attack Rules
- Custom Attack Preset Library (GM-only submenu)
- Ability checks asked of targets: prompt the target's player, or resolve
  automatically

The PC/NPC font rows are visible only while **Enable Target Selector** is checked.
Regular, bold, and italic styles are available. Hiding the rows does not erase
their saved client values. Each row combines its style,
hex value, and native color bar. The browser's native picker supplies any available
color-format controls, while the saved setting remains a normalized `#RRGGBB`
value.

Separately executed module-managed NPC attacks carry temporary attack-sequence
metadata in their Shadowdark roll configuration and a module-owned ChatMessage
flag. When enabled, their chat cards show `Attack 1/N`, `Attack 2/N`, and so on,
including attacks made across successive autocounter batches. A separate client option adds an
upper-card gradient based on miss, critical failure, success, or critical success.
Each result color is configurable; hiding or disabling the tint controls preserves
the saved colors. The attack-result tint also applies to ordinary single attacks
made by NPCs and PCs, without adding sequence numbers.

Spellcasting check cards have their own client-side tint toggle and four colors.
Automatic spell mishaps are a separate world feature. A dedicated
**Configure Mishap Tables** settings button opens a resizable editor for casting
class and tier-band RollTable mappings. The button is placed directly beneath the
Automatic Spell Mishaps toggle in the module settings. On a spell critical failure,
the module resolves the spell's casting-class Item and tier, selects the configured
tier 1–2, tier 3–4, or tier 5 RollTable, draws without creating a second table chat
message, and appends the rendered result to the original spell card. Unmapped
classes and blank tier-table fields do nothing. Wizard is included by default with
Shadowdark's three core Wizard Mishap tables; GMs can add, remove, or edit class
mappings without changing Actor, Class, or Spell data.

Result tints are rendered as a separate transparent overlay above the chat-message
background. This preserves Foundry backgrounds and compatible third-party chat
textures, including MK-Shadowdark Paper Chat, instead of replacing their
`background` or `background-image` declarations. An MK-specific cascade rule keeps
that overlay absolutely positioned despite Paper Chat's direct-child layout rule.

## Scope

- Foundry VTT v13 or v14
- Shadowdark RPG 4.x
- Normal Shadowdark NPC Actors for multiattack and target-pool behavior
- Normal Shadowdark NPC and Player Actors for Token HUD quick attacks, spells, abilities, and PC attributes
- Native `NPC Attack` Items
- Custom-rule source and enablement persist on the NPC Attack Item as
  `flags.gt-shadowdark-combat-refinements.customRules` and
  `flags.gt-shadowdark-combat-refinements.customRulesEnabled`
- Custom world presets persist in the hidden world setting
  `gt-shadowdark-combat-refinements.customRulePresets`
- Spell mishap class/table mappings persist in the hidden world setting
  `gt-shadowdark-combat-refinements.spellMishapMappings`
- Swallow state persists per Token as
  `flags.gt-shadowdark-combat-refinements.swallowed`
- PC quick-spell and spell-sheet favorite IDs persist on the Actor in
  `flags.gt-shadowdark-combat-refinements.favoriteSpells`
- Remaining attacks exist only for the lifetime of the open attack dialog
- Target pools exist only for the lifetime of the open attack dialog
- PC spell target pools exist only for the lifetime of the open spell dialog
- Custom-rule hit ledgers exist only for the lifetime of the open attack dialog

Shift-click or other no-dialog attacks remain a single attack because no quantity
was selected.

## Migrating from GT-NPC Multiattack

Version 1.0 renames the module to `gt-shadowdark-combat-refinements`
("GT Combat Refinements"). The first time a world loads the renamed module, the
active GM's client carries the following across from `gt-npc-multiattack` and
then clears the old keys:

- world settings, including the custom preset library and the spell-mishap
  class/table mappings;
- `customRules` and `customRulesEnabled` Item flags, on world Items and on Items
  embedded in Actors and unlinked tokens; the retired `metallic` flag is stripped
  from both namespaces wherever it is found;
- `favoriteSpells` Actor flags;
- `swallowed` Token flags, across **every** scene rather than only the active one.

Each connected user's own client preferences migrate when they log in.

Values already present under the new identity are never overwritten. Flag readers
also fall back to the old namespace for this release, so a document the sweep
misses keeps working until it is migrated. The swallow status-effect id is
deliberately unchanged so ActiveEffects already on swallowed tokens stay
recognisable.

**Before updating,** release any creature currently swallowed. A swallowed token
is hidden and has no release control except the one this module adds, so a token
whose flag is not carried across would otherwise need to be un-hidden by hand.

Uninstall GT-NPC Multiattack after the migration reports success; running both at
once is not supported.

## Development

- `node tests/runtime-smoke.mjs` runs the smoke suite.
- `node tools/export-preset-library.mjs` regenerates the bundled preset JSON from
  `BUILTIN_PRESETS`; the suite fails if the two drift.
- `node tools/build-release.mjs` stages a distributable copy in `dist/`,
  excluding `tests/`, `docs/` and `tools/`, and writes the two GitHub release
  assets: `dist/gt-shadowdark-combat-refinements.zip` and `dist/module.json`.

### Publishing a release

`module.json` points Foundry at GitHub: `manifest` is the **latest** release's
`module.json`, `download` is the versioned zip. For each release:

1. Bump `version` and the version in `download` in `module.json` (the build warns
   when they disagree).
2. `node tools/build-release.mjs`.
3. Create a GitHub release tagged `<version>` (bare, e.g. `1.1.0`) and attach **both**
   `dist/module.json` and `dist/gt-shadowdark-combat-refinements.zip`.

Users install with the manifest URL
`https://github.com/Nike-bit/gt-shadowdark-combat-refinements/releases/latest/download/module.json`.
