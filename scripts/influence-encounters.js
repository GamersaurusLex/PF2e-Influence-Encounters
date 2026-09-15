const MODULE_ID = "influence-encounters";
const SOCKET = `module.${MODULE_ID}`;
const SETTINGS = { encounters: "encounters", active: "activeEncounter", folders: "encounterFolders", selections: "userSelections" };
const { Application, Dialog } = foundry.appv1.api;
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const deepClone = (value) => foundry.utils.deepClone(value);
const randomID = () => foundry.utils.randomID();
const esc = (value = "") => foundry.utils.escapeHTML(String(value));
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;

const PF2E_SKILLS = [
  "Acrobatics", "Arcana", "Athletics", "Crafting", "Deception", "Diplomacy", "Intimidation",
  "Medicine", "Nature", "Occultism", "Performance", "Perception", "Religion", "Society",
  "Stealth", "Survival", "Thievery"
];

const PF2E_SAVES = ["Fortitude Save", "Reflex Save", "Will Save"];
const PF2E_SAVE_SLUGS = { "fortitude save": "fortitude", "reflex save": "reflex", "will save": "will" };

const PF2E_LORE_SKILLS = [
  "Academia Lore", "Accounting Lore", "Architecture Lore", "Art Lore", "Astronomy Lore", "Carpentry Lore",
  "Circus Lore", "Driving Lore", "Engineering Lore", "Farming Lore", "Fishing Lore", "Fortune-Telling Lore",
  "Games Lore", "Genealogy Lore", "Gladiatorial Lore", "Guild Lore", "Heraldry Lore", "Herbalism Lore",
  "Hunting Lore", "Labor Lore", "Legal Lore", "Library Lore", "Mercantile Lore", "Milling Lore", "Mining Lore",
  "Piloting Lore", "Sailing Lore", "Scouting Lore", "Scribing Lore", "Stabling Lore", "Tanning Lore",
  "Theater Lore", "Underworld Lore", "Warfare Lore"
];

const LORE_CATEGORIES = {
  "Lore about a specific deity *": ["Abadar Lore", "Iomedae Lore", "Pharasma Lore", "Sarenrae Lore", "Shelyn Lore"],
  "Lore about a specific creature or narrow category of creatures *": ["Demon Lore", "Dragon Lore", "Giant Lore", "Undead Lore", "Vampire Lore"],
  "Lore about a specific public organization *": ["Hellknights Lore", "Pathfinder Society Lore", "Aspis Consortium Lore"],
  "Lore about a specific settlement *": ["Absalom Lore", "Korvosa Lore", "Magnimar Lore", "Sandpoint Lore"],
  "Lore about a specific terrain *": ["Desert Lore", "Forest Lore", "Mountain Lore", "River Lore", "Swamp Lore"],
  "Lore about a type of food or drink *": ["Alcohol Lore", "Baking Lore", "Butchering Lore", "Cooking Lore", "Tea Lore"]
};

const LEVEL_BASED_DCS = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];

function levelBasedDC(level) {
  return LEVEL_BASED_DCS[Math.max(0, Math.min(25, Number(level) || 0))];
}

function automaticSkillDC(encounter, skill = {}) {
  return Math.max(0, levelBasedDC(encounter?.level) - (isLoreSkill(skill) ? 2 : 0));
}

function skillSlug(label = "") {
  const normalized = String(label).trim().toLowerCase();
  if (PF2E_SAVE_SLUGS[normalized]) return PF2E_SAVE_SLUGS[normalized];
  const standard = PF2E_SKILLS.find((skill) => skill.toLowerCase() === normalized);
  if (standard) return standard.toLowerCase();
  return String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parsedSkill(label, dc, type) {
  const cleanLabel = String(label).replace(/\([^)]*\)/g, "").replace(/^\s*[,;:]\s*/, "").trim();
  return { id: randomID(), label: cleanLabel, slug: skillSlug(cleanLabel), dc: Number(dc), dcModified: true, lore: /\blore$/i.test(cleanLabel), secret: false };
}

function parseDcSkills(text, type) {
  const results = [];
  const matches = [...String(text).matchAll(/\bDC\s*(\d+)\s*[,;:]?\s*/gi)];
  matches.forEach((match, index) => {
    const value = text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length)
      .replace(/[.;]+\s*$/, "").trim();
    value.replace(/\([^)]*\)/g, "").split(/\s+or\s+|\s*[,;]\s*/i).map((label) => label.trim()).filter(Boolean)
      .forEach((label) => results.push(parsedSkill(label, match[1], type)));
  });
  return results;
}

function sectionText(text, startPattern, endPattern) {
  const start = startPattern.exec(text);
  if (!start) return null;
  const remainder = text.slice(start.index + start[0].length);
  const end = endPattern.exec(remainder);
  return remainder.slice(0, end?.index ?? remainder.length).replace(/\s+/g, " ").trim();
}

function narrativeReward(description, npcId, index) {
  return { id: randomID(), kind: "narrative", label: index ? `Reward ${index + 1}` : "Reward", description, value: 0,
    type: "circumstance", mode: "narrative", scope: "both", skills: [], uses: 0, remaining: 0,
    activation: "automatic", active: true, applied: false, targetNpcId: npcId, playerVisible: true };
}

function parseInfluenceSource(source, npc) {
  const text = String(source).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const found = [];
  const sectionEnd = /\b(?:Background|Appearance|Personality|Discovery(?:\s+Skills?)?|Influence\s+Skills?|Influence\s+DC|Influence\s+\d+|Resistances?|Strengths?|Weaknesses?)\b/i;
  for (const [key, label] of [["background", "Background"], ["appearance", "Appearance"], ["personality", "Personality"]]) {
    const value = sectionText(text, new RegExp(`\\b${label}\\s*`, "i"), sectionEnd);
    if (value === null) continue;
    npc[key] = value;
    found.push(label);
  }
  const discoveryText = sectionText(text, /\bDiscovery(?:\s+Skills?)?\s*/i, sectionEnd);
  const influenceText = sectionText(text, /\bInfluence(?:\s+Skills?)?\s*/i, /\b(?:Background|Appearance|Personality|Influence\s+\d+|Discovery(?:\s+Skills?)?|Resistances?|Strengths?|Weaknesses?)\b/i);
  if (discoveryText !== null) { npc.discovery = parseDcSkills(discoveryText, "discovery"); found.push(`${npc.discovery.length} Discovery skill(s)`); }
  if (influenceText !== null) { npc.influence = parseDcSkills(influenceText, "influence"); found.push(`${npc.influence.length} Influence skill(s)`); }

  const thresholds = [...text.matchAll(/\bInfluence\s+(\d+)\s*/gi)].filter((match) => !/\b(?:DC|Skills?)\s*$/i.test(text.slice(Math.max(0, match.index - 12), match.index)));
  if (thresholds.length) {
    npc.thresholds = thresholds.map((match, index) => {
      const raw = text.slice(match.index + match[0].length, thresholds[index + 1]?.index ?? text.length)
        .split(/\b(?:Background|Appearance|Personality|Resistances?|Strengths?|Weaknesses?)\b/i)[0].trim();
      const sentences = raw.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
      const narrative = sentences.shift() ?? "";
      return { id: randomID(), points: Number(match[1]), label: `Influence ${match[1]}`, text: narrative,
        boons: sentences.map((sentence, rewardIndex) => narrativeReward(sentence, npc.id, rewardIndex)) };
    });
    found.push(`${npc.thresholds.length} threshold(s)`);
  }

  for (const [key, label, pattern] of [["strength", "Resistance", /\b(?:Resistances?|Strengths?)\s*/i], ["weakness", "Weakness", /\bWeaknesses?\s*/i]]) {
    const description = sectionText(text, pattern, /\b(?:Background|Appearance|Personality|Discovery(?:\s+Skills?)?|Influence(?:\s+Skills?|\s+DC|\s+\d+)|Resistances?|Strengths?|Weaknesses?)\b/i);
    if (description === null) continue;
    const magnitude = Number(description.match(/\bby\s+([+-]?\d+)\b/i)?.[1] ?? 0);
    const lowers = /\b(?:decrease|decreases|decreased|lower|lowers|lowered|reduce|reduces|reduced)\b/i.test(description);
    npc[key] = { label, description, value: magnitude ? (lowers ? -magnitude : magnitude) : 0,
      type: "circumstance", mode: magnitude ? "dc" : "narrative" };
    found.push(label);
  }
  return found;
}

function parseResearchSource(source, npc) {
  const text = String(source).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const found = [];
  const maximumLabel = String.raw`(?:Research\s+Points?|RP)`;
  const perActor = text.match(new RegExp(`\\bMaximum\\s+${maximumLabel}\\s+per\\s+(?:PC|character)\\s*[:—-]?\\s*(\\d+)`, "i"))
    ?? text.match(new RegExp(`\\bMaximum\\s+${maximumLabel}\\s*[:—-]?\\s*\\d+[^.;]*?\\b(\\d+)\\s*(?:RP\\s*)?per\\s+(?:PC|character)`, "i"));
  if (perActor) { npc.maximumPointsPerActor = Number(perActor[1]); found.push("maximum RP per PC"); }
  const max = text.match(new RegExp(`\\bMaximum\\s+${maximumLabel}\\s*[:—-]?\\s*(\\d+)`, "i"));
  if (max) { npc.maximumPoints = Number(max[1]); found.push("maximum RP"); }
  const checks = sectionText(text, /\b(?:Research\s+Checks?|Checks?)\s*/i, /\b(?:Maximum\s+(?:(?:Research\s+)?Points?|RP)|Requirements?|Description|Background)\b/i);
  if (checks !== null) { npc.influence = parseDcSkills(checks, "research"); found.push(`${npc.influence.length} Research check(s)`); }
  const requirements = sectionText(text, /\bRequirements?\s*/i, /\b(?:Maximum\s+(?:(?:Research\s+)?Points?|RP)|Research\s+Checks?|Checks?|Description|Background)\b/i);
  if (requirements !== null) { npc.requirements = requirements; found.push("requirements"); }
  const description = sectionText(text, /\b(?:Description|Background)\s*/i, /\b(?:Maximum\s+(?:(?:Research\s+)?Points?|RP)|Research\s+Checks?|Checks?|Requirements?)\b/i);
  if (description !== null) { npc.background = description; found.push("description"); }
  return found;
}

function parseSkillChallenge(source, npc) {
  const raw = String(source).replace(/\r/g, "").trim();
  const text = raw.replace(/\s+/g, " ").trim();
  const found = [];
  const firstLine = raw.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  const heading = firstLine.match(/^(.+?)\s+(?:SKILL\s+)?(?:CHALLENGE|OBSTACLE)(?:\s+\d+)?\s*$/i);
  if (heading) {
    npc.name = chaseTitle(heading[1].trim());
    found.push("name");
  }

  const sectionEnd = /\b(?:Description|Background|Special(?:\s+Rules?)?|Requirements?|Circumstances?|Conditional\s+Bonuses?)\b/i;
  const checksText = sectionText(text, /\b(?:Skill\s+Checks?|Checks?|Overcome)\s*/i, sectionEnd);
  const checks = parseChaseChecks(checksText ?? text);
  if (checks.length) {
    npc.influence = checks;
    found.push(`${checks.length} Skill check(s)`);
  }

  const description = sectionText(text, /\b(?:Description|Background)\s*[:—-]?\s*/i,
    /\b(?:Skill\s+Checks?|Checks?|Overcome|Special(?:\s+Rules?)?|Requirements?|Circumstances?|Conditional\s+Bonuses?)\b/i);
  if (description !== null) {
    npc.background = description;
    found.push("description");
  }

  const requirements = sectionText(text, /\b(?:Special(?:\s+Rules?)?|Requirements?|Circumstances?|Conditional\s+Bonuses?)\s*[:—-]?\s*/i,
    /\b(?:Skill\s+Checks?|Checks?|Overcome|Description|Background)\b/i);
  if (requirements !== null) {
    npc.requirements = requirements;
    found.push("special rules");
  }
  return found;
}

function chaseTitle(value = "") {
  return String(value).toLowerCase().replace(/(^|[\s—-])([a-z])/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function parseChaseChecks(text) {
  const results = [];
  const matches = [...String(text).replace(/\s+/g, " ").matchAll(/\bDC\s*(\d+)\s*/gi)];
  matches.forEach((match, index) => {
    const segment = text.replace(/\s+/g, " ").slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length)
      .replace(/^\s*[,;:]\s*/, "").split(/\s+to\b/i)[0].replace(/[.,;:]+\s*$/, "").trim();
    segment.split(/\s+or\s+|\s*[,;]\s*/i).map((label) => label.trim()).filter(Boolean)
      .forEach((label) => results.push(parsedSkill(label, match[1], "chase")));
  });
  return results;
}

function parseChaseObstacles(source) {
  const text = String(source).replace(/\r/g, "");
  const headers = [...text.matchAll(/^\s*([^\n]+?)\s+OBSTACLE\s+(\d+)\s*$/gim)];
  const obstacles = [];
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    const body = text.slice(header.index + header[0].length, headers[index + 1]?.index ?? text.length).trim();
    const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
    const statsIndex = lines.findIndex((line) => /\bChase\s+Points?\b/i.test(line));
    if (statsIndex < 0) continue;
    const statLines = lines.slice(statsIndex);
    let lastDcLine = -1;
    statLines.forEach((line, lineIndex) => { if (/\bDC\s*\d+/i.test(line)) lastDcLine = lineIndex; });
    const skillContinuation = new RegExp(`^(?:${[...PF2E_SKILLS, ...PF2E_SAVES].map((skill) => skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:\\s+or\\s+.+)?\\b`, "i");
    let descriptionIndex = -1;
    for (let lineIndex = lastDcLine + 1; lineIndex < statLines.length; lineIndex += 1) {
      const line = statLines[lineIndex];
      if (/^[A-Z](?:[A-Za-z’'\-]+)?\b/.test(line) && !skillContinuation.test(line) && !/^DC\b/i.test(line)) { descriptionIndex = lineIndex; break; }
    }
    const statText = statLines.slice(0, descriptionIndex < 0 ? statLines.length : descriptionIndex).join(" ");
    const points = Number(statText.match(/\bChase\s+Points?\s*(\d+)/i)?.[1] ?? 0);
    const overcome = statText.match(/\bOvercome\s+(.+)$/i)?.[1] ?? "";
    const checks = parseChaseChecks(overcome);
    if (!points || !checks.length) continue;
    const description = descriptionIndex < 0 ? "" : statLines.slice(descriptionIndex).join(" ");
    obstacles.push(chaseObstacle(randomID(), chaseTitle(header[1].trim()), points, checks.map((skill) => [skill.slug, skill.label, skill.dc, skill.lore]), description));
  }
  return { obstacles, level: headers.length ? Number(headers[0][2]) : 0 };
}

function normalizeReward(boon, targetId = "") {
  boon.id ||= randomID();
  boon.kind = ["modifier", "ip", "narrative"].includes(boon.kind) ? boon.kind : (boon.mode === "narrative" ? "narrative" : "modifier");
  boon.activation = boon.activation === "manual" ? "manual" : "automatic";
  boon.active = boon.active ?? boon.activation === "automatic";
  boon.applied ??= false;
  boon.playerVisible ??= true;
  boon.targetNpcId ??= targetId;
  boon.scope ??= "both";
  boon.mode ??= boon.kind === "narrative" ? "narrative" : "roll";
  boon.skills = Array.isArray(boon.skills) ? boon.skills : String(boon.skills ?? "").split(",").map((skill) => skill.trim()).filter(Boolean);
  boon.uses = Math.max(0, Number(boon.uses ?? 999));
  boon.remaining = Math.max(0, Number(boon.remaining ?? boon.uses));
}

function indexedArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, entry]) => entry);
}

function isGeneratedPlaceholderNpc(encounter, npc) {
  const matchesLegacyDiscovery = npc.discovery.length === encounter.discovery.length
    && npc.discovery.every((skill, index) => skill.id === encounter.discovery[index]?.id);
  return !npc.actorId
    && npc.name === encounter.name
    && npc.image === encounter.image
    && Number(npc.points) === 0
    && !npc.background && !npc.appearance && !npc.personality
    && !npc.influence.length && !npc.thresholds.length
    && !npc.weakness?.description && !npc.strength?.description
    && matchesLegacyDiscovery;
}

function normalizeEncounterCollections(encounter) {
  encounter.subsystemType = ["influence", "research", "chase", "skill"].includes(encounter.subsystemType) ? encounter.subsystemType : "influence";
  encounter.chaseType = ["chase-down", "run-away", "beat-clock", "competitive", "custom"].includes(encounter.chaseType) ? encounter.chaseType : "chase-down";
  encounter.currentRound = Math.max(1, Number(encounter.currentRound) || 1);
  encounter.subjectStartPosition = Math.max(0, Math.trunc(Number(encounter.subjectStartPosition ?? encounter.opponentPosition ?? 1) || 0));
  const savedSubjectPosition = Number(encounter.opponentPosition);
  encounter.opponentPosition = Number.isFinite(savedSubjectPosition)
    ? Math.max(0, Math.trunc(savedSubjectPosition))
    : encounter.subjectStartPosition;
  encounter.opponentPace = Math.max(0, Math.trunc(Number(encounter.opponentPace ?? 1) || 0));
  encounter.subjectTurnOrder = ["before", "after"].includes(encounter.subjectTurnOrder) ? encounter.subjectTurnOrder : (encounter.chaseType === "run-away" ? "after" : "before");
  encounter.obscureFutureObstacles = !!encounter.obscureFutureObstacles;
  encounter.chaseDesignedPartySize = Math.max(1, Math.trunc(Number(encounter.chaseDesignedPartySize) || 4));
  encounter.promptAdvanceWhenAllActed = !!encounter.promptAdvanceWhenAllActed;
  encounter.roundLimit = encounter.subsystemType === "skill"
    ? Math.max(1, Number(encounter.roundLimit) || 3)
    : Math.max(0, Number(encounter.roundLimit) || 0);
  encounter.dcVisibility = ["exact", "relative", "hidden"].includes(encounter.dcVisibility) ? encounter.dcVisibility : "exact";
  encounter.victoryText ??= "";
  encounter.failureText ??= "";
  encounter.victorySplashImage ??= "";
  encounter.victorySplashText ||= "You Win!";
  encounter.victorySplashMode = encounter.victorySplashMode === "manual" ? "manual" : "automatic";
  encounter.chaseOutcome = ["victory", "failure"].includes(encounter.chaseOutcome) ? encounter.chaseOutcome : "";
  encounter.skillPoints = Math.max(0, Number(encounter.skillPoints) || 0);
  encounter.skillPointGoal = Math.max(1, Number(encounter.skillPointGoal) || 8);
  encounter.skillScoringMode = encounter.skillScoringMode === "individual" ? "individual" : "shared";
  encounter.skillVictoryMode = encounter.skillVictoryMode === "gm" ? "gm" : "goal";
  encounter.skillPointsByActor = encounter.skillPointsByActor && typeof encounter.skillPointsByActor === "object" ? encounter.skillPointsByActor : {};
  for (const [actorId, points] of Object.entries(encounter.skillPointsByActor)) encounter.skillPointsByActor[actorId] = Math.max(0, Number(points) || 0);
  if (encounter.skillScoringMode === "individual") encounter.skillPoints = Object.values(encounter.skillPointsByActor).reduce((total, points) => total + points, 0);
  encounter.skillWinnerActorId ??= "";
  encounter.skillOutcome = ["victory", "failure"].includes(encounter.skillOutcome) ? encounter.skillOutcome : "";
  encounter.skillDescription ??= "";
  encounter.chaseDescription ??= "";
  encounter.chaseSubject = foundry.utils.mergeObject({ name: "Chase Objective", nickname: "", image: "icons/svg/mystery-man.svg", label: "Quarry", actorId: "" }, encounter.chaseSubject ?? {}, { inplace: false, overwrite: true });
  encounter.researchPoints = Math.max(0, Number(encounter.researchPoints) || 0);
  encounter.researchThresholds = indexedArray(encounter.researchThresholds);
  encounter.researchThresholds.forEach((threshold) => {
    threshold.id ||= randomID();
    threshold.points = Number(threshold.points) || 0;
    threshold.boons = indexedArray(threshold.boons);
    threshold.boons.forEach((boon) => normalizeReward(boon));
  });
  encounter.researchInterval ??= { value: 1, unit: "hour" };
  encounter.progressClock = foundry.utils.mergeObject({ enabled: false, clockId: "" }, encounter.progressClock ?? {}, { inplace: false, overwrite: true });
  encounter.participantNicknames = encounter.participantNicknames && typeof encounter.participantNicknames === "object" ? encounter.participantNicknames : {};
  encounter.discovery = indexedArray(encounter.discovery);
  encounter.influence = indexedArray(encounter.influence);
  encounter.thresholds = indexedArray(encounter.thresholds);
  encounter.thresholds.forEach((threshold) => threshold.boons = indexedArray(threshold.boons));
  encounter.activeEffects = indexedArray(encounter.activeEffects);
  encounter.activeEffects.forEach((effect) => {
    effect.id ||= randomID();
    effect.kind = "modifier";
    effect.label ||= "Circumstance";
    effect.description ??= "";
    effect.value = Number(effect.value) || 0;
    effect.type = ["circumstance", "status", "item", "untyped"].includes(effect.type) ? effect.type : "circumstance";
    effect.mode = effect.mode === "dc" ? "dc" : "roll";
    effect.scope = ["chase", "skill"].includes(encounter.subsystemType) ? encounter.subsystemType : (effect.scope ?? "both");
    effect.targetNpcId ??= "";
    effect.skills = Array.isArray(effect.skills) ? effect.skills : String(effect.skills ?? "").split(",").map((skill) => skillSlug(skill)).filter(Boolean);
    effect.uses = Math.max(1, Number(effect.uses) || 999);
    effect.remaining = Math.max(1, Number(effect.remaining) || effect.uses);
    effect.activation = "manual";
  });
  encounter.checkLog = indexedArray(encounter.checkLog);
  encounter.pendingDiscoveries = indexedArray(encounter.pendingDiscoveries);
  encounter.pendingChecks = indexedArray(encounter.pendingChecks);
  encounter.npcs = indexedArray(encounter.npcs);
  // Preserve the legacy single-NPC fallback, but let new multi-NPC drafts begin
  // empty so their first target must be deliberately added or dropped.
  if (!encounter.npcs.length && encounter.encounterType !== "multiple") {
    encounter.npcs = [{ id: randomID(), name: encounter.name, image: encounter.image, actorId: "" }];
  }
  encounter.npcs.forEach((npc) => {
    npc.id ||= randomID();
    npc.name ||= encounter.subsystemType === "chase" ? "New Obstacle" : encounter.subsystemType === "skill" ? "New Challenge" : "Influence Target";
    npc.image ||= "icons/svg/mystery-man.svg";
    npc.actorId ||= "";
    npc.nickname ??= "";
    npc.progressClockId ??= "";
    npc.background ??= "";
    npc.appearance ??= "";
    npc.personality ??= "";
    npc.points = Number(npc.points ?? encounter.points) || 0;
    npc.maximumPoints = Math.max(0, Number(npc.maximumPoints) || 0);
    npc.baseMaximumPoints = Math.max(0, Number(npc.baseMaximumPoints ?? npc.maximumPoints) || 0);
    npc.maximumPointsPerActor = Math.max(0, Number(npc.maximumPointsPerActor) || 0);
    npc.researchByActor = npc.researchByActor && typeof npc.researchByActor === "object" ? npc.researchByActor : {};
    for (const [actorId, rawRecord] of Object.entries(npc.researchByActor)) {
      const record = rawRecord && typeof rawRecord === "object" ? rawRecord : {};
      record.points = Math.max(0, Number(record.points) || 0);
      record.availability = ["available", "unavailable", "exhausted"].includes(record.availability) ? record.availability : "available";
      if (record.availability !== "unavailable") record.availability = npc.maximumPointsPerActor && record.points >= npc.maximumPointsPerActor ? "exhausted" : "available";
      npc.researchByActor[actorId] = record;
    }
    npc.availability = ["hidden", "available", "exhausted"].includes(npc.availability) ? npc.availability : "available";
    npc.requirements ??= "";
    npc.researchInterval ??= "";
    npc.awards = foundry.utils.mergeObject({ criticalFailure: -1, failure: 0, success: 1, criticalSuccess: 2 }, npc.awards ?? {}, { inplace: false, overwrite: true });
    if (encounter.subsystemType === "research" && npc.maximumPoints && npc.points >= npc.maximumPoints) npc.availability = "exhausted";
    if (encounter.subsystemType === "chase") {
      if (npc.maximumPoints) npc.points = Math.min(npc.maximumPoints, npc.points);
      npc.availability = npc.maximumPoints && npc.points >= npc.maximumPoints ? "exhausted" : "available";
    }
    npc.discovery = indexedArray(npc.discovery ?? deepClone(encounter.discovery));
    npc.influence = indexedArray(npc.influence ?? deepClone(encounter.influence));
    for (const skill of [...npc.discovery, ...npc.influence]) {
      skill.dc = Number(skill.dc) || 0;
      // Legacy encounters predate automatic DC tracking. Treat their values as
      // GM-authored so a future level change can never overwrite them.
      skill.dcModified = typeof skill.dcModified === "boolean" ? skill.dcModified : skill.dcModified === "false" ? false : true;
    }
    npc.weakness = foundry.utils.mergeObject(deepClone(encounter.weakness ?? DEFAULT_ENCOUNTER.weakness), npc.weakness ?? {}, { inplace: false, overwrite: true });
    npc.strength = foundry.utils.mergeObject(deepClone(encounter.strength ?? DEFAULT_ENCOUNTER.strength), npc.strength ?? {}, { inplace: false, overwrite: true });
    npc.weakness.mode ??= "roll";
    npc.strength.mode ??= "roll";
    npc.thresholds = indexedArray(npc.thresholds ?? deepClone(encounter.thresholds));
    npc.thresholds.forEach((threshold) => {
      threshold.id ||= randomID();
      threshold.points = Number(threshold.points) || 0;
      threshold.boons = indexedArray(threshold.boons);
      threshold.boons.forEach((boon) => normalizeReward(boon, npc.id));
    });
  });
  if (encounter.npcs.length > 1 && encounter.npcs.some((npc) => npc.actorId)) {
    encounter.npcs = encounter.npcs.filter((npc) => !isGeneratedPlaceholderNpc(encounter, npc));
  }
  if (encounter.subsystemType === "chase") {
    const lastPosition = Math.max(0, encounter.npcs.length - 1);
    encounter.subjectStartPosition = Math.min(lastPosition, encounter.subjectStartPosition);
    encounter.opponentPosition = Math.min(lastPosition, encounter.opponentPosition);
    if (encounter.status === "draft") encounter.opponentPosition = encounter.subjectStartPosition;
  }
  encounter.activeNpcId = encounter.npcs.some((npc) => npc.id === encounter.activeNpcId)
    ? encounter.activeNpcId
    : encounter.npcs[0]?.id ?? "";
  if (encounter.subsystemType === "chase") {
    let activeIndex = encounter.npcs.findIndex((npc) => npc.id === encounter.activeNpcId);
    while (activeIndex >= 0 && encounter.npcs[activeIndex]?.availability === "exhausted" && encounter.npcs[activeIndex + 1]) activeIndex += 1;
    if (activeIndex >= 0) encounter.activeNpcId = encounter.npcs[activeIndex].id;
  }
  encounter.backgroundImage ??= "";
  encounter.backgroundBlur ??= 6;
  encounter.presentationVisible ??= true;
  encounter.journalId ??= "";
  encounter.endedAt ??= null;
  encounter.folderId ??= "";
  encounter.encounterType = ["research", "chase", "skill"].includes(encounter.subsystemType) || encounter.encounterType === "multiple" ? "multiple" : "single";
  encounter.discoveries ??= {};
  for (const record of Object.values(encounter.discoveries)) {
    record.npcs ??= {};
    if (record.facts?.length && !Object.keys(record.npcs).length && encounter.activeNpcId) {
      record.npcs[encounter.activeNpcId] = { facts: record.facts, secretSkill: record.secretSkill ?? false };
    }
  }
  return encounter;
}

const DEFAULT_ENCOUNTER = {
  id: "",
  name: "New Influence Encounter",
  encounterType: "single",
  subsystemType: "influence",
  image: "icons/svg/mystery-man.svg",
  npcs: [],
  activeNpcId: "",
  activeActorId: "",
  backgroundImage: "",
  backgroundBlur: 6,
  presentationVisible: true,
  journalId: "",
  endedAt: null,
  level: 0,
  phases: 4,
  currentPhase: 1,
  points: 0,
  researchPoints: 0,
  skillPoints: 0,
  skillPointGoal: 8,
  skillScoringMode: "shared",
  skillVictoryMode: "goal",
  skillPointsByActor: {},
  skillWinnerActorId: "",
  skillOutcome: "",
  skillDescription: "",
  researchThresholds: [],
  researchInterval: { value: 1, unit: "hour" },
  progressClock: { enabled: false, clockId: "" },
  chaseType: "chase-down",
  currentRound: 1,
  opponentPosition: 1,
  subjectStartPosition: 1,
  opponentPace: 1,
  subjectTurnOrder: "before",
  obscureFutureObstacles: false,
  chaseDesignedPartySize: 4,
  promptAdvanceWhenAllActed: false,
  roundLimit: 0,
  dcVisibility: "exact",
  victoryText: "",
  failureText: "",
  victorySplashImage: "",
  victorySplashText: "You Win!",
  victorySplashMode: "automatic",
  chaseDescription: "",
  chaseSubject: { name: "Chase Objective", nickname: "", image: "icons/svg/mystery-man.svg", label: "Quarry", actorId: "" },
  publicPoints: true,
  status: "draft",
  discovery: [
    { id: "perception", label: "Perception", slug: "perception", dc: 14, dcModified: false, secret: false },
    { id: "diplomacy", label: "Diplomacy", slug: "diplomacy", dc: 14, dcModified: false, secret: false },
    { id: "secret", label: "Secret Discovery Skill", slug: "", dc: 14, dcModified: false, secret: true }
  ],
  influence: [],
  weakness: { label: "Weakness", description: "", value: 2, type: "circumstance", mode: "roll" },
  strength: { label: "Strength", description: "", value: -2, type: "circumstance", mode: "roll" },
  thresholds: [],
  participantIds: null,
  actorsActed: {},
  phaseActions: {},
  discoveries: {},
  activeEffects: [],
  checkLog: [],
  pendingDiscoveries: [],
  pendingChecks: [],
  history: []
};

const LANEKAR = {
  ...deepClone(DEFAULT_ENCOUNTER),
  id: "lanekar",
  name: "Lanekar, the Outcast",
  image: `modules/${MODULE_ID}/assets/lanekar-tiri-kitor.png`,
  npcs: [{ id: "lanekar-npc", name: "Lanekar, the Outcast", image: `modules/${MODULE_ID}/assets/lanekar-tiri-kitor.png`, actorId: "" }],
  activeNpcId: "lanekar-npc",
  level: 8,
  discovery: [
    { id: "perception", label: "Perception", slug: "perception", dc: 26, secret: false },
    { id: "diplomacy", label: "Diplomacy", slug: "diplomacy", dc: 24, secret: false },
    { id: "survival", label: "Survival", slug: "survival", dc: 21, secret: true }
  ],
  influence: [
    ["survival", "Survival", 21, false], ["nature", "Nature", 22, false],
    ["stealth", "Stealth", 23, false], ["diplomacy", "Diplomacy", 24, false],
    ["society", "Society", 25, false], ["medicine", "Medicine", 25, false],
    ["deception", "Deception", 27, false], ["intimidation", "Intimidation", 30, false],
    ["scouting-lore", "Scouting Lore", 19, true], ["warfare-lore", "Warfare Lore", 20, true],
    ["hobgoblin-lore", "Hobgoblin Lore", 20, true], ["blackfens-lore", "Blackfens Lore", 20, true],
    ["tiri-kitor-lore", "Tiri Kitor Lore", 21, true], ["dragon-lore", "Dragon Lore", 22, true],
    ["haunt-lore", "Haunt Lore", 23, true]
  ].map(([slug, label, dc, lore]) => ({ id: randomID(), slug, label, dc, dcModified: true, lore })),
  weakness: {
    label: "Prepare Them to Survive",
    description: "Concrete preparations for the tribe's survival rather than general promises.",
    value: 2,
    type: "circumstance"
  },
  strength: {
    label: "The Outcast's Sacred Office",
    description: "Pitying Lanekar, restoring him, asking him to advise the leaders, or disparaging the hunters.",
    value: -2,
    type: "circumstance"
  },
  thresholds: [
    { id: randomID(), points: 4, label: "Not a Threat", text: "Lanekar accepts that the party poses no danger to the Tiri Kitor.", boons: [{ id: randomID(), label: "Recognized by the Hunters", value: 1, type: "circumstance", mode: "roll", scope: "influence", skills: [], uses: 1, remaining: 1, optional: true, external: true }] },
    { id: randomID(), points: 9, label: "Proven Allies", text: "Lanekar accepts that the party genuinely intends to protect his people.", boons: [] },
    { id: randomID(), points: 15, label: "The Mad Mage's Secret", text: "Lanekar reveals the haunted complex and the safest route to it.", boons: [{ id: randomID(), label: "Lanekar's Route", value: 1, type: "circumstance", mode: "roll", scope: "external", skills: [], uses: 2, remaining: 2, optional: true, external: true }] },
    { id: randomID(), points: 24, label: "The Outcast's Counsel", text: "Lanekar reveals how best to approach the leaders of Starsong Hill.", boons: [{ id: randomID(), label: "Outcast's Insight", value: 2, type: "circumstance", mode: "roll", scope: "external", skills: [], uses: 3, remaining: 3, optional: true, external: true }] }
  ]
};

function peaceNpc({ id, name, discovery, influence, weakness, strength, background, appearance, personality, rewards = [] }) {
  return {
    id, name, actorId: "", image: "icons/svg/mystery-man.svg", points: 0,
    background, appearance, personality,
    discovery: discovery.map(([slug, label, dc, secret = false]) => ({ id: randomID(), slug, label, dc, dcModified: true, secret })),
    influence: influence.map(([slug, label, dc, lore = false]) => ({ id: randomID(), slug, label, dc, dcModified: true, lore })),
    weakness: weakness ?? { label: "Weakness", description: "", value: 0, type: "circumstance", mode: "dc" },
    strength: strength ?? { label: "Resistance", description: "", value: 0, type: "circumstance", mode: "dc" },
    thresholds: [
      { id: randomID(), points: 2, label: "Votes in Favor", text: `${name} agrees to the plan and votes in favor of the PCs.`, boons: [] },
      { id: randomID(), points: 4, label: "Personal Support", text: rewards[0]?.text ?? `${name} offers the PCs additional support.`, boons: rewards }
    ]
  };
}

const PEACE_TALKS = {
  ...deepClone(DEFAULT_ENCOUNTER),
  id: "peace-talks",
  name: "Peace Talks",
  encounterType: "multiple",
  image: "icons/svg/conversation.svg",
  phases: 5,
  publicPoints: true,
  discovery: [], influence: [], thresholds: [],
  weakness: { label: "Weakness", description: "", value: 0, type: "circumstance", mode: "dc" },
  strength: { label: "Resistance", description: "", value: 0, type: "circumstance", mode: "dc" },
  npcs: [
    peaceNpc({
      id: "tsiwak", name: "Tsiwak Eclipse Rider",
      discovery: [["art-lore", "Art Lore", 20, true], ["perception", "Perception", 26], ["scouting-lore", "Scouting Lore", 22, true], ["society", "Society", 24]],
      influence: [["art-lore", "Art Lore", 20, true], ["crafting", "Crafting (discussing pottery)", 20], ["performance", "Performance", 23], ["diplomacy", "Diplomacy", 24]],
      strength: { label: "Spoken Down To", description: "Speaking down to Tsiwak increases all of her Influence DCs by 2 for the rest of the encounter.", value: 2, type: "circumstance", mode: "dc" },
      background: "Head scout of the Lyrune-Quah who has traveled with Otehika for several years.",
      appearance: "Short hair braided close to her scalp and a black band tattooed across her eyes.", personality: "Serious, focused, quiet.",
      rewards: [{ id: randomID(), kind: "modifier", label: "Tsiwak's Support", description: "Tsiwak speaks privately with Grandmother Anpawi.", value: 1, type: "circumstance", mode: "roll", scope: "influence", skills: [], uses: 1, remaining: 1, activation: "automatic", active: true, targetNpcId: "anpawi", playerVisible: true, text: "Tsiwak lends her support when persuading Grandmother Anpawi." }]
    }),
    peaceNpc({
      id: "otehika", name: "Otehika Cinder Eater",
      discovery: [["horse-lore", "Horse Lore", 20, true], ["perception", "Perception", 26], ["society", "Society", 24]],
      influence: [["horse-lore", "Horse Lore", 20, true], ["diplomacy", "Diplomacy", 23], ["society", "Society", 24]],
      strength: { label: "Intimidating the Leaders", description: "Attempts to Intimidate Otehika or another leader cause all IP with Otehika to be lost. Use the manual IP control when triggered.", value: 0, type: "circumstance", mode: "narrative" },
      background: "A talented Sklar-Quah burn rider who traveled with Tsiwak as her guard.",
      appearance: "Their hair is scalp locked, apparently after catching fire.", personality: "Stubborn, brash, disorganized.",
      rewards: [{ id: randomID(), kind: "ip", label: "Encourages Uncle Memscut", description: "Otehika's enthusiasm wins Uncle Memscut's support.", value: 1, mode: "narrative", scope: "influence", skills: [], uses: 1, remaining: 1, activation: "manual", active: false, applied: false, targetNpcId: "memscut", playerVisible: true, text: "Gain 1 Influence Point with Uncle Memscut." }]
    }),
    peaceNpc({
      id: "datiti", name: "Grandmother Datiti",
      discovery: [["medicine", "Medicine", 20], ["perception", "Perception", 22], ["society", "Society", 24]],
      influence: [["medicine", "Medicine", 20], ["diplomacy", "Diplomacy", 24], ["nature", "Nature", 25]],
      strength: { label: "Disrespect", description: "Mocking or underestimating Grandmother Datiti immediately loses 1 IP with her. Use the manual IP control when triggered.", value: 0, type: "circumstance", mode: "narrative" },
      background: "An elderly Lyrune-Quah shaman and former adventuring wizard.",
      appearance: "Very long silver hair in wide braids threaded with large beads.", personality: "Sweet, wise, gentle.",
      rewards: [{ id: randomID(), kind: "narrative", label: "Eye of the Moonwarden", description: "Grandmother Datiti offers a treasured item after the bonfire.", value: 0, mode: "narrative", scope: "external", skills: [], uses: 0, remaining: 0, activation: "automatic", active: true, targetNpcId: "datiti", playerVisible: true, text: "Grandmother Datiti offers the PCs an eye of the moonwarden." }]
    }),
    peaceNpc({
      id: "anpawi", name: "Grandmother Anpawi",
      discovery: [["perception", "Perception", 26], ["religion", "Religion", 22], ["sarenrae-lore", "Sarenrae Lore", 20, true], ["shelyn-lore", "Shelyn Lore", 20, true], ["society", "Society", 24]],
      influence: [["sarenrae-lore", "Sarenrae Lore", 20, true], ["shelyn-lore", "Shelyn Lore", 20, true], ["religion", "Religion", 22], ["diplomacy", "Diplomacy", 23], ["society", "Society", 24]],
      weakness: { label: "Praise Tsiwak", description: "Praising Tsiwak's accomplishments and leadership reduces Grandmother Anpawi's Influence DCs by 2.", value: -2, type: "circumstance", mode: "dc" },
      background: "A Sklar-Quah shaman and the youngest shaman of her generation.",
      appearance: "Long dark hair shot with streaks of pure white, worn loose.", personality: "Stern, suspicious, traditionalist.",
      rewards: [{ id: randomID(), kind: "narrative", label: "Anpawi's Gifts", description: "Grandmother Anpawi offers valuable supplies after the bonfire.", value: 0, mode: "narrative", scope: "external", skills: [], uses: 0, remaining: 0, activation: "automatic", active: true, targetNpcId: "anpawi", playerVisible: true, text: "Grandmother Anpawi offers a cindergrass cloak and a Type II box of unspoiling." }]
    }),
    peaceNpc({
      id: "memscut", name: "Uncle Memscut",
      discovery: [["perception", "Perception", 26], ["seafaring-lore", "Seafaring Lore", 20, true], ["society", "Society", 24], ["survival", "Survival", 22]],
      influence: [["seafaring-lore", "Seafaring Lore", 20, true], ["survival", "Survival", 22], ["diplomacy", "Diplomacy", 25]],
      strength: { label: "Appeal to Belkzen Heritage", description: "Appeals to shared dromaar heritage raise Uncle Memscut's Influence DCs by 2 for one round.", value: 2, type: "circumstance", mode: "dc" },
      background: "A Shadde-Quah shaman from the shores of Varisia and friend of Grandmother Datiti.",
      appearance: "Bald, with an octopus tattoo across his scalp and small glasses.", personality: "Honorable, slow to speak, forthcoming.",
      rewards: [{ id: randomID(), kind: "modifier", label: "Memscut's Counsel", description: "Uncle Memscut asks Tsiwak about scouting farther into Belkzen.", value: 1, type: "circumstance", mode: "roll", scope: "influence", skills: [], uses: 1, remaining: 1, activation: "automatic", active: true, targetNpcId: "tsiwak", playerVisible: true, text: "Gain a +1 circumstance bonus to Influence Tsiwak on the next check." }]
    })
  ],
  activeNpcId: "tsiwak"
};

function researchSource(id, name, maximumPoints, checks, requirements = "", awards = {}) {
  return {
    id, name, actorId: "", image: "icons/svg/book.svg", points: 0, maximumPoints, availability: "available", requirements,
    researchInterval: "", awards: { criticalFailure: -1, failure: 0, success: 1, criticalSuccess: 2, ...awards },
    background: "", appearance: "", personality: "", discovery: [],
    influence: checks.map(([slug, label, dc, lore = false]) => ({ id: randomID(), slug, label, dc, dcModified: true, lore })),
    weakness: { label: "Assistance", description: "", value: 0, type: "circumstance", mode: "roll" },
    strength: { label: "Difficulty", description: "", value: 0, type: "circumstance", mode: "roll" }, thresholds: []
  };
}

const RESEARCHING_THE_EIGHTH = {
  ...deepClone(DEFAULT_ENCOUNTER),
  id: "researching-the-eighth", name: "Researching the Eighth", subsystemType: "research", encounterType: "multiple",
  image: "icons/svg/book.svg", phases: 4, publicPoints: true, researchPoints: 0,
  researchInterval: { value: 1, unit: "hour" }, discovery: [], influence: [], thresholds: [],
  npcs: [
    researchSource("workshop-journals", "Workshop Journals", 4, [["academia-lore", "Academia Lore", 20, true], ["library-lore", "Library Lore", 20, true], ["arcana", "Arcana", 22]], "A PC capable of reading Thassilonian studies the journals and books in the Spy's Workshop."),
    researchSource("prisoners-manifesto", "Prisoner's Manifesto", 4, [["academia-lore", "Academia Lore", 22, true], ["library-lore", "Library Lore", 22, true], ["arcana", "Arcana", 24]], "A PC capable of reading Thassilonian studies the scribbles carved into the oubliette walls."),
    researchSource("liralarues-notes", "Liralarue's Notes", 4, [["academia-lore", "Academia Lore", 24, true], ["library-lore", "Library Lore", 24, true], ["arcana", "Arcana", 26]], "A PC capable of reading Thassilonian studies Liralarue's marginal notes."),
    researchSource("religious-texts", "Religious Texts", 2, [["academia-lore", "Academia Lore", 24, true], ["library-lore", "Library Lore", 24, true], ["religion", "Religion", 26]], "A PC capable of reading Abyssal studies the religious collection."),
    researchSource("questioning-zalavexus", "Questioning Zalavexus", 4, [["deception", "Deception", 29], ["diplomacy", "Diplomacy", 27], ["intimidation", "Intimidation", 25]], "Question Zalavexus while he remains trapped; the skill reflects lying, promising freedom, or threatening him."),
    researchSource("workshop-texts", "Workshop Texts", 2, [["academia-lore", "Academia Lore", 26, true], ["library-lore", "Library Lore", 26, true], ["arcana", "Arcana", 28]], "A PC capable of reading Thassilonian studies the workbooks and marginalia in the collection."),
    researchSource("personal-library", "Liralarue's Personal Library", 4, [["academia-lore", "Academia Lore", 27, true], ["library-lore", "Library Lore", 27, true], ["arcana", "Arcana", 29]], "A PC capable of reading Thassilonian studies the books in Liralarue's bedroom."),
    researchSource("false-liralarue", "False Liralarue", 4, [["diplomacy", "Diplomacy", 29], ["intimidation", "Intimidation", 34]], "Interrogate the glabrezu that believes itself to be Liralarue.", { criticalFailure: -2 })
  ],
  activeNpcId: "workshop-journals",
  researchThresholds: [
    [2, "The Pit's Origin", "Karzoug ordered the hidden complex built as a regional spy network, overseen by Liralarue."],
    [4, "Crystal Discovery", "Liralarue found a divinatory crystal in the upper barracks."],
    [6, "Liralarue's Methods", "Liralarue relied on subterfuge and trickery more than raw magical power."],
    [8, "Hidden Laboratories", "She maintained deeper laboratories for variants of the clone ritual."],
    [10, "Changing Traditions", "She abandoned transmutation for divination, an unheard-of shift among Thassilonian wizards."],
    [12, "King Xin's Vision", "Her research suggested Xin imagined a cooperative Thassilon rather than one ruled by runelords."],
    [14, "The Song Key", "A clockwork songbird conceals a key capable of opening a deeper lock."],
    [16, "The Eighth School", "Liralarue sought an eighth Thassilonian school centered on divination and vainglory."],
    [18, "Reverse Engineering", "She hoped to transform the Pit into a runewell powered by divination."],
    [20, "The Clockwork Songbird", "Her notes explain how the songbird and its keyed song open the vault portal."],
    [22, "Earthfall Foreseen", "Liralarue foresaw Earthfall but could find no way to escape it."],
    [24, "Liralarue's Glimpse", "The party uncovers Liralarue's defensive divination and the method for teaching it during downtime."]
  ].map(([points, label, text]) => ({ id: randomID(), points, label, text, boons: points === 24 ? [narrativeReward("A PC can learn and teach Liralarue's Glimpse after 8 hours of downtime and a successful DC 30 Arcana check.", "", 0)] : [] }))
};

function chaseObstacle(id, name, points, checks, description, special = "") {
  return {
    id, name, nickname: "", actorId: "", image: "icons/svg/door-exit.svg", points: 0, baseMaximumPoints: points, maximumPoints: points,
    availability: "available", requirements: special, researchInterval: "",
    awards: { criticalFailure: -1, failure: 0, success: 1, criticalSuccess: 2 },
    background: description, appearance: "", personality: "", discovery: [],
    influence: checks.map(([slug, label, dc, lore = false]) => ({ id: randomID(), slug, label, dc, dcModified: true, lore })),
    weakness: { label: "Special Circumstance", description: special, value: 0, type: "circumstance", mode: "roll" },
    strength: { label: "", description: "", value: 0, type: "circumstance", mode: "roll" }, thresholds: []
  };
}

const WHERE_IS_THE_GOVERNOR = {
  ...deepClone(DEFAULT_ENCOUNTER),
  id: "where-is-the-governor", name: "Where Is the Governor?", subsystemType: "chase", encounterType: "multiple",
  image: "icons/svg/wing.svg", level: 7, publicPoints: true, phases: 5, currentRound: 1,
  chaseType: "chase-down", subjectStartPosition: 1, opponentPosition: 1, opponentPace: 1, subjectTurnOrder: "before", obscureFutureObstacles: false, roundLimit: 0, dcVisibility: "exact",
  victoryText: "The PCs catch Governor Heh before he reaches the safety of his fulu-warded manor.",
  failureText: "Governor Heh reaches his manor before the PCs can catch him.",
  chaseDescription: "The PCs pursue Governor Heh through downtown Willowshore before he can reach his fulu-warded manor.",
  chaseSubject: { name: "Governor Heh", nickname: "Governor Heh", image: "icons/svg/mystery-man.svg", label: "Quarry", actorId: "" },
  discovery: [], influence: [], thresholds: [],
  npcs: [
    chaseObstacle("governor-robes", "Where Is the Governor?", 7, [["society", "Society", 21], ["willowshore-lore", "Willowshore Lore", 19, true], ["stealth", "Stealth", 23], ["perception", "Perception", 25]], "The PCs learn that the governor is shopping at the Hand of Spring and try to approach without giving themselves away."),
    chaseObstacle("qi-zhongs-ire", "Qi Zhong's Ire", 3, [["religion", "Religion", 21], ["qi-zhong-lore", "Qi Zhong Lore", 21, true], ["diplomacy", "Diplomacy", 23], ["crafting", "Crafting", 25]], "Governor Heh desecrates the clinic's shrine, leaving Doctor Dami and his assistants to calm its irate phantom gecko guardian."),
    chaseObstacle("plowing-through-crowds", "Plowing Through Crowds", 4, [["intimidation", "Intimidation", 23], ["acrobatics", "Acrobatics", 25], ["athletics", "Athletics", 27]], "A dense crowd of haggling merchants and travelers blocks a narrow bridge while the governor slips through.", "A PC with a fly Speed, climb Speed, or another way to bypass crowd-created difficult terrain gains a +4 circumstance bonus."),
    chaseObstacle("which-way", "Which Way Did He Go?", 4, [["arcana", "Arcana", 23], ["occultism", "Occultism", 23], ["survival", "Survival", 25], ["perception", "Perception", 27]], "Governor Heh uses a scroll of illusory scene to create imperfect copies of himself throughout downtown Willowshore.", "A PC who succeeds at a DC 28 Will save to disbelieve gains a +4 circumstance bonus. Every PC gains it if the illusion is dispelled."),
    chaseObstacle("last-ditch-run", "Last-Ditch Run", 3, [["diplomacy", "Diplomacy", 23], ["deception", "Deception", 23], ["athletics", "Athletics", 25], ["intimidation", "Intimidation", 27]], "Manor Ward: with his manor in sight, the governor breaks into a sprint toward his fulu-warded home.", "For Athletics, Speed 35 feet grants +2; Speed 50 feet or teleporting ahead grants +4 circumstance.")
  ],
  activeNpcId: "governor-robes",
  activeEffects: [
    { id: randomID(), kind: "modifier", label: "Bypass the Crowds", description: "Fly Speed, climb Speed, or another way to bypass the crowd's difficult terrain.", value: 4, type: "circumstance", mode: "roll", scope: "chase", skills: [], uses: 999, remaining: 999, activation: "manual", targetNpcId: "plowing-through-crowds" },
    { id: randomID(), kind: "modifier", label: "Disbelieved or Dispelled Illusion", description: "Succeeded at the Will save, or the illusion has been dispelled.", value: 4, type: "circumstance", mode: "roll", scope: "chase", skills: [], uses: 999, remaining: 999, activation: "manual", targetNpcId: "which-way" },
    { id: randomID(), kind: "modifier", label: "Speed 35 Feet", description: "Applies to Athletics.", value: 2, type: "circumstance", mode: "roll", scope: "chase", skills: ["athletics"], uses: 999, remaining: 999, activation: "manual", targetNpcId: "last-ditch-run" },
    { id: randomID(), kind: "modifier", label: "Speed 50 Feet or Teleport", description: "Applies to Athletics instead of Speed 35 Feet.", value: 4, type: "circumstance", mode: "roll", scope: "chase", skills: ["athletics"], uses: 999, remaining: 999, activation: "manual", targetNpcId: "last-ditch-run" }
  ]
};

const ABEO_MARKET_CHASE_TEXT = `THROWN POWDER OBSTACLE 5
Chase Points 5; Overcome DC 20
Acrobatics or Athletics to avoid
the powder, DC 18 Crafting
to recognize the threat of the
powder and shield the eyes early
Abeo throws a bunch of alchemical powders into the air, obscuring vision and making a huge mess that’s difficult to navigate.
CROWDED MARKET OBSTACLE 5
Abeo
Chase Points 5; Overcome DC 20 Acrobatics or Athletics to weave or push through the crowd, DC 18 Society to follow the flow
It’s difficult to maneuver through the bustling market.
TWISTING ALLEYWAYS OBSTACLE 5
Chase Points 5; Overcome DC 22 Perception to navigate, DC 18 Society to know the neighborhood
These tight, dense alleyways are filled with objects that threaten to trip and confuse people rushing through.
BUSY CANAL OBSTACLE 5
Chase Points 5; Overcome DC 20 Acrobatics to vault across using poles or hanging lines, DC 18 Athletics to leap from boat to boat
Clotheslines hang across this narrow section of the canal, which is filled with boats carrying bird cages, stacks of pottery, and other impediments.
GUARDED GATE OBSTACLE 5
Chase Points 5; Overcome DC 25 Athletics to run past the guards and climb, DC 18 Deception or Diplomacy to convince the guards to open up the gates, DC 20 Stealth to slip past the guards
A metal gate and a few bored guards are meant to keep unwanted visitors out of this affluent neighborhood.
CARNIVOROUS GARDENS OBSTACLE 5
Chase Points 5; Overcome DC 20 Acrobatics to weave past snapping plants, DC 18 Nature to trick the carnivorous plants, DC 22 Survival to plot a clear path
The chase leads through a lush garden full of large carnivorous plants, all of which take a keen interest in anyone who passes through.`;

const parsedAbeoChase = parseChaseObstacles(ABEO_MARKET_CHASE_TEXT);
const ABEO_MARKET_CHASE = {
  ...deepClone(DEFAULT_ENCOUNTER),
  id: "abeo-market-chase", name: "Abeo's Market Chase", subsystemType: "chase", encounterType: "multiple",
  image: "icons/svg/wing.svg", level: parsedAbeoChase.level || 5, publicPoints: true, phases: parsedAbeoChase.obstacles.length, currentRound: 1,
  chaseType: "chase-down", subjectStartPosition: 1, opponentPosition: 1, opponentPace: 1, subjectTurnOrder: "before", obscureFutureObstacles: false, roundLimit: 0, dcVisibility: "exact",
  victoryText: "The PCs catch Abeo.", failureText: "Abeo escapes.",
  chaseDescription: "The PCs pursue Abeo through a market, twisting alleys, canals, guarded streets, and dangerous gardens.",
  chaseSubject: { name: "Abeo", nickname: "Abeo", image: "icons/svg/mystery-man.svg", label: "Quarry", actorId: "" },
  discovery: [], influence: [], thresholds: [], npcs: parsedAbeoChase.obstacles,
  activeNpcId: parsedAbeoChase.obstacles[0]?.id ?? "", activeEffects: []
};

class Store {
  static all() { return deepClone(game.settings.get(MODULE_ID, SETTINGS.encounters) ?? {}); }
  static activeId() { return game.settings.get(MODULE_ID, SETTINGS.active) ?? ""; }
  static get(id = this.activeId()) {
    const encounter = this.all()[id] ?? null;
    return encounter ? normalizeEncounterCollections(encounter) : null;
  }
  static async save(encounter) {
    normalizeEncounterCollections(encounter);
    if (game.user.isGM) {
      try { await syncEncounterProgressClocks(encounter); }
      catch (error) { reportProgressClockError(error); }
    }
    const all = this.all();
    all[encounter.id] = deepClone(encounter);
    await game.settings.set(MODULE_ID, SETTINGS.encounters, all);
    if (game.user.isGM) await syncEncounterJournal(encounter);
    Hooks.callAll("influenceEncounterUpdated", encounter.id);
  }
  static async remove(id) {
    const encounter = this.get(id);
    if (game.user.isGM && encounter) {
      try { await removeEncounterProgressClocks(encounter); }
      catch (error) { reportProgressClockError(error); }
    }
    if (this.activeId() === id) await game.settings.set(MODULE_ID, SETTINGS.active, "");
    const all = this.all();
    delete all[id];
    await game.settings.set(MODULE_ID, SETTINGS.encounters, all);
  }
  static async setActive(id) { await game.settings.set(MODULE_ID, SETTINGS.active, id); }
}

let progressClockWarningShown = false;

function progressClockDatabase() {
  if (!game.modules.get("global-progress-clocks")?.active) return null;
  const database = window.clockDatabase;
  return database?.get && database?.addClock && database?.update && database?.delete ? database : null;
}

function reportProgressClockError(error) {
  console.warn(`${MODULE_ID} | Global Progress Clocks integration failed; encounter data was still saved.`, error);
  if (progressClockWarningShown) return;
  progressClockWarningShown = true;
  ui.notifications.warn("The encounter was saved, but its Global Progress Clock could not be updated.");
}

async function removeEncounterProgressClocks(encounter) {
  const database = progressClockDatabase();
  if (!database || !encounter) return;
  const ids = new Set([
    encounter.progressClock?.clockId,
    ...(encounter.npcs ?? []).map((npc) => npc.progressClockId),
    ...[...database.values()].filter((clock) => clock.sourceModule === MODULE_ID && clock.sourceEncounterId === encounter.id).map((clock) => clock.id)
  ].filter(Boolean));
  const stored = deepClone(game.settings.get("global-progress-clocks", "activeClocks") ?? {});
  for (const id of ids) delete stored[id];
  await game.settings.set("global-progress-clocks", "activeClocks", stored);
  database.refresh?.();
  game.socket?.emit(SOCKET, { action: "progress-clock-refresh" });
  if (encounter.progressClock) encounter.progressClock.clockId = "";
  for (const npc of encounter.npcs ?? []) npc.progressClockId = "";
}

async function syncEncounterProgressClocks(encounter) {
  const database = progressClockDatabase();
  if (!database) return;
  const unsupportedSkillClock = encounter.subsystemType === "skill" && (encounter.skillScoringMode === "individual" || encounter.skillVictoryMode === "gm");
  const shouldDisplay = encounter.progressClock?.enabled && !unsupportedSkillClock && ["active", "paused"].includes(encounter.status);
  if (!shouldDisplay) return removeEncounterProgressClocks(encounter);
  const clocks = [];
  if (["research", "skill"].includes(encounter.subsystemType)) {
    encounter.progressClock.clockId ||= randomID();
    const thresholdMaximum = Math.max(0, ...encounter.researchThresholds.map((threshold) => Number(threshold.points) || 0));
    const sourceMaximum = encounter.npcs.reduce((total, source) => total + (Number(source.maximumPoints) || 0), 0);
    const value = encounter.subsystemType === "skill" ? Number(encounter.skillPoints) || 0 : Number(encounter.researchPoints) || 0;
    const configuredMaximum = encounter.subsystemType === "skill" ? encounter.skillPointGoal : Math.max(thresholdMaximum, sourceMaximum);
    const max = Math.min(99, Math.max(1, configuredMaximum, value));
    clocks.push({ id: encounter.progressClock.clockId, name: encounter.name, value: Math.min(max, Math.max(0, value)), max });
  } else {
    encounter.progressClock.clockId = "";
    for (const npc of encounter.npcs) {
      npc.progressClockId ||= randomID();
      const thresholdMaximum = Math.max(0, ...npc.thresholds.map((threshold) => Number(threshold.points) || 0));
      const max = Math.min(99, Math.max(1, thresholdMaximum, Number(npc.points) || 0));
      clocks.push({ id: npc.progressClockId, name: targetDisplayName(npc), value: Math.min(max, Math.max(0, Number(npc.points) || 0)), max });
    }
  }
  const desiredIds = new Set(clocks.map((clock) => clock.id));
  const stored = deepClone(game.settings.get("global-progress-clocks", "activeClocks") ?? {});
  for (const [id, clock] of Object.entries(stored)) {
    if (clock.sourceModule === MODULE_ID && clock.sourceEncounterId === encounter.id && !desiredIds.has(id)) delete stored[id];
  }
  for (const clock of clocks) {
    const data = { ...clock, type: "points", private: false, sourceModule: MODULE_ID, sourceEncounterId: encounter.id };
    stored[data.id] = foundry.utils.mergeObject(stored[data.id] ?? {}, data, { inplace: false, overwrite: true });
  }
  await game.settings.set("global-progress-clocks", "activeClocks", stored);
  database.refresh?.();
  game.socket?.emit(SOCKET, { action: "progress-clock-refresh" });
}

class FolderStore {
  static all() {
    return indexedArray(deepClone(game.settings.get(MODULE_ID, SETTINGS.folders) ?? [])).map((folder) => ({
      ...folder,
      color: folder.color || "#000000",
      sorting: folder.sorting === "m" ? "m" : "a"
    }));
  }
  static async save(folders) {
    await game.settings.set(MODULE_ID, SETTINGS.folders, indexedArray(folders));
    renderInfluenceSidebar();
  }
}

let influenceSidebarSearch = "";
const collapsedInfluenceFolders = new Set();

function participantPortrait(actor) {
  return actor?.prototypeToken?.texture?.src || actor?.img || "icons/svg/mystery-man.svg";
}

function participantDisplayName(encounter, actor) {
  return String(encounter?.participantNicknames?.[actor?.id] ?? "").trim() || actor?.name || "Participant";
}

function targetDisplayName(npc) {
  return String(npc?.nickname ?? "").trim() || npc?.name || "Target";
}

function researchActorState(source, actorId) {
  const record = source?.researchByActor?.[actorId] ?? { points: 0, availability: "available" };
  const points = Math.max(0, Number(record.points) || 0);
  const maximum = Math.max(0, Number(source?.maximumPointsPerActor) || 0);
  const availability = record.availability === "unavailable" ? "unavailable" : maximum && points >= maximum ? "exhausted" : "available";
  return { points, maximum, availability, available: availability === "available" };
}

function researchSourceAvailableForActor(source, actorId) {
  if (!source || source.availability !== "available" || (source.maximumPoints && source.points >= source.maximumPoints)) return false;
  return researchActorState(source, actorId).available;
}

function chaseVictoryMessage(encounter) {
  const role = String(encounter?.chaseSubject?.label ?? "").trim();
  const isQuarry = encounter?.chaseType === "chase-down" || /quarry/i.test(role);
  if (!isQuarry) return encounter?.victoryText || "You won the chase!";
  const name = String(encounter?.chaseSubject?.nickname ?? "").trim() || String(encounter?.chaseSubject?.name ?? "").trim();
  return name && name !== "Chase Objective" ? `You caught ${name}!` : "You caught the quarry!";
}

function chaseFailureMessage(encounter) {
  if (encounter?.failureText) return encounter.failureText;
  const role = String(encounter?.chaseSubject?.label ?? "").trim();
  const pursuer = encounter?.chaseType === "run-away" || /pursuer/i.test(role);
  const name = String(encounter?.chaseSubject?.nickname ?? "").trim() || String(encounter?.chaseSubject?.name ?? "").trim();
  if (pursuer) return name && name !== "Chase Objective" ? `${name} caught the party.` : "The pursuer caught the party.";
  return name && name !== "Chase Objective" ? `${name} escaped.` : "The quarry escaped.";
}

function influenceRewardSections(thresholds) {
  return thresholds.map((threshold) => {
    const visibleBoons = (threshold.boons ?? []).filter((boon) => boon.playerVisible);
    const boonList = visibleBoons.length
      ? `<ul>${visibleBoons.map((boon) => `<li><strong>${esc(boon.label)}</strong>${boon.description || boon.text ? ` — ${esc(boon.description || boon.text)}` : ""}</li>`).join("")}</ul>`
      : "";
    return `<section><h4>${esc(threshold.label || "Reward")}</h4>${threshold.text ? `<p>${esc(threshold.text)}</p>` : ""}${boonList}</section>`;
  }).join("");
}

async function actorFromDropEvent(event) {
  let data = {};
  try {
    data = TextEditor.getDragEventData(event);
  } catch (_error) {
    try { data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}"); } catch (_parseError) { return null; }
  }
  let actor = null;
  if (data.uuid) {
    const document = await fromUuid(data.uuid);
    actor = document?.documentName === "Token" ? document.actor : document?.documentName === "Actor" ? document : null;
  }
  return actor ?? (data.actorId ? game.actors.get(data.actorId) : null);
}

async function documentFromDropEvent(event) {
  let data = {};
  try { data = TextEditor.getDragEventData(event); }
  catch (_error) { try { data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}"); } catch (_parseError) { return null; } }
  return data.uuid ? fromUuid(data.uuid) : null;
}

function findBoon(encounter, boonId) {
  return [...encounter.npcs.flatMap((npc) => npc.thresholds), ...(encounter.researchThresholds ?? [])]
    .flatMap((threshold) => threshold.boons).find((boon) => boon.id === boonId);
}

function publicEncounterHtml(encounter) {
  const research = encounter.subsystemType === "research";
  const chase = encounter.subsystemType === "chase";
  const skillEncounter = encounter.subsystemType === "skill";
  const skillScores = skillEncounter && encounter.skillScoringMode === "individual"
    ? `<section><h2>Individual Scores</h2><ul>${encounterParticipants(encounter).map((actor) => `<li><strong>${esc(participantDisplayName(encounter, actor))}</strong> — ${skillActorPoints(encounter, actor.id)} SP</li>`).join("")}</ul></section>`
    : "";
  const results = skillEncounter ? encounter.npcs.map((challenge) => `<section><h3>${esc(targetDisplayName(challenge))}</h3>${challenge.background ? `<p>${esc(challenge.background)}</p>` : ""}</section>`).join("") : chase ? encounter.npcs.map((obstacle) => `<section><h3>${esc(targetDisplayName(obstacle))} — ${obstacle.points}/${obstacle.maximumPoints} CP</h3>${obstacle.background ? `<p>${esc(obstacle.background)}</p>` : ""}</section>`).join("") : research ? encounter.npcs.filter((source) => source.availability !== "hidden").map((source) =>
    `<section><h3>${esc(targetDisplayName(source))}${encounter.publicPoints ? ` — ${source.points}${source.maximumPoints ? `/${source.maximumPoints}` : ""} RP` : ""}</h3>${source.background ? `<p>${esc(source.background)}</p>` : ""}</section>`).join("") : encounter.npcs.map((npc) => {
    const reached = npc.thresholds.filter((threshold) => npc.points >= threshold.points);
    const rewards = reached.map((threshold) => `<article><h4>${esc(threshold.label)}</h4><p>${esc(threshold.text)}</p>${threshold.boons?.filter((boon) => boon.playerVisible).length ? `<ul>${threshold.boons.filter((boon) => boon.playerVisible).map((boon) => `<li><strong>${esc(boon.label)}</strong>${boon.description ? ` — ${esc(boon.description)}` : ""}</li>`).join("")}</ul>` : ""}</article>`).join("");
    return `<section><h3>${esc(targetDisplayName(npc))}${encounter.publicPoints ? ` — ${npc.points} IP` : ""}</h3>${npc.appearance ? `<p><strong>Appearance:</strong> ${esc(npc.appearance)}</p>` : ""}${rewards}</section>`;
  }).join("");
  const rows = encounter.checkLog.map((entry) => {
    const details = (entry.details ?? []).map(concealDiscoveryDC);
    const detailHtml = details.length ? `<ul>${details.map((detail) => `<li>${esc(detail)}</li>`).join("")}</ul>` : "";
    return `<tr><td>${esc(entry.actorName)}</td><td>${esc(entry.npcName ?? "")}</td><td>${entry.type === "research" ? "Research" : entry.type === "chase" ? "Chase" : entry.type === "skill" ? "Skill" : entry.type === "discovery" ? "Discovery" : "Influence"}</td><td>${esc(entry.skillLabel)}</td><td>${esc(String(entry.outcome).replace(/ — Invalid Discovery Skill$/, ""))}${detailHtml}</td></tr>`;
  }).join("");
  const status = encounter.endedAt ? "Completed" : encounter.status === "paused" ? "Paused" : "In Progress";
  const discoveries = research ? encounter.researchThresholds.filter((threshold) => threshold.points <= encounter.researchPoints).map((threshold) => `<article><h4>${esc(threshold.label)} — ${threshold.points} RP</h4><p>${esc(threshold.text)}</p></article>`).join("") : "";
  const skillStatus = encounter.skillScoringMode === "individual"
    ? `${encounter.skillVictoryMode === "goal" ? `Individual goal ${encounter.skillPointGoal} SP` : "GM-decided outcome"} · Round ${encounter.currentRound}${encounter.roundLimit ? `/${encounter.roundLimit}` : ""}`
    : `${encounter.skillPoints}${encounter.skillVictoryMode === "goal" ? `/${encounter.skillPointGoal}` : ""} SP · Round ${encounter.currentRound}${encounter.roundLimit ? `/${encounter.roundLimit}` : ""}`;
  return `<article class="influence-encounter-archive"><h1>${esc(encounter.name)}</h1><p><strong>${status}</strong> · ${research ? `${encounter.researchPoints} RP · ${encounter.researchInterval.value} ${esc(encounter.researchInterval.unit)} interval` : skillEncounter ? skillStatus : chase ? `Round ${encounter.currentRound}` : `Phase ${encounter.currentPhase} of ${encounter.phases}`}</p><section><h2>${research ? "Sources" : skillEncounter ? "Challenges" : chase ? "Obstacles" : "Targets and Results"}</h2>${results}</section>${skillScores}${research ? `<section><h2>Discoveries</h2>${discoveries}</section>` : ""}<section><h2>Check Log</h2>${rows ? `<table><thead><tr><th>PC</th><th>Target</th><th>Check</th><th>Skill</th><th>Outcome</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No checks have been completed.</p>"}</section></article>`;
}

function encounterJournalName(encounter) {
  return `${encounter.subsystemType === "research" ? "Research" : encounter.subsystemType === "chase" ? "Chase" : encounter.subsystemType === "skill" ? "Skill Encounter" : "Influence"}: ${encounter.name}${encounter.status === "paused" ? " (Paused)" : ""}`;
}

async function syncEncounterJournal(encounter) {
  if (!encounter?.id || !game.user.isGM) return;
  let journal = encounter.journalId ? game.journal.get(encounter.journalId) : null;
  if (!journal) {
    journal = await JournalEntry.create({
      name: encounterJournalName(encounter),
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { [MODULE_ID]: { encounterId: encounter.id, archive: true } }
    });
    if (!journal) return;
    encounter.journalId = journal.id;
    const all = Store.all();
    all[encounter.id] = deepClone(encounter);
    await game.settings.set(MODULE_ID, SETTINGS.encounters, all);
  }
  const journalName = encounterJournalName(encounter);
  if (journal.name !== journalName) await journal.update({ name: journalName });
  const content = publicEncounterHtml(encounter);
  const page = journal.pages.find((entry) => entry.getFlag(MODULE_ID, "encounterArchive"));
  const pageData = { name: "Encounter Record", type: "text", text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 }, flags: { [MODULE_ID]: { encounterArchive: true } } };
  if (page) await page.update(pageData);
  else await journal.createEmbeddedDocuments("JournalEntryPage", [pageData]);
  if (encounter.endedAt && journal.ownership.default !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
    await journal.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
  } else if (!encounter.endedAt && journal.ownership.default !== CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE) {
    await journal.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } });
  }
}

function snapshot(encounter, label) {
  const copy = deepClone(encounter);
  copy.history = [];
  encounter.history ??= [];
  encounter.history.push({ id: randomID(), at: Date.now(), label, state: copy });
  if (encounter.history.length > 50) encounter.history.shift();
}

function balancedChasePoints(basePoints, participantCount, designedPartySize) {
  return Math.max(1, Math.ceil((Math.max(1, Number(basePoints) || 1) * Math.max(1, participantCount)) / Math.max(1, designedPartySize)));
}

function actorStatisticModifier(actor, skill) {
  const statistic = skillStatistic(actor, skill.slug, skill.label);
  const value = Number(statistic?.mod ?? statistic?.check?.mod ?? statistic?.modifier ?? statistic?.value);
  return Number.isFinite(value) ? value : null;
}

const roundAdvancePrompts = new Set();
async function maybePromptRoundAdvance(encounter) {
  if (!game.user.isGM || !encounter?.promptAdvanceWhenAllActed || !["influence", "chase", "skill"].includes(encounter.subsystemType)) return;
  if (encounter.status !== "active" || encounter.chaseOutcome || encounter.skillOutcome || encounter.pendingChecks?.length) return;
  if (encounter.subsystemType === "influence" && encounter.currentPhase >= encounter.phases) return;
  const participants = encounterParticipants(encounter);
  if (!participants.length || !participants.every((actor) => encounter.actorsActed?.[actor.id])) return;
  const roundNumber = encounter.subsystemType === "influence" ? encounter.currentPhase : encounter.currentRound;
  const unit = encounter.subsystemType === "influence" ? "phase" : "round";
  const key = `${encounter.id}:${unit}:${roundNumber}`;
  if (roundAdvancePrompts.has(key)) return;
  roundAdvancePrompts.add(key);
  try {
    const advance = await Dialog.confirm({ title: `${unit.titleCase()} Complete`, content: `<p>All participating PCs have acted in ${unit} ${roundNumber}. Advance to the next ${unit}?</p>` });
    if (advance) await tracker?._action({ currentTarget: { dataset: { action: encounter.subsystemType === "influence" ? "advance" : "next-round" } } });
  } finally {
    roundAdvancePrompts.delete(key);
  }
}

function skillActorPoints(encounter, actorId) {
  return Math.max(0, Number(encounter?.skillPointsByActor?.[actorId]) || 0);
}

function skillScoreSummary(encounter) {
  if (encounter.skillScoringMode !== "individual") {
    return `The party has ${encounter.skillPoints}${encounter.skillVictoryMode === "goal" ? ` of ${encounter.skillPointGoal}` : ""} Skill Points.`;
  }
  const scores = encounterParticipants(encounter).map((actor) => `${participantDisplayName(encounter, actor)}: ${skillActorPoints(encounter, actor.id)} SP`);
  return scores.length ? scores.join(" — ") : "No individual scores have been recorded.";
}

function folderPartyCharacters() {
  const partyRoot = game.folders.find((folder) => folder.type === "Actor" && folder.name.toLowerCase() === "party");
  if (!partyRoot) return [];
  const folderIds = new Set([partyRoot.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of game.folders.filter((entry) => entry.type === "Actor")) {
      const parentId = folder.folder?.id ?? folder.folder ?? null;
      if (parentId && folderIds.has(parentId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        changed = true;
      }
    }
  }
  return game.actors
    .filter((actor) => actor.type === "character" && folderIds.has(actor.folder?.id ?? actor.folder))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function defaultPartyCharacters() {
  const members = game.actors
    .filter((actor) => actor.type === "party")
    .flatMap((party) => Array.from(party.members ?? []))
    .filter((actor) => actor?.type === "character");
  const uniqueMembers = [...new Map(members.map((actor) => [actor.id, actor])).values()];
  return (uniqueMembers.length ? uniqueMembers : folderPartyCharacters())
    .sort((a, b) => a.name.localeCompare(b.name));
}

function allCharacters() {
  return game.actors
    .filter((actor) => actor.type === "character")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function encounterParticipants(encounter) {
  const defaults = defaultPartyCharacters();
  if (!Array.isArray(encounter?.participantIds)) return defaults;
  return encounter.participantIds.map((id) => game.actors.get(id)).filter((actor) => actor?.type === "character");
}

function canUserControlActor(actor, user = game.user) {
  return !!actor?.testUserPermission?.(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
}

function encounterViewSelection(encounter) {
  if (!encounter) return { actorId: "", npcId: "" };
  if (game.user.isGM) {
    const visibleNpcs = encounter.npcs.filter((npc) => npc.availability !== "hidden");
    const npcId = visibleNpcs.some((npc) => npc.id === encounter.activeNpcId) ? encounter.activeNpcId : visibleNpcs[0]?.id ?? "";
    return { actorId: encounter.activeActorId ?? "", npcId };
  }
  const participants = encounterParticipants(encounter);
  const owned = participants.filter((actor) => canUserControlActor(actor));
  const saved = game.settings.get(MODULE_ID, SETTINGS.selections)?.[encounter.id] ?? {};
  const actorId = owned.some((actor) => actor.id === saved.actorId && !encounter.actorsActed?.[actor.id])
    ? saved.actorId
    : owned.find((actor) => actor.id === game.user.character?.id && !encounter.actorsActed?.[actor.id])?.id
      ?? owned.find((actor) => !encounter.actorsActed?.[actor.id])?.id
      ?? (owned.some((actor) => actor.id === saved.actorId) ? saved.actorId : owned[0]?.id ?? "");
  const selectableNpcs = encounter.npcs.filter((npc) => npc.availability !== "hidden");
  const npcId = encounter.subsystemType === "chase"
    ? encounter.activeNpcId
    : selectableNpcs.some((npc) => npc.id === saved.npcId)
    ? saved.npcId
    : selectableNpcs.some((npc) => npc.id === encounter.activeNpcId) ? encounter.activeNpcId : selectableNpcs[0]?.id ?? "";
  return { actorId, npcId };
}

async function setEncounterViewSelection(encounter, changes) {
  const selections = deepClone(game.settings.get(MODULE_ID, SETTINGS.selections) ?? {});
  selections[encounter.id] = { ...encounterViewSelection(encounter), ...changes };
  await game.settings.set(MODULE_ID, SETTINGS.selections, selections);
}

function skillStatistic(actor, slug, label) {
  let statistic = actor?.getStatistic?.(slug) ?? null;
  if (statistic) return statistic;
  const normalized = slug.toLowerCase().replace(/-lore$/, "").replaceAll("-", " ");
  const lore = actor?.itemTypes?.lore?.find((i) => {
    const name = i.name.toLowerCase().replace(/ lore$/, "");
    return name === normalized || i.slug === slug;
  });
  if (lore) return actor.getStatistic?.(lore.slug) ?? lore.system?.mod ?? null;
  return null;
}

function loreItemForSkill(actor, skill) {
  const slug = String(skill.slug ?? "").toLowerCase();
  const normalizedSlug = slug.replace(/-lore$/, "").replaceAll("-", " ");
  const normalizedLabel = String(skill.label ?? "").toLowerCase().replace(/ lore$/, "");
  return actor?.itemTypes?.lore?.find((item) => {
    const itemName = item.name.toLowerCase().replace(/ lore$/, "");
    return item.slug === slug || itemName === normalizedSlug || itemName === normalizedLabel;
  }) ?? null;
}

function isLoreSkill(skill) {
  return !!skill.lore || /(?:^|-)lore$/.test(String(skill.slug ?? "").toLowerCase()) || / lore$/i.test(String(skill.label ?? ""));
}

function availableSkillsForActor(actor, skills) {
  return skills.filter((skill) => !isLoreSkill(skill) || !!loreItemForSkill(actor, skill));
}

function actorSkillChoices(actor) {
  return Object.values(actor?.skills ?? {})
    .filter((statistic) => statistic?.slug && statistic?.label && statistic?.roll)
    .map((statistic) => ({ slug: statistic.slug, label: game.i18n.localize(statistic.label), lore: !!statistic.lore, rank: Number(statistic.rank) || 0 }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function trainedSkillChoices(actor) {
  return actorSkillChoices(actor).filter((skill) => skill.rank >= 1);
}

function concealDiscoveryDC(fact) {
  const text = String(fact ?? "");
  let match = text.match(/^(.+?) DC \d+\.?$/i);
  if (match) return `Secret Discovery Skill — ${match[1]}`;
  match = text.match(/^(.+?) is the lowest non-Lore option at DC \d+\.?$/i);
  if (match) return `Lowest non-Lore DC — ${match[1]}`;
  match = text.match(/^(.+?) is the highest non-Lore option at DC \d+\.?$/i);
  if (match) return `Highest non-Lore DC — ${match[1]}`;
  return text.replace(/\s*\(DC \d+\)(\.)?$/i, "$1");
}

async function chooseLoreSpecialization(category) {
  const examples = LORE_CATEGORIES[category] ?? [];
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = new Dialog({
      title: category.replace(/\s*\*$/, ""),
      content: `<form class="lore-specialization-picker"><div class="form-group"><label>Search examples</label><input type="search" name="loreSearch" placeholder="Search Lore examples"></div><div class="lore-example-list">${examples.map((example) => `<button type="button" data-lore-example="${esc(example)}">${esc(example)}</button>`).join("")}</div><hr><div class="form-group"><label>Custom Lore</label><input name="customLore" placeholder="Enter a specific subject"></div><p class="hint">“Lore” is added automatically if it is omitted.</p></form>`,
      render: (html) => {
        html.find('[name="loreSearch"]').on("input", (event) => {
          const query = String(event.currentTarget.value).trim().toLowerCase();
          html.find("[data-lore-example]").each((_, button) => { button.hidden = !button.dataset.loreExample.toLowerCase().includes(query); });
        });
        html.find("[data-lore-example]").on("click", (event) => { finish(event.currentTarget.dataset.loreExample); dialog.close(); });
      },
      buttons: {
        use: { icon: '<i class="fa-solid fa-check"></i>', label: "Use Lore", callback: (html) => {
          let value = String(html.find('[name="customLore"]').val() ?? "").trim();
          if (value && !/\bLore$/i.test(value)) value += " Lore";
          finish(value || null);
        } },
        cancel: { label: "Cancel", callback: () => finish(null) }
      },
      default: "use",
      close: () => finish(null)
    }, { width: 470 });
    dialog.render(true);
  });
}

class InfluenceTracker extends Application {
  constructor(options = {}) { super(options); }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "influence-encounter-tracker", title: "Influence Encounter", template: `modules/${MODULE_ID}/templates/tracker.hbs`,
      width: 640, height: "auto", resizable: true, classes: [MODULE_ID],
      tabs: [{ navSelector: ".tracker-tabs", contentSelector: ".tracker-content", initial: "encounter" }]
    });
  }
  getData() {
    const encounter = Store.get();
    const isResearch = encounter?.subsystemType === "research";
    const isChase = encounter?.subsystemType === "chase";
    const isSkill = encounter?.subsystemType === "skill";
    const participants = encounterParticipants(encounter);
    if (encounter && !participants.some((actor) => actor.id === encounter.activeActorId)) encounter.activeActorId = "";
    const selection = encounterViewSelection(encounter);
    const actors = participants.map((actor) => ({ id: actor.id, name: participantDisplayName(encounter, actor), image: participantPortrait(actor), acted: !!encounter?.actorsActed?.[actor.id], skillPoints: isSkill ? skillActorPoints(encounter, actor.id) : 0 }));
    const controlledActors = actors.filter((entry) => game.user.isGM || canUserControlActor(game.actors.get(entry.id)))
      .map((entry) => ({ ...entry, selected: entry.id === selection.actorId }));
    const activeObstacleIndex = isChase ? Math.max(0, encounter.npcs.findIndex((npc) => npc.id === encounter.activeNpcId)) : -1;
    const obscureChaseCourse = isChase && encounter.obscureFutureObstacles && !game.user.isGM;
    const visibleNpcs = (encounter?.npcs ?? []).filter((npc, index) => npc.availability !== "hidden" && (!obscureChaseCourse || index <= activeObstacleIndex));
    const activeNpcRecord = visibleNpcs.find((npc) => npc.id === selection.npcId) ?? visibleNpcs[0] ?? null;
    const selectedResearchActor = isResearch ? participants.find((actor) => actor.id === selection.actorId) : null;
    const activeResearchState = isResearch && activeNpcRecord && selection.actorId ? researchActorState(activeNpcRecord, selection.actorId) : null;
    const activeNpc = activeNpcRecord ? { ...activeNpcRecord, name: targetDisplayName(activeNpcRecord), researchActorState: activeResearchState } : null;
    const thresholdSource = isResearch ? (encounter?.researchThresholds ?? []) : (isChase || isSkill) ? [] : (activeNpcRecord?.thresholds ?? []);
    const individualSkillScoring = isSkill && encounter.skillScoringMode === "individual";
    const goalBasedSkillEncounter = isSkill && encounter.skillVictoryMode === "goal";
    const currentPoints = isResearch ? Number(encounter?.researchPoints) : isSkill ? (individualSkillScoring ? skillActorPoints(encounter, selection.actorId) : Number(encounter?.skillPoints)) : Number(activeNpcRecord?.points);
    const thresholds = thresholdSource.map((threshold) => ({
      ...threshold,
      unlocked: currentPoints >= threshold.points,
      boons: threshold.boons.filter((boon) => game.user.isGM || boon.playerVisible)
    }));
    const knownDiscoveries = (encounter?.discoveries?.[game.user.id]?.npcs?.[activeNpc?.id]?.facts ?? []).map(concealDiscoveryDC);
    const pendingByLog = new Map((encounter?.pendingDiscoveries ?? []).map((pending) => [pending.logEntryId, pending]));
    const checkLog = [...(encounter?.checkLog ?? [])].reverse().map((entry) => ({ ...entry,
      typeLabel: entry.type === "research" ? "Research" : entry.type === "chase" ? "Chase" : entry.type === "skill" ? "Skill" : entry.type === "discovery" ? "Discovery" : "Influence",
      pendingDiscovery: pendingByLog.get(entry.id),
      details: entry.type === "discovery" ? (entry.details ?? []).map(concealDiscoveryDC) : (entry.details ?? []),
      displayOutcome: !game.user.isGM && entry.type === "discovery"
        ? (entry.outcome.includes("Invalid Discovery Skill") ? "Failure" : entry.outcome.startsWith("Critical Success") ? "Critical Success" : entry.outcome.startsWith("Success") ? "Success" : "Failure")
        : entry.outcome
    }));
    const npcs = visibleNpcs.map((npc) => ({ ...npc, name: targetDisplayName(npc), active: npc.id === activeNpc?.id,
      researchActorState: isResearch && selection.actorId ? researchActorState(npc, selection.actorId) : null,
      subjectHere: isChase && !obscureChaseCourse && encounter.npcs.indexOf(npc) === encounter.opponentPosition, showPoints: game.user.isGM || encounter.publicPoints }));
    const subjectRole = String(encounter?.chaseSubject?.label || "Subject").trim();
    const subjectIsPursuer = encounter?.chaseType === "run-away" || /pursuer/i.test(subjectRole);
    const chaseSubjectStatus = obscureChaseCourse ? `The ${subjectRole} is ${subjectIsPursuer ? "behind you" : "ahead of you"}.` : "";
    const standardDc = levelBasedDC(encounter?.level ?? 0);
    const overcomeChecks = (isChase || isSkill) ? (activeNpcRecord?.influence ?? []).map((skill) => {
      let dcText = "";
      if (game.user.isGM || encounter.dcVisibility === "exact") dcText = `DC ${skill.dc}`;
      else if (encounter.dcVisibility === "relative") {
        const difference = Number(skill.dc) - standardDc;
        dcText = difference <= -5 ? "Incredibly Easy" : difference <= -2 ? "Easy" : difference >= 10 ? "Incredibly Hard" : difference >= 5 ? "Very Hard" : difference >= 2 ? "Hard" : "Standard";
      }
      return { ...skill, dcText };
    }) : [];
    const sourceAvailable = isChase ? activeNpc?.availability !== "exhausted" : !isResearch || researchSourceAvailableForActor(activeNpcRecord, selection.actorId);
    return { encounter, activeNpc, actors, controlledActors, npcs, thresholds, knownDiscoveries, checkLog, overcomeChecks, isResearch, isChase, isSkill, individualSkillScoring, goalBasedSkillEncounter, obscureChaseCourse, chaseSubjectStatus,
      researchActorLabel: selectedResearchActor ? participantDisplayName(encounter, selectedResearchActor) : "Selected PC",
      pointLabel: isResearch ? "RP" : isChase ? "CP" : isSkill ? "SP" : "IP", targetLabel: isResearch ? "Research Sources" : isChase ? "Chase Course" : isSkill ? "Skill Challenges" : "Influence Targets",
      actionLabel: isResearch ? "Research" : (isChase || isSkill) ? "Make a Check" : "Influence", currentPoints,
      pendingChecks: game.user.isGM ? (encounter?.pendingChecks ?? []).map((request, index) => {
        const queuedActor = game.actors.get(request.actorId);
        const queuedNpc = encounter.npcs.find((npc) => npc.id === request.npcId);
        const skillList = request.type === "discovery" ? queuedNpc?.discovery : queuedNpc?.influence;
        const queuedSkill = skillList?.find((skill) => skill.id === request.skillId || skill.slug === request.skillSlug);
        return { ...request, position: index + 1, actorName: queuedActor ? participantDisplayName(encounter, queuedActor) : "Missing PC",
          npcName: queuedNpc ? targetDisplayName(queuedNpc) : "Missing target", skillLabel: queuedSkill?.label ?? request.skillLabel ?? "Missing skill" };
      }) : [],
      isGM: game.user.isGM, showPoints: game.user.isGM || encounter?.publicPoints, noEncounter: !encounter, isPaused: encounter?.status === "paused",
      canAct: !!encounter && encounter.status === "active" && !encounter.chaseOutcome && !encounter.skillOutcome && !!selection.actorId && sourceAvailable,
      canPause: game.user.isGM && encounter?.status === "active", canResume: game.user.isGM && encounter?.status === "paused",
      canTriggerVictorySplash: game.user.isGM && isChase && encounter?.chaseOutcome === "victory" && encounter?.victorySplashMode === "manual",
      canDeclareSkillOutcome: game.user.isGM && isSkill && encounter?.skillVictoryMode === "gm" && encounter?.status === "active" && !encounter?.skillOutcome,
      canDeclareChaseOutcome: game.user.isGM && isChase && encounter?.status === "active" && !encounter?.chaseOutcome,
      canPrior: !isResearch && !isChase && encounter?.status === "active" && (encounter?.currentPhase ?? 1) > 1,
      canNext: !isResearch && !isChase && encounter?.status === "active" && (encounter?.currentPhase ?? 1) < (encounter?.phases ?? 1),
      canNextRound: (isChase || isSkill) && encounter?.status === "active" && !encounter?.chaseOutcome && !encounter?.skillOutcome && !(isSkill && encounter.skillVictoryMode === "gm" && encounter.roundLimit && encounter.currentRound >= encounter.roundLimit),
      roundActionLabel: isSkill && encounter?.skillVictoryMode === "goal" && encounter?.roundLimit && encounter.currentRound >= encounter.roundLimit ? "Finish Final Round" : "Next Round" };
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-action]").on("click", (event) => this._action(event));
  }
  async _action(event) {
    const action = event.currentTarget.dataset.action;
    const encounter = Store.get();
    if (action === "manage") return new EncounterManager().render(true);
    if (action === "edit") {
      if (!encounter || !game.user.isGM) return;
      return new EncounterEditor(encounter).render({ force: true });
    }
    if (!encounter) return;
    if (action === "select-participant") {
      const actorId = event.currentTarget.dataset.actorId;
      const actor = game.actors.get(actorId);
      if (!game.user.isGM && !canUserControlActor(actor)) return ui.notifications.warn(`You do not own ${actor?.name ?? "that character"}.`);
      if (game.user.isGM) {
        encounter.activeActorId = actorId;
        await Store.save(encounter);
      } else {
        await setEncounterViewSelection(encounter, { actorId });
        this.render(false);
        renderInfluenceSidebar();
      }
      return;
    }
    if (action === "select-npc") {
      const npcId = event.currentTarget.dataset.npcId;
      if (encounter.subsystemType === "chase" && npcId !== encounter.activeNpcId) return ui.notifications.info("Chase obstacles are attempted in order.");
      if (game.user.isGM) {
        encounter.activeNpcId = npcId;
        await Store.save(encounter);
      } else {
        await setEncounterViewSelection(encounter, { npcId });
        this.render(false);
        renderInfluenceSidebar();
      }
      return this.render(false);
    }
    if (action === "request") {
      const selection = encounterViewSelection(encounter);
      return requestCheck(encounter, event.currentTarget.dataset.type, selection.actorId, selection.npcId);
    }
    if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("INFLUENCE.GMOnly"));
    if (action === "adjudicate-request") {
      const request = encounter.pendingChecks.find((entry) => entry.id === event.currentTarget.dataset.id);
      return request ? adjudicate(request) : ui.notifications.warn("That queued check is no longer available.");
    }
    if (action === "cancel-request") return cancelPendingCheck(encounter.id, event.currentTarget.dataset.id, "The GM canceled this check request.");
    if (action === "pause") return pauseEncounter(encounter.id);
    if (action === "resume") return resumeEncounter(encounter.id);
    if (action === "victory-splash") return triggerVictorySplash(encounter);
    if (action === "undo") {
      let entry = encounter.history.pop();
      while (entry?.label === "undo") entry = encounter.history.pop();
      if (!entry) return ui.notifications.info("Nothing to undo.");
      const history = encounter.history;
      Object.assign(encounter, deepClone(entry.state), { history });
    } else if (action === "next-round") {
      if (encounter.subsystemType === "skill") {
        if (encounter.pendingChecks.length) return ui.notifications.warn("Resolve or cancel pending checks before ending the round.");
        snapshot(encounter, "Finish skill encounter round");
        if (encounter.skillVictoryMode === "goal" && encounter.roundLimit && encounter.currentRound >= encounter.roundLimit) {
          const leadingScore = Math.max(0, ...Object.values(encounter.skillPointsByActor).map(Number));
          const goalReached = encounter.skillScoringMode === "individual" ? leadingScore >= encounter.skillPointGoal : encounter.skillPoints >= encounter.skillPointGoal;
          encounter.skillOutcome = goalReached ? "victory" : "failure";
          if (goalReached && encounter.skillScoringMode === "individual") {
            encounter.skillWinnerActorId = Object.entries(encounter.skillPointsByActor).find(([, score]) => Number(score) >= encounter.skillPointGoal)?.[0] ?? "";
          }
          await ChatMessage.create({
            content: `<div class="influence-chat influence-result ${encounter.skillOutcome === "victory" ? "influence-reward" : "influence-reward-lost"}"><strong>${encounter.skillOutcome === "victory" ? "Skill Encounter Won" : "Skill Encounter Failed"}</strong><p>${esc(encounter.skillOutcome === "victory" ? (encounter.victoryText || "The party achieved its goal!") : (encounter.failureText || "The party ran out of time."))}</p></div>`,
            style: CONST.CHAT_MESSAGE_STYLES.OOC,
            flags: { [MODULE_ID]: { messageKind: "result" } }
          });
        } else {
          encounter.currentRound += 1;
          encounter.actorsActed = {};
          await ChatMessage.create({ content: `<div class="influence-chat influence-result"><strong>Round ${encounter.currentRound}</strong><p>${esc(skillScoreSummary(encounter))}</p></div>`, style: CONST.CHAT_MESSAGE_STYLES.OOC, flags: { [MODULE_ID]: { messageKind: "result" } } });
        }
      } else {
      snapshot(encounter, "Next chase round");
      encounter.currentRound += 1;
      encounter.opponentPosition += encounter.opponentPace;
      encounter.actorsActed = {};
      const subjectName = String(encounter.chaseSubject?.nickname ?? "").trim() || encounter.chaseSubject?.name || "The chase subject";
      const subjectRole = String(encounter.chaseSubject?.label || "Subject").trim();
      const subjectIsPursuer = encounter.chaseType === "run-away" || /pursuer/i.test(subjectRole);
      const destination = encounter.npcs[encounter.opponentPosition];
      const movementMessage = encounter.obscureFutureObstacles
        ? `The ${subjectRole} is ${subjectIsPursuer ? "catching up" : "getting further ahead"}.`
        : `${subjectRole} acts ${encounter.subjectTurnOrder === "after" ? "after" : "before"} the party and moves ${encounter.opponentPace} obstacle${encounter.opponentPace === 1 ? "" : "s"}${destination ? ` to ${targetDisplayName(destination)}` : " toward the end of the chase"}.`;
      await ChatMessage.create({
        content: `<div class="influence-chat influence-result"><strong>${encounter.obscureFutureObstacles ? "Chase Update" : `${esc(subjectName)} Advances`}</strong><p>${esc(movementMessage)}</p></div>`,
        style: CONST.CHAT_MESSAGE_STYLES.OOC
      });
      if (encounter.roundLimit && encounter.currentRound > encounter.roundLimit) ui.notifications.warn("The chase has reached its configured round limit.");
      if (encounter.opponentPosition >= encounter.npcs.length) {
        encounter.chaseOutcome = "failure";
        await ChatMessage.create({ content: `<div class="influence-chat influence-result influence-reward-lost"><strong>Chase Lost</strong><p>${esc(chaseFailureMessage(encounter))}</p></div>`, style: CONST.CHAT_MESSAGE_STYLES.OOC, flags: { [MODULE_ID]: { messageKind: "result" } } });
      }
      }
    } else if (action === "pass-obstacle") {
      const npc = encounter.npcs.find((entry) => entry.id === encounter.activeNpcId);
      if (!npc) return;
      if (!encounter.activeActorId) return ui.notifications.warn("Choose the PC who is passing or unable to act.");
      snapshot(encounter, `Pass: ${targetDisplayName(npc)}`);
      npc.points = Math.max(0, Number(npc.points) - 1);
      encounter.actorsActed[encounter.activeActorId] = true;
    } else if (action === "declare-chase-outcome") {
      if (encounter.subsystemType !== "chase" || encounter.chaseOutcome) return;
      if (encounter.pendingChecks.length) return ui.notifications.warn("Resolve or cancel pending checks before declaring the outcome.");
      const outcome = event.currentTarget.dataset.outcome;
      if (!["victory", "failure"].includes(outcome)) return;
      snapshot(encounter, `Declare chase ${outcome}`);
      encounter.chaseOutcome = outcome;
      const fallback = outcome === "victory" ? chaseVictoryMessage(encounter) : chaseFailureMessage(encounter);
      await ChatMessage.create({
        content: `<div class="influence-chat influence-result ${outcome === "victory" ? "influence-reward" : "influence-reward-lost"}"><strong>${outcome === "victory" ? "Chase Won" : "Chase Lost"}</strong><p>${esc(outcome === "victory" ? (encounter.victoryText || fallback) : (encounter.failureText || fallback))}</p></div>`,
        style: CONST.CHAT_MESSAGE_STYLES.OOC,
        flags: { [MODULE_ID]: { messageKind: "result" } }
      });
    } else if (action === "advance") {
      snapshot(encounter, action);
      encounter.phaseActions ??= {};
      encounter.phaseActions[encounter.currentPhase] = deepClone(encounter.actorsActed);
      encounter.currentPhase = Math.min(encounter.phases, encounter.currentPhase + 1);
      encounter.actorsActed = deepClone(encounter.phaseActions[encounter.currentPhase] ?? {});
    } else if (action === "prior") {
      snapshot(encounter, action);
      encounter.phaseActions ??= {};
      encounter.phaseActions[encounter.currentPhase] = deepClone(encounter.actorsActed);
      encounter.currentPhase = Math.max(1, encounter.currentPhase - 1);
      encounter.actorsActed = deepClone(encounter.phaseActions[encounter.currentPhase] ?? {});
    } else if (action === "adjust") {
      const npc = encounter.npcs.find((entry) => entry.id === encounter.activeNpcId);
      const research = encounter.subsystemType === "research";
      const chase = encounter.subsystemType === "chase";
      const skillEncounter = encounter.subsystemType === "skill";
      const selectedActorId = encounterViewSelection(encounter).actorId;
      const individualSkill = skillEncounter && encounter.skillScoringMode === "individual";
      if (individualSkill && !selectedActorId) return ui.notifications.warn("Choose a participating PC before adjusting an individual score.");
      const value = await promptNumber(research ? "Adjust Research Points" : individualSkill ? `Adjust Skill Points: ${participantDisplayName(encounter, game.actors.get(selectedActorId))}` : skillEncounter ? "Adjust Skill Points" : chase ? `Adjust Chase Points: ${targetDisplayName(npc)}` : `Adjust Influence Points: ${targetDisplayName(npc)}`, research ? encounter.researchPoints : individualSkill ? skillActorPoints(encounter, selectedActorId) : skillEncounter ? encounter.skillPoints : npc.points);
      if (value === null) return;
      snapshot(encounter, action);
      if (research) encounter.researchPoints = Math.max(0, value);
      else if (individualSkill) {
        encounter.skillPointsByActor[selectedActorId] = Math.max(0, value);
        encounter.skillPoints = Object.values(encounter.skillPointsByActor).reduce((total, points) => total + Number(points || 0), 0);
      } else if (skillEncounter) encounter.skillPoints = Math.max(0, value); else npc.points = Math.max(0, value);
    } else if (action === "change-ip") {
      const npc = encounter.npcs.find((entry) => entry.id === encounter.activeNpcId);
      const delta = Number(event.currentTarget.dataset.delta);
      if (!Number.isFinite(delta) || delta === 0) return;
      const research = encounter.subsystemType === "research";
      const chase = encounter.subsystemType === "chase";
      const skillEncounter = encounter.subsystemType === "skill";
      const individualActorId = skillEncounter && encounter.skillScoringMode === "individual"
        ? encounterViewSelection(encounter).actorId
        : "";
      if (skillEncounter && encounter.skillScoringMode === "individual" && !individualActorId) {
        return ui.notifications.warn("Choose a participating PC before adjusting an individual score.");
      }
      snapshot(encounter, research ? `${signed(delta)} RP` : skillEncounter ? `${signed(delta)} SP` : `${targetDisplayName(npc)}: ${signed(delta)} ${chase ? "CP" : "IP"}`);
      if (research) encounter.researchPoints = Math.max(0, Number(encounter.researchPoints) + delta);
      else if (skillEncounter && encounter.skillScoringMode === "individual") {
        encounter.skillPointsByActor[individualActorId] = Math.max(0, skillActorPoints(encounter, individualActorId) + delta);
        encounter.skillPoints = Object.values(encounter.skillPointsByActor).reduce((total, points) => total + Number(points || 0), 0);
      } else if (skillEncounter) encounter.skillPoints = Math.max(0, Number(encounter.skillPoints) + delta);
      else npc.points = Math.max(0, Number(npc.points) + delta);
    } else if (action === "apply-reward") {
      const boon = findBoon(encounter, event.currentTarget.dataset.id);
      const targetNpc = encounter.npcs.find((npc) => npc.id === boon?.targetNpcId);
      if (!boon || boon.kind !== "ip" || !targetNpc || boon.applied) return;
      snapshot(encounter, boon.label);
      targetNpc.points = Math.max(0, Number(targetNpc.points) + Number(boon.value));
      boon.applied = true;
    } else if (action === "reset-actions") {
      snapshot(encounter, action);
      encounter.actorsActed = {};
    } else if (action === "declare-skill-outcome") {
      if (encounter.subsystemType !== "skill" || encounter.skillVictoryMode !== "gm") return;
      if (encounter.pendingChecks.length) return ui.notifications.warn("Resolve or cancel pending checks before declaring the outcome.");
      const outcome = event.currentTarget.dataset.outcome;
      if (!['victory', 'failure'].includes(outcome)) return;
      snapshot(encounter, `Declare ${outcome}`);
      encounter.skillOutcome = outcome;
      encounter.skillWinnerActorId = "";
      await ChatMessage.create({ content: `<div class="influence-chat influence-result ${outcome === "victory" ? "influence-reward" : "influence-reward-lost"}"><strong>${outcome === "victory" ? "Skill Encounter Outcome" : "Skill Encounter Failed"}</strong><p>${esc(outcome === "victory" ? (encounter.victoryText || "The GM determined the outcome.") : (encounter.failureText || "The GM determined the encounter was unsuccessful."))}</p>${encounter.skillScoringMode === "individual" ? `<p>${esc(skillScoreSummary(encounter))}</p>` : ""}</div>`, style: CONST.CHAT_MESSAGE_STYLES.OOC, flags: { [MODULE_ID]: { messageKind: "result" } } });
    } else if (action === "end-encounter") {
      if (!await Dialog.confirm({ title: "End Encounter", content: "<p>End this encounter and make its Journal record available to players?</p>" })) return;
      snapshot(encounter, action);
      encounter.status = "complete";
      encounter.endedAt = Date.now();
      encounter.presentationVisible = false;
    } else if (action === "remove-effect") {
      snapshot(encounter, action);
      encounter.activeEffects = encounter.activeEffects.filter((e) => e.id !== event.currentTarget.dataset.id);
    } else if (action === "resolve-pending-discovery") {
      const pending = encounter.pendingDiscoveries.find((entry) => entry.id === event.currentTarget.dataset.id);
      if (!pending) return ui.notifications.info("That Discovery has already been resolved.");
      const selections = await collectDiscoveryChoices(pending.choices, pending.actorId);
      if (!selections.length) return;
      await resolveDiscovery(encounter.id, pending.userId, selections, pending.logEntryId);
      return this.render(false);
    } else return;
    await Store.save(encounter);
    game.socket.emit(SOCKET, { action: "refresh" });
    this.render(false);
    renderCinematicHud();
    renderInfluenceSidebar();
    if (action === "declare-chase-outcome" && encounter.chaseOutcome === "victory" && encounter.victorySplashMode === "automatic") triggerVictorySplash(Store.get(encounter.id));
    if (action === "pass-obstacle") maybePromptRoundAdvance(Store.get(encounter.id));
  }
}

function renderCinematicHud() {
  let hud = document.getElementById("influence-cinematic-hud");
  if (!hud) {
    hud = document.createElement("section");
    hud.id = "influence-cinematic-hud";
    document.body.append(hud);
  }
  const encounter = Store.get();
  if (!encounter || encounter.status !== "active" || !encounter.presentationVisible) {
    hud.className = "";
    hud.innerHTML = "";
    return;
  }
  const actor = game.actors.get(encounter.activeActorId);
  const npc = encounter.npcs.find((entry) => entry.id === encounter.activeNpcId) ?? encounter.npcs[0];
  const actorName = participantDisplayName(encounter, actor);
  const npcName = targetDisplayName(npc);
  const isChase = encounter.subsystemType === "chase";
  const actorHtml = actor
    ? `<figure class="influence-speaker influence-speaker-pc"><img src="${esc(participantPortrait(actor))}" alt="${esc(actorName)}"><figcaption>${esc(actorName)}</figcaption></figure>`
    : `<figure class="influence-speaker influence-speaker-empty"><div class="influence-silhouette"><i class="fa-solid fa-user"></i></div><figcaption>Choose a participant</figcaption></figure>`;
  const npcHtml = npc
    ? `<figure class="influence-speaker influence-speaker-npc"><img src="${esc(npc.image)}" alt="${esc(npcName)}"><figcaption>${esc(npcName)}</figcaption></figure>`
    : "";
  const subject = encounter.chaseSubject ?? {};
  const subjectName = String(subject.nickname ?? "").trim() || subject.name || "Chase Objective";
  const subjectHtml = `<figure class="influence-speaker influence-speaker-subject"><img src="${esc(subject.image || "icons/svg/mystery-man.svg")}" alt="${esc(subjectName)}"><figcaption><small>${esc(subject.label || "Objective")}</small>${esc(subjectName)}</figcaption></figure>`;
  hud.className = "visible";
  hud.style.setProperty("--influence-blur", `${Number(encounter.backgroundBlur) || 0}px`);
  hud.innerHTML = `<div class="influence-cinematic-backdrop"${encounter.backgroundImage ? ` style="background-image:url('${esc(encounter.backgroundImage)}')"` : ""}></div><div class="influence-cinematic-stage ${isChase ? "chase" : ""}">${actorHtml}<div class="influence-conversation-mark"><i class="fa-solid ${isChase ? "fa-arrow-right" : "fa-comments"}"></i></div>${npcHtml}${isChase ? `<div class="influence-conversation-mark"><i class="fa-solid fa-arrow-right"></i></div>${subjectHtml}` : ""}</div>`;
}

function showVictorySplash(encounter) {
  document.getElementById("influence-victory-splash")?.remove();
  const splash = document.createElement("div");
  splash.id = "influence-victory-splash";
  splash.innerHTML = `${encounter.victorySplashImage ? `<img class="victory-splash-image" src="${esc(encounter.victorySplashImage)}" alt="">` : ""}<div class="victory-splash-shade"></div><div class="victory-splash-content"><i class="fa-solid fa-trophy"></i><h1>${esc(encounter.victorySplashText || "You Win!")}</h1><p>${esc(chaseVictoryMessage(encounter))}</p><button type="button"><i class="fa-solid fa-xmark"></i> Close</button></div>`;
  splash.querySelector("button")?.addEventListener("click", () => splash.remove());
  splash.addEventListener("click", (event) => { if (event.target === splash) splash.remove(); });
  document.body.append(splash);
  requestAnimationFrame(() => splash.classList.add("visible"));
}

function triggerVictorySplash(encounter) {
  if (!encounter || encounter.subsystemType !== "chase" || encounter.chaseOutcome !== "victory") return;
  showVictorySplash(encounter);
  if (game.user.isGM) game.socket.emit(SOCKET, { action: "victory-splash", encounterId: encounter.id });
}

function activateInfluenceSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.querySelectorAll("#sidebar-tabs [data-tab]").forEach((button) => {
    const active = button.dataset.tab === "influence-encounters";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  sidebar.querySelectorAll("#sidebar-content > .tab").forEach((section) => {
    const active = section.id === "influence-encounters-sidebar";
    section.classList.toggle("active", active);
    if (active) section.hidden = false;
  });
  document.getElementById("sidebar-content")?.classList.add("active-influence-encounters", "expanded");
}

function renderInfluenceSidebar() {
  const sidebar = document.getElementById("sidebar");
  const tabsMenu = sidebar?.querySelector("#sidebar-tabs > menu");
  const content = sidebar?.querySelector("#sidebar-content");
  if (!tabsMenu || !content) return;
  if (!tabsMenu.dataset.influenceTabBound) {
    tabsMenu.dataset.influenceTabBound = "true";
    tabsMenu.addEventListener("click", (event) => {
      const selectedTab = event.target.closest("button[data-tab]")?.dataset.tab;
      if (!selectedTab || selectedTab === "influence-encounters") return;
      const influencePanel = document.getElementById("influence-encounters-sidebar");
      if (influencePanel) {
        influencePanel.classList.remove("active");
        influencePanel.hidden = true;
      }
      const influenceButton = tabsMenu.querySelector('[data-tab="influence-encounters"]');
      influenceButton?.classList.remove("active");
      influenceButton?.setAttribute("aria-pressed", "false");
      content.classList.remove("active-influence-encounters");
      const selectedPanel = content.querySelector(`:scope > #${CSS.escape(selectedTab)}`);
      selectedPanel?.classList.add("active");
      if (selectedPanel) selectedPanel.hidden = false;
    });
  }
  let tabButton = tabsMenu.querySelector('[data-tab="influence-encounters"]');
  if (!tabButton) {
    const item = document.createElement("li");
    item.innerHTML = '<button type="button" class="ui-control plain icon fa-solid fa-comments" data-tab="influence-encounters" role="tab" aria-pressed="false" aria-label="Influence Encounter" data-tooltip="Influence Encounter"></button><div class="notification-pip"></div>';
    tabButton = item.querySelector("button");
    tabButton.addEventListener("click", activateInfluenceSidebar);
    tabsMenu.insertBefore(item, tabsMenu.lastElementChild);
  }
  let panel = document.getElementById("influence-encounters-sidebar");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "influence-encounters-sidebar";
    panel.className = "tab sidebar-tab flexcol influence-sidebar";
    panel.hidden = true;
    content.append(panel);
  }
  const encounter = Store.get();
  if (game.user.isGM) {
    panel.classList.add("directory");
    panel.innerHTML = renderEncounterDirectory();
  } else if (!encounter) {
    panel.classList.remove("directory");
    panel.innerHTML = '<div class="influence-sidebar-body"><p>No active encounter.</p></div>';
  } else {
    panel.classList.remove("directory");
    const research = encounter.subsystemType === "research";
    const chase = encounter.subsystemType === "chase";
    const skillEncounter = encounter.subsystemType === "skill";
    const actors = encounterParticipants(encounter);
    const selection = encounterViewSelection(encounter);
    const actorRows = actors.map((actor) => {
      const acted = !!encounter.actorsActed?.[actor.id];
      const owned = canUserControlActor(actor);
      const selected = actor.id === selection.actorId;
      const score = skillEncounter && encounter.skillScoringMode === "individual" && encounter.publicPoints ? ` <small>${skillActorPoints(encounter, actor.id)} SP</small>` : "";
      const contents = `<img src="${esc(participantPortrait(actor))}" alt=""><span>${esc(participantDisplayName(encounter, actor))}${score}</span><i class="fa-solid ${acted ? "fa-check" : "fa-hourglass"}" title="${acted ? "Acted this round" : "Has not acted"}"></i>`;
      return owned
        ? `<button type="button" data-influence-action="select-participant" data-id="${actor.id}" class="influence-sidebar-person ${acted ? "acted" : ""} ${selected ? "selected" : ""}" ${acted ? "disabled" : ""} title="${acted ? "This PC has already acted" : `Act as ${esc(participantDisplayName(encounter, actor))}`}">${contents}</button>`
        : `<div class="influence-sidebar-person ${acted ? "acted" : ""}">${contents}</div>`;
    }).join("");
    const activeObstacleIndex = chase ? Math.max(0, encounter.npcs.findIndex((npc) => npc.id === encounter.activeNpcId)) : -1;
    const obscureChaseCourse = chase && encounter.obscureFutureObstacles;
    const visibleSources = encounter.npcs.filter((npc, index) => npc.availability !== "hidden" && (!obscureChaseCourse || index <= activeObstacleIndex));
    const npcRows = visibleSources.map((npc) => {
      const subjectMarker = chase && !obscureChaseCourse && encounter.npcs.indexOf(npc) === encounter.opponentPosition ? ` <small><i class="fa-solid fa-location-dot"></i> ${esc(encounter.chaseSubject?.label || "Subject")}</small>` : "";
      const actorState = research && selection.actorId ? researchActorState(npc, selection.actorId) : null;
      const actorStatus = actorState ? ` <small>Your PC: ${encounter.publicPoints ? `${actorState.points}${actorState.maximum ? `/${actorState.maximum}` : ""} RP · ` : ""}${esc(actorState.availability)}</small>` : "";
      const sourceStatus = encounter.publicPoints ? ` <small>${npc.points}${npc.maximumPoints ? `/${npc.maximumPoints}` : ""} RP</small>` : "";
      return `<div class="influence-sidebar-npc ${npc.id === selection.npcId ? "active" : ""}"><button data-influence-action="select-npc" data-id="${npc.id}" title="Review and select ${esc(targetDisplayName(npc))}"><img src="${esc(npc.image)}" alt=""><span>${esc(targetDisplayName(npc))}${subjectMarker}${research ? `${sourceStatus}${actorStatus}` : chase ? ` <small>${npc.points}/${npc.maximumPoints} CP</small>` : ""}</span></button></div>`;
    }).join("");
    const activeNpc = visibleSources.find((npc) => npc.id === selection.npcId) ?? visibleSources[0];
    const points = research ? encounter.researchPoints : skillEncounter && encounter.skillScoringMode === "individual" ? skillActorPoints(encounter, selection.actorId) : skillEncounter ? encounter.skillPoints : activeNpc?.points ?? 0;
    const pointLabel = research ? "RP" : chase ? "CP" : skillEncounter ? "SP" : "IP";
    const researchDisabled = research && !researchSourceAvailableForActor(activeNpc, selection.actorId) ? " disabled" : "";
    const actions = research ? `<button data-influence-action="research"${researchDisabled}><i class="fa-solid fa-book-open"></i> Research</button>` : chase ? '<button data-influence-action="chase"><i class="fa-solid fa-person-running"></i> Make a Check</button>' : skillEncounter ? '<button data-influence-action="skill"><i class="fa-solid fa-dice-d20"></i> Make a Check</button>' : '<button data-influence-action="discovery"><i class="fa-solid fa-magnifying-glass"></i> Discovery</button><button data-influence-action="influence"><i class="fa-solid fa-comments"></i> Influence</button>';
    const chaseStatus = obscureChaseCourse ? `<p class="chase-relative-status">The ${esc(encounter.chaseSubject?.label || "Subject")} is ${encounter.chaseType === "run-away" || /pursuer/i.test(encounter.chaseSubject?.label || "") ? "behind you" : "ahead of you"}.</p>` : "";
    const skillGoal = skillEncounter && encounter.skillVictoryMode === "goal" ? `/${encounter.skillPointGoal}` : "";
    panel.innerHTML = `<header class="influence-sidebar-header"><div><h2>${esc(encounter.name)}</h2><p>${research ? `${encounter.researchInterval.value} ${esc(encounter.researchInterval.unit)} interval` : (chase || skillEncounter) ? `Round ${encounter.currentRound}${skillEncounter && encounter.roundLimit ? ` of ${encounter.roundLimit}` : ""}` : `Phase ${encounter.currentPhase} of ${encounter.phases}`}</p></div><strong>${game.user.isGM || encounter.publicPoints ? `${points}${chase && activeNpc?.maximumPoints ? `/${activeNpc.maximumPoints}` : skillGoal} ${pointLabel}` : `— ${pointLabel}`}</strong></header><div class="influence-sidebar-body"><h3>PCs in the Encounter</h3><div class="influence-sidebar-people">${actorRows || "<p>No participants.</p>"}</div><h3>${research ? "Research Sources" : chase ? "Chase Course" : skillEncounter ? "Skill Challenges" : "Influence Targets"}</h3>${chaseStatus}<div class="influence-sidebar-npcs">${npcRows}</div><div class="influence-sidebar-actions"><button data-influence-action="open"><i class="fa-solid fa-up-right-from-square"></i> Open Encounter</button>${encounter.status === "active" && !encounter.skillOutcome ? actions : ""}</div></div>`;
  }
  panel.onclick = (event) => {
    const button = event.target.closest("[data-influence-action]");
    if (button) return handleSidebarAction({ currentTarget: button });
    const entry = game.user.isGM ? event.target.closest(".influence-sidebar-encounter") : null;
    if (entry) return openSidebarEncounter(entry.dataset.entryId);
  };
  if (game.user.isGM) activateEncounterDirectoryListeners(panel);
}

function encounterDirectoryEntry(entry) {
  const active = entry.id === Store.activeId() && entry.status === "active";
  const paused = entry.status === "paused";
  return `<li class="directory-item document influence-sidebar-encounter ${active ? "active" : ""} ${paused ? "paused" : ""}" data-entry-id="${entry.id}" data-folder-id="${esc(entry.folderId)}" draggable="true" tabindex="0"><img class="thumbnail" src="${esc(entry.image)}" alt=""><a class="document-name ellipsis">${esc(entry.name)}${paused ? " (Paused)" : ""}</a>${active ? '<i class="fa-solid fa-play influence-active-marker" data-tooltip="Active Encounter"></i>' : paused ? '<i class="fa-solid fa-pause influence-active-marker" data-tooltip="Paused Encounter"></i>' : ""}</li>`;
}

function renderEncounterDirectory() {
  const query = influenceSidebarSearch.trim().toLowerCase();
  const encounters = Object.values(Store.all()).map(normalizeEncounterCollections)
    .filter((entry) => !query || entry.name.toLowerCase().includes(query));
  const folders = FolderStore.all().sort((a, b) => a.name.localeCompare(b.name));
  const folderIds = new Set(folders.map((folder) => folder.id));
  const rootEntries = encounters.filter((entry) => !entry.folderId || !folderIds.has(entry.folderId));
  const folderHtml = folders.map((folder) => {
    const children = encounters.filter((entry) => entry.folderId === folder.id).sort(folder.sorting === "m"
      ? (a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0)
      : (a, b) => a.name.localeCompare(b.name));
    if (query && !children.length && !folder.name.toLowerCase().includes(query)) return "";
    const expanded = query || !collapsedInfluenceFolders.has(folder.id);
    const colorStyle = folder.color ? ` style="background-color:${esc(folder.color)}"` : "";
    const borderStyle = folder.color ? ` style="border-left-color:${esc(folder.color)}"` : "";
    return `<li class="directory-item folder flexcol influence-folder ${expanded ? "expanded" : ""}" data-folder-id="${folder.id}"><header class="folder-header"${colorStyle}><i class="fa-solid fa-folder-open fa-fw" inert></i><span class="folder-name ellipsis">${esc(folder.name)}</span><button type="button" class="create-button create-entry icon icon-plus fa-solid fa-comments" data-influence-action="new-encounter" data-folder-id="${folder.id}" data-tooltip aria-label="Create Encounter"></button></header><ol class="subdirectory plain"${borderStyle}>${children.map(encounterDirectoryEntry).join("")}</ol></li>`;
  }).join("");
  return `<header class="directory-header"><div class="header-actions action-buttons flexrow"><button type="button" data-influence-action="new-encounter"><i class="fa-solid fa-file-circle-plus"></i> Create Encounter</button><button type="button" data-influence-action="new-folder"><i class="fa-solid fa-folder-plus"></i> Create Folder</button></div><search class="directory-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" name="search" value="${esc(influenceSidebarSearch)}" autocomplete="off" placeholder="Search Encounters"><button type="button" class="inline-control icon fa-solid fa-xmark" data-influence-action="clear-search" aria-label="Clear Search"></button></search></header><ol class="directory-list plain">${rootEntries.sort((a, b) => a.name.localeCompare(b.name)).map(encounterDirectoryEntry).join("")}${folderHtml}${!encounters.length && !folders.length ? '<li class="directory-item"><p class="hint">No influence encounters found.</p></li>' : ""}</ol>`;
}

function activateEncounterDirectoryListeners(panel) {
  const search = panel.querySelector('.directory-search input[name="search"]');
  search?.addEventListener("input", () => {
    influenceSidebarSearch = search.value;
    const query = influenceSidebarSearch.trim().toLowerCase();
    panel.querySelectorAll(".influence-sidebar-encounter").forEach((entry) => {
      entry.hidden = !!query && !entry.querySelector(".document-name")?.textContent.toLowerCase().includes(query);
    });
    panel.querySelectorAll(".influence-folder").forEach((folder) => {
      const folderMatches = folder.querySelector(".folder-name")?.textContent.toLowerCase().includes(query);
      const childMatches = [...folder.querySelectorAll(".influence-sidebar-encounter")].some((entry) => !entry.hidden);
      folder.hidden = !!query && !folderMatches && !childMatches;
    });
  });
  panel.querySelectorAll(".influence-sidebar-encounter").forEach((entry) => {
    entry.addEventListener("keydown", (event) => { if (event.key === "Enter") openSidebarEncounter(entry.dataset.entryId); });
    entry.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showEncounterContextMenu(event, entry.dataset.entryId);
    });
    entry.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/x-influence-encounter", entry.dataset.entryId);
      event.dataTransfer.effectAllowed = "move";
    });
  });
  panel.querySelectorAll(".influence-folder").forEach((folder) => {
    const header = folder.querySelector(".folder-header");
    header?.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const id = folder.dataset.folderId;
      if (collapsedInfluenceFolders.has(id)) collapsedInfluenceFolders.delete(id);
      else collapsedInfluenceFolders.add(id);
      folder.classList.toggle("expanded");
    });
    header?.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showFolderContextMenu(event, folder.dataset.folderId);
    });
    folder.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes("application/x-influence-encounter")) return;
      event.preventDefault();
      folder.classList.add("droptarget");
    });
    folder.addEventListener("dragleave", () => folder.classList.remove("droptarget"));
    folder.addEventListener("drop", async (event) => {
      const id = event.dataTransfer.getData("application/x-influence-encounter");
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      folder.classList.remove("droptarget");
      await moveEncounterToFolder(id, folder.dataset.folderId);
    });
  });
  const root = panel.querySelector(":scope > .directory-list");
  root?.addEventListener("dragover", (event) => {
    if (event.target.closest(".influence-folder") || !event.dataTransfer.types.includes("application/x-influence-encounter")) return;
    event.preventDefault();
  });
  root?.addEventListener("drop", async (event) => {
    if (event.target.closest(".influence-folder")) return;
    const id = event.dataTransfer.getData("application/x-influence-encounter");
    if (id) await moveEncounterToFolder(id, "");
  });
}

function openSidebarEncounter(id) {
  if (!game.user.isGM) return;
  return id === Store.activeId() && Store.get(id)?.status === "active"
    ? tracker.render(true)
    : new EncounterEditor(Store.get(id)).render({ force: true });
}

async function moveEncounterToFolder(id, folderId) {
  const encounter = Store.get(id);
  if (!encounter || encounter.folderId === folderId) return;
  encounter.folderId = folderId;
  await Store.save(encounter);
}

class InfluenceFolderConfig extends foundry.applications.sheets.FolderConfig {
  _onRender(context, options) {
    super._onRender(context, options);
    const picker = this.element.querySelector('color-picker[name="color"]');
    if (!picker) return;
    const captureColor = () => { this.pendingFolderColor = picker.value; };
    picker.addEventListener("input", captureColor, { signal: this._folderColorAbort?.signal });
    picker.addEventListener("change", captureColor, { signal: this._folderColorAbort?.signal });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (this.influenceFolderId) {
      context.name = this.document.name;
      context.namePlaceholder = this.document.name;
      context.buttons = [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "Update Folder" }];
    }
    return context;
  }

  async _processSubmitData(_event, form, submitData) {
    const folders = FolderStore.all();
    const id = this.influenceFolderId || randomID();
    // Foundry's form-associated color-picker can retain its new value without
    // including it in FormDataExtended until another ordinary field changes.
    // Read the live custom element value at submission time.
    const colorPicker = form.elements.namedItem("color") ?? form.querySelector('color-picker[name="color"]');
    const liveColor = colorPicker?.value;
    const submittedColor = this.pendingFolderColor || liveColor || submitData.color?.css || submitData.color;
    const folder = {
      id,
      name: submitData.name?.trim() || "Folder",
      color: submittedColor ? String(submittedColor) : "#000000",
      sorting: submitData.sorting === "m" ? "m" : "a"
    };
    const index = folders.findIndex((entry) => entry.id === id);
    if (index >= 0) folders[index] = folder;
    else folders.push(folder);
    await FolderStore.save(folders);
    return {};
  }
}

function openEncounterFolderConfig(event, existingFolder = null) {
  const FolderClass = foundry.documents.Folder.implementation;
  const folder = new FolderClass({
    name: existingFolder?.name || "Folder",
    type: "JournalEntry",
    color: existingFolder?.color || "#000000",
    sorting: existingFolder?.sorting === "m" ? "m" : "a"
  });
  const application = new InfluenceFolderConfig({
    document: folder,
    position: {
      top: event?.currentTarget?.offsetTop ?? event?.target?.offsetTop ?? 0,
      left: window.innerWidth - 790
    }
  });
  // ApplicationV2 discards undeclared option keys. Keep the custom folder ID
  // on the application instance so configuring a folder updates it in place.
  application.influenceFolderId = existingFolder?.id || "";
  application.pendingFolderColor = existingFolder?.color || "#000000";
  return application.render({ force: true });
}

function createEncounterFolder(event) {
  return openEncounterFolderConfig(event);
}

async function openCreateEncounterDialog(event, folderId = "") {
  if (!game.user.isGM) return;
  const folders = FolderStore.all().sort((a, b) => a.name.localeCompare(b.name));
  const content = document.createElement("div");
  content.innerHTML = await foundry.applications.handlebars.renderTemplate("templates/sidebar/document-create.html", {
    name: "",
    defaultName: "New Influence Encounter",
    folder: folderId,
    folders,
    hasFolders: folders.length > 0,
    hasTypes: true,
    type: "single",
    types: [
      { value: "single", label: "Influence — Single NPC" },
      { value: "multiple", label: "Influence — Multiple NPCs" },
      { value: "research", label: "Research" },
      { value: "chase", label: "Chase" },
      { value: "skill", label: "Skill Encounter" }
    ],
    typeHint: ""
  });

  return foundry.applications.api.DialogV2.prompt({
    content,
    window: { title: "Create Encounter" },
    position: {
      width: 320,
      left: window.innerWidth - 630,
      top: event?.currentTarget?.offsetTop ?? 0
    },
    ok: {
      label: "Create Encounter",
      callback: async (_event, button) => {
        const data = new foundry.applications.ux.FormDataExtended(button.form).object;
        const encounter = deepClone(DEFAULT_ENCOUNTER);
        encounter.id = randomID();
        encounter.subsystemType = ["research", "chase", "skill"].includes(data.type) ? data.type : "influence";
        encounter.name = data.name?.trim() || (encounter.subsystemType === "research" ? "New Research Encounter" : encounter.subsystemType === "chase" ? "New Chase" : encounter.subsystemType === "skill" ? "New Skill Encounter" : "New Influence Encounter");
        encounter.encounterType = ["multiple", "research", "chase", "skill"].includes(data.type) ? "multiple" : "single";
        if (encounter.subsystemType === "research") {
          encounter.researchThresholds = [
            [2, "First Discovery"],
            [4, "Second Discovery"],
            [6, "Third Discovery"],
            [8, "Fourth Discovery"]
          ].map(([points, label]) => ({ id: randomID(), points, label, text: "", boons: [] }));
        }
        if (encounter.subsystemType === "chase") {
          encounter.npcs = [];
          encounter.discovery = [];
          encounter.influence = [];
          encounter.image = "icons/svg/wing.svg";
        }
        if (encounter.subsystemType === "skill") {
          encounter.npcs = [{ id: randomID(), name: "General Challenge", image: "icons/svg/d20-black.svg", actorId: "", points: 0, maximumPoints: 0, availability: "available", requirements: "", background: "", discovery: [], influence: [], thresholds: [] }];
          encounter.discovery = [];
          encounter.influence = [];
          encounter.image = "icons/svg/d20-black.svg";
          encounter.roundLimit = 3;
        }
        encounter.folderId = data.folder || "";
        normalizeEncounterCollections(encounter);
        if (encounter.npcs[0]) encounter.npcs[0].name = encounter.name;
        await Store.save(encounter);
        new EncounterEditor(Store.get(encounter.id)).render({ force: true });
        return encounter;
      }
    }
  });
}

function showFolderContextMenu(event, folderId) {
  const folder = FolderStore.all().find((entry) => entry.id === folderId);
  if (!folder) return;
  closeEncounterContextMenu();
  const menu = document.createElement("nav");
  menu.id = "influence-encounter-context-menu";
  menu.className = "influence-context-menu";
  menu.innerHTML = '<button type="button" data-folder-action="edit"><i class="fa-solid fa-pen"></i> Edit Folder</button><button type="button" data-folder-action="remove"><i class="fa-solid fa-folder-minus"></i> Remove Folder</button><hr><button type="button" data-folder-action="delete"><i class="fa-solid fa-trash"></i> Delete All</button>';
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - bounds.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - bounds.height - 8)}px`;
  menu.querySelector('[data-folder-action="edit"]').addEventListener("click", () => {
    closeEncounterContextMenu();
    openEncounterFolderConfig(event, folder);
  });
  menu.querySelector('[data-folder-action="remove"]').addEventListener("click", async () => {
    closeEncounterContextMenu();
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remove Folder" },
      content: "<p><strong>Are you sure?</strong> Folder will be deleted and all contents moved to the parent folder.</p>"
    });
    if (!confirmed) return;
    const encounters = Store.all();
    for (const encounter of Object.values(encounters)) {
      if (encounter.folderId === folder.id) encounter.folderId = "";
    }
    await game.settings.set(MODULE_ID, SETTINGS.encounters, encounters);
    collapsedInfluenceFolders.delete(folder.id);
    await FolderStore.save(FolderStore.all().filter((entry) => entry.id !== folder.id));
    if (game.user.isGM) game.socket.emit(SOCKET, { action: "refresh" });
  });
  menu.querySelector('[data-folder-action="delete"]').addEventListener("click", async () => {
    closeEncounterContextMenu();
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete All" },
      content: "<p><strong>Are you sure?</strong> This folder and all its contents will be permanently deleted and cannot be recovered.</p>"
    });
    if (!confirmed) return;
    const encounters = Store.all();
    const deleted = Object.values(encounters).filter((encounter) => encounter.folderId === folder.id);
    const journalIds = deleted.map((encounter) => encounter.journalId).filter((id) => game.journal.has(id));
    if (journalIds.length) await JournalEntry.deleteDocuments(journalIds);
    for (const encounter of deleted) delete encounters[encounter.id];
    await game.settings.set(MODULE_ID, SETTINGS.encounters, encounters);
    if (deleted.some((encounter) => encounter.id === Store.activeId())) {
      await game.settings.set(MODULE_ID, SETTINGS.active, "");
      tracker?.render(false);
      renderCinematicHud();
    }
    collapsedInfluenceFolders.delete(folder.id);
    await FolderStore.save(FolderStore.all().filter((entry) => entry.id !== folder.id));
    if (game.user.isGM) game.socket.emit(SOCKET, { action: "refresh" });
  });
}

function closeEncounterContextMenu() {
  document.getElementById("influence-encounter-context-menu")?.remove();
}

function showEncounterContextMenu(event, encounterId) {
  const encounter = Store.get(encounterId);
  if (!game.user.isGM || !encounter) return;
  closeEncounterContextMenu();
  const menu = document.createElement("nav");
  menu.id = "influence-encounter-context-menu";
  menu.className = "influence-context-menu";
  const isActive = encounterId === Store.activeId() && encounter.status === "active";
  const lifecycle = encounter.status === "paused"
    ? '<button type="button" data-context-action="resume"><i class="fa-solid fa-play"></i> Resume</button>'
    : isActive
      ? '<button type="button" data-context-action="pause"><i class="fa-solid fa-pause"></i> Pause</button>'
      : '<button type="button" data-context-action="activate"><i class="fa-solid fa-play"></i> Activate</button>';
  menu.innerHTML = `<button type="button" data-context-action="edit"><i class="fa-solid fa-pen"></i> Edit</button>${lifecycle}<button type="button" data-context-action="duplicate"><i class="fa-solid fa-copy"></i> Duplicate as New Draft</button><hr><button type="button" data-context-action="export"><i class="fa-solid fa-file-export"></i> Export Data</button><button type="button" data-context-action="import"><i class="fa-solid fa-file-import"></i> Import Data</button><hr><button type="button" data-context-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>`;
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - bounds.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - bounds.height - 8)}px`;
  menu.querySelectorAll("[data-context-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.contextAction;
    closeEncounterContextMenu();
    if (action === "edit") new EncounterEditor(Store.get(encounterId)).render({ force: true });
    if (action === "activate") await activateEncounter(encounterId);
    if (action === "pause") await pauseEncounter(encounterId);
    if (action === "resume") await resumeEncounter(encounterId);
    if (action === "duplicate") await duplicateEncounter(encounterId);
    if (action === "export") exportEncounterData(encounterId);
    if (action === "import") importEncounterData();
    if (action === "delete") await deleteEncounter(encounterId);
  }));
  setTimeout(() => {
    document.addEventListener("pointerdown", (pointerEvent) => {
      if (!menu.contains(pointerEvent.target)) closeEncounterContextMenu();
    }, { once: true });
    document.addEventListener("keydown", closeEncounterContextMenu, { once: true });
  }, 0);
}

async function activateEncounter(id) {
  const encounter = Store.get(id);
  if (!encounter) return;
  const startingDraftChase = encounter.subsystemType === "chase" && encounter.status === "draft";
  if (startingDraftChase) {
    const firstObstacle = encounter.npcs.find((obstacle) => Number(obstacle.points) < Number(obstacle.maximumPoints || 0)) ?? encounter.npcs[0];
    encounter.activeNpcId = firstObstacle?.id ?? "";
    encounter.currentRound = 1;
    encounter.opponentPosition = Math.min(Math.max(0, encounter.npcs.length - 1), encounter.subjectStartPosition);
    encounter.actorsActed = {};
    encounter.chaseOutcome = "";
  }
  if (encounter.subsystemType === "skill" && encounter.status === "draft") {
    encounter.currentRound = 1;
    encounter.skillPoints = 0;
    encounter.skillPointsByActor = {};
    encounter.skillWinnerActorId = "";
    encounter.skillOutcome = "";
    encounter.actorsActed = {};
    encounter.activeNpcId = encounter.npcs[0]?.id ?? "";
  }
  encounter.status = "active";
  encounter.endedAt = null;
  encounter.presentationVisible = true;
  await Store.setActive(id);
  await Store.save(encounter);
  tracker?.render(true);
  renderInfluenceSidebar();
  renderCinematicHud();
  game.socket.emit(SOCKET, { action: "open-encounter", encounterId: id });
}

async function pauseEncounter(id) {
  const encounter = Store.get(id);
  if (!encounter || encounter.status !== "active") return;
  snapshot(encounter, "pause");
  encounter.status = "paused";
  encounter.presentationVisible = false;
  await Store.setActive(id);
  await Store.save(encounter);
  tracker?.render(false);
  renderInfluenceSidebar();
  renderCinematicHud();
  game.socket.emit(SOCKET, { action: "refresh" });
}

async function resumeEncounter(id) {
  const encounter = Store.get(id);
  if (!encounter || encounter.status !== "paused") return;
  snapshot(encounter, "resume");
  encounter.status = "active";
  encounter.endedAt = null;
  encounter.presentationVisible = true;
  await Store.setActive(id);
  await Store.save(encounter);
  tracker?.render(true);
  renderInfluenceSidebar();
  renderCinematicHud();
  game.socket.emit(SOCKET, { action: "open-encounter", encounterId: id });
}

async function duplicateEncounter(id) {
  const source = Store.get(id);
  if (!source) return;
  const names = new Set(Object.values(Store.all()).map((entry) => String(entry.name).toLowerCase()));
  let name = `${source.name} (Copy)`;
  let copyNumber = 2;
  while (names.has(name.toLowerCase())) name = `${source.name} (Copy ${copyNumber++})`;
  const duplicate = deepClone(source);
  Object.assign(duplicate, {
    id: randomID(), name, status: "draft", currentPhase: 1, currentRound: 1, chaseOutcome: "", skillOutcome: "", skillWinnerActorId: "", points: 0, researchPoints: 0, skillPoints: 0, skillPointsByActor: {},
    opponentPosition: source.subsystemType === "chase" ? source.subjectStartPosition : source.opponentPosition,
    activeActorId: "", actorsActed: {}, phaseActions: {}, discoveries: {},
    activeEffects: ["chase", "skill"].includes(source.subsystemType) ? deepClone(source.activeEffects) : [], checkLog: [], pendingDiscoveries: [], pendingChecks: [], history: [], journalId: "", endedAt: null,
    presentationVisible: true
  });
  duplicate.npcs.forEach((npc) => {
    npc.points = 0;
    npc.researchByActor = {};
    npc.progressClockId = "";
    npc.thresholds.forEach((threshold) => threshold.boons.forEach((boon) => {
      boon.remaining = boon.uses;
      boon.applied = false;
      boon.active = boon.activation === "automatic";
    }));
  });
  if (duplicate.subsystemType === "chase") {
    duplicate.activeNpcId = duplicate.npcs[0]?.id ?? "";
    duplicate.subjectStartPosition = Math.min(Math.max(0, duplicate.npcs.length - 1), Math.max(0, Number(source.subjectStartPosition) || 0));
    duplicate.opponentPosition = duplicate.subjectStartPosition;
    duplicate.activeEffects.forEach((effect) => effect.remaining = effect.uses);
  }
  duplicate.progressClock.clockId = "";
  await Store.save(duplicate);
  renderInfluenceSidebar();
  ui.notifications.info(`Created ${duplicate.name}.`);
}

function uniqueEncounterName(preferredName, suffix = "Imported") {
  const names = new Set(Object.values(Store.all()).map((entry) => String(entry.name).toLowerCase()));
  if (!names.has(preferredName.toLowerCase())) return preferredName;
  let name = `${preferredName} (${suffix})`;
  let number = 2;
  while (names.has(name.toLowerCase())) name = `${preferredName} (${suffix} ${number++})`;
  return name;
}

function exportEncounterData(id) {
  const encounter = Store.get(id);
  if (!encounter) return ui.notifications.error("That influence encounter no longer exists.");
  const exported = deepClone(encounter);
  exported.journalId = "";
  saveDataToFile(JSON.stringify({
    type: "influence-encounter",
    version: 1,
    encounter: exported
  }, null, 2), "application/json", `${encounter.name.slugify() || "influence-encounter"}.json`);
}

function importEncounterData() {
  if (!game.user.isGM) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const source = parsed?.type === "influence-encounter" ? parsed.encounter : parsed;
      if (!source || typeof source !== "object" || Array.isArray(source) || typeof source.name !== "string") {
        throw new Error("The selected file is not an Influence Encounter export.");
      }
      const imported = foundry.utils.mergeObject(deepClone(DEFAULT_ENCOUNTER), deepClone(source), {
        inplace: false, overwrite: true, insertKeys: true, insertValues: true
      });
      normalizeEncounterCollections(imported);
      Object.assign(imported, {
        id: randomID(), name: uniqueEncounterName(imported.name), status: "draft",
        currentPhase: 1, currentRound: 1, points: 0, researchPoints: 0, skillPoints: 0, skillPointsByActor: {},
        chaseOutcome: "", skillOutcome: "", skillWinnerActorId: "", participantIds: null, activeActorId: "", actorsActed: {}, phaseActions: {},
        discoveries: {}, activeEffects: [], checkLog: [], history: [], journalId: "",
        endedAt: null, presentationVisible: true
      });
      imported.npcs.forEach((npc) => {
        npc.actorId = "";
        npc.points = 0;
        npc.thresholds.forEach((threshold) => threshold.boons.forEach((boon) => {
          boon.remaining = boon.uses;
          boon.applied = false;
          boon.active = boon.activation === "automatic";
        }));
      });
      await Store.save(imported);
      renderInfluenceSidebar();
      ui.notifications.info(`Imported ${imported.name}.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to import encounter`, error);
      ui.notifications.error(error.message || "Could not import that Influence Encounter file.");
    }
  }, { once: true });
  input.click();
}

async function deleteEncounter(id) {
  const encounter = Store.get(id);
  if (!encounter) return;
  const isActive = Store.activeId() === id;
  const confirmed = await Dialog.confirm({
    title: "Delete Influence Encounter",
    content: `<p>Delete <strong>${esc(encounter.name)}</strong>?</p><p>${isActive ? "The active encounter will be ended and published to its Journal before its definition is removed." : "This removes the encounter definition."} Its Journal record will remain available unless you delete that separately.</p>`
  });
  if (!confirmed) return;
  if (isActive) {
    encounter.status = "complete";
    encounter.endedAt = Date.now();
    encounter.presentationVisible = false;
    await Store.save(encounter);
  }
  await Store.remove(id);
  closeEncounterContextMenu();
  tracker?.render(false);
  renderInfluenceSidebar();
  renderCinematicHud();
  if (game.user.isGM) game.socket.emit(SOCKET, { action: "refresh" });
}

async function handleSidebarAction(event) {
  const action = event.currentTarget.dataset.influenceAction;
  if (action === "new-encounter" && game.user.isGM) {
    event.stopPropagation?.();
    return openCreateEncounterDialog(event, event.currentTarget.dataset.folderId || "");
  }
  if (action === "new-folder" && game.user.isGM) return createEncounterFolder(event);
  if (action === "clear-search") {
    influenceSidebarSearch = "";
    renderInfluenceSidebar();
    return;
  }
  if (action === "open-encounter" && game.user.isGM) {
    const id = event.currentTarget.dataset.id;
    return id === Store.activeId() && Store.get(id)?.status === "active"
      ? tracker.render(true)
      : new EncounterEditor(Store.get(id)).render({ force: true });
  }
  if (action === "open") return tracker.render(true);
  if (action === "manage") return new EncounterManager().render(true);
  const encounter = Store.get();
  if (!encounter) return;
  if (action === "select-participant" && !game.user.isGM) {
    const actor = game.actors.get(event.currentTarget.dataset.id);
    if (!encounterParticipants(encounter).some((participant) => participant.id === actor?.id) || !canUserControlActor(actor)) return ui.notifications.warn("You do not own that participating PC.");
    if (encounter.actorsActed?.[actor.id]) return ui.notifications.info(`${actor.name} has already acted this ${["chase", "skill"].includes(encounter.subsystemType) ? "round" : encounter.subsystemType === "research" ? "research interval" : "phase"}.`);
    await setEncounterViewSelection(encounter, { actorId: actor.id });
    renderInfluenceSidebar();
    tracker?.render(false);
    return;
  }
  const selection = encounterViewSelection(encounter);
  if (["discovery", "influence", "research", "chase", "skill"].includes(action)) return requestCheck(encounter, action, selection.actorId, selection.npcId);
  if (action === "select-npc" && !game.user.isGM) {
    await setEncounterViewSelection(encounter, { npcId: event.currentTarget.dataset.id });
    renderInfluenceSidebar();
    tracker?.render(false);
    return;
  }
  if (!game.user.isGM) return;
  if (action === "select-actor") encounter.activeActorId = event.currentTarget.dataset.id;
  else if (action === "select-npc") encounter.activeNpcId = event.currentTarget.dataset.id;
  else if (action === "toggle-presentation") encounter.presentationVisible = !encounter.presentationVisible;
  else if (action === "edit-npc") return editNpc(encounter, encounter.npcs.find((npc) => npc.id === event.currentTarget.dataset.id));
  else if (action === "remove-npc") {
    if (encounter.npcs.length <= 1) return ui.notifications.warn("An influence encounter must have at least one target.");
    encounter.npcs = encounter.npcs.filter((npc) => npc.id !== event.currentTarget.dataset.id);
    normalizeEncounterCollections(encounter);
  } else return;
  await Store.save(encounter);
}

async function editNpc(encounter, npc) {
  if (!npc) return;
  new Dialog({
    title: "Configure Influence Target",
    content: `<form><div class="form-group"><label>Name</label><input name="name" value="${esc(npc.name)}"></div><div class="form-group"><label>Nickname</label><input name="nickname" value="${esc(npc.nickname)}" placeholder="Optional short display name"></div><div class="form-group"><label>Portrait</label><file-picker name="image" type="imagevideo" value="${esc(npc.image)}"></file-picker></div><label>Background<textarea name="background">${esc(npc.background)}</textarea></label><label>Appearance<textarea name="appearance">${esc(npc.appearance)}</textarea></label><label>Personality<textarea name="personality">${esc(npc.personality)}</textarea></label><p class="hint">Use Edit Encounter for this target's skills, traits, thresholds, and rewards.</p></form>`,
    buttons: { save: { icon: '<i class="fa-solid fa-save"></i>', label: "Save", callback: async (html) => { npc.name = html.find('[name="name"]').val()?.trim() || npc.name; npc.nickname = html.find('[name="nickname"]').val()?.trim() || ""; npc.image = html.find('[name="image"]').val()?.trim() || npc.image; npc.background = html.find('[name="background"]').val()?.trim() || ""; npc.appearance = html.find('[name="appearance"]').val()?.trim() || ""; npc.personality = html.find('[name="personality"]').val()?.trim() || ""; await Store.save(encounter); } }, cancel: { label: "Cancel" } }, default: "save"
  }).render(true);
}

async function handleNpcDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("dragover");
  const actor = await actorFromDropEvent(event);
  if (!actor) return ui.notifications.warn("Drop an Actor or Token to add an influence target.");
  const encounter = Store.get();
  if (!encounter || encounter.npcs.some((npc) => npc.actorId === actor.id)) return;
  const npc = { id: randomID(), actorId: actor.id, name: actor.name, image: participantPortrait(actor) };
  encounter.npcs.push(npc);
  encounter.activeNpcId = npc.id;
  await Store.save(encounter);
  editNpc(encounter, npc);
}

class EncounterManager extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "influence-encounter-manager", title: "Influence Encounter Manager", template: `modules/${MODULE_ID}/templates/manager.hbs`,
      width: 760, height: 680, resizable: true, classes: [MODULE_ID]
    });
  }
  getData() { return { encounters: Object.values(Store.all()).map(normalizeEncounterCollections), activeId: Store.activeId() }; }
  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-action]").on("click", (event) => this._action(event));
  }
  async _action(event) {
    const { action, id } = event.currentTarget.dataset;
    if (action === "new") return openCreateEncounterDialog(event);
    if (action === "sample") return new EncounterEditor(deepClone(LANEKAR)).render({ force: true });
    if (action === "peace-sample") return new EncounterEditor(deepClone(PEACE_TALKS)).render({ force: true });
    if (action === "research-sample") return new EncounterEditor(deepClone(RESEARCHING_THE_EIGHTH)).render({ force: true });
    if (action === "chase-sample") return new EncounterEditor(deepClone(WHERE_IS_THE_GOVERNOR)).render({ force: true });
    if (action === "abeo-chase-sample") return new EncounterEditor(deepClone(ABEO_MARKET_CHASE)).render({ force: true });
    if (action === "edit") return new EncounterEditor(Store.get(id)).render({ force: true });
    if (action === "activate") {
      await activateEncounter(id);
      this.render(false);
    }
    if (action === "pause") { await pauseEncounter(id); this.render(false); }
    if (action === "resume") { await resumeEncounter(id); this.render(false); }
    if (action === "delete") { await deleteEncounter(id); this.render(false); }
    if (action === "export") exportEncounterData(id);
    if (action === "import") importEncounterData();
  }
}

class EncounterEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(encounter, options = {}) {
    super(options);
    this.encounter = normalizeEncounterCollections(encounter);
    this._dirty = false;
    this._forceClose = false;
  }
  get title() { return `Encounter: ${this.encounter?.name || (this.encounter?.subsystemType === "research" ? "New Research Encounter" : this.encounter?.subsystemType === "chase" ? "New Chase" : this.encounter?.subsystemType === "skill" ? "New Skill Encounter" : "New Influence Encounter")}`; }
  static DEFAULT_OPTIONS = {
    id: "influence-encounter-editor",
    tag: "form",
    classes: [MODULE_ID],
    position: { width: 860, height: 780 },
    window: { icon: "fa-solid fa-comments", resizable: true, contentClasses: ["standard-form", "influence-editor"] },
    form: { closeOnSubmit: false, handler: EncounterEditor.#onSubmit },
    actions: { add: EncounterEditor.#onAdd, remove: EncounterEditor.#onRemove, move: EncounterEditor.#onMove, parse: EncounterEditor.#onParse, parseChase: EncounterEditor.#onParseChase, rebalanceChase: EncounterEditor.#onRebalanceChase, dcReference: EncounterEditor.#onDcReference, unlink: EncounterEditor.#onUnlink }
  };
  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/editor.hbs`, root: true, scrollable: [".content"] }
  };
  static TABS = {
    primary: {
      tabs: [
        { id: "basics", label: "Basics", icon: "fa-solid fa-image" },
        { id: "skills", label: "Skills", icon: "fa-solid fa-list-check" },
        { id: "traits", label: "Weakness & Strength", icon: "fa-solid fa-scale-balanced" },
        { id: "results", label: "Results & Boons", icon: "fa-solid fa-trophy" }
      ],
      initial: "basics"
    }
  };
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isResearch = this.encounter.subsystemType === "research";
    const isChase = this.encounter.subsystemType === "chase";
    const isSkill = this.encounter.subsystemType === "skill";
    const selected = new Set(Array.isArray(this.encounter.participantIds)
      ? this.encounter.participantIds
      : defaultPartyCharacters().map((actor) => actor.id));
    const characterActors = allCharacters().map((actor) => ({
      id: actor.id, name: actor.name, nickname: this.encounter.participantNicknames?.[actor.id] ?? "",
      image: participantPortrait(actor), selected: selected.has(actor.id)
    }));
    const encounterView = deepClone(this.encounter);
    if (isResearch) encounterView.npcs.forEach((source) => {
      source.researchParticipantRows = characterActors.filter((actor) => actor.selected).map((actor) => {
        const state = researchActorState(source, actor.id);
        return { ...actor, ...state };
      });
    });
    const tabs = this._prepareTabs("primary");
    if (isResearch) {
      delete tabs.traits;
      tabs.results.label = "Discoveries";
      tabs.results.icon = "fa-solid fa-lightbulb";
    } else if (isChase || isSkill) {
      tabs.traits.label = "Circumstances";
      tabs.traits.icon = "fa-solid fa-sliders";
      delete tabs.results;
      tabs.skills.label = isChase ? "Overcome Checks" : "Skill Checks";
    }
    const chasePositionOptions = Object.fromEntries(this.encounter.npcs.map((npc, index) => [index, `${index + 1} — ${targetDisplayName(npc)}`]));
    return {
      ...context,
      encounter: encounterView,
      isResearch,
      isChase,
      isSkill,
      individualSkillScoring: isSkill && this.encounter.skillScoringMode === "individual",
      goalBasedSkillEncounter: isSkill && this.encounter.skillVictoryMode === "goal",
      isChallenge: isChase || isSkill,
      progressClockAvailable: !!progressClockDatabase(),
      progressClockSupported: !isSkill || (this.encounter.skillScoringMode === "shared" && this.encounter.skillVictoryMode === "goal"),
      characterActors,
      skillChoices: [...PF2E_SKILLS, ...((isChase || isSkill) ? PF2E_SAVES : []), ...PF2E_LORE_SKILLS, ...Object.keys(LORE_CATEGORIES)],
      tabs,
      modifierTypes: { circumstance: "Circumstance", status: "Status", item: "Item", untyped: "Untyped" },
      traitModes: { roll: "Roll modifier", dc: "DC adjustment", narrative: "Narrative only" },
      circumstanceModes: { roll: "Roll modifier", dc: "DC adjustment" },
      boonModes: { roll: "Roll bonus", dc: "DC adjustment", narrative: "Narrative" },
      boonScopes: { both: "Both", discovery: "Discovery", influence: "Influence", external: "Outside this encounter" },
      rewardKinds: { modifier: "Mechanical modifier", ip: "IP adjustment", narrative: "Narrative reward" },
      rewardActivations: { automatic: "Automatic", manual: "GM applies" },
      availabilityOptions: { hidden: "Hidden", available: "Available", exhausted: "Exhausted" },
      researchActorAvailabilityOptions: { available: "Available", unavailable: "Unavailable", exhausted: "Exhausted" },
      intervalUnits: { minute: "Minutes", hour: "Hours", day: "Days" },
      chaseTypes: { "chase-down": "Chase Down", "run-away": "Run Away", "beat-clock": "Beat the Clock", competitive: "Competitive", custom: "Custom" },
      subjectTurnOrders: { before: "Before the party", after: "After the party" },
      skillScoringModes: { shared: "Shared party pool", individual: "Individual PC scores" },
      skillVictoryModes: { goal: "Reach a point goal", gm: "GM decides" },
      dcVisibilities: { exact: "Exact DCs", relative: "Relative difficulty", hidden: "Hidden" },
      victorySplashModes: { automatic: "Automatic when the chase is won", manual: "Manual GM trigger after victory" },
      chasePositionOptions,
      npcTargets: { ...((isChase || isSkill) ? { "": isChase ? "All obstacles" : "All challenges" } : {}), ...Object.fromEntries(this.encounter.npcs.map((npc) => [npc.id, targetDisplayName(npc)])) }
    };
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("input", () => { this._dirty = true; });
    this.element.addEventListener("change", () => { this._dirty = true; });
    for (const selector of ['[name="skillScoringMode"]', '[name="skillVictoryMode"]']) {
      this.element.querySelector(selector)?.addEventListener("change", async () => {
        this._capture();
        await this.render({ force: true });
      });
    }
    this.element.querySelectorAll('[name^="participantNicknames."]').forEach((input) => input.addEventListener("input", () => {
      this.encounter.participantNicknames[input.name.slice("participantNicknames.".length)] = input.value.trim();
    }));
    this.element.querySelectorAll('[name$=".nickname"]').forEach((input) => input.addEventListener("input", () => {
      const index = Number(input.name.match(/^npcs\.(\d+)\.nickname$/)?.[1]);
      if (Number.isInteger(index) && this.encounter.npcs[index]) this.encounter.npcs[index].nickname = input.value.trim();
    }));
    this.element.querySelector('[name="name"]')?.addEventListener("input", (event) => {
      const name = event.currentTarget.value.trim() || "New Influence Encounter";
      this.element.querySelector(".window-title").textContent = `Encounter: ${name}`;
    });
    for (const zone of this.element.querySelectorAll("[data-actor-drop]")) {
      zone.addEventListener("dragenter", (event) => { event.preventDefault(); zone.classList.add("dragover"); });
      zone.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; zone.classList.add("dragover"); });
      zone.addEventListener("dragleave", (event) => { if (!zone.contains(event.relatedTarget)) zone.classList.remove("dragover"); });
      zone.addEventListener("drop", (event) => this._onActorDrop(event, zone.dataset.actorDrop));
    }
    const refreshAutomaticDc = (row) => {
      const modified = row?.querySelector("[data-dc-modified]");
      const dcInput = row?.querySelector("[data-dc-input]");
      const labelInput = row?.querySelector("[data-skill-label]");
      if (!row || !dcInput || modified?.value === "true") return;
      const lore = row.querySelector('input[type="checkbox"][name$=".lore"]')?.checked || /\bLore$/i.test(labelInput?.value ?? "");
      dcInput.value = Math.max(0, levelBasedDC(this.element.querySelector('[name="level"]')?.value ?? this.encounter.level) - (lore ? 2 : 0));
    };
    this.element.querySelector('[name="level"]')?.addEventListener("input", () => {
      this.element.querySelectorAll(".skill-row").forEach(refreshAutomaticDc);
    });
    this.element.querySelectorAll("[data-research-actor-points]").forEach((input) => input.addEventListener("input", () => {
      const previous = Math.max(0, Number(input.dataset.previousValue) || 0);
      const current = Math.max(0, Number(input.value) || 0);
      const delta = current - previous;
      input.dataset.previousValue = String(current);
      if (!delta) return;
      const sourcePoints = this.element.querySelector(`[name="npcs.${input.dataset.sourceIndex}.points"]`);
      const encounterPoints = this.element.querySelector('[name="researchPoints"]');
      if (sourcePoints) sourcePoints.value = String(Math.max(0, Number(sourcePoints.value) + delta));
      if (encounterPoints) encounterPoints.value = String(Math.max(0, Number(encounterPoints.value) + delta));
    }));
    this.element.querySelector('[name="chaseType"]')?.addEventListener("change", (event) => {
      const order = this.element.querySelector('[name="subjectTurnOrder"]');
      if (order) order.value = event.currentTarget.value === "run-away" ? "after" : "before";
    });
    this.element.querySelectorAll("[data-dc-input]").forEach((input) => input.addEventListener("input", () => {
      const modified = input.closest(".skill-row")?.querySelector("[data-dc-modified]");
      if (modified) modified.value = "true";
    }));
    this.element.querySelectorAll("input[data-skill-label]").forEach((input) => {
      input.addEventListener("focus", () => { input.dataset.previousValue = input.value; });
      input.addEventListener("input", () => {
        const row = input.closest(".skill-row");
        const slugInput = row?.querySelector("input[data-skill-slug]");
        const loreInput = row?.querySelector('input[type="checkbox"][name$=".lore"]');
        if (slugInput) slugInput.value = skillSlug(input.value.replace(/\s*\*$/, ""));
        if (loreInput) {
          const value = input.value.trim();
          const knownNonLore = [...PF2E_SKILLS, ...PF2E_SAVES].some((choice) => choice.toLowerCase() === value.toLowerCase());
          if (/\bLore$/i.test(value) || Object.hasOwn(LORE_CATEGORIES, value)) loreInput.checked = true;
          else if (knownNonLore) loreInput.checked = false;
        }
        refreshAutomaticDc(row);
      });
      input.addEventListener("change", async () => {
        if (!LORE_CATEGORIES[input.value]) return;
        const previous = input.dataset.previousValue ?? "";
        const selected = await chooseLoreSpecialization(input.value);
        input.value = selected ?? previous;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    this.element.querySelectorAll('input[type="checkbox"][name$=".lore"]').forEach((input) => input.addEventListener("change", () => refreshAutomaticDc(input.closest(".skill-row"))));
  }
  async _onActorDrop(event, destination) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    event.currentTarget.classList.remove("dragover");
    const dropped = await documentFromDropEvent(event);
    const actor = dropped?.documentName === "Token" ? dropped.actor : dropped?.documentName === "Actor" ? dropped : await actorFromDropEvent(event);
    const [dropType, dropIndex] = destination.split(":");
    if (!actor && !(dropType === "npc" && this.encounter.subsystemType === "research" && ["Item", "JournalEntry", "JournalEntryPage"].includes(dropped?.documentName))) return ui.notifications.warn(this.encounter.subsystemType === "research" ? "Drop an Actor, Item, Journal, or Journal page." : "Drop an Actor from the sidebar or a Token from the canvas.");
    this._capture();
    if (dropType === "chase-subject") {
      if (!actor) return ui.notifications.warn("Drop an Actor from the sidebar or a Token from the canvas.");
      // A chase subject is encounter-level presentation data, never an
      // obstacle link. Preserve every obstacle explicitly while updating it.
      const obstacles = deepClone(this.encounter.npcs);
      this.encounter.chaseSubject = { ...this.encounter.chaseSubject, actorId: actor.id, name: actor.name, image: participantPortrait(actor) };
      this.encounter.npcs = obstacles;
      this._dirty = true;
      ui.notifications.info(`Linked the chase subject to ${actor.name}.`);
      return this.render({ force: true });
    }
    if (dropType === "link-target") {
      const npc = this.encounter.npcs[Number(dropIndex)];
      if (!npc || !actor) return ui.notifications.warn("Drop an Actor from the sidebar or a Token from the canvas.");
      if (this.encounter.npcs.some((entry) => entry !== npc && entry.actorId === actor.id)) return ui.notifications.warn(`${actor.name} is already linked to another influence target.`);
      npc.actorId = actor.id;
      npc.name = actor.name;
      npc.image = participantPortrait(actor);
      this._dirty = true;
      ui.notifications.info(`Linked this influence target to ${actor.name}. Its encounter mechanics were preserved.`);
      return this.render({ force: true });
    }
    if (dropType === "participant") {
      if (actor.type !== "character") return ui.notifications.warn(`${actor.name} is not a player character and cannot be added as a participant.`);
      this.encounter.participantIds ??= [];
      if (this.encounter.participantIds.includes(actor.id)) return ui.notifications.info(`${actor.name} is already participating.`);
      this._dirty = true;
      this.encounter.participantIds.push(actor.id);
      ui.notifications.info(`Added ${actor.name} as a participant.`);
    } else if (dropType === "npc") {
      if (!actor && this.encounter.subsystemType === "research") {
        const image = dropped.src || dropped.img || dropped.parent?.img || "icons/svg/book.svg";
        const created = { id: randomID(), actorId: "", sourceUuid: dropped.uuid, name: dropped.name || "Research Source", image, points: 0, maximumPoints: 4,
          availability: "available", requirements: "", researchInterval: "", awards: { criticalFailure: -1, failure: 0, success: 1, criticalSuccess: 2 },
          background: "", appearance: "", personality: "", discovery: [], influence: [], thresholds: [] };
        this.encounter.npcs.push(created);
        this.encounter.activeNpcId = created.id;
        this._dirty = true;
        ui.notifications.info(`Added ${created.name} as a research source.`);
        return this.render({ force: true });
      }
      if (this.encounter.npcs.some((npc) => npc.actorId === actor.id)) return ui.notifications.info(`${actor.name} is already an influence target.`);
      this._dirty = true;
      const research = this.encounter.subsystemType === "research";
      const created = { id: randomID(), actorId: actor.id, name: actor.name, image: participantPortrait(actor), points: 0,
        maximumPoints: research ? 4 : 0, availability: "available", requirements: "", researchInterval: "", awards: { criticalFailure: -1, failure: 0, success: 1, criticalSuccess: 2 },
        background: "", appearance: "", personality: "", discovery: deepClone(DEFAULT_ENCOUNTER.discovery.slice(0, 2)), influence: [], thresholds: [],
        weakness: { label: "Weakness", description: "", value: 0, type: "circumstance", mode: "roll" },
        strength: { label: "Resistance", description: "", value: 0, type: "circumstance", mode: "roll" } };
      const placeholder = this.encounter.npcs.length === 1 && isGeneratedPlaceholderNpc(this.encounter, this.encounter.npcs[0]);
      if (!research) created.discovery.forEach((skill) => { if (!skill.dcModified) skill.dc = automaticSkillDC(this.encounter, skill); });
      if (placeholder) this.encounter.npcs[0] = created;
      else this.encounter.npcs.push(created);
      this.encounter.activeNpcId = created.id;
      this.encounter.encounterType = this.encounter.npcs.length > 1 ? "multiple" : "single";
      ui.notifications.info(`Added ${actor.name} as a ${research ? "research source" : "influence target"}.`);
    } else return;
    await this.render({ force: true });
  }
  _mergeFormData(formData) {
    const expanded = foundry.utils.expandObject(formData);
    const npcUpdates = indexedArray(expanded.npcs);
    const thresholdUpdates = indexedArray(expanded.researchThresholds);
    const effectUpdates = indexedArray(expanded.activeEffects);
    delete expanded.npcs;
    delete expanded.researchThresholds;
    delete expanded.activeEffects;
    foundry.utils.mergeObject(this.encounter, expanded, { inplace: true, overwrite: true });
    npcUpdates.forEach((update, index) => {
      const existing = this.encounter.npcs[index];
      if (existing) foundry.utils.mergeObject(existing, update, { inplace: true, overwrite: true });
    });
    thresholdUpdates.forEach((update, index) => {
      const existing = this.encounter.researchThresholds[index];
      if (existing) foundry.utils.mergeObject(existing, update, { inplace: true, overwrite: true });
    });
    effectUpdates.forEach((update, index) => {
      const existing = this.encounter.activeEffects[index];
      if (existing) foundry.utils.mergeObject(existing, update, { inplace: true, overwrite: true });
    });
  }
  _capture(formData = new foundry.applications.ux.FormDataExtended(this.element).object) {
    this._mergeFormData(formData);
    normalizeEncounterCollections(this.encounter);
    this.encounter.publicPoints = this.element.querySelector('[name="publicPoints"]')?.checked ?? false;
    this.encounter.progressClock.enabled = this.element.querySelector('[name="progressClock.enabled"]')?.checked ?? false;
    this.encounter.promptAdvanceWhenAllActed = this.element.querySelector('[name="promptAdvanceWhenAllActed"]')?.checked ?? false;
    this.encounter.participantIds = [...this.element.querySelectorAll('[name="partyParticipant"]:checked')].map((input) => input.value);
    for (const input of this.element.querySelectorAll('[name^="participantNicknames."]')) {
      this.encounter.participantNicknames[input.name.slice("participantNicknames.".length)] = input.value.trim();
    }
    this.encounter.npcs.forEach((npc, npcIndex) => {
      npc.nickname = this.element.querySelector(`[name="npcs.${npcIndex}.nickname"]`)?.value.trim() ?? "";
      npc.discovery.forEach((skill, skillIndex) => skill.secret = this.element.querySelector(`[name="npcs.${npcIndex}.discovery.${skillIndex}.secret"]`)?.checked ?? false);
      npc.influence.forEach((skill, skillIndex) => skill.lore = this.element.querySelector(`[name="npcs.${npcIndex}.influence.${skillIndex}.lore"]`)?.checked ?? false);
      npc.thresholds.forEach((threshold, thresholdIndex) => threshold.boons.forEach((boon, boonIndex) => {
        boon.playerVisible = this.element.querySelector(`[name="npcs.${npcIndex}.thresholds.${thresholdIndex}.boons.${boonIndex}.playerVisible"]`)?.checked ?? false;
      }));
    });
  }
  static async #onAdd(_event, target) {
    this._dirty = true;
    this._capture();
    this._add(target.dataset.type);
    await this.render({ force: true });
  }
  static async #onRemove(_event, target) {
    this._capture();
    if (this._remove(target.dataset.type, Number(target.dataset.index)) === false) return;
    this._dirty = true;
    await this.render({ force: true });
  }
  static async #onMove(_event, target) {
    this._capture();
    const index = Number(target.dataset.index);
    const destination = index + Number(target.dataset.direction);
    if (!Number.isInteger(index) || destination < 0 || destination >= this.encounter.npcs.length) return;
    const [moved] = this.encounter.npcs.splice(index, 1);
    this.encounter.npcs.splice(destination, 0, moved);
    this._dirty = true;
    await this.render({ force: true });
  }
  static async #onParse(_event, target) {
    this._capture();
    const npcIndex = Number(target.dataset.npcIndex);
    const npc = this.encounter.npcs[npcIndex];
    const source = this.element.querySelector(`[data-parser-source="${npcIndex}"]`)?.value?.trim();
    const type = this.encounter.subsystemType;
    if (!npc || !source) return ui.notifications.warn(`Paste the ${type === "research" ? "source's research" : type === "skill" ? "challenge" : "NPC's influence"} text before parsing.`);
    const found = type === "research" ? parseResearchSource(source, npc) : type === "skill" ? parseSkillChallenge(source, npc) : parseInfluenceSource(source, npc);
    if (!found.length) return ui.notifications.warn("No recognizable sections were found.");
    this._dirty = true;
    ui.notifications.info(`Parsed ${npc.name}: ${found.join(", ")}. Review the generated fields before saving.`);
    await this.render({ force: true });
  }
  static async #onParseChase() {
    this._capture();
    const source = this.element.querySelector("[data-chase-parser-source]")?.value?.trim();
    if (!source) return ui.notifications.warn("Paste one or more published obstacle blocks before parsing.");
    const parsed = parseChaseObstacles(source);
    if (!parsed.obstacles.length) return ui.notifications.warn("No recognizable chase obstacles were found. Include each OBSTACLE heading, Chase Points, and Overcome DCs.");
    this.encounter.npcs = parsed.obstacles;
    this.encounter.phases = parsed.obstacles.length;
    this.encounter.activeNpcId = parsed.obstacles[0].id;
    if (parsed.level) this.encounter.level = parsed.level;
    this._dirty = true;
    ui.notifications.info(`Parsed ${parsed.obstacles.length} chase obstacle(s). Review the generated fields before saving.`);
    await this.render({ force: true });
  }
  static async #onRebalanceChase() {
    this._capture();
    const participants = Array.isArray(this.encounter.participantIds) ? this.encounter.participantIds.length : defaultPartyCharacters().length;
    for (const obstacle of this.encounter.npcs) obstacle.maximumPoints = balancedChasePoints(obstacle.baseMaximumPoints, participants, this.encounter.chaseDesignedPartySize);
    this._dirty = true;
    ui.notifications.info(`Rebalanced all obstacles for ${participants || 1} participating PC${participants === 1 ? "" : "s"}.`);
    await this.render({ force: true });
  }
  static async #onDcReference() {
    this._capture();
    const standard = levelBasedDC(this.encounter.level);
    const adjustments = [["Incredibly Easy", -10], ["Very Easy", -5], ["Easy", -2], ["Standard", 0], ["Hard", 2], ["Very Hard", 5], ["Incredibly Hard", 10]];
    const cells = adjustments.map(([label, adjustment]) => `<tr><th>${label}</th><td>${standard + adjustment}</td><td>${signed(adjustment)}</td></tr>`).join("");
    new Dialog({ title: `Level ${this.encounter.level} DC Reference`, content: `<table class="dc-reference-grid"><thead><tr><th>Difficulty</th><th>DC</th><th>Adjustment</th></tr></thead><tbody>${cells}</tbody></table>`, buttons: { close: { label: "Close" } }, default: "close" }).render(true);
  }
  static async #onUnlink(_event, target) {
    this._capture();
    const npc = this.encounter.npcs[Number(target.dataset.index)];
    if (!npc?.actorId) return;
    npc.actorId = "";
    this._dirty = true;
    ui.notifications.info(`${npc.name} is no longer linked to a Foundry Actor. Its current name and portrait were retained.`);
    await this.render({ force: true });
  }
  _add(type) {
    const [kind, npcIndex, thresholdIndex] = type.split(":");
    const npc = this.encounter.npcs[Number(npcIndex)];
    if (kind === "npc") {
      const research = this.encounter.subsystemType === "research";
      const chase = this.encounter.subsystemType === "chase";
      const skillEncounter = this.encounter.subsystemType === "skill";
      const firstChaseObstacle = chase && this.encounter.npcs.length === 0;
      const created = { id: randomID(), name: research ? "New Research Source" : chase ? "New Obstacle" : skillEncounter ? "New Challenge" : "New Influence Target", image: research ? "icons/svg/book.svg" : chase ? "icons/svg/door-exit.svg" : skillEncounter ? "icons/svg/d20-black.svg" : "icons/svg/mystery-man.svg", actorId: "", points: 0,
        baseMaximumPoints: chase ? 3 : 0, maximumPoints: research ? 4 : chase ? 3 : 0, availability: "available", requirements: "", researchInterval: "", awards: { criticalFailure: -1, failure: 0, success: 1, criticalSuccess: 2 },
        background: "", appearance: "", personality: "", discovery: (chase || skillEncounter) ? [] : deepClone(DEFAULT_ENCOUNTER.discovery.slice(0, 2)), influence: [], thresholds: [],
        weakness: { label: "Weakness", description: "", value: 0, type: "circumstance", mode: "dc" },
        strength: { label: "Resistance", description: "", value: 0, type: "circumstance", mode: "dc" } };
      if (!research && !chase && !skillEncounter) created.discovery.forEach((skill) => { if (!skill.dcModified) skill.dc = automaticSkillDC(this.encounter, skill); });
      this.encounter.npcs.push(created);
      if (!chase || firstChaseObstacle) this.encounter.activeNpcId = created.id;
    }
    if (kind === "discovery" && npc) npc.discovery.push({ id: randomID(), slug: "", label: "", dc: automaticSkillDC(this.encounter), dcModified: false, lore: false, secret: false });
    if (kind === "influence" && npc) npc.influence.push({ id: randomID(), slug: "", label: "", dc: automaticSkillDC(this.encounter), dcModified: false, lore: false });
    if (kind === "threshold" && npc) npc.thresholds.push({ id: randomID(), points: 0, label: "", text: "", boons: [] });
    if (kind === "boon" && npc) npc.thresholds[Number(thresholdIndex)]?.boons.push({ id: randomID(), kind: "narrative", label: "New Reward", description: "", value: 0, type: "circumstance", mode: "narrative", scope: "both", skills: [], uses: 0, remaining: 0, activation: "automatic", active: true, applied: false, targetNpcId: npc.id, playerVisible: true });
    if (kind === "research-threshold") this.encounter.researchThresholds.push({ id: randomID(), points: 0, label: "New Discovery", text: "", boons: [] });
    if (kind === "circumstance") this.encounter.activeEffects.push({ id: randomID(), kind: "modifier", label: "New Circumstance", description: "", value: 1, type: "circumstance", mode: "roll", scope: this.encounter.subsystemType, targetNpcId: "", skills: [], uses: 999, remaining: 999, activation: "manual" });
  }
  _remove(type, index) {
    const [kind, npcIndex, thresholdIndex] = type.split(":");
    const npc = this.encounter.npcs[Number(npcIndex)];
    if (kind === "npc") {
      if (this.encounter.npcs.length <= 1 && this.encounter.subsystemType !== "research") {
        ui.notifications.warn(this.encounter.subsystemType === "skill" ? "A skill encounter must have at least one challenge." : "An influence encounter must have at least one target.");
        return false;
      }
      this.encounter.npcs.splice(index, 1);
      normalizeEncounterCollections(this.encounter);
    }
    if (kind === "discovery" && npc) npc.discovery.splice(index, 1);
    if (kind === "influence" && npc) npc.influence.splice(index, 1);
    if (kind === "threshold" && npc) npc.thresholds.splice(index, 1);
    if (kind === "boon" && npc) npc.thresholds[Number(thresholdIndex)]?.boons.splice(index, 1);
    if (kind === "research-threshold") this.encounter.researchThresholds.splice(index, 1);
    if (kind === "circumstance") this.encounter.activeEffects.splice(index, 1);
    return true;
  }
  static async #onSubmit(_event, _form, formData) {
    if (await this._save(formData.object) !== false) await this.render({ force: true });
  }
  async _save(formData) {
    try {
      const priorActiveState = this.encounter.id ? Store.get(this.encounter.id) : null;
      this._mergeFormData(formData);
      normalizeEncounterCollections(this.encounter);
      this.encounter.publicPoints = this.element.querySelector('[name="publicPoints"]')?.checked ?? false;
      this.encounter.progressClock.enabled = this.element.querySelector('[name="progressClock.enabled"]')?.checked ?? false;
      this.encounter.promptAdvanceWhenAllActed = this.element.querySelector('[name="promptAdvanceWhenAllActed"]')?.checked ?? false;
      this.encounter.participantIds = [...this.element.querySelectorAll('[name="partyParticipant"]:checked')].map((input) => input.value);
      for (const input of this.element.querySelectorAll('[name^="participantNicknames."]')) {
        this.encounter.participantNicknames[input.name.slice("participantNicknames.".length)] = input.value.trim();
      }
      this.encounter.id ||= randomID();
      this.encounter.phases = Number(this.encounter.phases) || 4;
      if (!this.encounter.npcs.length) {
        ui.notifications.warn(`Add at least one ${this.encounter.subsystemType === "research" ? "Research Source" : this.encounter.subsystemType === "chase" ? "Obstacle" : this.encounter.subsystemType === "skill" ? "Challenge" : "Influence Target"} before saving this encounter.`);
        return false;
      }
      if (this.encounter.subsystemType === "chase" && this.encounter.status === "draft") {
        this.encounter.opponentPosition = this.encounter.subjectStartPosition;
      }
      this.encounter.npcs.forEach((npc, npcIndex) => {
        npc.nickname = this.element.querySelector(`[name="npcs.${npcIndex}.nickname"]`)?.value.trim() ?? "";
        npc.points = Math.max(0, Number(npc.points) || 0);
        npc.maximumPoints = Math.max(0, Number(npc.maximumPoints) || 0);
        for (const key of ["criticalFailure", "failure", "success", "criticalSuccess"]) npc.awards[key] = Number(npc.awards[key]) || 0;
        npc.discovery.forEach((skill, skillIndex) => { skill.dc = Number(skill.dc); skill.secret = this.element.querySelector(`[name="npcs.${npcIndex}.discovery.${skillIndex}.secret"]`)?.checked ?? false; });
        npc.influence.forEach((skill, skillIndex) => { skill.dc = Number(skill.dc); skill.lore = this.element.querySelector(`[name="npcs.${npcIndex}.influence.${skillIndex}.lore"]`)?.checked ?? false; });
        npc.weakness.value = Number(npc.weakness.value) || 0;
        npc.strength.value = Number(npc.strength.value) || 0;
        npc.thresholds.forEach((threshold, thresholdIndex) => {
          threshold.points = Number(threshold.points) || 0;
          threshold.boons.forEach((boon, boonIndex) => {
            boon.value = Number(boon.value) || 0;
            boon.uses = Math.max(0, Number(boon.uses) || 0);
            boon.remaining = Math.min(boon.uses, Number(boon.remaining ?? boon.uses));
            boon.skills = typeof boon.skills === "string" ? boon.skills.split(",").map((skill) => skill.trim()).filter(Boolean) : boon.skills;
            boon.playerVisible = this.element.querySelector(`[name="npcs.${npcIndex}.thresholds.${thresholdIndex}.boons.${boonIndex}.playerVisible"]`)?.checked ?? false;
          });
        });
      });
      this.encounter.researchPoints = Math.max(0, Number(this.encounter.researchPoints) || 0);
      this.encounter.researchInterval.value = Math.max(1, Number(this.encounter.researchInterval.value) || 1);
      if (priorActiveState?.status === "active") {
        snapshot(priorActiveState, "Edit active encounter");
        this.encounter.history = priorActiveState.history;
      }
      this.encounter.researchThresholds.forEach((threshold) => threshold.points = Math.max(0, Number(threshold.points) || 0));
      this.encounter.activeEffects.forEach((effect) => {
        effect.value = Number(effect.value) || 0;
        effect.skills = typeof effect.skills === "string" ? effect.skills.split(",").map((skill) => skillSlug(skill)).filter(Boolean) : effect.skills;
      });
      this.encounter.backgroundBlur = Math.max(0, Math.min(20, Number(this.encounter.backgroundBlur) || 0));
      this.encounter.obscureFutureObstacles = this.element.querySelector('[name="obscureFutureObstacles"]')?.checked ?? false;
      await Store.save(this.encounter);
      this._dirty = false;
      ui.notifications.info(`${this.encounter.name} saved.`);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to save encounter`, error);
      ui.notifications.error(`Could not save ${this.encounter.name}. See the console for details.`);
      throw error;
    }
  }
  async close(options = {}) {
    if (this._forceClose || !this._dirty) return super.close(options);
    const choice = await new Promise((resolve) => {
      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };
      new Dialog({
        title: "Unsaved Encounter Changes",
        content: `<p>You have unsaved changes to <strong>${esc(this.encounter.name)}</strong>. Closing without saving will discard them.</p>`,
        buttons: {
          save: { icon: '<i class="fa-solid fa-floppy-disk"></i>', label: "Save and Close", callback: () => finish("save") },
          cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel", callback: () => finish("cancel") },
          discard: { icon: '<i class="fa-solid fa-trash"></i>', label: "Close Without Saving", callback: () => finish("discard") }
        },
        default: "cancel",
        close: () => finish("cancel")
      }).render(true);
    });
    if (choice === "cancel") return this;
    if (choice === "save") {
      const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
      if (await this._save(formData) === false) return this;
    }
    this._forceClose = true;
    return super.close(options);
  }
}

async function requestCheck(encounter, type, selectedActorId = null, selectedNpcId = null) {
  const npc = encounter.npcs.find((entry) => entry.id === selectedNpcId) ?? encounter.npcs.find((entry) => entry.id === encounter.activeNpcId) ?? encounter.npcs[0];
  const isResearch = type === "research" || encounter.subsystemType === "research";
  const isChase = type === "chase" || encounter.subsystemType === "chase";
  const isSkill = type === "skill" || encounter.subsystemType === "skill";
  if (!npc) return ui.notifications.warn(isResearch ? "Choose a research source first." : "Choose an influence target first.");
  if (isResearch && (npc.availability !== "available" || (npc.maximumPoints && npc.points >= npc.maximumPoints))) return ui.notifications.warn(`${npc.name} is not currently available for further research.`);
  const actor = (selectedActorId ? game.actors.get(selectedActorId) : null)
    ?? canvas.tokens.controlled[0]?.actor
    ?? game.user.character;
  if (!actor) return ui.notifications.warn("Select a participant, select a character token, or assign a user character first.");
  const npcName = targetDisplayName(npc);
  if (!encounterParticipants(encounter).some((participant) => participant.id === actor.id)) return ui.notifications.warn(`${actor.name} is not participating in this encounter.`);
  if (!game.user.isGM && !canUserControlActor(actor)) return ui.notifications.warn(`You must be an Owner of ${actor.name} to act for that character.`);
  if (isResearch && !researchSourceAvailableForActor(npc, actor.id)) {
    const state = researchActorState(npc, actor.id);
    return ui.notifications.warn(state.availability === "unavailable" ? `${npcName} is unavailable to ${actor.name}.` : `${actor.name} has exhausted the Research Points available from ${npcName}.`);
  }
  if (encounter.actorsActed?.[actor.id]) return ui.notifications.warn(`${actor.name} has already acted this ${isResearch ? "research interval" : (isChase || isSkill) ? "round" : "phase"}.`);
  let options = "";
  if (type === "discovery") {
    const perception = npc.discovery.find((skill) => skill.slug === "perception");
    const diplomacy = npc.discovery.find((skill) => skill.slug === "diplomacy");
    const primary = [perception, diplomacy].filter(Boolean)
      .map((skill) => { const mod = actorStatisticModifier(actor, skill); return `<option value="configured:${skill.id}">${esc(skill.label)}${mod === null ? "" : ` (${signed(mod)})`}</option>`; }).join("");
    const otherSkills = actorSkillChoices(actor).filter((skill) => !["perception", "diplomacy"].includes(skill.slug));
    const remaining = otherSkills.map((skill) => { const mod = actorStatisticModifier(actor, skill); return `<option value="actor:${esc(skill.slug)}">${esc(skill.label)}${mod === null ? "" : ` (${signed(mod)})`}</option>`; }).join("");
    options = `${primary}<option disabled>──────────</option>${remaining}`;
  } else {
    const skills = availableSkillsForActor(actor, npc.influence);
    if (!skills.length) return ui.notifications.warn(`${actor.name} has none of the configured ${isResearch ? "Research" : isChase ? "Overcome" : isSkill ? "Skill Encounter" : "Influence"} checks.`);
    options = skills.map((skill) => { const mod = actorStatisticModifier(actor, skill); return `<option value="configured:${skill.id}">${esc(skill.label)}${mod === null ? "" : ` (${signed(mod)})`}</option>`; }).join("");
  }
  new Dialog({
    title: `Make a Check: ${npcName}`,
    content: `<form><p>${isResearch ? "Source" : "Target"}: <strong>${esc(npcName)}</strong></p>${isResearch && npc.requirements ? `<p class="hint"><strong>Requirements:</strong> ${esc(npc.requirements)}</p>` : ""}<div class="form-group"><label>Skill</label><select name="skill">${options}</select></div></form>`,
    buttons: { request: { icon: '<i class="fas fa-paper-plane"></i>', label: "Request Check", callback: (html) => {
      const selection = String(html.find('[name="skill"]').val());
      const [source, value] = selection.split(":");
      const actorChoice = source === "actor" ? actorSkillChoices(actor).find((skill) => skill.slug === value) : null;
      const payload = { action: "check-request", encounterId: encounter.id, npcId: npc.id, requesterId: game.user.id, actorId: actor.id, type,
        skillId: source === "configured" ? value : null, skillSlug: actorChoice?.slug ?? null, skillLabel: actorChoice?.label ?? null };
      if (game.user.isGM) receiveCheckRequest(payload); else game.socket.emit(SOCKET, payload);
    } } }
  }).render(true);
}

function applicableBoons(encounter, request, skill) {
  const unlocked = encounter.subsystemType === "research"
    ? encounter.researchThresholds.flatMap((threshold) => threshold.points <= encounter.researchPoints ? threshold.boons : [])
    : encounter.npcs.flatMap((npc) => npc.thresholds.flatMap((threshold) => threshold.points <= npc.points ? threshold.boons : []));
  return [...unlocked, ...(encounter.activeEffects ?? [])].filter((b) => {
    if ((b.kind ?? "modifier") !== "modifier") return false;
    if (b.targetNpcId && b.targetNpcId !== request.npcId) return false;
    if ((b.remaining ?? b.uses) <= 0) return false;
    if (b.external || b.scope === "external") return false;
    if (b.mode === "narrative") return false;
    if (!["both", request.type, "external"].includes(b.scope)) return false;
    return !b.skills?.length || b.skills.includes(skill.slug);
  });
}

let adjudicationOpen = false;
let checkQueueOperation = Promise.resolve();

function receiveCheckRequest(payload) {
  checkQueueOperation = checkQueueOperation.then(() => enqueueCheckRequest(payload)).catch((error) => console.error(`${MODULE_ID} | Check queue operation failed`, error));
  return checkQueueOperation;
}

async function notifyPendingCheck(request, message) {
  const recipients = [...new Set([request.requesterId, ...ChatMessage.getWhisperRecipients("GM").map((user) => user.id)].filter(Boolean))];
  await ChatMessage.create({
    content: `<div class="influence-chat influence-check-canceled"><strong>Check Request Canceled</strong><p>${esc(message)}</p></div>`,
    whisper: recipients
  });
  game.socket.emit(SOCKET, { action: "check-request-status", userId: request.requesterId, message });
}

async function cancelPendingCheck(encounterId, requestId, reason) {
  const encounter = Store.get(encounterId);
  const request = encounter?.pendingChecks?.find((entry) => entry.id === requestId);
  if (!encounter || !request) return;
  encounter.pendingChecks = encounter.pendingChecks.filter((entry) => entry.id !== requestId);
  await Store.save(encounter);
  game.socket.emit(SOCKET, { action: "refresh" });
  await notifyPendingCheck(request, reason);
  tracker?.render(false);
}

async function enqueueCheckRequest(payload) {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  const encounter = Store.get(payload.encounterId);
  const actor = game.actors.get(payload.actorId);
  const npc = encounter?.npcs?.find((entry) => entry.id === payload.npcId);
  if (!encounter || encounter.status !== "active" || !actor || !npc) return ui.notifications.warn("That check request is no longer valid.");
  if (encounter.skillOutcome || encounter.chaseOutcome) return ui.notifications.warn("That encounter has already concluded.");
  if (encounter.pendingChecks.some((entry) => entry.actorId === payload.actorId)) {
    game.socket.emit(SOCKET, { action: "check-request-status", userId: payload.requesterId, message: `${participantDisplayName(encounter, actor)} already has a check waiting for the GM.` });
    return;
  }
  const request = { ...payload, id: payload.id || randomID(), submittedAt: Date.now() };
  encounter.pendingChecks.push(request);
  await Store.save(encounter);
  const skillList = request.type === "discovery" ? npc.discovery : npc.influence;
  const skill = skillList.find((entry) => entry.id === request.skillId || entry.slug === request.skillSlug);
  const actorName = participantDisplayName(encounter, actor);
  const npcName = targetDisplayName(npc);
  await ChatMessage.create({ content: `<div class="influence-chat influence-check-request"><strong>Check Requested</strong><p>${esc(actorName)} requested a check against ${esc(npcName)} using ${esc(skill?.label ?? request.skillLabel ?? "an unknown skill")}.</p></div>` });
  game.socket.emit(SOCKET, { action: "check-request-status", userId: request.requesterId, message: `${actorName}'s check request is queued for the GM.` });
  game.socket.emit(SOCKET, { action: "refresh" });
  tracker?.render(false);
  if (!adjudicationOpen) adjudicate(request);
}

async function adjudicate(request) {
  if (!game.user.isGM) return;
  if (adjudicationOpen) return ui.notifications.info("Finish the current adjudication before opening another request.");
  const encounter = Store.get(request.encounterId);
  const actor = game.actors.get(request.actorId);
  if (!encounter || !encounter.pendingChecks.some((entry) => entry.id === request.id)) return ui.notifications.error("The requested check is no longer available.");
  if (!actor) return cancelPendingCheck(encounter.id, request.id, "The acting PC is no longer available.");
  const npc = encounter.npcs.find((entry) => entry.id === request.npcId);
  if (!npc) return cancelPendingCheck(encounter.id, request.id, "The requested target is no longer available.");
  const actorName = participantDisplayName(encounter, actor);
  const npcName = targetDisplayName(npc);
  if (encounter.actorsActed?.[actor.id]) return cancelPendingCheck(encounter.id, request.id, `${actorName} has already acted this round.`);
  if (request.type === "chase" && (npc.id !== encounter.activeNpcId || npc.availability === "exhausted")) {
    return cancelPendingCheck(encounter.id, request.id, `${npcName} is no longer the active obstacle.`);
  }
  if (request.type === "skill" && encounter.skillOutcome) return cancelPendingCheck(encounter.id, request.id, "The Skill Encounter has already concluded.");
  if (request.type === "research" && !researchSourceAvailableForActor(npc, actor.id)) {
    const state = researchActorState(npc, actor.id);
    return cancelPendingCheck(encounter.id, request.id, state.availability === "unavailable" ? `${npcName} is unavailable to ${actorName}.` : `${actorName} has exhausted the Research Points available from ${npcName}.`);
  }
  request.npcId = npc.id;
  const list = request.type === "discovery" ? npc.discovery : npc.influence;
  let skill = request.skillId ? list.find((s) => s.id === request.skillId) : list.find((s) => s.slug === request.skillSlug);
  if (!skill && request.type === "discovery") {
    const secret = list.find((entry) => entry.secret);
    skill = { id: `attempt:${request.skillSlug}`, slug: request.skillSlug, label: request.skillLabel ?? request.skillSlug,
      dc: Number(secret?.dc ?? list[0]?.dc ?? 20), invalidDiscovery: true };
  }
  if (!skill) return cancelPendingCheck(encounter.id, request.id, "The requested skill is no longer available.");
  encounter.activeActorId = actor.id;
  encounter.activeNpcId = npc.id;
  await Store.save(encounter);
  game.socket.emit(SOCKET, { action: "refresh" });
  tracker?.render(false);
  renderCinematicHud();
  renderInfluenceSidebar();
  const mods = [
    { id: "weakness", label: npc.weakness.label, value: npc.weakness.value, type: npc.weakness.type, mode: npc.weakness.mode ?? "roll", description: npc.weakness.description },
    { id: "strength", label: npc.strength.label, value: npc.strength.value, type: npc.strength.type, mode: npc.strength.mode ?? "roll", description: npc.strength.description },
    ...applicableBoons(encounter, request, skill).map((b) => ({ ...b, id: `boon:${b.id}`, description: b.mode === "dc" ? "DC adjustment" : "Unlocked boon" }))
  ].filter((modifier) => modifier.id.startsWith("boon:") || modifier.description || Number(modifier.value));
  const customMods = [];
  const rows = mods.map((m) => `<label class="influence-mod"><input type="checkbox" name="mod" value="${m.id}" ${m.id.startsWith("boon:") && m.activation === "automatic" ? "checked" : ""}> <strong>${esc(m.label)}</strong> ${signed(Number(m.value))} <small>${esc(m.description ?? "")}</small></label>`).join("");
  const invalidNotice = skill.invalidDiscovery ? `<p class="hint"><strong>GM:</strong> This is not a valid Discovery skill for this encounter. The blind roll consumes the character's action but cannot grant a Discovery.</p>` : "";
  const content = `<form class="influence-adjudicate"><p><strong>${esc(actorName)}</strong> influences <strong>${esc(npcName)}</strong>: ${esc(skill.label)} vs. DC ${skill.dc}</p>${invalidNotice}${rows}<hr><h4>Custom modifiers</h4><div class="form-group"><input name="customLabel" placeholder="Narrative circumstance"><input type="number" name="customValue" value="0"></div><div class="form-group"><label>Type</label><select name="customType"><option>circumstance</option><option>status</option><option>item</option><option>untyped</option></select><label><input type="checkbox" name="saveCustom"> Keep for this target</label><button type="button" data-action="add-custom"><i class="fas fa-plus"></i> Add Modifier</button></div><div class="custom-modifiers"></div><div class="form-group"><label>DC adjustment</label><input type="number" name="dcAdjust" value="0"><p class="hint">Positive raises the DC; negative lowers it.</p></div></form>`;
  const adjudicationContent = request.type === "research" ? content.replace(" influences ", " researches ") : request.type === "chase" ? content.replace(" influences ", " attempts ") : request.type === "skill" ? content.replace(" influences ", " tackles ") : content;
  adjudicationOpen = true;
  new Dialog({
    title: `Adjudicate ${request.type === "research" ? "Research" : request.type === "chase" ? "Chase" : request.type === "skill" ? "Skill Encounter" : "Influence"} Check`, content: adjudicationContent,
    render: (html) => {
      const renderCustomMods = () => html.find(".custom-modifiers").html(customMods.map((mod) => `<div class="custom-modifier"><span><strong>${esc(mod.label)}</strong> ${signed(mod.value)} (${esc(mod.type)})${mod.persist ? " — kept" : ""}</span><button type="button" data-remove-custom="${mod.id}" title="Remove modifier"><i class="fas fa-times"></i></button></div>`).join(""));
      html.find('[data-action="add-custom"]').on("click", () => {
        const value = Number(html.find('[name="customValue"]').val());
        if (!Number.isFinite(value) || value === 0) return ui.notifications.warn("Enter a non-zero modifier before adding it.");
        customMods.push({ id: randomID(), label: html.find('[name="customLabel"]').val()?.trim() || "Situational Modifier",
          value, type: html.find('[name="customType"]').val(), persist: html.find('[name="saveCustom"]').is(":checked") });
        html.find('[name="customLabel"]').val("");
        html.find('[name="customValue"]').val(0);
        html.find('[name="saveCustom"]').prop("checked", false);
        renderCustomMods();
      });
      html.find(".custom-modifiers").on("click", "[data-remove-custom]", (event) => {
        const index = customMods.findIndex((mod) => mod.id === event.currentTarget.dataset.removeCustom);
        if (index >= 0) customMods.splice(index, 1);
        renderCustomMods();
      });
    },
    buttons: {
      roll: { icon: '<i class="fas fa-dice-d20"></i>', label: "Confirm and Roll", callback: async (html) => {
        const selectedIds = html.find('[name="mod"]:checked').map((_, e) => e.value).get();
        const selected = mods.map((m) => ({ ...m, selected: selectedIds.includes(m.id) }));
        selected.push(...customMods.map((mod) => ({ ...mod, selected: true })));
        const boonDcAdjust = selected.filter((m) => m.selected && m.mode === "dc").reduce((sum, m) => sum + Number(m.value), 0);
        const dcAdjust = (Number(html.find('[name="dcAdjust"]').val()) || 0) + boonDcAdjust;
        encounter.activeEffects.push(...customMods.filter((mod) => mod.persist).map((mod) => ({ id: randomID(), kind: "modifier", targetNpcId: npc.id, label: mod.label, value: mod.value, type: mod.type, mode: "roll", scope: "both", skills: [], uses: 999, remaining: 999 })));
        await executeCheck(encounter, request, actor, skill, selected.filter((m) => m.selected), dcAdjust);
      } },
      cancel: { label: "Return to Queue" }
    }, default: "roll", close: () => { adjudicationOpen = false; }
  }, { width: 520 }).render(true);
}

async function executeCheck(encounter, request, actor, skill, selected, dcAdjust) {
  const adjudicationEffects = encounter.activeEffects ?? [];
  const currentEncounter = Store.get(encounter.id);
  if (currentEncounter) {
    const currentEffectIds = new Set((currentEncounter.activeEffects ?? []).map((effect) => effect.id));
    currentEncounter.activeEffects.push(...adjudicationEffects.filter((effect) => !currentEffectIds.has(effect.id)));
    encounter = currentEncounter;
  }
  const npc = encounter.npcs.find((entry) => entry.id === request.npcId) ?? encounter.npcs[0];
  if (!npc) return ui.notifications.error("The influence target is no longer available.");
  const actorName = participantDisplayName(encounter, actor);
  const npcName = targetDisplayName(npc);
  const statistic = skillStatistic(actor, skill.slug, skill.label);
  if (!statistic?.roll) return ui.notifications.error(`${actor.name} has no rollable ${skill.label} statistic.`);
  const effectiveDC = Number(skill.dc) + dcAdjust;
  const rollModifiers = selected.filter((mod) => mod.mode !== "dc").map((mod) => new game.pf2e.Modifier({
    slug: `influence-${String(mod.id).slugify()}`,
    label: mod.label,
    modifier: Number(mod.value),
    type: mod.type || "untyped"
  }));
  const breakdown = selected.map((m) => `${esc(m.label)} ${signed(Number(m.value))}`).join(", ");
  const roll = await statistic.roll({
    // PF2e's public roll card may show the degree of success, but subsystem
    // DCs and success margins remain GM information.
    dc: { value: effectiveDC, visible: false, label: `${encounter.name} — ${npcName}: ${skill.label}` },
    modifiers: rollModifiers,
    extraRollOptions: [`influence:type:${request.type}`, `influence:encounter:${encounter.id}`],
    label: `${request.type.titleCase()}: ${npcName}`,
    messageMode: request.type === "discovery" ? "blind" : "public",
    createMessage: true
  });
  if (!roll) return;
  const degree = Number(roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess);
  const outcome = ["Critical Failure", "Failure", "Success", "Critical Success"][degree] ?? "Unknown";
  const outcomeClass = ["critical-failure", "failure", "success", "critical-success"][degree] ?? "unknown";
  const points = request.type === "research"
    ? Number(npc.awards?.[["criticalFailure", "failure", "success", "criticalSuccess"][degree]] ?? 0)
    : ["influence", "chase", "skill"].includes(request.type) ? ([ -1, 0, 1, 2 ][degree] ?? 0) : 0;
  const individualSkillScoring = request.type === "skill" && encounter.skillScoringMode === "individual";
  const previousPoints = request.type === "research" ? Number(encounter.researchPoints) : individualSkillScoring ? skillActorPoints(encounter, actor.id) : request.type === "skill" ? Number(encounter.skillPoints) : Number(npc.points);
  const newlyReachedInfluenceThresholds = request.type === "influence"
    ? npc.thresholds.filter((threshold) => threshold.points > previousPoints && threshold.points <= previousPoints + points)
    : [];
  snapshot(encounter, `${actorName} → ${npcName}: ${skill.label}`);
  encounter.checkLog ??= [];
  const logEntry = { id: randomID(), actorId: actor.id, actorName, npcId: npc.id, npcName, type: request.type,
    skillLabel: skill.label, outcome: skill.invalidDiscovery ? `${outcome} — Invalid Discovery Skill` : outcome,
    phase: encounter.currentPhase, timestamp: Date.now(), detailLabel: "", details: [] };
  encounter.checkLog.push(logEntry);
  if (request.type === "discovery" && !skill.invalidDiscovery && degree >= 2) {
    encounter.pendingDiscoveries ??= [];
    encounter.pendingDiscoveries.push({ id: randomID(), logEntryId: logEntry.id, userId: request.requesterId, actorId: actor.id, npcId: npc.id, choices: degree === 3 ? 2 : 1 });
  }
  if (request.type === "influence") npc.points = Math.max(0, npc.points + points);
  let skillWonNow = false;
  if (request.type === "skill") {
    const cap = encounter.skillVictoryMode === "goal" ? encounter.skillPointGoal : Number.POSITIVE_INFINITY;
    if (individualSkillScoring) {
      encounter.skillPointsByActor[actor.id] = Math.max(0, Math.min(cap, previousPoints + points));
      encounter.skillPoints = Object.values(encounter.skillPointsByActor).reduce((total, score) => total + Number(score || 0), 0);
    } else encounter.skillPoints = Math.max(0, Math.min(cap, Number(encounter.skillPoints) + points));
    const resultingPoints = individualSkillScoring ? skillActorPoints(encounter, actor.id) : encounter.skillPoints;
    if (encounter.skillVictoryMode === "goal" && resultingPoints >= encounter.skillPointGoal) {
      encounter.skillOutcome = "victory";
      encounter.skillWinnerActorId = individualSkillScoring ? actor.id : "";
      skillWonNow = true;
      logEntry.detailLabel = "Skill Encounter";
      logEntry.details = [individualSkillScoring ? `${actorName} reached ${encounter.skillPointGoal} Skill Points.` : (encounter.victoryText || "The party achieved its goal!")];
    }
  }
  let chaseWonNow = false;
  let chaseObstacleCompleted = false;
  let canceledChaseRequests = [];
  let canceledSkillRequests = [];
  if (request.type === "chase") {
    npc.points = Math.max(0, Math.min(npc.maximumPoints, Number(npc.points) + points));
    if (npc.maximumPoints && npc.points >= npc.maximumPoints) {
      chaseObstacleCompleted = true;
      npc.availability = "exhausted";
      const index = encounter.npcs.findIndex((entry) => entry.id === npc.id);
      const next = encounter.npcs[index + 1];
      if (next) encounter.activeNpcId = next.id;
      if (!next || index + 1 >= encounter.opponentPosition) {
        encounter.chaseOutcome = "victory";
        chaseWonNow = true;
      }
      logEntry.detailLabel = "Chase Progress";
      logEntry.details = [encounter.chaseOutcome === "victory" ? chaseVictoryMessage(encounter) : `${npcName} overcome. Next obstacle: ${targetDisplayName(next)}.`];
    }
  }
  const newlyLostInfluenceThresholds = request.type === "influence"
    ? npc.thresholds.filter((threshold) => threshold.points <= previousPoints && threshold.points > npc.points)
    : [];
  if (request.type === "research") {
    const actorState = researchActorState(npc, actor.id);
    const sourceRoom = npc.maximumPoints ? Math.max(0, npc.maximumPoints - npc.points) : Math.max(0, points);
    const actorRoom = actorState.maximum ? Math.max(0, actorState.maximum - actorState.points) : Math.max(0, points);
    const applied = points > 0 ? Math.min(points, sourceRoom, actorRoom) : points;
    npc.points = Math.max(0, npc.points + Math.max(0, applied));
    npc.researchByActor[actor.id] ??= { points: 0, availability: "available" };
    npc.researchByActor[actor.id].points = Math.max(0, Number(npc.researchByActor[actor.id].points) + Math.max(0, applied));
    if (npc.maximumPointsPerActor && npc.researchByActor[actor.id].points >= npc.maximumPointsPerActor) npc.researchByActor[actor.id].availability = "exhausted";
    encounter.researchPoints = Math.max(0, Number(encounter.researchPoints) + applied);
    if (npc.maximumPoints && npc.points >= npc.maximumPoints) npc.availability = "exhausted";
    logEntry.detailLabel = "Discoveries Gained";
    logEntry.details = encounter.researchThresholds
      .filter((threshold) => threshold.points > previousPoints && threshold.points <= encounter.researchPoints)
      .flatMap((threshold) => [threshold.label, threshold.text, ...threshold.boons.map((boon) => boon.label)]).filter(Boolean);
  }
  if (request.type === "influence") {
    logEntry.detailLabel = newlyLostInfluenceThresholds.length ? "Boons Lost" : "Boons Gained";
    logEntry.details = (newlyLostInfluenceThresholds.length ? newlyLostInfluenceThresholds : newlyReachedInfluenceThresholds)
      .flatMap((threshold) => [threshold.label, ...threshold.boons.map((boon) => boon.label)]);
  }
  encounter.actorsActed[actor.id] = true;
  encounter.pendingChecks = (encounter.pendingChecks ?? []).filter((entry) => entry.id !== request.id);
  if (skillWonNow) {
    canceledSkillRequests = [...encounter.pendingChecks];
    encounter.pendingChecks = [];
  }
  if (chaseObstacleCompleted) {
    canceledChaseRequests = encounter.pendingChecks.filter((entry) => entry.npcId === npc.id);
    encounter.pendingChecks = encounter.pendingChecks.filter((entry) => entry.npcId !== npc.id);
  }
  for (const mod of selected.filter((m) => m.id.startsWith("boon:"))) {
    const boonId = mod.id.slice(5);
    const boon = findBoon(encounter, boonId);
    if (boon) boon.remaining = Math.max(0, (boon.remaining ?? boon.uses) - 1);
  }
  await Store.save(encounter);
  game.socket.emit(SOCKET, { action: "refresh" });
  const resultText = request.type === "discovery"
    ? "Discovery checks do not award Influence Points."
    : request.type === "research"
      ? `${signed(encounter.researchPoints - previousPoints)} Research Point${Math.abs(encounter.researchPoints - previousPoints) === 1 ? "" : "s"}`
      : request.type === "chase"
        ? `${signed(points)} Chase Point${Math.abs(points) === 1 ? "" : "s"}`
        : request.type === "skill"
        ? `${signed((individualSkillScoring ? skillActorPoints(encounter, actor.id) : encounter.skillPoints) - previousPoints)} Skill Point${Math.abs((individualSkillScoring ? skillActorPoints(encounter, actor.id) : encounter.skillPoints) - previousPoints) === 1 ? "" : "s"}`
        : `${signed(points)} Influence Point${Math.abs(points) === 1 ? "" : "s"}`;
  if (request.type !== "discovery") {
    await ChatMessage.create({
      content: `<div class="influence-chat influence-result influence-outcome-${outcomeClass}"><strong>${esc(encounter.name)} — ${esc(npcName)}</strong><p>${esc(actorName)} used ${esc(skill.label)}.${breakdown ? ` Modifiers: ${breakdown}.` : ""}</p><p><strong>${outcome} — ${resultText}</strong></p></div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OOC,
      flags: { [MODULE_ID]: { messageKind: "result" } }
    });
  }
  if (request.type === "chase" && npc.availability === "exhausted") {
    const next = encounter.npcs.find((entry) => entry.id === encounter.activeNpcId);
    await ChatMessage.create({
      content: `<div class="influence-chat influence-result influence-reward"><strong>${encounter.chaseOutcome === "victory" ? "Chase Won" : `Obstacle Overcome — ${esc(npcName)}`}</strong><p>${esc(encounter.chaseOutcome === "victory" ? chaseVictoryMessage(encounter) : `Next: ${targetDisplayName(next)}`)}</p></div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OOC,
      flags: { [MODULE_ID]: { messageKind: "result" } }
    });
    if (!chaseWonNow) {
      const subjectName = String(encounter.chaseSubject?.nickname ?? "").trim() || encounter.chaseSubject?.name;
      const genericSubject = !subjectName || subjectName === "Chase Objective";
      const pursuer = encounter.chaseType === "run-away" || /pursuer/i.test(encounter.chaseSubject?.label ?? "");
      const progressMessage = pursuer
        ? `You're pulling farther ahead of ${genericSubject ? "the pursuer" : subjectName}.`
        : `You're catching up with ${genericSubject ? "the quarry" : subjectName}.`;
      await ChatMessage.create({ content: `<div class="influence-chat influence-result influence-chase-progress"><strong>Chase Progress</strong><p>${esc(progressMessage)}</p></div>`, style: CONST.CHAT_MESSAGE_STYLES.OOC, flags: { [MODULE_ID]: { messageKind: "result" } } });
    }
  }
  if (skillWonNow) {
    await ChatMessage.create({ content: `<div class="influence-chat influence-result influence-reward"><strong>Skill Encounter Won</strong><p>${individualSkillScoring ? `${esc(actorName)} reached ${encounter.skillPointGoal} Skill Points. ` : ""}${esc(encounter.victoryText || "The party achieved its goal!")}</p></div>`, style: CONST.CHAT_MESSAGE_STYLES.OOC, flags: { [MODULE_ID]: { messageKind: "result" } } });
  }
  for (const canceled of canceledChaseRequests) await notifyPendingCheck(canceled, `${npcName} was overcome before this queued check could be adjudicated.`);
  for (const canceled of canceledSkillRequests) await notifyPendingCheck(canceled, "The party reached the Skill Point goal before this queued check could be adjudicated.");
  if (chaseWonNow && encounter.victorySplashMode === "automatic") triggerVictorySplash(encounter);
  if (newlyReachedInfluenceThresholds.length) {
    const rewards = influenceRewardSections(newlyReachedInfluenceThresholds);
    await ChatMessage.create({
      content: `<div class="influence-chat influence-result influence-reward"><strong>Reward Earned — ${esc(npcName)}</strong>${rewards}</div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OOC,
      flags: { [MODULE_ID]: { messageKind: "result" } }
    });
  }
  if (newlyLostInfluenceThresholds.length) {
    await ChatMessage.create({
      content: `<div class="influence-chat influence-result influence-reward-lost"><strong>Reward Lost — ${esc(npcName)}</strong><p>The party's Influence fell below a reward threshold.</p>${influenceRewardSections(newlyLostInfluenceThresholds)}</div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OOC,
      flags: { [MODULE_ID]: { messageKind: "result" } }
    });
  }
  if (request.type === "discovery" && (skill.invalidDiscovery || degree < 2)) {
    await ChatMessage.create({ content: `<div class="influence-chat influence-result influence-outcome-failure influence-discovery-failure"><strong>Discovery</strong><p>${esc(actorName)} failed to learn anything new about ${esc(npcName)}.</p></div>`, flags: { [MODULE_ID]: { messageKind: "result" } } });
  }
  if (request.type === "discovery" && !skill.invalidDiscovery && degree >= 2) await offerDiscovery(encounter, request.requesterId, degree === 3 ? 2 : 1, logEntry.id, actor.id);
  await maybePromptRoundAdvance(Store.get(encounter.id));
  tracker.render(false);
}

async function offerDiscovery(encounter, userId, choices, logEntryId, actorId) {
  if (userId === game.user.id) {
    const selections = await collectDiscoveryChoices(choices, actorId);
    return resolveDiscovery(encounter.id, userId, selections, logEntryId);
  }
  game.socket.emit(SOCKET, { action: "discovery-offer", encounterId: encounter.id, userId, choices, logEntryId, actorId });
}

async function collectDiscoveryChoices(choices, actorId) {
  const selections = [];
  const actor = game.actors.get(actorId);
  for (let i = 0; i < choices; i++) {
    const options = [
      ["secret", "Secret Discovery skill"], ["low", "Lowest non-Lore Influence DC"],
      ["high", "Highest non-Lore Influence DC"], ["skill", "Whether a specific skill is usable"],
      ["weakness", "NPC weakness"], ["strength", "NPC strength"]
    ];
    const choice = await promptSelect(`Discovery ${i + 1} of ${choices}`, options);
    if (!choice) break;
    const skillOptions = trainedSkillChoices(actor).map((skill) => [skill.slug, skill.label]);
    const named = choice === "skill" ? await promptSelect("Which trained skill do you ask about?", skillOptions, "Choose Skill") : "";
    if (choice !== "skill" || named) selections.push({ choice, named });
  }
  return selections;
}

async function resolveDiscovery(encounterId, userId, selections, logEntryId) {
  if (!game.user.isGM) return;
  const encounter = Store.get(encounterId);
  if (!encounter) return;
  const logEntry = encounter.checkLog?.find((entry) => entry.id === logEntryId);
  const pending = encounter.pendingDiscoveries?.find((entry) => entry.logEntryId === logEntryId && entry.userId === userId);
  if (!pending) return;
  const npc = encounter.npcs.find((entry) => entry.id === logEntry?.npcId) ?? encounter.npcs[0];
  if (!npc) return;
  const npcName = targetDisplayName(npc);
  const secret = npc.discovery.find((s) => s.secret);
  const nonLore = npc.influence.filter((s) => !s.lore);
  const low = nonLore.toSorted((a, b) => a.dc - b.dc)[0];
  const high = nonLore.toSorted((a, b) => b.dc - a.dc)[0];
  encounter.discoveries[userId] ??= { npcs: {} };
  encounter.discoveries[userId].npcs ??= {};
  encounter.discoveries[userId].npcs[npc.id] ??= { facts: [], secretSkill: false };
  const discoveryRecord = encounter.discoveries[userId].npcs[npc.id];
  const learned = [];
  for (const selection of selections) {
    const { choice, named } = selection;
    let fact = "";
    if (choice === "secret") { fact = secret ? `Secret Discovery Skill — ${secret.label}` : "No secret Discovery skill is configured."; discoveryRecord.secretSkill = !!secret; }
    if (choice === "low") fact = low ? `Lowest non-Lore DC — ${low.label}` : "No non-Lore Influence skill is configured.";
    if (choice === "high") fact = high ? `Highest non-Lore DC — ${high.label}` : "No non-Lore Influence skill is configured.";
    if (choice === "weakness") fact = `${npc.weakness.label}: ${npc.weakness.description}`;
    if (choice === "strength") fact = `${npc.strength.label}: ${npc.strength.description}`;
    if (choice === "skill") {
      const askedSkill = game.actors.get(encounter.checkLog?.find((entry) => entry.id === logEntryId)?.actorId)?.skills?.[named];
      const askedLabel = askedSkill ? game.i18n.localize(askedSkill.label) : named;
      const found = npc.influence.find((s) => s.slug === named);
      fact = found ? `${found.label} can influence ${npcName}.` : `${askedLabel} is not among ${npcName}'s listed Influence skills.`;
    }
    discoveryRecord.facts.push(fact);
    learned.push(fact);
    await ChatMessage.create({
      content: `<div class="influence-chat influence-discovery-reveal"><strong>Discovery: ${esc(npcName)}</strong><p>${esc(fact)}</p></div>`,
      whisper: [userId, ...ChatMessage.getWhisperRecipients("GM").map((u) => u.id)],
      flags: { [MODULE_ID]: { messageKind: "discovery-reveal" } }
    });
  }
  if (!learned.length) return;
  if (logEntry) Object.assign(logEntry, { detailLabel: "Learned", details: [...(logEntry.details ?? []), ...learned] });
  if (pending) {
    pending.choices = Math.max(0, Number(pending.choices) - learned.length);
    if (!pending.choices) encounter.pendingDiscoveries = encounter.pendingDiscoveries.filter((entry) => entry.id !== pending.id);
  }
  await Store.save(encounter);
  game.socket.emit(SOCKET, { action: "refresh", userId });
  tracker?.render(false);
}

async function resumePendingDiscoveries() {
  if (game.user.isGM) return;
  const encounter = Store.get();
  const pending = (encounter?.pendingDiscoveries ?? []).filter((entry) => entry.userId === game.user.id);
  for (const entry of pending) {
    const selections = await collectDiscoveryChoices(entry.choices, entry.actorId);
    if (selections.length) game.socket.emit(SOCKET, { action: "discovery-selection", encounterId: encounter.id, userId: game.user.id, selections, logEntryId: entry.logEntryId });
  }
}

function promptNumber(title, value) { return new Promise((resolve) => new Dialog({ title, content: `<input type="number" name="value" value="${value}">`, buttons: { ok: { label: "Apply", callback: (h) => resolve(Number(h.find('[name="value"]').val())) }, cancel: { label: "Cancel", callback: () => resolve(null) } }, close: () => resolve(null) }).render(true)); }
function promptSelect(title, options, confirmLabel = "Reveal") { return new Promise((resolve) => new Dialog({ title, content: `<select name="value">${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`, buttons: { ok: { label: confirmLabel, callback: (h) => resolve(h.find('[name="value"]').val()) }, cancel: { label: "Cancel", callback: () => resolve(null) } }, close: () => resolve(null) }).render(true)); }

let tracker;
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTINGS.encounters, { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, SETTINGS.active, { scope: "world", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, SETTINGS.folders, { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, SETTINGS.selections, { scope: "client", config: false, type: Object, default: {} });
  loadTemplates([`modules/${MODULE_ID}/templates/trait-fields.hbs`]);
});

Hooks.once("ready", async () => {
  const orphanedActiveId = Store.activeId();
  if (game.user.isGM && orphanedActiveId && !Store.get(orphanedActiveId)) await Store.setActive("");
  tracker = new InfluenceTracker();
  game.socket.on(SOCKET, (payload) => {
    if (payload.action === "check-request" && game.user.isGM && game.users.activeGM?.id === game.user.id) receiveCheckRequest(payload);
    if (payload.action === "check-request-status" && payload.userId === game.user.id) ui.notifications.info(payload.message);
    if (payload.action === "discovery-offer" && payload.userId === game.user.id) collectDiscoveryChoices(payload.choices, payload.actorId).then((selections) => game.socket.emit(SOCKET, { action: "discovery-selection", encounterId: payload.encounterId, userId: game.user.id, selections, logEntryId: payload.logEntryId }));
    if (payload.action === "discovery-selection" && game.user.isGM && game.users.activeGM?.id === game.user.id) resolveDiscovery(payload.encounterId, payload.userId, payload.selections, payload.logEntryId);
    if (payload.action === "progress-clock-refresh") progressClockDatabase()?.refresh?.();
    if (payload.action === "open-encounter") setTimeout(() => tracker?.render(true), 150);
    if (payload.action === "victory-splash") {
      const encounter = Store.get(payload.encounterId);
      if (encounter?.chaseOutcome === "victory") showVictorySplash(encounter);
    }
    if (payload.action === "refresh" && (!payload.userId || payload.userId === game.user.id)) {
      tracker?.render(false);
      renderCinematicHud();
      renderInfluenceSidebar();
    }
  });
  game[MODULE_ID] = { open: () => tracker.render(true), manage: () => new EncounterManager().render(true), Store };
  setTimeout(() => { renderInfluenceSidebar(); renderCinematicHud(); }, 250);
  setTimeout(() => { const active = Store.get(); if (active?.status === "active") tracker?.render(true); }, 350);
  setTimeout(() => resumePendingDiscoveries(), 500);
});

Hooks.on("renderSidebar", () => renderInfluenceSidebar());
function markInfluenceChatMessage(message, html) {
  let kind = message.getFlag(MODULE_ID, "messageKind");
  if (!kind && message.whisper?.length && /<strong>Discovery:/i.test(message.content ?? "")) kind = "discovery-reveal";
  if (!kind && /influence-result/.test(message.content ?? "")) kind = "result";
  if (!kind) return;
  const element = html instanceof HTMLElement ? html : html?.[0];
  element?.classList.add(`influence-${kind}-message`);
}
Hooks.on("renderChatMessage", markInfluenceChatMessage);
Hooks.on("renderChatMessageHTML", markInfluenceChatMessage);
Hooks.on("canvasReady", () => { renderInfluenceSidebar(); renderCinematicHud(); });

Hooks.on("renderSceneControls", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  const tools = root?.querySelector("#scene-controls-tools");
  if (!tools || tools.querySelector(".influence-control")) return;
  const item = document.createElement("li");
  item.innerHTML = '<button type="button" class="control ui-control tool icon fa-solid fa-comments influence-control" aria-label="Influence Encounter" data-tooltip="Influence Encounter"></button>';
  item.querySelector("button").addEventListener("click", () => tracker?.render(true));
  tools.append(item);
});

Hooks.on("renderJournalDirectory", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".influence-journal-button")) return;
  const button = document.createElement("button");
  button.type = "button"; button.className = "influence-journal-button";
  button.innerHTML = '<i class="fa-solid fa-comments"></i><span>Influence Encounter</span>';
  button.addEventListener("click", () => tracker.render(true));
  const actions = root.querySelector(".directory-header .header-actions");
  const footer = root.querySelector(".directory-footer");
  (actions ?? footer ?? root).append(button);
});

Hooks.on("influenceEncounterUpdated", (id) => {
  // The directory must refresh for draft encounters too, not only the active one.
  renderInfluenceSidebar();
  if (id === Store.activeId()) {
    tracker?.render(false);
    renderCinematicHud();
    if (game.user.isGM) game.socket.emit(SOCKET, { action: "refresh" });
  }
});
