# Changelog

## Unreleased

- Renamed the Chase action to “Roll to Overcome” in both the encounter window and sidebar.
- Added PF2e-style outcome colors to subsystem result cards: green for critical success, blue for success, orange for failure, and red for critical failure.
- Added a persistent, serialized GM check-request queue with duplicate prevention, explicit adjudicate/cancel controls, requester confirmations, and automatic cancellation of stale requests when another PC overcomes the obstacle.
- Added Chase progress announcements when the party overcomes an obstacle without yet winning, including quarry catch-up and pursuer lead messages.
- Standardized newly added player-facing punctuation on em dashes.
- Added optional per-PC maximum RP limits and per-PC source availability for Research encounters. Research awards now track each participant's contribution by source, enforce personal caps, and automatically exhaust that source for the affected PC only.
- Added a GM-facing per-source participant ledger with editable RP contributions and access states. Manual contribution changes keep the source and encounter totals synchronized.
- Extended Research text parsing to recognize “Maximum RP” and common “Maximum RP per PC” forms.
- Fixed duplicated Research encounters retaining accumulated shared, source, or per-PC progress.

## 0.4.0 — 2026-09-08

- Added the Chase Down catch victory condition and public “You caught…” notification. Chase victories can now show a full-screen, image-backed splash with customizable headline, either automatically or from a GM-only trigger in the tracker.
- Added an optional Chase setting that obscures future obstacles from players. Players see completed and active obstacles only, receive relative quarry/pursuer position text instead of an exact location, and get non-spoiling movement updates in chat.
- Changed the active encounter tracker's Manage button to Edit Encounter; it now opens the active encounter directly in its editor instead of opening the full encounter manager.
- Added explicit Chase Subject pace, starting obstacle, and Before/After Party turn-order controls. The active tracker marks the subject's current obstacle and announces each subject movement in chat when the GM advances the round.
- Players who own multiple participating PCs can now select any eligible PC directly from the encounter sidebar. After a check, the client automatically selects the next owned PC who has not acted instead of remaining stuck on the character who just acted.
- Changed Duplicate to create a clean new draft. Chase copies now select obstacle 1, reset runtime progress and logs, and preserve all configured obstacles, subject data, artwork, checks, and circumstances.
- Fixed newly activated Chases opening on the most recently added or edited obstacle; draft Chases now begin at their first incomplete obstacle, and adding later obstacles no longer changes the runtime position.
- Fixed dropping an Actor onto the persistent Chase Subject also propagating into an obstacle drop handler and overwriting the first obstacle's name and image.
- Added a persistent Chase Subject with role, name, nickname, Actor drag-and-drop linking, and file-picked artwork, plus an overall chase description and cinematic background. Chase presentations now show the acting PC, current obstacle image, and persistent subject in a three-panel composition.
- Added a Chase Circumstances tab for reusable global or obstacle-specific bonuses, penalties, and DC adjustments. Configured circumstances appear as optional checkboxes when the GM adjudicates a matching Overcome check and can be limited to particular statistics.
- Added Fortitude, Reflex, and Will saves to the Chase Overcome picker with their correct PF2e statistic slugs; Lore Overcome checks continue to default to the level-based Easy DC (standard DC minus 2).
- Added the first Chase subsystem prototype with ordered obstacles, per-obstacle Chase Points, PF2e degree-of-success awards, no CP carryover, round/action tracking, pass/unable penalties, manual CP controls, pause/resume, undo, and automatic obstacle transitions.
- Added configuration fields for Chase Down, Run Away, Beat the Clock, Competitive, and Custom chase designs, plus deterministic opponent pacing, configurable round limits and outcomes, and exact/relative/hidden Overcome DC presentation.
- Added the five-obstacle `Where Is the Governor?` Season of Ghosts sample chase with all published Overcome checks, DCs, descriptions, and situational modifiers.
- Added Chase-aware player and GM tracker, sidebar, chat results, check log, victory/failure notices, and Journal publication.

## 0.3.0 — 2026-09-07

- Critical-failure IP losses that drop a target below a threshold now post a separate public Reward Lost card after the negative Influence Point notice.
- Fixed existing Global Progress Clock labels failing to repaint on player clients after an encounter nickname was changed.
- Added encounter-specific PC and target nicknames for compact display in the tracker, sidebar, cinematic portraits, chat cards, logs, and published summaries without changing linked Actor names.
- Shortened Influence progress-clock labels to each target's nickname or name instead of prefixing every clock with the encounter name.
- Extended optional Global Progress Clocks support to Influence encounters, with one public IP clock per target that remains visible while the encounter is active or paused and is cleaned up when its target or encounter is removed.
- Influence threshold rewards now receive their own public Reward Earned chat card, separate from the Influence Point result notice and limited to player-visible reward details.
- Concealed subsystem check DCs and success margins on player-facing PF2e roll cards while retaining public Influence rolls and their degree of success.
- Restored GM and player encounter-sidebar interaction by explicitly enabling pointer events on the custom Foundry sidebar panel.
- Fixed the Chat sidebar disappearing on the first switch away from the Influence sidebar by preserving Foundry's required sidebar-content classes.
- Fixed the same first-switch failure by allowing Foundry's tab handler to run before the Influence sidebar cleanup.
- Private Discovery revelation cards now have distinct blue module styling and omit the redundant visible recipient line while remaining privately delivered.
- Result notices now use Foundry's normal OOC message style plus a durable outer-message marker and high-contrast green treatment.
- Influence and Research result cards now use distinct result styling and carry no unnecessary recipient metadata; the redundant GM-only Discovery summary card was removed.
- GM point adjustments now refresh player clients immediately.
- Successful Discovery choices are persisted until resolved, restored after player reconnects, and can be completed manually by the GM from the check log.
- Failed Discovery checks now post a public chat card stating that the acting PC learned nothing new about the target.
- Committing a check request now updates the shared cinematic portraits to its PC and target and posts a public chat acknowledgment naming the requested action and skill.
- Existing Influence targets can now be linked or relinked by dropping an Actor or Token onto their cards; this updates identity and art while preserving encounter mechanics, with an option to unlink later.
- New Research encounters begin with First through Fourth Discovery at 2, 4, 6, and 8 RP.
- Saving now refreshes the open editor so updated Discovery threshold names and RP values appear immediately.
- Selecting a Lore skill now automatically checks its Lore checkbox.
- Fixed Research sources disappearing from the Skills tab after saving source details.
- Research editors now omit the inapplicable Weakness & Strength tab and label their results tab Discoveries.
- Removed the generated placeholder NPC from new multi-NPC encounters; their first target must now be added explicitly through drag-and-drop or Add Influence Target.
- Added the Research subsystem with shared Research Points, timed research intervals, multiple independently capped/hidden/exhausted sources, source-specific skill DCs and degree-of-success awards, and encounter-wide discovery thresholds.
- Added Actor, Item, Journal, and Journal-page drag-and-drop for Research sources, plus source-text parsing and manual source/threshold editing.
- Added the complete `Researching the Eighth` sample encounter, including its eight sources, 24 RP discovery ladder, source requirements, and special critical-failure penalty.
- Fixed hidden Research sources remaining visible in the GM-facing active tracker after editing and resuming an encounter; selection now falls back to a visible source.
- Added optional Global Progress Clocks integration for Research encounters. An enabled shared-RP tracker stays visible while active or paused, updates with Research progress, and is removed when completed, deleted, or switched off.
- Added PF2e level-based automatic skill DCs. New and otherwise untouched checks follow the encounter level, Lore defaults to the Easy adjustment, and manually edited DCs are preserved.
- Expanded the skill picker with common Lore skills plus searchable specialization dialogs for deity, creature, organization, settlement, terrain, and food or drink Lore.

## 0.2.0 — 2026-09-03

- Added saved pause/resume support. GMs can pause or resume encounters from the tracker, manager, or Influence sidebar context menu; paused encounters hide the cinematic presentation, prevent new checks, preserve all progress, and mark their Journal record and UI entries as `(Paused)`.
- Added editable PF2e skill pickers and a per-NPC text parser for published Background, Appearance, Personality, Discovery/Influence DCs, thresholds, rewards, Resistances/Strengths, and Weaknesses.
- Changed the ApplicationV2 editor to save in place and added a three-choice unsaved-changes warning when a modified encounter is closed.
- Added true per-NPC Influence Points, Discovery and Influence skills, DCs, weaknesses, resistances, thresholds, and rewards.
- Added GM-only Background and Personality notes plus player-visible Appearance text for each influence target.
- Added structured cross-NPC roll modifiers, DC adjustments, limited-use effects, manual IP rewards, and narrative rewards.
- Added the five-target Peace Talks sample encounter.
- Updated the tracker, check log, discoveries, and Journal publication for multi-NPC encounters.
- Migrated the encounter editor to Foundry's ApplicationV2 framework and native theme variables.
- Fixed active-encounter deletion so it ends and publishes the encounter, clears the active state, and releases the cinematic display.
- Added editor drop zones for participating PCs and influence targets dragged from the Actor directory or canvas, preserving Actor links, names, and prototype-token/actor images.
- Removed the generated encounter-name placeholder target once real Actor-linked NPCs are added, preventing a false encounter-wide Skills section.
- Replaced typed image-path fields with Foundry file pickers for encounter images, cinematic backgrounds, and NPC portraits.
- Enlarged both Actor drop zones into full-width rounded panels with prominent dashed outlines and drag-over highlighting.
- Added player-private acting-PC and target selections, restricted acting-PC choices to Owner-level characters, and made current-phase acted status prominent in the encounter window and player sidebar.

## 0.1.6 — 2026-09-02

- Added a Foundry-style Influence Encounter sidebar with folders, search, drag-and-drop organization, and context menus.
- Added encounter and folder creation/configuration dialogs that follow Foundry's interface conventions.
- Added encounter duplication and portable JSON import/export.
- Added selectable party participants and drag-and-drop NPC influence targets.
- Added cinematic PC/NPC portrait presentation, optional background images, and canvas blur.
- Added per-check logging, player-safe Discovery outcomes, discoveries, and threshold-boon details.
- Added GM narrative modifiers, manual Influence Point adjustment, phase reversal, and functional undo.
- Corrected Discovery checks so they never award Influence Points.
- Limited Lore choices to Lore skills present on the acting character's sheet.
- Added participant buttons for requesting checks without selecting a token.
- Added Journal-backed encounter records and player-facing publication at encounter end.
- Added application theming that follows Foundry's Browser Default, Dark, and Light settings.
- Corrected the editor form structure and restored reliable editing and saving.
