**GT Combat Refinements v1.0** — a Foundry VTT module for **Shadowdark RPG**
Optional combat tools that sit on top of Shadowdark's own dialogs and rolls. Everything is a setting; nothing replaces the system's mechanics. Foundry v13–v14, Shadowdark 4.x. MK-Shadowdark compatible. 

__**Gamemaster features**__

**NPC Multiattack**
• `Num. Attacks` > 1 puts a selected/max counter in the native attack dialog — roll 1, 2 or all attacks with one press, each as its own Shadowdark roll and chat card.
• Autocounter: the dialog stays open and the pool counts down (`2/3` → `1/1`) until the creature is out of attacks.
• Chat cards are numbered `Attack 1/N`, `Attack 2/N` … and optionally tinted by result (miss / crit fail / hit / crit).

**Target Selection (NPC attacks)**
• A **Target** row in the attack dialog: split the attacks across several scene tokens, each row with its own advantage / normal / disadvantage and its own share of attacks. AC is read from the chosen token.
• Hover a token and press `T` to add it or give it another attack; `Shift+.` / `Shift+,` adjust the hovered target (rebindable).
• **Random** mode: build a pool, and `k` attacks are dealt out with `1dN` rolls — a GM-whispered summary shows who got what.
• **Sees Hidden**: let this attack target hidden tokens without unhiding them.
• Coexists with MK-Shadowdark's Targeting Assistant (its duplicate panel is hidden and the module's picks are mirrored to the canvas).

**Attack Features — automated monster abilities**
The NPC Attack sheet gets an **Attack Features** box: pick a preset, press **Add**, and the attack runs it. Applied features show as plain checkboxes with their editable numbers underneath (DC, ability, damage, duration, condition, limb, death timer, once-per-target, name). Names are written into Shadowdark's own Attack Features field, so the attack card names them and quotes a same-named NPC Feature.
Built-in presets (all editable, all alphabetical):
• **Gore / Crush / Charge / Ambush / Rampage / Backstab / Assassinate** — extra dice or multiplied base damage when hits stack up, on a natural 18+, or on a charge (one attack, triple damage).
• **Mob / Pod Hunter** — flat damage bonuses you switch on when the situation applies.
• **Rage** — d6 → d8 damage dice while the creature is wounded.
• **Algae-Eater** — every attack rolls with advantage and costs the creature 1d4 HP.
• **Poison (Damage / Paralyze / Sleep / Lethal)**, **Petrify**, **Knock**, **Ability Drain** — the target makes an ability check or suffers: damage, a condition with a rolled duration, a petrified limb, a drop to 0 HP with a set death timer, or lost ability points. One check per hit.
• **Swallow** — STR check or be swallowed whole: hidden, statused, 1d8 a turn, released after enough damage from the inside.
• **Grab** — steal a random carried item; it lands on the NPC *and* in an **Items → Stolen** folder.
• **Greedy** — instead of damage, a GM window lists the victim's gear, gems and coins; highlight the plausible loot and `1dN` picks (coins: `1d100`).
• **Shatter** — each hit destroys a random piece of nonmagical gear (`1dN` of a stack); the ruin is recorded on the NPC.
• **Sever** — on a natural 18+, roll which limb.
Manual features (Charge, Shatter, Greedy, Mob…) appear as **Conditional Features** checkboxes in the attack dialog, so you decide per batch.

**Preset Library**
• A GM window to browse, duplicate, edit, import and export presets as JSON; write your own with a validated schema (no scripting, nothing executes unless it validates).
• The full monster feature library ships as an importable JSON file.

**Interactive saves — the player rolls**
• When a feature calls for a check, a request card appears under the attack: *Elara must pass a CON check (DC 12) or suffer: 1d4 damage* — with **Roll** and a grey **Cancel**. Only the target's owner (or GM) can press them.
• The result and consequence are applied only after the roll. Switch to fully automatic rolling in settings if you prefer speed.

**Death timers with MK-Shadowdark**
• A lethal poison parks its death timer on the character; the next press of MK's Death Timer button starts at that value (e.g. `1`, or `1 + @abilities.con.mod`) instead of rolling.

**Spell Mishaps**
• On a spellcasting critical failure the module draws from the class's mishap table for the spell's tier and appends the result to the spell card. Wizard is mapped out of the box; map any casting class to any RollTables.

**Quick actions on the Token HUD (NPCs too)**
• **Quick Attack**, **Quick Spell**, **Quick Ability** buttons open palettes of the token's attacks, spells (All / Tier tabs, wands, scrolls, favourites) and special attacks / features, straight into Shadowdark's native rolls. Hover any entry for its description.

__**Player features**__

**Targeting from the attack and spell dialogs**
• A **Target** row in your attack dialog remembers the token you targeted; **Random** builds a pool of targets and picks one when you roll.
• Spells get the same, plus **Area**: keep every target and list them on the spell card, with a per-target apply-damage button for the GM.
• **Sees Hidden** for the cases the GM allows.

**Roll your own saves**
• When a monster's poison, gaze or bite calls for a check, *you* get the card and press **Roll** — the standard Shadowdark check prompt opens for your character (pick advantage, roll mode), and the outcome shows *Resisted* or *Failed to resist* with what was at stake.

**Reroll modes (luck tokens)**
• `kh.` / `kl.` buttons beside Shadowdark's reroll icon on attacks, spell checks and attribute checks. A roll made with advantage rerolls two dice; a plain roll can reroll **one** die and keep the higher (or lower) of the two.

**Quick actions on the Token HUD**
• **Quick Attack** — your equipped weapons (melee and ranged, thrown in both), with modifier, damage and range, hover for the description and weapon qualities.
• **Quick Spell** — all your spells by tier, wand and scroll spells, focus casting, and a 'star' favourites section (the star also appears on your character sheet).
• **Quick Ability** — class abilities with their remaining uses.
• **Quick Attribute** — a d20 button for STR/DEX/CON/INT/WIS/CHA checks. Every attribute check dialog gains a **Difficulty** field (9 / 12 / 15 / 18 or custom) and the card reports the DC and the result.

**Chat**
• Attack, attribute and spellcasting cards can be tinted by result with your own colours, without breaking chat textures like MK-Shadowdark Paper Chat.

__**Migration**__
Previously published as *GT-NPC Multiattack* — settings, favourites, applied features and swallow states migrate automatically on first load.
