"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { cardsById } from "@/data/cards";
import { CardCategory, CardKind, CreatureZone, EffectType, canCardOccupySlot } from "@/data/cards/types";
import { conditionCards } from "@/data/cards/conditions";
import { prebuiltDecks } from "@/data/tournaments/prebuiltDecks";
import { DAMAGE_COUNTER_HP, addResourceWithinCap, applyDamage, calculateAttachedCardRpBonus, calculateAttachedCreatureDefenseBonus, calculateAttachedHostHealthBonus, calculateRpBankCap, calculateVictoryPoints, conditionPreventsCardPlay, createSeededRandom, determineVictoryResult, drawWithHandLimit, getDrawCountFromActions, getRequiredDrawShortfall, getResourceGainFromActions, halfCostRoundedUp, isEcosystemConditionMet, moveFoundationDamageCounter, parseLegacyAttackText, parseLegacyUtilityText, preserveDamageOnUpgrade, reconcileContinuousHealth, redistributeOrphans, resolveConditionalDiceDamage, resolveOpposedRoll, resolveResourceTransfer, rollDie } from "./gameRules.mjs";
import { createHabitatInstance, resolveEndOfTurnHabitatMaintenance } from "./habitatRules.mjs";
import { addCardsToHandWithLimit, canHostSpecialPlacement, createCreatureInstance, getOceanicApexSacrificeChoices, getPersonalDeckType, getSpecialPlacementHostTags, moveSlottedCreatureBetweenFoundations, placeCardInSpecialHost, removeCreatureInstances, resolveDestructionRecoveryWaves } from "./zoneRules.mjs";
import { attackCanTargetCard, attackerHasDisadvantageFromMassive, canTargetInAttackSequence, createAttackSequence, createRegenerateDecision, getCloakDefenseBonus, getDarknessShroudDefenseBonus, getRemainingAttackTargets, getRovLightsAttackBonus, hasDefenseAdvantage, recordAttackResolution, resolveRegenerateDecision, resolveToxicConsumption, shouldSelfDiscardAfterConsume } from "./combatRules.mjs";
import { consumeSchoolDensityConditionDiscount, getEffectiveSchoolDensityRequirement } from "./conditionRules.mjs";
import { getOpponentActionUseKey, markOpponentActionUsed, supportLocksFurtherPlays, wasOpponentActionUsedThisTurn } from "./opponentActionRules.mjs";
import { OPPONENT_DIFFICULTY_OPTIONS, OpponentDifficulty, chooseOpponentPreferredDeck, getOpponentDifficultyProfile, limitOpponentOptionalActions, normalizeOpponentDifficulty, orderOpponentChoices, scaleOpponentThinkingDelay, selectOpponentChoice } from "./opponentDifficultyRules.mjs";
import foundationDeckImg from "./images/foundation-deck.png";
import palsDeckImg from "./images/pals-deck.png";

function shuffle(arr, random = Math.random) {
  const result = arr.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

const defaultDeckId = "coral-garden";
const CARD_ART_FALLBACK = "/images/brand/SeaPalsTCGLogoWhite.svg";

function createDeck(deckType, deckId = defaultDeckId, random = Math.random) {
  const selectedDeck = prebuiltDecks.find((deck) => deck.id === deckId) ?? prebuiltDecks[0];
  const ids = (selectedDeck?.cards ?? []).flatMap((entry) => {
    const card = cardsById[entry.cardId];
    if (!card) return [];
    const belongsInDeck = deckType === "foundation" ? isFoundationCard(card) : !isFoundationCard(card);
    return belongsInDeck ? Array.from({ length: entry.quantity }, () => entry.cardId) : [];
  });
  return shuffle(ids, random);
}

function getUnavailableDeckEntries(deckId) {
  const selectedDeck = prebuiltDecks.find((deck) => deck.id === deckId);
  return (selectedDeck?.cards ?? []).filter((entry) => !cardsById[entry.cardId]);
}

function splitTurnActionLines(summary) {
  if (!summary) return [];
  const protectedSummary = String(summary)
    .replaceAll("Dr. ", "Dr.__SPACE__")
    .replaceAll("Capt. ", "Capt.__SPACE__");
  return protectedSummary
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.replaceAll(".__SPACE__", ". ").trim())
    .filter(Boolean);
}

function hasBaseCoral(cardIds) {
  return cardIds.some((cardId) => {
    const card = cardsById[cardId];
    return isFoundationCard(card) && Number(card.stage ?? 0) === 0;
  });
}

function createFoundationOpening(deckId, random = Math.random) {
  let foundationCards = createDeck("foundation", deckId, random);
  let attempts = 0;

  while (!hasBaseCoral(foundationCards.slice(0, 4)) && attempts < 100) {
    foundationCards = shuffle(foundationCards, random);
    attempts += 1;
  }

  if (!hasBaseCoral(foundationCards.slice(0, 4))) {
    const baseCoralIndex = foundationCards.findIndex((cardId) => hasBaseCoral([cardId]));
    if (baseCoralIndex >= 4) {
      [foundationCards[0], foundationCards[baseCoralIndex]] = [foundationCards[baseCoralIndex], foundationCards[0]];
    }
  }

  return foundationCards;
}

function createInitialGameState(deckId = defaultDeckId, opponentDeckId = deckId, random = Math.random) {
  const foundationCards = createFoundationOpening(deckId, random);
  const palsCards = createDeck("pals", deckId, random);
  const opponentFoundationCards = createFoundationOpening(opponentDeckId, random);
  const opponentPalsCards = createDeck("pals", opponentDeckId, random);
  const opponentOpeningHand = shuffle([...opponentFoundationCards.slice(0, 4), ...opponentPalsCards.slice(0, 4)], random);
  const opponentBaseCoralId = opponentOpeningHand.find((cardId) => isFoundationCard(cardsById[cardId]) && Number(cardsById[cardId]?.stage ?? 0) === 0);
  const opponentCorals = createOpponentStartingCorals(opponentBaseCoralId);
  const opponentSetupCost = Number(cardsById[opponentBaseCoralId]?.cost?.rp ?? 0);
  return {
    foundationDeck: foundationCards.slice(4),
    palsDeck: palsCards.slice(4),
    hand: shuffle([...foundationCards.slice(0, 4), ...palsCards.slice(0, 4)], random),
    conditionDeck: shuffle(conditionCards.map((card) => card.id), random),
    opponent: {
      foundationDeck: opponentFoundationCards.slice(4),
      palsDeck: opponentPalsCards.slice(4),
      hand: removeOneCard(opponentOpeningHand, opponentBaseCoralId),
      corals: opponentCorals,
      habitats: [],
      habitatInstances: [],
      reefCreatures: [],
      reefCreatureInstances: [],
      orphanCreatures: [],
      discardPile: [],
      blueCrabRecycleUsedTurn: null,
      supportBlockedUntilRound: 0,
      resilienceUsedCardIds: [],
      actionCooldowns: {},
      actionUses: {},
      creatureStatuses: {},
      conditionDensityUses: {},
      rp: Math.max(0, 3 - opponentSetupCost),
    },
  };
}

function createOpponentStartingCorals(baseCoralId) {
  const card = cardsById[baseCoralId];
  if (!card) return [];
  const instanceId = `opponent-${baseCoralId}`;
  return [{
    id: instanceId,
    cardId: baseCoralId,
    health: Number(card.health ?? 0),
    maxHealth: Number(card.health ?? 0),
    slots: createCoralSlots(card, instanceId),
    playedTurn: 1,
    stageEnteredTurn: 1,
  }];
}

function getOnPlayCoralDamage(card, controllerCardIds = []) {
  const visitEffects = (effects = [], allowConditionalDice = true, inferredCoralTarget = false) => effects.reduce((total, effect) => {
    const targetsCoral = effect.type === EffectType.DAMAGE && (effect.target?.kind === CardKind.CORAL || inferredCoralTarget);
    let amount = typeof effect.amount === "number" ? effect.amount : Number(effect.amount?.value ?? 0);
    if (effect.amount?.type === "dice") {
      amount = resolveConditionalDiceDamage({ dice: effect.amount.dice, multiplier: effect.amount.multiplier, fallbackAmount: effect.amount.fallbackAmount, conditionMet: allowConditionalDice }).damage;
    }
    return total + (targetsCoral ? amount : 0) + visitEffects(effect.effects, allowConditionalDice, inferredCoralTarget) + visitEffects(effect.then ? [effect.then] : [], allowConditionalDice, inferredCoralTarget);
  }, 0);
  return (card?.onPlay ?? []).reduce((total, action) => {
    const diceCondition = (action.conditionalModifiers ?? []).find((modifier) => modifier.modifier?.type === "useDiceDamage")?.condition;
    const conditionMet = !diceCondition?.cardId || controllerCardIds.includes(diceCondition.cardId);
    return total + visitEffects(action.effects, conditionMet, /damage[^.]*coral/i.test(action.text ?? ""));
  }, 0);
}

function getOnPlayFoundationDamage(card, controllerCardIds = []) {
  const coralDamage = getOnPlayCoralDamage(card, controllerCardIds);
  if (coralDamage) return { amount: coralDamage, targetType: "coral", actionName: getOnPlayAbilityName(card) };
  for (const action of card?.onPlay ?? []) {
    const legacyEffect = parseLegacyUtilityText(typeof action === "string" ? action : action?.text);
    if (legacyEffect?.type === "damageFoundation") {
      return { amount: legacyEffect.amount, targetType: legacyEffect.targetType, actionName: getActionName(action) };
    }
  }
  return null;
}

function getOnPlayCoralHeal(card) {
  for (const action of card?.onPlay ?? []) {
    for (const effect of action.effects ?? []) {
      if ((effect.type === "heal" || effect.type === EffectType.MODIFY_HEALTH) && effect.target?.kind === CardKind.CORAL && effect.target?.controller === "you") {
        const roll = effect.amount?.type === "dice" ? rollDie(effect.amount.dice) : null;
        const amount = roll ? roll.total * Number(effect.amount.multiplier ?? 1) : Number(effect.amount?.value ?? effect.amount ?? 0);
        return { amount, actionName: action.name ?? "Coral Heal", roll: roll?.total ?? null };
      }
    }
  }
  return null;
}

function getOnPlayDrawCount(card) {
  return getDrawCountFromActions(card?.onPlay);
}

function getOnPlayAbilityName(card) {
  const hasCoralDamage = (effects = []) => effects.some((effect) =>
    (effect.type === EffectType.DAMAGE && effect.target?.kind === CardKind.CORAL) || hasCoralDamage(effect.effects) || (effect.then ? hasCoralDamage([effect.then]) : false),
  );
  const action = (card?.onPlay ?? []).find((candidate) => hasCoralDamage(candidate.effects));
  return action?.name ?? getActionName(card?.onPlay?.[0]) ?? "On Play";
}

function getOnPlayRandomDiscard(card) {
  for (const action of card?.onPlay ?? []) {
    const effect = (action.effects ?? []).find((candidate) => candidate.type === EffectType.DISCARD_RANDOM_CARD && candidate.targetPlayer === "opponent");
    if (effect) return { actionName: action.name ?? "On Play", amount: Math.max(1, Number(effect.amount ?? 1)) };
  }
  return null;
}

function getOnPlayOpponentDeckDiscard(card) {
  const numberWords = { one: 1, two: 2, three: 3, four: 4 };
  for (const ability of card?.onPlay ?? []) {
    const text = typeof ability === "string" ? ability : ability?.text ?? "";
    if (!/opponent(?:'s|’s)? deck|their deck/i.test(text) || !/discard/i.test(text) || !/top|next/i.test(text)) continue;
    const amountToken = text.match(/discards?\s+(?:(?:the\s+)?next\s+)?(\d+|one|two|three|four)\s+cards?/i)?.[1];
    const amount = Number(amountToken) || numberWords[amountToken?.toLowerCase()] || 0;
    if (amount) return { actionName: text.split(":")[0]?.trim() || "On Play", amount };
  }
  return null;
}

function getOnPlaySupportBlock(card) {
  const text = (card?.onPlay ?? []).map((ability) => typeof ability === "string" ? ability : ability?.text ?? "").find((ability) => /opponent cannot play support cards (?:on (?:their|its) )?next turn/i.test(ability));
  return text ? { actionName: text.split(":")[0]?.trim() || "On Play" } : null;
}

function getOnPlayEnsnare(card) {
  const text = (card?.onPlay ?? []).map((ability) => typeof ability === "string" ? ability : ability?.text ?? "").find((ability) => /ensnare:.*flip a coin.*if heads.*gets\s*-\d+\s*defense/i.test(ability));
  const penalty = text?.match(/gets\s*-(\d+)\s*defense/i)?.[1];
  return penalty ? { actionName: "Ensnare", penalty: Number(penalty) } : null;
}

function getOnPlayUtilitySearch(card) {
  for (const action of card?.onPlay ?? []) {
    const effect = typeof action === "object" ? (action.effects ?? []).find((candidate) => candidate.type === EffectType.SEARCH_DECK) : parseLegacyUtilityAction(action);
    if (effect?.type === EffectType.SEARCH_DECK) return { action, effect, actionName: getActionName(action) };
  }
  return null;
}

function getOnPlayReorder(card) {
  for (const action of card?.onPlay ?? []) {
    const effect = getSupportedUtilityEffect(action);
    if (effect?.type === "reorderTopDeck") return { action, effect, actionName: getActionName(action) };
  }
  return null;
}

function cardHasSchoolMomentum(card) {
  return (card?.onPlay ?? []).some((ability) => /momentum:.*creature school.*different name/i.test(typeof ability === "string" ? ability : ability?.text ?? ""));
}

function cardHasPlenteous(card) {
  return (card?.passives ?? []).some((passive) => /plenteous:.*base krill bloom/i.test(typeof passive === "string" ? passive : passive?.text ?? ""));
}

function cardHasAncientResilience(card) {
  return (card?.passives ?? []).some((passive) => /ancient resilience:.*once per game.*would be removed.*keep it instead/i.test(typeof passive === "string" ? passive : passive?.text ?? ""));
}

function getPassiveCoralHeal(passive) {
  const text = typeof passive === "string" ? passive : passive?.text ?? "";
  const match = text.match(/once per turn.*heal\s+(\d+)\s*hp.*coral/i);
  return match ? { amount: Number(match[1]), actionName: typeof passive === "object" ? passive.name ?? "Recovery" : text.split(":")[0] } : null;
}

function getJointedStructureMove(passive) {
  const text = typeof passive === "string" ? passive : passive?.text ?? "";
  return /jointed structure:.*once per turn.*move a creature between your corals/i.test(text)
    ? { actionName: typeof passive === "object" ? passive.name ?? "Jointed Structure" : text.split(":")[0] }
    : null;
}

function getDamageCounterMove(passive) {
  const effect = typeof passive === "object" ? passive?.effect : null;
  if (effect?.type !== "moveDamageCounter") return null;
  const counterCount = Math.max(1, Number(effect.amount) || 1);
  const hpPerCounter = Math.max(1, Number(effect.hpPerCounter) || DAMAGE_COUNTER_HP);
  return {
    actionName: passive.name ?? "Move Damage Counter",
    counterHp: counterCount * hpPerCounter,
    effect,
  };
}

function cardHasSymbiosis(card) {
  return (card?.onPlay ?? []).some((ability) => typeof ability === "object" && /symbiosis/i.test(ability.name ?? "") && (ability.effects ?? []).some((effect) => effect.type === EffectType.ATTACH_TO_CARD));
}

function cardUsesOpponentReef(card) {
  return card?.kind === CardKind.CREATURE
    && card?.specialPlacement?.controller === "opponent"
    && card?.specialPlacement?.acceptsAnyCoralSlot === true;
}

function getSlotCardIds(slot) {
  return [slot?.cardId, ...(slot?.hostedCardIds ?? [])].filter(Boolean);
}

function getOrphanEntriesFromFoundation(foundation) {
  return (foundation?.slots ?? []).filter((slot) => slot.cardId).map((slot) => ({
    cardId: slot.cardId,
    instanceId: slot.cardInstanceId ?? createStableInstanceId(`orphan-${slot.cardId}`),
    hostedCardIds: (slot.hostedCardIds ?? []).filter(Boolean),
  }));
}

function redistributeOrphanCreatures(foundations, orphanEntries = []) {
  return redistributeOrphans(foundations, orphanEntries, (cardId, slot) => canCardOccupySlot(cardsById[cardId], slot));
}

function getHostedTargetSlotId(slotId, hostedIndex) {
  return `hosted:${slotId}:${hostedIndex}`;
}

function getOrphanHostedTargetSlotId(orphanInstanceId, hostedIndex) {
  return `orphan-hosted:${orphanInstanceId}:${hostedIndex}`;
}

function parseOrphanHostedTargetSlotId(targetSlotId) {
  const match = String(targetSlotId ?? "").match(/^orphan-hosted:(.+):(\d+)$/);
  return match ? { orphanInstanceId: match[1], hostedIndex: Number(match[2]) } : null;
}

function parseHostedTargetSlotId(targetSlotId) {
  const match = String(targetSlotId ?? "").match(/^hosted:(.+):(\d+)$/);
  return match ? { slotId: match[1], hostedIndex: Number(match[2]) } : null;
}

// Hosted creatures keep their original position as their stable combat identity.
// Compacting this array after a defeat makes a sibling inherit the defeated
// creature's target ID and can incorrectly skip or repeat an attack.
function removeHostedCardAtIndex(hostedCardIds, hostedIndex) {
  return (hostedCardIds ?? []).map((cardId, index) => index === hostedIndex ? null : cardId);
}

function getSlotCardInstanceId(slot) {
  return slot?.cardInstanceId ?? (slot?.cardId ? `legacy-${slot.id}-${slot.cardId}` : null);
}

function getSlotActionKey(slot) {
  return getSlotCardInstanceId(slot) ? `slot-${getSlotCardInstanceId(slot)}` : slot?.id;
}

function getSlotTargetInstanceId(slot) {
  return getSlotCardInstanceId(slot) ? `slot-card:${getSlotCardInstanceId(slot)}` : `slot:${slot?.id}`;
}

function getHostedDefenseBonusDice(hostCard, hostedCard) {
  for (const passive of hostCard?.passives ?? []) {
    const effect = typeof passive === "object" ? passive.effect : null;
    if (effect?.type !== EffectType.MODIFY_DEFENSE_ROLL && effect?.type !== "modifyDefenseRoll") continue;
    if (effect.target?.tags?.length && !effect.target.tags.some((tag) => hostedCard?.tags?.includes(tag))) continue;
    if (effect.amount?.type === "dice" && effect.amount.dice) return effect.amount.dice;
  }
  return null;
}

function cardIsHiddenByAbyss(card, habitatIds) {
  return habitatIds?.includes("abyss") && (card?.passives ?? []).some((passive) => /darkness shroud:.*cannot be targeted/i.test(typeof passive === "string" ? passive : passive?.text ?? ""));
}

function cardCanTargetHiddenByAbyss(card, attack = null) {
  const rules = [...(card?.passives ?? []), ...(card?.specialRules ?? []), ...(card?.actions ?? []), ...(card?.onPlay ?? [])].map((rule) => typeof rule === "string" ? rule : rule?.text ?? "");
  return rules.some((rule) => /can target .*hidden by the abyss/i.test(rule)) || /can target .*hidden by the abyss/i.test(attack?.text ?? "");
}

function getBiteBackAttack(card) {
  const text = [...(card?.actions ?? []), ...(card?.passives ?? [])].find((action) => typeof action === "string" && /bite back:.*if targeted unsuccessfully/i.test(action));
  if (!text) return null;
  const dice = text.match(/\b(D\d+(?:[+-]\d+)?)\b/i)?.[1];
  return dice ? { attackDice: dice.toUpperCase(), actionName: "Bite Back" } : null;
}

function getTargetAvoidance(card) {
  for (const passive of card?.passives ?? []) {
    const text = typeof passive === "string" ? passive : passive?.text ?? "";
    if (!/if targeted|if being targeted/i.test(text) || !/flip a coin/i.test(text) || !/attack fails/i.test(text)) continue;
    const failureResult = /if heads[^.]*attack fails/i.test(text) ? "heads" : /if tails[^.]*attack fails/i.test(text) ? "tails" : null;
    if (failureResult) return { abilityName: text.split(":")[0]?.trim() || "Evasion", failureResult };
  }
  return null;
}

function cardHasScatter(card) {
  return (card?.passives ?? []).some((passive) => /opponent rerolls successful attacks/i.test(typeof passive === "string" ? passive : passive?.text ?? ""));
}

function getDynamicAttackRepeat(card, attack, friendlyCorals, friendlyOpenWater, habitats = []) {
  const baseRepeat = Math.max(1, Number(attack?.repeat ?? 1));
  const text = attack?.text ?? "";
  const friendlyCards = [
    ...(friendlyCorals ?? []).flatMap((foundation) => [cardsById[foundation.cardId], ...(foundation.slots ?? []).map((slot) => cardsById[slot.cardId])]),
    ...(friendlyOpenWater ?? []).map((cardId) => cardsById[cardId]),
  ].filter(Boolean);
  const bonusRepeats = attack?.bonusRepeats;
  if (bonusRepeats?.type === "countCardsOnReef" && (!bonusRepeats.requires || (bonusRepeats.requires.type === "kindInPlay" ? habitats.length > 0 : habitats.includes(bonusRepeats.requires.cardId)))) {
    const matchingCount = friendlyCards.filter((candidate) => candidate.id === bonusRepeats.cardId).length;
    return Math.min(Number(bonusRepeats.maxBonus ?? Infinity), baseRepeat + matchingCount);
  }
  if (bonusRepeats?.type === "cardInPlay" && habitats.includes(bonusRepeats.cardId)) return baseRepeat + Number(bonusRepeats.amount ?? 1);
  if (/group hunt:/i.test(text)) {
    const tunaCount = friendlyCards.filter((candidate) => /\btuna\b/i.test(candidate.name ?? "")).length;
    return baseRepeat + Math.min(2, tunaCount);
  }
  if (/frenzied attack:/i.test(text) && habitats.includes("open-ocean")) {
    const sharkCount = friendlyCards.filter((candidate) => /\bshark\b/i.test(candidate.name ?? "")).length;
    return baseRepeat + sharkCount;
  }
  return baseRepeat;
}

function getDefenseAdjustment(attack, targetCard, habitats = []) {
  const text = attack?.text ?? "";
  const fishPenalty = targetCard?.category === CardCategory.FISH ? text.match(/defending fish have\s*-(\d+)\s*defense/i) : null;
  const conditionalPenalty = attack?.conditionalDefensePenalty && (!attack.conditionalDefensePenalty.requiredCardId || habitats.includes(attack.conditionalDefensePenalty.requiredCardId)) ? Number(attack.conditionalDefensePenalty.amount ?? 0) : 0;
  return {
    flat: (fishPenalty ? -Number(fishPenalty[1]) : 0) - Number(attack?.ensnarePenalty ?? 0) - conditionalPenalty,
    ignoresBonuses: /ignore defensive bonuses/i.test(text),
  };
}

function getRolledAttackBonus(attack, rawRoll, habitats = []) {
  const match = (attack?.text ?? "").match(/if you roll a?\s*(\d+)\s*or higher and open ocean[^.]*add\s*\+?(\d+)/i);
  if (!match || !habitats.includes("open-ocean") || Number(rawRoll) < Number(match[1])) return { flat: 0, detail: "" };
  return { flat: Number(match[2]), detail: `+${match[2]} Open Ocean roll bonus` };
}

function parseLegacyAttackAction(action) {
  return parseLegacyAttackText(action);
}

function parseLegacyUtilityAction(action) {
  return parseLegacyUtilityText(action);
}

function getActionName(action) {
  return typeof action === "string" ? action.split(":")[0]?.trim() || "Action" : action?.name ?? "Action";
}

function getActionCost(action) {
  const text = typeof action === "string" ? action : action?.text ?? "";
  return Number(action?.cost?.rp ?? text.match(/cost:\s*(\d+)\s*rp/i)?.[1] ?? 0);
}

function getBasicAttackEffect(card) {
  for (const action of card?.actions ?? []) {
    const legacyAttack = parseLegacyAttackAction(action);
    if (legacyAttack) return legacyAttack;
    const actionEffects = [...(action.effects ?? []), ...(action.effect ? [action.effect] : [])];
    const effect = actionEffects.find((candidate) => candidate.type === EffectType.ATTACK && candidate.attackDice);
    if (effect) {
      const hasCompanionEffects = actionEffects.some((candidate) => candidate !== effect);
      return {
        ...effect,
        actionName: action.name ?? effect.attackName ?? "Attack",
        text: action.text ?? effect.text ?? "",
        actionCost: Number(action.cost?.rp ?? 0),
        skipNextTurn: /cannot (?:use|be performed).*next turn/i.test(action.text ?? ""),
        targetTags: effect.targetTags ?? action.targetTags ?? [],
        unsupportedDetails: hasCompanionEffects
          ? "This action has additional effects that are not implemented; only its opposed attack resolved."
          : "",
      };
    }
  }
  return null;
}

function getOnPlayAttackEffect(card) {
  const defenseModifier = (card?.onPlay ?? []).flatMap((ability) => typeof ability === "object" ? ability.effects ?? [] : []).find((effect) => (effect.type === EffectType.MODIFY_DEFENSE_ROLL || effect.type === "modifyDefenseRoll") && Number(effect.amount ?? 0) < 0);
  for (const ability of card?.onPlay ?? []) {
    const legacyAttack = parseLegacyAttackAction(ability);
    if (legacyAttack) return legacyAttack;
    if (typeof ability !== "object") continue;
    const effect = (ability.effects ?? []).find((candidate) => candidate.type === EffectType.ATTACK && candidate.attackDice);
    if (effect) {
      const supportedCompanionTypes = new Set([EffectType.DAMAGE, EffectType.MODIFY_DEFENSE_ROLL, "grantAdvantage"]);
      return { ...effect, actionName: ability.name ?? effect.attackName ?? "On Play Attack", actionCost: 0, text: ability.text ?? effect.text ?? "", targetTags: effect.targetTags ?? ability.targetTags ?? [], conditionalModifiers: effect.conditionalModifiers ?? ability.conditionalModifiers ?? [], conditionalDefensePenalty: defenseModifier ? { amount: Math.abs(Number(defenseModifier.amount)), requiredCardId: defenseModifier.requires?.cardId ?? null } : null, unsupportedDetails: (ability.effects ?? []).some((candidate) => candidate !== effect && !supportedCompanionTypes.has(candidate.type)) ? "This On Play ability has additional effects that are not implemented; its attack resolved." : "" };
    }
  }
  return null;
}

function getActionEffects(action) {
  return [...(action?.effects ?? []), ...(action?.effect ? [action.effect] : [])];
}

function actionIsOncePerTurn(action) {
  return action?.oncePerTurn !== false && !/as often as you like/i.test(action?.text ?? "");
}

function cardMatchesAttackTarget(card, attack) {
  return attackCanTargetCard(card, attack);
}

function cardMatchesSearchCriteria(card, effect) {
  if (!card) return false;
  if (effect.targetCardId && effect.targetCardId !== card.id) return false;
  if (effect.targetKind && effect.targetKind !== card.kind) return false;
  if (effect.targetCategories?.length && !effect.targetCategories.includes(card.category)) return false;
  if (effect.targetTags?.length && !effect.targetTags.every((tag) => card.tags?.includes(tag))) return false;
  if (effect.excludeTags?.some((tag) => card.tags?.includes(tag))) return false;
  if (effect.targetNameIncludes && !card.name?.toLowerCase().includes(effect.targetNameIncludes.toLowerCase())) return false;
  return true;
}

function cardHasAttackAdvantage(card, targetCard, habitats = [], attack = null) {
  if (attack?.advantage === true) return true;
  return (card?.onPlay ?? []).some((ability) => {
    if (typeof ability === "string") return /(?:attacks? have|gain) advantage/i.test(ability) && (!/abyss/i.test(ability) || habitats.includes("abyss"));
    return (ability.effects ?? []).some((effect) => {
      if (effect.type !== "grantAdvantage") return false;
      if (effect.targetCategories?.length && !effect.targetCategories.includes(targetCard?.category)) return false;
      const requiredCardId = effect.requires?.cardId;
      return !requiredCardId || habitats.includes(requiredCardId);
    });
  });
}

function getAttackConditionalModifier(attacker, targetCard, habitats, friendlyCorals, friendlyOpenWater, attack, friendlyOrphans = []) {
  const text = attack?.text ?? "";
  let flat = Number(attack?.flatBonus ?? 0);
  const details = attack?.flatBonus ? [`+${attack.flatBonus} ${attack.flatBonusSource ?? "attack bonus"}`] : [];
  (targetCard?.passives ?? []).forEach((passive) => {
    const passiveText = typeof passive === "string" ? passive : passive?.text ?? "";
    const penalty = passiveText.match(/all attacks against this creature have\s*-(\d+)\s*on their attack rolls/i);
    if (penalty) {
      flat -= Number(penalty[1]);
      details.push(`-${penalty[1]} ${targetCard.name}`);
    }
  });
  (attacker?.passives ?? []).forEach((passive) => {
    const passiveText = typeof passive === "string" ? passive : passive?.text ?? "";
    const openPursuit = passiveText.match(/gain\s*\+(\d+)\s+on attacks when open ocean/i);
    if (openPursuit && habitats.includes("open-ocean")) {
      flat += Number(openPursuit[1]);
      details.push(`+${openPursuit[1]} Open Pursuit`);
    }
    const titanBonus = passiveText.match(/attacking a giant or colossal squid, gain\s*\+(\d+)/i);
    if (titanBonus && /giant squid|colossal squid/i.test(targetCard?.name ?? "")) {
      flat += Number(titanBonus[1]);
      details.push(`+${titanBonus[1]} Battle of the Titans`);
    }
  });
  const habitatBonus = (habitatId, pattern) => {
    const match = text.match(pattern);
    if (habitats.includes(habitatId) && match) {
      flat += Number(match[1]);
      details.push(`+${match[1]} ${habitatId === "abyss" ? "Abyss" : "Open Ocean"}`);
    }
  };
  habitatBonus("abyss", /if abyss[^.]*add\s*\+?(\d+)/i);
  habitatBonus("open-ocean", /if open ocean[^.]*add\s*\+?(\d+)/i);
  const schoolBonus = text.match(/if targeting (?:a damaged )?creature school[^.]*add\s*\+?(\d+)/i) ?? text.match(/add\s*\+?(\d+)\s+if targeting a creature school/i);
  if (isCreatureSchool(targetCard) && schoolBonus && (!/damaged creature school/i.test(text) || Number(targetCard.health ?? 0) < Number(targetCard.maxHealth ?? Infinity))) {
    flat += Number(schoolBonus[1]);
    details.push(`+${schoolBonus[1]} Creature School`);
  }
  const namedTargetBonus = text.match(/add\s*\+?(\d+)\s+if targeting man o['’]? war/i);
  if (namedTargetBonus && /man o['’]? war/i.test(targetCard?.name ?? "")) {
    flat += Number(namedTargetBonus[1]);
    details.push(`+${namedTargetBonus[1]} Man O' War target`);
  }
  const friendlyCards = [...friendlyCorals.flatMap((foundation) => [cardsById[foundation.cardId], ...foundation.slots.flatMap((slot) => getSlotCardIds(slot).map((cardId) => cardsById[cardId]))]), ...(friendlyOpenWater ?? []).map((cardId) => cardsById[cardId]), ...(friendlyOrphans ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])].map((cardId) => cardsById[cardId]))].filter(Boolean);
  friendlyCards.forEach((card) => (card.passives ?? []).forEach((passive) => {
    const passiveText = typeof passive === "string" ? passive : passive?.text ?? "";
    const boost = passiveText.match(/all of your attacks have \+(\d+)/i);
    if (boost) { flat += Number(boost[1]); details.push(`+${boost[1]} ${card.name}`); }
  }));
  if (isCreatureSchool(targetCard)) {
    const corralCount = Math.min(2, friendlyCards.filter((card) => (card.passives ?? []).some((passive) => /attacks against creature schools gain \+1/i.test(typeof passive === "string" ? passive : passive?.text ?? ""))).length);
    if (corralCount) { flat += corralCount; details.push(`+${corralCount} Corral`); }
  }
  const extraDieMatch = text.match(/if open ocean[^.]*add\s*(D\d+)/i);
  const hasStructuredExtraDie = (attack?.conditionalModifiers ?? []).some((entry) => entry.modifier?.type === "addDiceToAttackRoll");
  const extraRoll = !hasStructuredExtraDie && habitats.includes("open-ocean") && extraDieMatch ? rollDie(extraDieMatch[1]) : null;
  if (extraRoll) { flat += extraRoll.total; details.push(`+${extraRoll.total} ${extraDieMatch[1]}`); }
  const ecosystemCards = friendlyCards;
  (attack?.conditionalModifiers ?? []).forEach((entry) => {
    if (!isEcosystemConditionMet(entry.condition, habitats, ecosystemCards)) return;
    const modifier = entry.modifier ?? {};
    if (modifier.type === "addDiceToAttackRoll") {
      const bonusRoll = rollDie(modifier.dice);
      if (bonusRoll) {
        flat += bonusRoll.total;
        details.push(`+${bonusRoll.total} ${modifier.dice} conditional bonus`);
      }
    } else if (modifier.type === "fixed") {
      const amount = Number(modifier.amount ?? 0);
      flat += amount;
      details.push(`${amount >= 0 ? "+" : ""}${amount} conditional bonus`);
    }
  });
  return { flat, details };
}

function getSupportedUtilityEffect(action) {
  const actionText = typeof action === "string" ? action : action?.text ?? "";
  const cloakEffect = /cloak in darkness:.*choose one of your opponent'?s corals?.*stunn?ed/i.test(actionText)
    ? { type: EffectType.STUN_CORAL, target: { controller: "opponent", kind: CardKind.CORAL } }
    : null;
  return parseLegacyUtilityAction(action) ?? cloakEffect ?? getActionEffects(action).find((effect) => effect.type === EffectType.DRAW_CARDS || effect.type === EffectType.SEARCH_DECK || effect.type === "reorderTopDeck" || effect.type === "grantNextOnPlayAttackBonus" || effect.type === "rollDiceForResource" || effect.type === EffectType.RECOVER_CARD_FROM_DISCARD || effect.type === "recoverCardFromDiscard" || effect.type === "discardThenSearchDeck" || effect.type === "discardThenDraw" || effect.type === "modifyDefenseRoll" || effect.type === EffectType.GRANT_DEFENSE_ADVANTAGE || effect.type === EffectType.STUN_CORAL || (effect.type === EffectType.FLIP_COIN && [EffectType.STUN_CORAL, EffectType.DAMAGE, EffectType.MODIFY_RP_GENERATION, "modifyRpGeneration"].includes(effect.onSuccess?.type))) ?? null;
}

function supportExplicitlyLocksFurtherSupports(card) {
  return supportLocksFurtherPlays(card);
}

function isCreatureSchool(card) {
  return card?.kind === CardKind.CREATURE && card.tags?.includes("creature-school");
}

function getCardClassLabel(card) {
  if (!card) return "Unknown Card";
  const zoneLabel = card.zone === CreatureZone.OCEAN ? "Oceanic" : card.zone === CreatureZone.DEEP ? "Deep" : "Reef";
  const classLabel = String(card.class ?? card.category ?? card.kind ?? "card")
    .split(/[-_]/)
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : "")
    .join(" ");

  if (card.kind === CardKind.CORAL) return `${card.stageLabel ?? "Base"} - ${zoneLabel} Coral`;
  if (isCreatureSchool(card)) return `${zoneLabel} Creature School`;
  if (card.kind === CardKind.CREATURE) return `${zoneLabel} ${classLabel}`;
  if (card.kind === CardKind.HABITAT) return `${zoneLabel} Habitat`;
  if (card.kind === CardKind.SUPPORT) return "Support Action";
  return classLabel;
}

function isFoundationCard(card) {
  return getPersonalDeckType(card) === "foundation";
}

function getInPlayStageLabel(card) {
  if (!card || (card.kind !== CardKind.CORAL && !isCreatureSchool(card))) return null;
  if (card.stageLabel) return card.stageLabel;
  const stage = String(card.stage ?? "").toLowerCase();
  if (!stage || stage === "base" || stage === "0") return "Base";
  if (stage === "stage1" || stage === "stage-1" || stage === "1") return "Stage 1";
  if (stage === "stage2" || stage === "stage-2" || stage === "2") return "Stage 2";
  return String(card.stage);
}

function InPlayHoverLabel({ card, zoom = 1 }) {
  if (!card) return null;
  const stageLabel = getInPlayStageLabel(card);
  const inverseZoom = Math.min(2.5, Math.max(0.7, 1 / Math.max(0.2, Number(zoom) || 1)));

  return (
    <span
      className="seapals-in-play-hover-label"
      style={{ "--seapals-hover-label-scale": inverseZoom }}
      aria-hidden="true"
    >
      <span className="seapals-in-play-hover-name">{card.name}</span>
      {stageLabel ? <span className="seapals-in-play-hover-stage">{stageLabel}</span> : null}
    </span>
  );
}

function getCreatureSlotLabel(slot) {
  if (!slot) return "Creature";
  const rawZone = String(slot.zone ?? "reef")
    .replace(/^your_/, "")
    .replace(/^opponent_/, "")
    .toLowerCase();
  const zoneLabel = rawZone === "ocean"
    ? "Oceanic"
    : rawZone.charAt(0).toUpperCase() + rawZone.slice(1);
  const rawClass = String(slot.slotClass ?? slot.slotType ?? slot.class ?? "any");
  const classLabel = rawClass === "any"
    ? "Creature"
    : rawClass
        .split(/[-_]/)
        .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : "")
        .join(" ");
  return `${zoneLabel} ${classLabel}`;
}

function EmptySlotHoverLabel({ slot, zoom = 1, position }) {
  const inverseZoom = Math.min(2.5, Math.max(0.7, 1 / Math.max(0.2, Number(zoom) || 1)));
  const placeBelow = Number.parseFloat(position?.top) < 20;
  return (
    <span
      className={`seapals-in-play-hover-label ${placeBelow ? "seapals-in-play-hover-label--below" : ""}`}
      style={{ "--seapals-hover-label-scale": inverseZoom }}
      aria-hidden="true"
    >
      <span className="seapals-in-play-hover-name">{getCreatureSlotLabel(slot)}</span>
      <span className="seapals-in-play-hover-stage">Empty Slot</span>
    </span>
  );
}

const BUBBLE_PARTICLES = [
  { drift: -72, rise: 150, size: 26, delay: 0, duration: 1750 },
  { drift: -46, rise: 210, size: 42, delay: 80, duration: 1900 },
  { drift: -24, rise: 132, size: 18, delay: 180, duration: 1450 },
  { drift: -8, rise: 245, size: 34, delay: 20, duration: 2050 },
  { drift: 14, rise: 178, size: 54, delay: 130, duration: 1800 },
  { drift: 34, rise: 226, size: 24, delay: 230, duration: 1700 },
  { drift: 58, rise: 148, size: 38, delay: 40, duration: 1600 },
  { drift: 82, rise: 202, size: 20, delay: 160, duration: 1850 },
  { drift: -92, rise: 188, size: 16, delay: 260, duration: 1550 },
  { drift: 96, rise: 164, size: 30, delay: 280, duration: 1650 },
  { drift: -36, rise: 270, size: 22, delay: 300, duration: 1900 },
  { drift: 44, rise: 282, size: 16, delay: 340, duration: 1800 },
];

function BubbleBurst({ x, y }) {
  return (
    <span className="seapals-bubble-burst" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true">
      {BUBBLE_PARTICLES.map((particle, index) => (
        <span
          key={index}
          className="seapals-bubble-particle"
          style={{
            "--seapals-bubble-drift": `${particle.drift}px`,
            "--seapals-bubble-rise": `${particle.rise}px`,
            "--seapals-bubble-size": `${particle.size}px`,
            "--seapals-bubble-delay": `${particle.delay}ms`,
            "--seapals-bubble-duration": `${particle.duration}ms`,
          }}
        />
      ))}
    </span>
  );
}

function getCardStartTurnRp(card) {
  if (!card || (card.kind !== CardKind.CORAL && !card.tags?.includes("creature-school"))) return 0;

  return (card.passives ?? []).reduce((total, passive) => {
    const effect = typeof passive === "object" ? passive.effect : null;
    if (effect?.type === "gainResource" && effect.resource === "rp" && Number.isFinite(Number(effect.amount))) {
      return total + Number(effect.amount);
    }

    const text = typeof passive === "string" ? passive : passive?.text;
    const match = text?.match(/collect\s+(\d+)\s*rp\s+at the start of your turn/i);
    return total + (match ? Number(match[1]) : 0);
  }, 0);
}

function conditionPreventsCoralIncome(card, activeCondition) {
  if (!card || !activeCondition) return false;
  return (activeCondition.effects ?? []).some(
    (effect) =>
      effect.type === EffectType.PREVENT_RP_GENERATION &&
      effect.targetKind === CardKind.CORAL &&
      effect.targetWeaknesses?.some((weakness) => card.weaknesses?.includes(weakness)),
  );
}

function getEcosystemStartTurnRp(playerCorals, activeCondition = null) {
  return playerCorals.reduce((total, coral) => {
    const coralCard = cardsById[coral.cardId];
    const baseCoralRp = conditionPreventsCoralIncome(coralCard, activeCondition) ? 0 : getCardStartTurnRp(coralCard);
    const coralRp = Math.max(0, baseCoralRp - Number(coral.rpPenaltyNextTurn ?? 0));
    const slottedRp = (coral.slots ?? []).reduce(
      (slotTotal, slot) => slotTotal + getCardStartTurnRp(cardsById[slot.cardId]),
      0,
    );
    const attachedCardBonus = calculateAttachedCardRpBonus(coral, cardsById);
    return total + coralRp + slottedRp + attachedCardBonus;
  }, 0);
}

function getEcosystemCreatureCardIds(foundations = [], openWaterCreatures = [], orphanCreatures = []) {
  return [
    ...foundations.flatMap((foundation) => (foundation.slots ?? []).flatMap(getSlotCardIds)),
    ...openWaterCreatures.map((entry) => typeof entry === "string" ? entry : entry?.cardId).filter(Boolean),
    ...orphanCreatures.flatMap((entry) => [entry?.cardId, ...(entry?.hostedCardIds ?? [])]).filter(Boolean),
  ];
}

function getParasiteRequestedRp(controllerFoundations, controllerOpenWater, controllerOrphans, opposingFoundations, opposingOpenWater, opposingOrphans) {
  const controllerCardIds = getEcosystemCreatureCardIds(controllerFoundations, controllerOpenWater, controllerOrphans);
  if (!controllerCardIds.includes("cookie-cutter-shark")) return 0;
  return getEcosystemCreatureCardIds(opposingFoundations, opposingOpenWater, opposingOrphans)
    .map((cardId) => cardsById[cardId])
    .filter((card) => [CardCategory.PREDATOR, CardCategory.APEX].includes(card?.category))
    .length;
}

function describeParasiteTransfer(actorLabel, transfer) {
  if (!transfer?.requested) return "";
  const collected = transfer.transferred
    ? `${actorLabel} collected ${transfer.transferred} RP from the opposing RP bank.`
    : `${actorLabel} could not collect RP from the opposing RP bank.`;
  const remainder = transfer.uncollected
    ? ` ${transfer.uncollected} additional RP could not be transferred because the opposing bank or recipient cap had no room. The printed fallback to “collect from the board” has no defined board-resource transition in the repository rules, so no card was removed.`
    : "";
  return `${collected}${remainder}`;
}

function getEcosystemRpCap(corals, habitats = [], activeCondition = null) {
  const coralCards = corals.flatMap((coral) => [
    cardsById[coral.cardId],
    ...(coral.slots ?? []).flatMap((slot) => [
      cardsById[slot.cardId],
      ...(slot.hostedCardIds ?? []).map((cardId) => cardsById[cardId]),
    ]),
  ]);
  const otherCards = habitats.map((cardId) => cardsById[cardId]);
  return calculateRpBankCap([...coralCards, ...otherCards].filter(Boolean), activeCondition);
}

function getCardPlayCost(card, activeCondition = null) {
  const baseCost = Number(card?.cost?.rp ?? 0);
  const modifier = (activeCondition?.effects ?? []).reduce((total, effect) => {
    const matchesKind = !effect.targetKind || effect.targetKind === card?.kind;
    const matchesCategory = !effect.targetCategories?.length || effect.targetCategories.includes(card?.category);
    return effect.type === EffectType.MODIFY_PLAY_COST && matchesKind && matchesCategory
      ? total + Number(effect.amount ?? 0)
      : total;
  }, 0);
  return Math.max(0, baseCost + modifier);
}

function getOpposingPlayCostModifier(card, opposingCorals = [], opposingReefCreatures = [], opposingOrphans = []) {
  const opposingCards = [
    ...opposingReefCreatures.map((cardId) => cardsById[cardId]),
    ...opposingOrphans.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])].map((cardId) => cardsById[cardId])),
    ...opposingCorals.flatMap((foundation) => [cardsById[foundation.cardId], ...foundation.slots.flatMap((slot) => getSlotCardIds(slot).map((cardId) => cardsById[cardId]))]),
  ].filter(Boolean);
  return opposingCards.reduce((total, opposingCard) => total + (opposingCard.passives ?? []).reduce((passiveTotal, passive) => {
    const effect = typeof passive === "object" ? passive.effect : null;
    if (effect?.type !== EffectType.MODIFY_PLAY_COST || effect.targetPlayer !== "opponent") return passiveTotal;
    if (effect.targetKind && effect.targetKind !== card?.kind) return passiveTotal;
    if (effect.targetCategories?.length && !effect.targetCategories.includes(card?.category)) return passiveTotal;
    return passiveTotal + Number(effect.amount ?? 0);
  }, 0), 0);
}

function getConditionPlayRestriction(card, activeCondition = null) {
  return conditionPreventsCardPlay(card, activeCondition) ? `${activeCondition.name}: ${activeCondition.text}` : "";
}

function getConditionExtraDraws(activeCondition = null) {
  return (activeCondition?.effects ?? []).reduce(
    (total, effect) => total + (effect.type === EffectType.MODIFY_TURN_DRAW ? Number(effect.amount ?? 0) : 0),
    0,
  );
}

function getUnsupportedConditionEffects(activeCondition = null) {
  const supported = new Set([
    EffectType.PREVENT_CARD_PLAY,
    EffectType.PREVENT_RP_GENERATION,
    EffectType.MODIFY_PLAY_COST,
    EffectType.MODIFY_TURN_DRAW,
    EffectType.MODIFY_RP_BANK_CAP,
    EffectType.MODIFY_SCHOOL_DENSITY_REQUIREMENT,
    "setHandLimit",
  ]);
  return (activeCondition?.effects ?? []).filter((effect) => !supported.has(effect.type));
}

function getEcosystemVictoryPoints(corals, habitats = [], reefCreatures = []) {
  const cardIds = [
    ...habitats,
    ...reefCreatures,
    ...corals.flatMap((coral) => [coral.cardId, ...(coral.slots ?? []).flatMap(getSlotCardIds)]),
  ];
  return calculateVictoryPoints(cardIds.map((cardId) => cardsById[cardId]), cardIds);
}

function ecosystemHasCard(corals, reefCreatures, cardId, orphanCreatures = []) {
  return (reefCreatures ?? []).includes(cardId)
    || orphanCreatures.some((entry) => entry.cardId === cardId || (entry.hostedCardIds ?? []).includes(cardId))
    || corals.some((coral) => coral.cardId === cardId || coral.slots.some((slot) => slot.cardId === cardId || (slot.hostedCardIds ?? []).includes(cardId)));
}

function getGlobalCoralHealthBonus(foundations) {
  return foundations.reduce((total, foundation) => total + (cardsById[foundation.cardId]?.passives ?? []).reduce((passiveTotal, passive) => {
    const effect = typeof passive === "object" ? passive.effect : null;
    return passiveTotal + (effect?.type === EffectType.MODIFY_HEALTH && effect.targetKind === CardKind.CORAL && effect.controller === "you" ? Number(effect.amount ?? 0) : 0);
  }, 0), 0);
}

function reconcileGlobalCoralHealth(foundations, ecosystemCreatures = []) {
  const bonus = getGlobalCoralHealthBonus(foundations);
  const creatureSchools = foundations.filter((foundation) => isCreatureSchool(cardsById[foundation.cardId]));
  const territorialSources = [
    ...ecosystemCreatures.map((entry) => typeof entry === "string" ? { cardId: entry } : entry),
    ...foundations.flatMap((foundation) => foundation.slots.map((slot) => ({
      cardId: slot.cardId,
      ...(Object.prototype.hasOwnProperty.call(slot, "territorialTargetFoundationId")
        ? { territorialTargetFoundationId: slot.territorialTargetFoundationId }
        : {}),
    }))),
  ].filter((entry) => entry.cardId === "ocean-triggerfish");
  const territorialBonuses = territorialSources.reduce((bonuses, source) => {
    const hasPersistedTarget = Object.prototype.hasOwnProperty.call(source, "territorialTargetFoundationId");
    const target = hasPersistedTarget
      ? creatureSchools.find((foundation) => foundation.id === source.territorialTargetFoundationId)
      : creatureSchools[0];
    if (target) bonuses.set(target.id, Number(bonuses.get(target.id) ?? 0) + 10);
    return bonuses;
  }, new Map());
  let changed = false;
  const destroyed = [];
  const corals = foundations.map((foundation) => {
    const card = cardsById[foundation.cardId];
    if (card?.kind !== CardKind.CORAL && !isCreatureSchool(card)) return foundation;
    const attachedBonus = calculateAttachedHostHealthBonus(foundation.slots.map((slot) => cardsById[slot.cardId]).filter(Boolean));
    const totalBonus = (card.kind === CardKind.CORAL ? bonus : 0) + attachedBonus + Number(territorialBonuses.get(foundation.id) ?? 0);
    const desiredMax = Math.max(0, Number(card.health ?? 0) + totalBonus);
    const currentMax = Number(foundation.maxHealth ?? card.health ?? 0);
    if (desiredMax === currentMax) return foundation;
    changed = true;
    const reconciled = reconcileContinuousHealth(foundation.health ?? currentMax, currentMax, card.health, totalBonus);
    const next = { ...foundation, maxHealth: reconciled.maxHealth, health: reconciled.health };
    if (reconciled.destroyed) destroyed.push(next);
    return next;
  });
  return { changed, destroyed, corals: corals.filter((foundation) => !destroyed.some((entry) => entry.id === foundation.id)) };
}

function reconcileFoundationHealthToFixedPoint(foundations = [], reefCreatures = [], orphanCreatures = []) {
  let corals = foundations;
  let orphans = orphanCreatures;
  const destroyed = [];
  const destructionWaves = [];
  let changed = false;
  const maximumPasses = Math.max(2, foundations.length + 2);

  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const allUnslottedCreatures = [
      ...reefCreatures,
      ...orphans,
      ...orphans.flatMap((entry) => (entry.hostedCardIds ?? []).map((cardId) => ({ cardId }))),
    ];
    const result = reconcileGlobalCoralHealth(corals, allUnslottedCreatures);
    if (!result.changed) break;
    changed = true;
    corals = result.corals;
    if (result.destroyed.length) {
      destroyed.push(...result.destroyed);
      destructionWaves.push(result.destroyed);
      const redistributed = redistributeOrphanCreatures(corals, [...orphans, ...result.destroyed.flatMap(getOrphanEntriesFromFoundation)]);
      corals = redistributed.corals;
      orphans = redistributed.orphans;
    }
  }

  return { changed, corals, orphans, destroyed, destructionWaves };
}

function getFragmentRecoveryEffect(card) {
  return (card?.passives ?? [])
    .map((passive) => typeof passive === "object" ? passive.effect : null)
    .find((candidate) => candidate?.type === EffectType.RECOVER_CARD_FROM_DISCARD && candidate.targetCardId && candidate.destination === "hand") ?? null;
}

function getFragmentRecoveryIds(card, discard) {
  const effect = getFragmentRecoveryEffect(card);
  if (!effect) return [];
  return discard.filter((cardId) => cardId === effect.targetCardId).slice(0, Math.max(1, Number(effect.amount ?? 1)));
}

function resolveFoundationDestructionTriggers(destructionWaves = [], initialHand = [], initialDiscard = [], handLimit = Infinity) {
  return resolveDestructionRecoveryWaves(
    destructionWaves,
    initialHand,
    initialDiscard,
    handLimit,
    (foundation, discardPile) => {
      const effect = getFragmentRecoveryEffect(cardsById[foundation.cardId]);
      if (!effect) return null;
      const recoveredIds = getFragmentRecoveryIds(cardsById[foundation.cardId], discardPile);
      return {
        targetCardId: effect.targetCardId,
        recoveredIds,
      };
    },
  );
}

function getSchoolDensity(foundations) {
  return foundations.reduce((total, foundation) => total + Number(cardsById[foundation.cardId]?.schoolDensity ?? 0), 0);
}

function getHabitatRequirementError(card, habitatIds) {
  const rules = [...(card?.playRequirements ?? []), ...(card?.specialRules ?? [])].map((rule) => typeof rule === "string" ? rule : rule?.text ?? "");
  const hasOpenOcean = habitatIds.includes("open-ocean");
  const hasAbyss = habitatIds.includes("abyss");
  const hasCoralReef = habitatIds.includes("coral-reef");
  if (rules.some((rule) => /open ocean or coral reef/i.test(rule)) && !hasOpenOcean && !hasCoralReef) return `${card.name} requires Open Ocean or Coral Reef in your ecosystem.`;
  if (rules.some((rule) => /open ocean or abyss/i.test(rule)) && !hasOpenOcean && !hasAbyss) return `${card.name} requires Open Ocean or Abyss in your ecosystem.`;
  if (rules.some((rule) => /requires? open ocean|only be played if open ocean/i.test(rule)) && !hasOpenOcean) return `${card.name} requires Open Ocean in your ecosystem.`;
  if (rules.some((rule) => /requires? abyss|only be played if abyss/i.test(rule)) && !hasAbyss) return `${card.name} requires Abyss in your ecosystem.`;
  return "";
}

function getCompositionRequirementError(card, corals, reefCreatures = []) {
  const rules = [...(card?.playRequirements ?? []), ...(card?.specialRules ?? [])].map((rule) => typeof rule === "string" ? rule : rule?.text ?? "");
  const ecosystemCards = [
    ...(corals ?? []).flatMap((foundation) => (foundation.slots ?? []).flatMap((slot) => getSlotCardIds(slot).map((cardId) => cardsById[cardId]))),
    ...(reefCreatures ?? []).map((cardId) => cardsById[cardId]),
  ].filter(Boolean);
  const coralCount = (corals ?? []).filter((foundation) => cardsById[foundation.cardId]?.kind === CardKind.CORAL).length;
  const fishCount = ecosystemCards.filter((candidate) => candidate.category === CardCategory.FISH && !isCreatureSchool(candidate)).length;
  const invertebrateCount = ecosystemCards.filter((candidate) => candidate.category === CardCategory.INVERTEBRATE && !isCreatureSchool(candidate)).length;
  const compositionRequirement = (card?.playRequirements ?? []).find((requirement) => requirement?.type === "ecosystemComposition");
  if (compositionRequirement) {
    const missing = [
      coralCount < Number(compositionRequirement.minimumCorals ?? 0) ? `${compositionRequirement.minimumCorals} Corals (you have ${coralCount})` : null,
      fishCount < Number(compositionRequirement.minimumFish ?? 0) ? `${compositionRequirement.minimumFish} Fish (you have ${fishCount})` : null,
      invertebrateCount < Number(compositionRequirement.minimumInvertebrates ?? 0) ? `${compositionRequirement.minimumInvertebrates} Invertebrates (you have ${invertebrateCount})` : null,
    ].filter(Boolean);
    if (missing.length) return `${card.name} requires ${missing.join(", ")}.`;
  }
  const oceanicFishCount = ecosystemCards.filter((candidate) => candidate.category === CardCategory.FISH && candidate.tags?.includes("oceanic")).length;
  const oceanicPredatorCount = ecosystemCards.filter((candidate) => candidate.category === CardCategory.PREDATOR && candidate.tags?.includes("oceanic")).length;
  const oceanicApexCount = ecosystemCards.filter((candidate) => candidate.category === CardCategory.APEX && candidate.tags?.includes("oceanic")).length;
  const fishRequirement = rules.map((rule) => rule.match(/requires?\s+(\d+)\s+oceanic fish/i)).find(Boolean);
  if (fishRequirement && oceanicFishCount < Number(fishRequirement[1])) return `${card.name} requires ${fishRequirement[1]} Oceanic Fish in your ecosystem; you have ${oceanicFishCount}.`;
  if (rules.some((rule) => /requires? an oceanic predator or oceanic apex/i.test(rule)) && oceanicPredatorCount + oceanicApexCount < 1) return `${card.name} requires an Oceanic Predator or Oceanic Apex in your ecosystem.`;
  if (rules.some((rule) => /discard one oceanic predator or two oceanic fish/i.test(rule)) && oceanicPredatorCount < 1 && oceanicFishCount < 2) return `${card.name} requires an Oceanic Predator or two Oceanic Fish in your ecosystem to discard as its additional play cost.`;
  return "";
}

function getOceanicPlaySacrifices(card, corals, reefCreatures = [], orphanCreatures = []) {
  const requiresSacrifice = (card?.specialRules ?? []).some((rule) => /discard one oceanic predator or two oceanic fish/i.test(typeof rule === "string" ? rule : rule?.text ?? ""));
  if (!requiresSacrifice) return [];
  const entries = [
    ...(corals ?? []).flatMap((coral) => (coral.slots ?? []).filter((slot) => slot.cardId).map((slot) => ({ card: cardsById[slot.cardId], cardId: slot.cardId, coralId: coral.id, slotId: slot.id, reefIndex: -1 }))),
    ...(reefCreatures ?? []).map((cardId, reefIndex) => ({ card: cardsById[cardId], cardId, coralId: null, slotId: null, reefIndex })),
    ...(orphanCreatures ?? []).map((entry, orphanIndex) => ({ card: cardsById[entry.cardId], cardId: entry.cardId, coralId: null, slotId: null, reefIndex: -1, orphanIndex })),
  ].filter((entry) => entry.card?.tags?.includes("oceanic"));
  const predator = entries.find((entry) => entry.card.category === CardCategory.PREDATOR);
  if (predator) return [predator];
  return entries.filter((entry) => entry.card.category === CardCategory.FISH).slice(0, 2);
}

function createCoralId(cardId) {
  return `${cardId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createStableInstanceId(prefix) {
  return createCoralId(prefix);
}

function reconcileHabitatZone(currentInstances = [], nextEntries = []) {
  const used = new Set();
  return nextEntries.map((entry) => {
    const cardId = typeof entry === "string" ? entry : entry.cardId;
    if (entry?.instanceId) {
      if (used.has(entry.instanceId)) throw new Error(`Duplicate habitat instanceId: ${entry.instanceId}`);
      used.add(entry.instanceId);
      return entry;
    }
    const existing = currentInstances.find((candidate) => candidate.cardId === cardId && !used.has(candidate.instanceId));
    if (existing) {
      used.add(existing.instanceId);
      return existing;
    }
    return createHabitatInstance(cardId, createStableInstanceId(`habitat-${cardId}`), cardsById);
  });
}

function reconcileCreatureZone(currentInstances = [], nextEntries = [], prefix = "creature") {
  const used = new Set();
  return nextEntries.map((entry) => {
    const cardId = typeof entry === "string" ? entry : entry.cardId;
    if (entry?.instanceId) {
      if (used.has(entry.instanceId)) throw new Error(`Duplicate creature instanceId: ${entry.instanceId}`);
      used.add(entry.instanceId);
      return entry;
    }
    const existing = currentInstances.find((candidate) => candidate.cardId === cardId && !used.has(candidate.instanceId));
    if (existing) {
      used.add(existing.instanceId);
      return existing;
    }
    return createCreatureInstance(cardId, createStableInstanceId(`${prefix}-${cardId}`), typeof entry === "object" ? entry : {});
  });
}

function reconcileOpponentInstances(current, next) {
  const habitatInstanceIds = (next?.habitatInstances ?? []).map((instance) => instance.cardId);
  const habitatIds = next?.habitats ?? habitatInstanceIds;
  const reefInstanceIds = (next?.reefCreatureInstances ?? []).map((instance) => instance.cardId);
  const reefIds = next?.reefCreatures ?? reefInstanceIds;
  const sameCardOrder = (left, right) => left.length === right.length && left.every((cardId, index) => cardId === right[index]);
  const habitatSource = next?.habitatInstances?.length && sameCardOrder(habitatInstanceIds, habitatIds) ? next.habitatInstances : habitatIds;
  const reefSource = next?.reefCreatureInstances?.length && sameCardOrder(reefInstanceIds, reefIds) ? next.reefCreatureInstances : reefIds;
  const habitatInstances = reconcileHabitatZone(current?.habitatInstances ?? [], habitatSource);
  const reefCreatureInstances = reconcileCreatureZone(current?.reefCreatureInstances ?? [], reefSource, "opponent-reef");
  const orphanCreatures = reconcileCreatureZone(current?.orphanCreatures ?? [], next?.orphanCreatures ?? [], "opponent-orphan");
  return {
    ...next,
    habitats: habitatInstances.map((instance) => instance.cardId),
    habitatInstances,
    reefCreatures: reefCreatureInstances.map((instance) => instance.cardId),
    reefCreatureInstances,
    orphanCreatures,
  };
}

function createCoralSlots(card, coralId, idPrefix = coralId) {
  return (card.slots ?? []).flatMap((slot, index) => {
    const count = slot.count ?? 1;
    return Array.from({ length: count }).map((_, slotIndex) => ({
      ...slot,
      count: 1,
      id: `${idPrefix}-${index}-${slotIndex}`,
      cardId: null,
      cardInstanceId: null,
      hostedCardIds: [],
      position: null,
    }));
  });
}

function getSlotIdentity(slot) {
  const zone = slot.zone ?? "reef";
  const slotClass = slot.slotClass ?? slot.slotType ?? slot.class ?? "any";
  return `${zone}:${slotClass}`;
}

function mergeUpgradedCoralSlots(existingSlots, nextCard, coralId) {
  const nextSlots = createCoralSlots(nextCard, coralId, `${coralId}-${nextCard.id}`);
  const unusedExistingSlots = [...existingSlots];

  const mergedSlots = nextSlots.map((nextSlot) => {
    const matchingIndex = unusedExistingSlots.findIndex(
      (existingSlot) => getSlotIdentity(existingSlot) === getSlotIdentity(nextSlot),
    );
    if (matchingIndex === -1) return nextSlot;

    const [existingSlot] = unusedExistingSlots.splice(matchingIndex, 1);
    return {
      ...nextSlot,
      id: existingSlot.id,
      cardId: existingSlot.cardId,
      cardInstanceId: existingSlot.cardInstanceId ?? null,
      hostedCardIds: existingSlot.hostedCardIds ?? [],
      position: existingSlot.position,
    };
  });

  return [...mergedSlots, ...unusedExistingSlots.filter((slot) => slot.cardId)];
}

function removeOneCard(cards, cardId) {
  const index = cards.indexOf(cardId);
  if (index === -1) return cards;
  return [...cards.slice(0, index), ...cards.slice(index + 1)];
}

function removeLastCard(cards, cardId) {
  const index = cards.lastIndexOf(cardId);
  if (index === -1) return cards;
  return [...cards.slice(0, index), ...cards.slice(index + 1)];
}

function getPlacementCoordinates(event, zoom, offset) {
  const rect = event.currentTarget.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;
  const worldX = centerX + (screenX - centerX - offset.x) / zoom;
  const worldY = centerY + (screenY - centerY - offset.y) / zoom;
  return {
    x: (worldX / rect.width) * 100,
    y: (worldY / rect.height) * 100,
  };
}

function getBracketSlotPositions(count) {
  // place anchors evenly around the coral in a circle to avoid overlap
  const positions = [];
  const radiusBase = 150; // percent of the coral box, larger to keep anchors outside the card frame
  const radius = radiusBase + Math.max(0, count - 4) * 10;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2; // start at top
    const left = 50 + Math.cos(angle) * radius;
    const top = 50 + Math.sin(angle) * radius;
    positions.push({ top: `${top}%`, left: `${left}%` });
  }
  return positions;
}

function getOpponentSlotPositions(count) {
  const positions = [];
  const radius = 105 + Math.max(0, count - 4) * 8;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    positions.push({
      top: `${50 + Math.sin(angle) * radius}%`,
      left: `${50 + Math.cos(angle) * radius}%`,
    });
  }
  return positions;
}

function getOpponentCoralGridOffset(index, total) {
  if (total <= 1) return { x: 0, y: 0 };
  const columns = Math.min(3, total);
  const rows = Math.ceil(total / columns);
  const row = Math.floor(index / columns);
  const firstIndexInRow = row * columns;
  const itemsInRow = Math.min(columns, total - firstIndexInRow);
  const column = index - firstIndexInRow;
  return {
    x: (column - (itemsInRow - 1) / 2) * 700,
    y: (row - (rows - 1) / 2) * 780,
  };
}

function getSlotIconPath(slot) {
  if (!slot) return "/images/icons/any-creature.png";
  const rawZone = slot.zone ? slot.zone.replace("your_", "").replace("opponent_", "") : "reef";
  const zone = rawZone === "ocean" ? "oceanic" : rawZone;
  const cls = slot.slotClass || slot.slotType || slot.class || "any";

  if (cls === "any") return "/images/icons/any-creature.png";
  if (cls === "filter-feeder") return "/images/icons/filter-feeder-any.png";

  if (zone && cls) {
    if (zone === "reef" && cls === "apex") {
      return "/images/icons/reef-apex_icon.png";
    }
    return `/images/icons/${zone}-${cls}-icon.png`;
  }

  if (cls) {
    if (cls === "apex") return "/images/icons/apex-any.png";
    return `/images/icons/${cls}-icon.png`;
  }

  return "/images/icons/any-creature.png";
}

function getSlotConnectorStyle(position) {
  const dx = Number(position.left.replace("%", "")) - 50;
  const dy = Number(position.top.replace("%", "")) - 50;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  return {
    width: `${distance}%`,
    height: "2px",
    top: `${50 + dy / 2}%`,
    left: `${50 + dx / 2}%`,
    transform: `translateX(-50%) rotate(${angle}rad)`,
  };
}

export default function Simulator() {
  const [initialGame] = useState(() => createInitialGameState(defaultDeckId, defaultDeckId, createSeededRandom(0x5ea9a15)));
  const [selectedDeckId, setSelectedDeckId] = useState(defaultDeckId);
  const [selectedOpponentDeckId, setSelectedOpponentDeckId] = useState(defaultDeckId);
  const [opponentDifficulty, setOpponentDifficulty] = useState(OpponentDifficulty.MEDIUM);
  const [pendingOpponentDifficulty, setPendingOpponentDifficulty] = useState(OpponentDifficulty.MEDIUM);
  const [victoryTarget, setVictoryTarget] = useState(30);
  const [pendingVictoryTarget, setPendingVictoryTarget] = useState(30);
  const [foundationDeck, setFoundationDeck] = useState(initialGame.foundationDeck);
  const [palsDeck, setPalsDeck] = useState(initialGame.palsDeck);
  const [hand, setHand] = useState(initialGame.hand);
  const [playerCorals, setPlayerCorals] = useState([]);
  const [playerHabitatInstances, setPlayerHabitatInstances] = useState([]);
  const [playerReefCreatureInstances, setPlayerReefCreatureInstances] = useState([]);
  const [playerOrphanCreatureInstances, setPlayerOrphanCreatureInstances] = useState([]);
  const [bubbleBursts, setBubbleBursts] = useState([]);
  const [opponent, setOpponentState] = useState(() => reconcileOpponentInstances(initialGame.opponent, initialGame.opponent));
  const [opponentThinking, setOpponentThinking] = useState(false);
  const opponentThinkingTimerRef = useRef(null);
  const resolveOpponentTurnRef = useRef(null);
  const [draggingCoralId, setDraggingCoralId] = useState(null);
  const [slotDragStart, setSlotDragStart] = useState(null);
  const [coralDragStart, setCoralDragStart] = useState(null);
  const [floatingCardOffsets, setFloatingCardOffsets] = useState({});
  const [floatingCardDrag, setFloatingCardDrag] = useState(null);
  const floatingCardWasDraggedRef = useRef(false);
  const [ecosystemZoom, setEcosystemZoom] = useState(1);
  const [ecosystemOffset, setEcosystemOffset] = useState({ x: 0, y: 0 });
  const [opponentEcosystemZoom, setOpponentEcosystemZoom] = useState(1);
  const [opponentEcosystemOffset, setOpponentEcosystemOffset] = useState({ x: 0, y: 0 });
  const [opponentViewportTouched, setOpponentViewportTouched] = useState(false);
  const [mobileBoardView, setMobileBoardView] = useState("player");
  const [mobileHudPanel, setMobileHudPanel] = useState(null);
  const ecosystemRef = useRef(null);
  const opponentEcosystemRef = useRef(null);
  const coralWasDraggedRef = useRef(false);
  const slotWasDraggedRef = useRef(false);
  const slotDragStartRef = useRef(null);
  const bubbleBurstIdRef = useRef(0);
  const bubbleBurstTimersRef = useRef(new Set());
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const [isOpponentPanning, setIsOpponentPanning] = useState(false);
  const [opponentPanStart, setOpponentPanStart] = useState(null);
  const [discardPile, setDiscardPile] = useState([]);
  const [lostZone, setLostZone] = useState([]);
  const [conditionDeck, setConditionDeck] = useState(initialGame.conditionDeck);
  const [activeConditionId, setActiveConditionId] = useState(null);
  const [persistentConditionIds, setPersistentConditionIds] = useState([]);
  const [conditionDensityUses, setConditionDensityUses] = useState({});
  const [blueCrabRecycleUsedTurn, setBlueCrabRecycleUsedTurn] = useState(null);
  const [resilienceUsedCardIds, setResilienceUsedCardIds] = useState([]);
  const [round, setRound] = useState(0);
  const [gamePhase, setGamePhase] = useState("setup");
  const [roundFlash, setRoundFlash] = useState(false);
  const [turn, setTurn] = useState(1);
  const [rp, setRp] = useState(3);
  const [hasDrawnThisTurn, setHasDrawnThisTurn] = useState(false);
  const [turnDrawSelection, setTurnDrawSelection] = useState(null);
  const [turnDrawResult, setTurnDrawResult] = useState(null);
  const [actionBlinkOn, setActionBlinkOn] = useState(true);
  const [modal, setModal] = useState(null);
  const [selectedHandCard, setSelectedHandCard] = useState(null);
  const [handPopoverCardId, setHandPopoverCardId] = useState(null);
  const [playingCardId, setPlayingCardId] = useState(null);
  const [playError, setPlayError] = useState("");
  const [usedAttackers, setUsedAttackers] = useState([]);
  const [actionCooldowns, setActionCooldowns] = useState({});
  const [usedCreatureActions, setUsedCreatureActions] = useState([]);
  const [pendingCreatureAction, setPendingCreatureAction] = useState(null);
  const [creatureStatuses, setCreatureStatuses] = useState({});
  const [poisonImmunityNextPredatorAttack, setPoisonImmunityNextPredatorAttack] = useState(false);
  const [rovLightsActive, setRovLightsActive] = useState(false);
  const [nextOnPlayAttackBonus, setNextOnPlayAttackBonus] = useState(null);
  const [supportLockSourceId, setSupportLockSourceId] = useState(null);
  const [supportBlockedUntilRound, setSupportBlockedUntilRound] = useState(0);
  const [attackContext, setAttackContext] = useState(null);
  const [searchContext, setSearchContext] = useState(null);
  const [gameResult, setGameResult] = useState(null);
  const [inspectedCard, setInspectedCard] = useState(null);
  const [eventOverlay, setEventOverlay] = useState(() => ({
    type: "new-game-setup",
    initial: true,
    title: "Welcome to the SeaPals Simulator",
    message: "Learn SeaPals by building an ecosystem one legal action at a time. Choose a deck for each side and a victory target, then begin the setup round with four Foundation and four Pals cards.",
  }));
  const [pendingEvents, setPendingEvents] = useState([]);
  const [faceoffRolling, setFaceoffRolling] = useState(false);
  const [faceoffPreview, setFaceoffPreview] = useState(null);
  const [log, setLog] = useState(["New Coral Garden game started. Setup: play a base Coral or Creature School using your 3 RP."]);
  const [turnLog, setTurnLog] = useState(["Setup began with 3 RP and an eight-card hand."]);
  const opponentDifficultyProfile = getOpponentDifficultyProfile(opponentDifficulty);

  const playerHabitats = playerHabitatInstances.map((instance) => instance.cardId);
  const playerReefCreatures = playerReefCreatureInstances.map((instance) => instance.cardId);
  const playerOrphanCreatures = playerOrphanCreatureInstances;

  const getPlayerReefSlotId = (index) => `reef-${playerReefCreatureInstances[index]?.instanceId ?? index}`;
  const getOpponentReefSlotId = (index) => `reef-${opponent.reefCreatureInstances?.[index]?.instanceId ?? index}`;
  const getPlayerOrphanSlotId = (index) => `orphan-${playerOrphanCreatures[index]?.instanceId ?? index}`;
  const getOpponentOrphanSlotId = (index) => `orphan-${opponent.orphanCreatures?.[index]?.instanceId ?? index}`;
  const findZoneIndexBySlotId = (instances, slotId, prefix) => {
    const identity = String(slotId).slice(prefix.length);
    const stableIndex = (instances ?? []).findIndex((instance) => instance?.instanceId === identity);
    if (stableIndex >= 0) return stableIndex;
    const legacyIndex = Number(identity);
    return Number.isInteger(legacyIndex) ? legacyIndex : -1;
  };

  function setPlayerHabitats(update) {
    setPlayerHabitatInstances((current) => {
      const currentIds = current.map((instance) => instance.cardId);
      const nextEntries = typeof update === "function" ? update(currentIds) : update;
      return reconcileHabitatZone(current, nextEntries ?? []);
    });
  }

  function setPlayerReefCreatures(update) {
    setPlayerReefCreatureInstances((current) => {
      const currentIds = current.map((instance) => instance.cardId);
      const nextEntries = typeof update === "function" ? update(currentIds) : update;
      return reconcileCreatureZone(current, nextEntries ?? [], "player-reef");
    });
  }

  function setPlayerOrphanCreatures(update) {
    setPlayerOrphanCreatureInstances((current) => {
      const nextEntries = typeof update === "function" ? update(current) : update;
      return reconcileCreatureZone(current, nextEntries ?? [], "player-orphan");
    });
  }

  function queueBubbleBurst(x, y) {
    const id = ++bubbleBurstIdRef.current;
    const burst = {
      id,
      x: Math.min(96, Math.max(4, Number(x) || 50)),
      y: Math.min(92, Math.max(8, Number(y) || 50)),
    };
    setBubbleBursts((current) => [...current, burst]);
    const timer = window.setTimeout(() => {
      setBubbleBursts((current) => current.filter((entry) => entry.id !== id));
      bubbleBurstTimersRef.current.delete(timer);
    }, 2300);
    bubbleBurstTimersRef.current.add(timer);
  }

  function queueBubbleBurstAtClientPoint(clientX, clientY) {
    const ecosystem = ecosystemRef.current;
    if (!ecosystem) return;
    const rect = ecosystem.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    queueBubbleBurst(
      ((clientX - rect.left) / rect.width) * 100,
      ((clientY - rect.top) / rect.height) * 100,
    );
  }

  function queueBubbleBurstForSlot(slotId) {
    const ecosystem = ecosystemRef.current;
    if (!ecosystem) return;
    const slotElement = [...ecosystem.querySelectorAll("[data-slot-id]")]
      .find((element) => element.dataset.slotId === slotId);
    if (!slotElement) return;
    const ecosystemRect = ecosystem.getBoundingClientRect();
    const slotRect = slotElement.getBoundingClientRect();
    queueBubbleBurst(
      ((slotRect.left + slotRect.width / 2 - ecosystemRect.left) / ecosystemRect.width) * 100,
      ((slotRect.top + slotRect.height / 2 - ecosystemRect.top) / ecosystemRect.height) * 100,
    );
  }

  useEffect(() => () => {
    bubbleBurstTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    bubbleBurstTimersRef.current.clear();
  }, []);

  function projectNormalizedPlayerState(projectedState) {
    const projectedCorals = projectedState.corals ?? playerCorals;
    const projectedReefInstances = projectedState.reefCreatureInstances ?? playerReefCreatureInstances;
    const projectedOrphans = projectedState.orphanCreatureInstances ?? playerOrphanCreatureInstances;
    const healthResult = reconcileFoundationHealthToFixedPoint(projectedCorals, projectedReefInstances, projectedOrphans);
    const projectedHabitatCardIds = projectedState.habitatInstances?.map((instance) => instance.cardId)
      ?? projectedState.habitats
      ?? playerHabitats;
    const projectedOtherCards = [
      ...projectedHabitatCardIds,
      ...projectedReefInstances.map((instance) => instance.cardId),
      ...healthResult.orphans.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])]),
    ];
    const projectedRp = Number(projectedState.rp ?? rp);
    const nextRp = Math.min(projectedRp, getEcosystemRpCap(healthResult.corals, projectedOtherCards, activeCondition));
    if (!healthResult.changed && nextRp === projectedRp) return { state: projectedState, collateral: null };
    if (!healthResult.destroyed.length) return { state: { ...projectedState, corals: healthResult.corals, rp: nextRp }, collateral: null };
    const projectedHand = projectedState.hand ?? hand;
    const handLimit = Number((activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit")?.amount ?? Infinity);
    const triggerResult = resolveFoundationDestructionTriggers(healthResult.destructionWaves, projectedHand, projectedState.discardPile ?? discardPile, handLimit);
    return {
      state: {
        ...projectedState,
        corals: healthResult.corals,
        orphanCreatureInstances: healthResult.orphans,
        hand: triggerResult.hand,
        discardPile: triggerResult.discardPile,
        rp: nextRp,
      },
      collateral: {
        owner: "player",
        destroyed: healthResult.destroyed.map(({ id, cardId }) => ({ id, cardId })),
        orphanCount: healthResult.orphans.length,
        fragmentTriggers: triggerResult.triggers,
        rpLost: Math.max(0, projectedRp - nextRp),
      },
    };
  }

  function normalizeProjectedPlayerState(projectedState) {
    return projectNormalizedPlayerState(projectedState).state;
  }

  function projectNormalizedOpponentState(projectedState) {
    const healthResult = reconcileFoundationHealthToFixedPoint(projectedState.corals ?? [], projectedState.reefCreatureInstances ?? projectedState.reefCreatures ?? [], projectedState.orphanCreatures ?? []);
    const opponentHabitatCardIds = projectedState.habitatInstances?.map((instance) => instance.cardId)
      ?? projectedState.habitats
      ?? [];
    const opponentOtherCards = [
      ...opponentHabitatCardIds,
      ...(projectedState.reefCreatures ?? []),
      ...healthResult.orphans.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])]),
    ];
    const projectedRp = Number(projectedState.rp ?? 0);
    const nextRp = Math.min(projectedRp, getEcosystemRpCap(healthResult.corals, opponentOtherCards, activeCondition));
    if (!healthResult.changed && nextRp === projectedRp) return { state: projectedState, collateral: null };
    if (!healthResult.destroyed.length) return { state: { ...projectedState, corals: healthResult.corals, rp: nextRp }, collateral: null };
    const handLimit = Number((activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit")?.amount ?? Infinity);
    const triggerResult = resolveFoundationDestructionTriggers(healthResult.destructionWaves, projectedState.hand ?? [], projectedState.discardPile ?? [], handLimit);
    return {
      state: {
        ...projectedState,
        corals: healthResult.corals,
        orphanCreatures: healthResult.orphans,
        hand: triggerResult.hand,
        discardPile: triggerResult.discardPile,
        rp: nextRp,
      },
      collateral: {
        owner: "opponent",
        destroyed: healthResult.destroyed.map(({ id, cardId }) => ({ id, cardId })),
        orphanCount: healthResult.orphans.length,
        fragmentTriggers: triggerResult.triggers,
        rpLost: Math.max(0, projectedRp - nextRp),
      },
    };
  }

  function normalizeProjectedOpponentState(projectedState) {
    return projectNormalizedOpponentState(projectedState).state;
  }

  function getContinuousHealthCollapseMessage(collateral) {
    if (!collateral?.destroyed?.length) return "";
    const ownerLabel = collateral.owner === "player" ? "Your" : "The opponent's";
    const names = collateral.destroyed.map((entry) => cardsById[entry.cardId]?.name ?? "foundation card");
    const destroyedNames = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    const foundationLabel = names.length === 1 ? "foundation" : "foundations";
    const fragmentMessages = (collateral.fragmentTriggers ?? []).map((trigger) => {
      const recoveredName = cardsById[trigger.targetCardId]?.name ?? "matching card";
      if (trigger.cardsToHand.length) return `Fragment returned ${trigger.cardsToHand.length} ${recoveredName}${trigger.cardsToHand.length === 1 ? "" : " cards"} to hand.`;
      if (trigger.cardsToDiscard.length) return `Fragment found ${recoveredName}, but the active hand limit kept it in discard.`;
      return `Fragment triggered but found no ${recoveredName} in discard.`;
    });
    const orphanMessage = collateral.orphanCount
      ? `${collateral.orphanCount} creature${collateral.orphanCount === 1 ? "" : "s"} now remain orphaned on ${collateral.owner === "player" ? "your" : "the opponent's"} reef.`
      : "All attached creatures found another legal space.";
    const rpMessage = collateral.rpLost ? ` The RP bank cap also fell, returning ${collateral.rpLost} excess RP.` : "";
    return `${ownerLabel} ${foundationLabel} ${destroyedNames} collapsed because a continuous health bonus ended. ${orphanMessage}${rpMessage}${fragmentMessages.length ? ` ${fragmentMessages.join(" ")}` : ""}`;
  }

  function buildContinuousHealthCollapseEvent(collateral, { sourceCardId = null, playerStateAfter = null, opponentStateAfter = null, opponentSequence = false } = {}) {
    if (!collateral?.destroyed?.length) return null;
    const isPlayer = collateral.owner === "player";
    const message = getContinuousHealthCollapseMessage(collateral);
    return {
      type: "opponent-impact",
      sourceCardId: sourceCardId ?? collateral.destroyed[0].cardId,
      defenderCardId: sourceCardId ? collateral.destroyed[0].cardId : null,
      title: isPlayer ? "Your Foundation Collapsed" : "Opponent Foundation Collapsed",
      message,
      success: !isPlayer,
      playerStateAfter,
      opponentStateAfter,
      logMessage: message,
      opponentSequence,
    };
  }

  function setOpponent(update) {
    setOpponentState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      return normalizeProjectedOpponentState(reconcileOpponentInstances(current, next));
    });
  }

  useEffect(() => () => {
    if (opponentThinkingTimerRef.current) clearTimeout(opponentThinkingTimerRef.current);
  }, []);

  useEffect(() => {
    const replaceCardArt = (image) => {
      if (!(image instanceof HTMLImageElement) || !image.closest(".seapals-game-shell") || image.dataset.cardArtFallback === "true") return;
      image.dataset.cardArtFallback = "true";
      image.src = CARD_ART_FALLBACK;
    };
    const replaceMissingCardArt = (event) => replaceCardArt(event.target);
    const watchImage = (image) => {
      if (!(image instanceof HTMLImageElement) || image.dataset.cardArtWatched === "true") return;
      image.dataset.cardArtWatched = "true";
      image.addEventListener("error", replaceMissingCardArt, { once: true });
      if (image.complete && image.naturalWidth === 0) replaceCardArt(image);
    };
    const replaceAlreadyBrokenCardArt = () => document.querySelectorAll(".seapals-game-shell img").forEach((image) => {
      watchImage(image);
    });
    document.addEventListener("error", replaceMissingCardArt, true);
    const imageObserver = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (node.matches("img")) watchImage(node);
      node.querySelectorAll?.("img").forEach(watchImage);
    })));
    const shell = document.querySelector(".seapals-game-shell");
    if (shell) imageObserver.observe(shell, { childList: true, subtree: true });
    const scanTimer = window.setTimeout(replaceAlreadyBrokenCardArt, 300);
    return () => {
      document.removeEventListener("error", replaceMissingCardArt, true);
      imageObserver.disconnect();
      window.clearTimeout(scanTimer);
    };
  }, []);

  useEffect(() => {
    resolveOpponentTurnRef.current = resolveOpponentTurn;
  });

  const activeCondition = activeConditionId ? cardsById[activeConditionId] : null;
  const persistentConditions = persistentConditionIds.map((conditionId) => cardsById[conditionId]).filter(Boolean);
  const unsupportedConditionEffects = getUnsupportedConditionEffects(activeCondition);
  const isSetup = gamePhase === "setup";
  const isStartOfTurn = gamePhase === "draw" && !hasDrawnThisTurn;
  const hasCoralInPlay = playerCorals.length > 0;
  const startTurnRp = getEcosystemStartTurnRp(playerCorals, activeCondition);
  const playerRpCap = getEcosystemRpCap(playerCorals, [...playerHabitats, ...playerReefCreatures, ...playerOrphanCreatures.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])], activeCondition);
  const opponentRpCap = getEcosystemRpCap(opponent.corals, [...opponent.habitats, ...opponent.reefCreatures, ...(opponent.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])], activeCondition);
  const playerVp = getEcosystemVictoryPoints(playerCorals, playerHabitats, [...playerReefCreatures, ...playerOrphanCreatures.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])]);
  const opponentCorals = opponent.corals;
  const playerCoralCards = playerCorals.filter((foundation) => cardsById[foundation.cardId]?.kind === CardKind.CORAL);
  const opponentCoralCards = opponentCorals.filter((foundation) => cardsById[foundation.cardId]?.kind === CardKind.CORAL);
  const opponentLayoutSignature = [
    ...opponentCorals.map((coral) => `${coral.id}:${coral.slots.map((slot) => `${slot.cardId ?? "_"}:${(slot.hostedCardIds ?? []).filter(Boolean).join(",")}`).join(";")}`),
    ...opponent.habitatInstances.map((instance) => `habitat:${instance.instanceId}`),
    ...(opponent.reefCreatureInstances ?? []).map((instance) => `reef:${instance.instanceId}`),
    ...(opponent.orphanCreatures ?? []).map((instance) => `orphan:${instance.instanceId}:${(instance.hostedCardIds ?? []).filter(Boolean).join(",")}`),
  ].join("|");
  const opponentVp = getEcosystemVictoryPoints(opponentCorals, opponent.habitats, [...opponent.reefCreatures, ...(opponent.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])]);
  const playerSchoolDensity = getSchoolDensity(playerCorals);
  const opponentSchoolDensity = getSchoolDensity(opponentCorals);
  const schoolDensityConditionIds = [...new Set([activeConditionId, ...persistentConditionIds].filter(Boolean))];
  const playingCard = playingCardId ? cardsById[playingCardId] : null;
  const inspectedCardData = inspectedCard ? cardsById[inspectedCard.cardId] : null;
  const inspectedCreatureSlot = inspectedCard?.owner === "player" && inspectedCard.coralId
    ? playerCorals.find((coral) => coral.id === inspectedCard.coralId)?.slots.find((slot) => slot.id === inspectedCard.slotId)
    : null;
  const inspectedActionKey = inspectedCreatureSlot ? getSlotActionKey(inspectedCreatureSlot) : inspectedCard?.slotId;
  const isPlacingCoral = Boolean(isFoundationCard(playingCard) && Number(playingCard.stage ?? 0) === 0);
  const isUpgradingCoral = Boolean(isFoundationCard(playingCard) && Number(playingCard.stage ?? 0) > 0);
  const upgradeableCoralIds = new Set(
    isUpgradingCoral
      ? playerCorals
          .filter((coral) => {
            const currentCard = cardsById[coral.cardId];
            const upgradeCost = Number(currentCard?.upgrade?.cost?.rp ?? playingCard?.cost?.rp ?? 0);
            return (
              currentCard?.upgrade?.canUpgrade &&
              currentCard.upgrade.nextCardId === playingCardId &&
              turn > (coral.stageEnteredTurn ?? coral.playedTurn ?? turn) &&
              rp >= upgradeCost
            );
          })
          .map((coral) => coral.id)
      : [],
  );

  useEffect(() => {
    setHasDrawnThisTurn(false);
  }, [turn]);

  useEffect(() => {
    setRp((current) => Math.min(current, playerRpCap));
  }, [playerRpCap]);

  useEffect(() => {
    setOpponent((current) => current.rp > opponentRpCap ? { ...current, rp: opponentRpCap } : current);
  }, [opponentRpCap]);

  useEffect(() => {
    if (!opponentLayoutSignature || opponentViewportTouched) return undefined;
    const frame = requestAnimationFrame(() => zoomEcosystemToFit("opponent"));
    return () => cancelAnimationFrame(frame);
  }, [opponentLayoutSignature, opponentViewportTouched, mobileBoardView]);

  useEffect(() => {
    const result = reconcileFoundationHealthToFixedPoint(playerCorals, playerReefCreatureInstances, playerOrphanCreatures);
    if (!result.changed) return;
    setPlayerCorals(result.corals);
    if (result.destroyed.length) setPlayerOrphanCreatures(result.orphans);
    if (result.destroyed.length) {
      const handLimit = Number((activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit")?.amount ?? Infinity);
      const triggerResult = resolveFoundationDestructionTriggers(result.destructionWaves, hand, discardPile, handLimit);
      setDiscardPile(triggerResult.discardPile);
      if (triggerResult.hand !== hand) setHand(triggerResult.hand);
      const fragmentMessage = triggerResult.triggers.map((trigger) => trigger.cardsToHand.length + trigger.cardsToDiscard.length
        ? ` Fragment found ${[...trigger.cardsToHand, ...trigger.cardsToDiscard].map((cardId) => cardsById[cardId]?.name).join(" and ")}.${trigger.cardsToHand.length ? ` ${trigger.cardsToHand.length} moved to your hand.` : ""}${trigger.cardsToDiscard.length ? ` ${trigger.cardsToDiscard.length} remained in discard because of the hand limit.` : ""}`
        : ` Fragment triggered but found no ${cardsById[trigger.targetCardId]?.name ?? "matching card"} to recover.`).join("");
      pushLog(`${result.destroyed.map((foundation) => cardsById[foundation.cardId]?.name).join(", ")} was destroyed when a continuous coral-health bonus ended. Its creatures filled compatible open slots; ${result.orphans.length} remain orphaned on your reef.${fragmentMessage}`);
    }
  }, [playerCorals, playerReefCreatures]);

  useEffect(() => {
    const result = reconcileFoundationHealthToFixedPoint(opponent.corals, opponent.reefCreatureInstances ?? opponent.reefCreatures, opponent.orphanCreatures);
    if (!result.changed) return;
    setOpponent((current) => {
      if (!result.destroyed.length) return { ...current, corals: result.corals };
      const handLimit = Number((activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit")?.amount ?? Infinity);
      const triggerResult = resolveFoundationDestructionTriggers(result.destructionWaves, current.hand, current.discardPile, handLimit);
      return { ...current, corals: result.corals, orphanCreatures: result.orphans, hand: triggerResult.hand, discardPile: triggerResult.discardPile };
    });
    if (result.destroyed.length) pushLog(`Opponent lost ${result.destroyed.map((foundation) => cardsById[foundation.cardId]?.name).join(", ")} when a continuous coral-health bonus ended.`);
  }, [opponent.corals, opponent.reefCreatures]);

  useEffect(() => {
    if (["setup", "opponent", "transition"].includes(gamePhase) || opponentThinking || eventOverlay?.opponentSequence || pendingEvents.some((event) => event.opponentSequence)) return;
    if (eventOverlay?.type === "choose-regenerate" || pendingEvents.some((event) => event.type === "choose-regenerate")) return;
    const eventRequiresResolution = String(eventOverlay?.type ?? "").startsWith("choose-")
      || ["onplay-target-prompt", "faceoff-ready", "school-attack-ready"].includes(eventOverlay?.type);
    if (playingCardId || attackContext || searchContext || pendingCreatureAction || faceoffRolling || eventRequiresResolution) return;
    const result = determineVictoryResult(playerVp, opponentVp, victoryTarget);
    if (!result) return;
    setGameResult((current) => {
      if (current) return current;
      return result.message;
    });
  }, [gamePhase, playerVp, opponentVp, victoryTarget, opponentThinking, eventOverlay?.type, eventOverlay?.opponentSequence, pendingEvents, playingCardId, attackContext, searchContext, pendingCreatureAction, faceoffRolling]);

  useEffect(() => {
    if (!faceoffRolling || !["faceoff-ready", "school-attack-ready"].includes(eventOverlay?.type)) return;
    const updatePreview = () => {
      const attackRoll = rollDie(eventOverlay.attackDice);
      const defenseRoll = eventOverlay.type === "faceoff-ready" ? rollDie(eventOverlay.defenseDice) : null;
      if (attackRoll && (eventOverlay.type === "school-attack-ready" || defenseRoll)) setFaceoffPreview({ attack: attackRoll.total, defense: defenseRoll?.total ?? 0 });
    };
    updatePreview();
    const interval = setInterval(updatePreview, 90);
    return () => clearInterval(interval);
  }, [faceoffRolling, eventOverlay]);

  useEffect(() => {
    if (round === 0) return;
    setRoundFlash(true);
    const timeout = setTimeout(() => setRoundFlash(false), 1400);
    return () => clearTimeout(timeout);
  }, [round]);

  useEffect(() => {
    if (!isPlacingCoral && !isUpgradingCoral) {
      setActionBlinkOn(true);
      return;
    }

    const interval = setInterval(() => setActionBlinkOn((value) => !value), 500);
    return () => clearInterval(interval);
  }, [isPlacingCoral, isUpgradingCoral]);

  useEffect(() => {
    if (modal === "hand" && hand.length) {
      setSelectedHandCard((current) => {
        const next = current && hand.includes(current) ? current : hand[0];
        setPlayError("");
        return next;
      });
    }
    if (modal !== "hand") {
      setSelectedHandCard(null);
      setPlayError("");
    }
  }, [modal, hand]);

  useEffect(() => {
    if (modal) setMobileHudPanel(null);
  }, [modal]);

  function getPlayerCardPlayCost(card) {
    return Math.max(0, getCardPlayCost(card, activeCondition) + getOpposingPlayCostModifier(card, opponentCorals, opponent.reefCreatures, opponent.orphanCreatures));
  }

  function getPlayerSchoolDensityRequirement(card) {
    return getEffectiveSchoolDensityRequirement(card, schoolDensityConditionIds, conditionDensityUses);
  }

  function consumePlayerSchoolDensityDiscount(card) {
    const result = consumeSchoolDensityConditionDiscount(card, schoolDensityConditionIds, conditionDensityUses);
    if (!result.discount) return null;
    setConditionDensityUses(result.usedByCondition);
    pushLog(`${result.discount.label} reduced ${card.name}'s School Density requirement by ${result.discount.amount}. Your one-time reduction from this condition is now used.`);
    return result.discount;
  }

  function getPlayError(card) {
    if (!card) return "Select a card first.";
    if (gameResult) return "This game has ended. Start a new game to continue playing.";
    if (attackContext) return "Finish or cancel the current attack before playing another card.";
    if (!isSetup && gamePhase !== "main") return "Cards can only be played during your Build phase.";
    if (isSetup && !(isFoundationCard(card) && Number(card.stage ?? 0) === 0)) {
      return "During setup, play a base Coral or Creature School before the first round begins.";
    }
    const conditionRestriction = getConditionPlayRestriction(card, activeCondition);
    if (conditionRestriction) return conditionRestriction;
    if (card.kind === CardKind.CREATURE && !isCreatureSchool(card) && !cardUsesOpponentReef(card) && !hasCoralInPlay) {
      return "You need a coral in play before you can slot this creature.";
    }
    const unmetRequirement = (card.playRequirements ?? []).find((requirement) => {
      if (requirement.type === "kindInPlay" && requirement.requiredKind === CardKind.HABITAT) return !playerHabitats.length;
      if (requirement.type === "cardInPlay" && requirement.requiredKind === CardKind.HABITAT) {
        return !playerHabitats.includes(requirement.cardId);
      }
      return false;
    });
    if (unmetRequirement) return unmetRequirement.text ?? "You do not meet this card's play requirement.";
    const habitatRequirementError = getHabitatRequirementError(card, playerHabitats);
    if (habitatRequirementError) return habitatRequirementError;
    const compositionRequirementError = getCompositionRequirementError(card, playerCorals, [...playerReefCreatures, ...playerOrphanCreatures.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])]);
    if (compositionRequirementError) return compositionRequirementError;
    const densityRequirement = getPlayerSchoolDensityRequirement(card);
    if (densityRequirement.effectiveRequirement > playerSchoolDensity) {
      const discountMessage = densityRequirement.discount ? ` ${densityRequirement.discount.label} reduces its printed ${densityRequirement.printedRequirement} requirement to ${densityRequirement.effectiveRequirement}.` : "";
      return `${card.name} requires ${densityRequirement.effectiveRequirement} School Density, but your ecosystem has ${playerSchoolDensity}.${discountMessage}`;
    }
    if (cardUsesOpponentReef(card)) {
      const opponentCoralSlots = opponentCoralCards.flatMap((coral) => coral.slots ?? []);
      if (!opponentCoralSlots.length) return `${card.name} needs an opponent coral with a slot before it can invade.`;
      if (!opponentCoralSlots.some((slot) => !slot.cardId)) return `All opponent coral slots are occupied, so ${card.name} has nowhere to invade.`;
    } else if (card.kind === CardKind.CREATURE && card.zone !== CreatureZone.OCEAN && !isCreatureSchool(card)) {
      const compatibleSlots = playerCorals.flatMap((coral) =>
        coral.slots.filter((slot) => canCardOccupySlot(card, slot)),
      );
      const allowedHostTags = getSpecialPlacementHostTags(card);
      const compatibleHostSlots = allowedHostTags.length ? playerCorals.flatMap((coral) => coral.slots.filter((slot) => {
        const host = cardsById[slot.cardId];
        return host && allowedHostTags.some((tag) => host.tags?.includes(tag));
      })) : [];
      if (!compatibleSlots.length && !compatibleHostSlots.length) {
        return `None of your corals have a compatible slot for ${card.name}.`;
      }
      if (!compatibleSlots.some((slot) => !slot.cardId) && !compatibleHostSlots.some((slot) => canHostSpecialPlacement(cardsById[slot.cardId], card, slot.hostedCardIds))) {
        return compatibleHostSlots.length
          ? `All compatible slots and special host spaces for ${card.name} are occupied.`
          : `All compatible slots for ${card.name} are occupied.`;
      }
    }
    if (isFoundationCard(card) && Number(card.stage ?? 0) > 0) {
      const matchingCorals = playerCorals.filter((coral) => {
        const currentCard = cardsById[coral.cardId];
        return currentCard?.upgrade?.canUpgrade && currentCard.upgrade.nextCardId === card.id;
      });
      if (!matchingCorals.length) {
        return `You do not have the previous stage of ${card.name} in your ecosystem.`;
      }

      const matureCorals = matchingCorals.filter(
        (coral) => turn > (coral.stageEnteredTurn ?? coral.playedTurn ?? turn),
      );
      if (!matureCorals.length) {
        return `${card.name} must remain in your ecosystem for a full turn before it can be upgraded.`;
      }

      const minimumUpgradeCost = Math.min(
        ...matureCorals.map((coral) => Number(cardsById[coral.cardId]?.upgrade?.cost?.rp ?? card.cost?.rp ?? 0)),
      );
      if (rp < minimumUpgradeCost) {
        return `Not enough RP — this upgrade costs ${minimumUpgradeCost} RP.`;
      }
      return "";
    }
    if (card.kind === CardKind.SUPPORT) {
      if (round <= supportBlockedUntilRound) return `Echo Disruption prevents you from playing Support cards this turn.`;
      if (supportLockSourceId) return `${cardsById[supportLockSourceId]?.name ?? "A Support card"} says you cannot play another Support card this turn.`;
      const supportCost = getPlayerCardPlayCost(card);
      if (rp < supportCost) return `Not enough RP — ${card.name} costs ${supportCost} RP.`;
      if (card.id === "spearfishing") {
        const hasTarget = playerCorals.some((coral) => coral.slots.some((slot) => {
          const target = cardsById[slot.cardId];
          return target && [CardCategory.FISH, CardCategory.PREDATOR].includes(target.category);
        })) || playerReefCreatures.some((cardId) => [CardCategory.FISH, CardCategory.PREDATOR].includes(cardsById[cardId]?.category))
          || playerOrphanCreatures.some((entry) => [CardCategory.FISH, CardCategory.PREDATOR].includes(cardsById[entry.cardId]?.category));
        return hasTarget ? "" : "Spearfishing needs one of your Fish or Predators in play to discard.";
      }
      if (card.id === "whirlpool" || card.id === "super-whirlpool") return opponentCoralCards.length ? "" : `${card.name} needs an opponent coral to target.`;
      if (card.id === "coral-heal") return playerCoralCards.some((coral) => (coral.statuses ?? []).length || Number(coral.rpPenaltyNextTurn ?? 0) > 0) ? "" : "Coral Heal needs one of your corals to have a removable status effect.";
      if (card.id === "robotic-survey" || card.id === "explorer-jordan") return foundationDeck.length || palsDeck.length ? "" : `${card.name} cannot inspect a deck because both personal decks are empty.`;
      if (card.id === "poison-heal") return poisonImmunityNextPredatorAttack ? "Poison Heal is already protecting your next attack." : "";
      if (card.id === "rov-lights") {
        if (rovLightsActive) return "ROV Lights is already active for this turn.";
        const deepTargets = [...opponentCorals.flatMap((foundation) => foundation.slots.flatMap((slot) => getSlotCardIds(slot).map((cardId) => cardsById[cardId]))), ...(opponent.reefCreatures ?? []).map((cardId) => cardsById[cardId]), ...(opponent.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])].map((cardId) => cardsById[cardId]))].filter((target) => target?.zone === CreatureZone.DEEP);
        return deepTargets.length ? "" : "ROV Lights needs an opponent Deep creature to target this turn.";
      }
      if (card.id === "dr-evans") {
        return foundationDeck.length || palsDeck.length ? "" : "Dr. Evans cannot draw because both personal decks are empty.";
      }
      if (card.id === "coral-cement") {
        return playerCoralCards.some((coral) => (coral.health ?? coral.maxHealth) < coral.maxHealth)
          ? ""
          : "Coral Cement needs one of your corals to have damage before it can be played.";
      }
      if (card.id === "restocking") {
        const candidates = discardPile.filter((cardId) => {
          const candidate = cardsById[cardId];
          return candidate?.kind === CardKind.CREATURE && candidate.category === CardCategory.FISH;
        });
        return candidates.length ? "" : "Restocking needs a Fish in your discard pile.";
      }
      if (card.id === "recovery") return discardPile.length ? "" : "Recovery has no card to recover because your discard pile is empty.";
      if (card.id === "scientist-jes") {
        const searchEffect = (card.effects ?? []).find((effect) => effect.type === EffectType.SEARCH_DECK);
        const hasHabitatToSearch = [...foundationDeck, ...palsDeck].some((cardId) => cardMatchesSearchCriteria(cardsById[cardId], searchEffect));
        const hasCardToDraw = foundationDeck.length || palsDeck.length;
        return hasHabitatToSearch || hasCardToDraw
          ? ""
          : "Scientist Jes cannot be played because both personal decks are empty and no Habitat remains to search for.";
      }
      const searchEffect = (card.effects ?? []).find((effect) => effect.type === EffectType.SEARCH_DECK);
      if (!searchEffect) {
        return `${card.name} has a targeted or special effect that is not implemented yet.`;
      }
      const candidates = [...foundationDeck, ...palsDeck].filter((cardId) => {
        const candidate = cardsById[cardId];
        if (!candidate || candidate.kind !== searchEffect.targetKind) return false;
        if (searchEffect.targetCategories?.length && !searchEffect.targetCategories.includes(candidate.category)) return false;
        if (searchEffect.targetTags?.some((tag) => !candidate.tags?.includes(tag))) return false;
        if (searchEffect.excludeTags?.some((tag) => candidate.tags?.includes(tag))) return false;
        return true;
      });
      return candidates.length ? "" : `${card.name} has no matching card remaining in your decks.`;
    }
    const cost = getPlayerCardPlayCost(card);
    if (rp < cost) return `Not enough RP — need ${cost} RP.`;
    return "";
  }

  function clampZoom(zoom) {
    return Math.min(2.2, Math.max(0.12, zoom));
  }

  function zoomEcosystemToFit(owner) {
    const isOpponent = owner === "opponent";
    const element = isOpponent ? opponentEcosystemRef.current : ecosystemRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const corals = isOpponent ? opponentCorals : playerCorals;
    const floatingCardsPresent = isOpponent
      ? opponent.habitats.length || opponent.reefCreatures.length || (opponent.orphanCreatures?.length ?? 0)
      : playerHabitats.length || playerReefCreatures.length || playerOrphanCreatures.length;
    const positions = corals.map((coral, index) => {
      if (!isOpponent) return { x: coral.x, y: coral.y, absolute: false };
      const offset = getOpponentCoralGridOffset(index, corals.length);
      return { x: rect.width / 2 + offset.x, y: rect.height / 2 + offset.y + (floatingCardsPresent ? 360 : 0), absolute: true };
    });
    if (!positions.length && !floatingCardsPresent) {
      (isOpponent ? setOpponentEcosystemZoom : setEcosystemZoom)(1);
      (isOpponent ? setOpponentEcosystemOffset : setEcosystemOffset)({ x: 0, y: 0 });
      return;
    }
    const coralWidth = isOpponent ? 180 : 240;
    const coralHeight = isOpponent ? 210 : 280;
    const bounds = corals.flatMap((coral, coralIndex) => {
      const centerX = positions[coralIndex].absolute ? positions[coralIndex].x : (positions[coralIndex].x / 100) * rect.width;
      const centerY = positions[coralIndex].absolute ? positions[coralIndex].y : (positions[coralIndex].y / 100) * rect.height;
      const anchors = isOpponent ? getOpponentSlotPositions(coral.slots.length) : getBracketSlotPositions(coral.slots.length);
      const cardBounds = [{ minX: centerX - coralWidth / 2, maxX: centerX + coralWidth / 2, minY: centerY - coralHeight / 2, maxY: centerY + coralHeight / 2 }];
      coral.slots.forEach((slot, slotIndex) => {
        const position = slot.position ?? anchors[slotIndex];
        const slotX = centerX + (Number.parseFloat(position.left) - 50) / 100 * coralWidth;
        const slotY = centerY + (Number.parseFloat(position.top) - 50) / 100 * coralHeight;
        cardBounds.push({ minX: slotX - 70, maxX: slotX + 70, minY: slotY - 85, maxY: slotY + 85 });
      });
      return cardBounds;
    });
    if (floatingCardsPresent) bounds.push({ minX: 0, maxX: rect.width, minY: 0, maxY: 330 });
    const padding = 36;
    const minX = Math.min(...bounds.map((entry) => entry.minX)) - padding;
    const maxX = Math.max(...bounds.map((entry) => entry.maxX)) + padding;
    const minY = Math.min(...bounds.map((entry) => entry.minY)) - padding;
    const maxY = Math.max(...bounds.map((entry) => entry.maxY)) + padding;
    const nextZoom = clampZoom(Math.min((rect.width - 48) / Math.max(1, maxX - minX), (rect.height - 48) / Math.max(1, maxY - minY), 1.15));
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    const nextOffset = {
      x: (rect.width / 2 - contentCenterX) * nextZoom,
      y: (rect.height / 2 - contentCenterY) * nextZoom,
    };
    (isOpponent ? setOpponentEcosystemZoom : setEcosystemZoom)(nextZoom);
    (isOpponent ? setOpponentEcosystemOffset : setEcosystemOffset)(nextOffset);
  }

  function canUseSlotWithCard(slot, cardId) {
    const card = cardsById[cardId];
    if (!slot || !card) return false;
    return canCardOccupySlot(card, slot) && !slot.cardId;
  }

  function canHostCardInSlot(slot, cardId) {
    const hostCard = cardsById[slot?.cardId];
    const candidateCard = cardsById[cardId];
    return Boolean(hostCard && candidateCard && canHostSpecialPlacement(hostCard, candidateCard, slot.hostedCardIds));
  }

  function findCoralBySlotId(slotId) {
    return playerCorals.find((coral) => coral.slots.some((slot) => slot.id === slotId));
  }

  function getPlayerAttackTargets(attacker, attack, opponentState = opponent) {
    const canTargetHidden = cardCanTargetHiddenByAbyss(attacker, attack);
    const targets = (opponentState.corals ?? []).flatMap((coral) => coral.slots.flatMap((slot) => {
      const entries = [
        { cardId: slot.cardId, slotId: slot.id, instanceId: getSlotTargetInstanceId(slot), controller: slot.controller },
        ...(slot.hostedCardIds ?? []).map((cardId, hostedIndex) => ({ cardId, slotId: getHostedTargetSlotId(slot.id, hostedIndex), instanceId: `hosted:${getHostedTargetSlotId(slot.id, hostedIndex)}`, controller: slot.controller })),
      ];
      return entries.filter((entry) => {
        const targetCard = cardsById[entry.cardId];
        return entry.controller !== "player" && cardMatchesAttackTarget(targetCard, attack) && (!cardIsHiddenByAbyss(targetCard, opponentState.habitats) || canTargetHidden);
      }).map((entry) => ({ coralId: coral.id, slotId: entry.slotId, instanceId: entry.instanceId }));
    }));
    (opponentState.reefCreatureInstances ?? []).forEach((instance) => {
      const targetCard = cardsById[instance.cardId];
      if (cardMatchesAttackTarget(targetCard, attack) && (!cardIsHiddenByAbyss(targetCard, opponentState.habitats) || canTargetHidden)) {
        targets.push({ coralId: "__reef__", slotId: `reef-${instance.instanceId}`, instanceId: instance.instanceId });
      }
    });
    (opponentState.orphanCreatures ?? []).forEach((entry, orphanIndex) => {
      const orphanInstanceId = entry.instanceId ?? `legacy-${orphanIndex}`;
      const orphanTargets = [
        { cardId: entry.cardId, slotId: `orphan-${orphanInstanceId}`, instanceId: entry.instanceId ?? `orphan:${orphanInstanceId}` },
        ...(entry.hostedCardIds ?? []).flatMap((cardId, hostedIndex) => cardId ? [{
          cardId,
          slotId: getOrphanHostedTargetSlotId(orphanInstanceId, hostedIndex),
          instanceId: `hosted:${getOrphanHostedTargetSlotId(orphanInstanceId, hostedIndex)}`,
        }] : []),
      ];
      orphanTargets.forEach((entryTarget) => {
        const targetCard = cardsById[entryTarget.cardId];
        if (cardMatchesAttackTarget(targetCard, attack) && (!cardIsHiddenByAbyss(targetCard, opponentState.habitats) || canTargetHidden)) {
          targets.push({ coralId: "__orphan__", slotId: entryTarget.slotId, instanceId: entryTarget.instanceId });
        }
      });
    });
    (opponentState.corals ?? []).forEach((foundation) => {
      const targetCard = cardsById[foundation.cardId];
      if (isCreatureSchool(targetCard) && cardMatchesAttackTarget(targetCard, attack)) {
        targets.push({ coralId: foundation.id, slotId: "__foundation__", instanceId: `foundation:${foundation.id}` });
      }
    });
    return targets;
  }

  function createPlayerAttackContext(baseContext, attacker, attack, targets) {
    const repeatCount = getDynamicAttackRepeat(attacker, attack, playerCorals, playerReefCreatures, playerHabitats);
    const uniqueTargets = targets.filter((target, index, allTargets) => target.instanceId && allTargets.findIndex((candidate) => candidate.instanceId === target.instanceId) === index);
    return {
      ...baseContext,
      targets: uniqueTargets,
      allTargets: uniqueTargets,
      sequence: createAttackSequence(repeatCount),
      costCommitted: false,
    };
  }

  function commitPlayerAttackCost(context, attacker, attack) {
    if (context.costCommitted) return;
    const attackerActionKey = context.attackerActionKey ?? context.attackerSlotId;
    if (!context.onPlay) setUsedAttackers((current) => current.includes(attackerActionKey) ? current : [...current, attackerActionKey]);
    if (!context.onPlay && attack.skipNextTurn) setActionCooldowns((current) => ({ ...current, [attackerActionKey]: turn + 2 }));
    setRp((current) => Math.max(0, current - attack.actionCost));
    if (poisonImmunityNextPredatorAttack) setPoisonImmunityNextPredatorAttack(false);
  }

  function completePlayerAttackStep(targetInstanceId, resolution, { attackerSurvives = true, invalidTargetInstanceIds = [], nextTargets = null } = {}) {
    const recorded = recordAttackResolution(attackContext?.sequence ?? createAttackSequence(1), { targetInstanceId, resolution });
    if (!recorded.accepted) {
      pushLog(recorded.error);
      return { continues: false, complete: true, error: recorded.error };
    }
    const invalidTargets = new Set(invalidTargetInstanceIds);
    const targetPool = nextTargets ?? attackContext?.allTargets ?? attackContext?.targets ?? [];
    const remainingTargets = getRemainingAttackTargets(recorded.sequence, targetPool).filter((target) => !invalidTargets.has(target.instanceId));
    const continues = attackerSurvives && !recorded.sequence.complete && remainingTargets.length > 0;
    if (continues) {
      setAttackContext({ ...attackContext, sequence: recorded.sequence, targets: remainingTargets, allTargets: targetPool, costCommitted: true });
    } else {
      setAttackContext(null);
      setInspectedCard(null);
    }
    return {
      continues,
      complete: !continues,
      resolvedCount: recorded.sequence.resolutions.length,
      requiredCount: recorded.sequence.requiredAttacks,
      stoppedForNoTargets: attackerSurvives && !recorded.sequence.complete && remainingTargets.length === 0,
    };
  }

  function getAttackSequenceContinuationMessage(sequenceResult) {
    if (sequenceResult?.continues) return ` This was attack ${sequenceResult.resolvedCount} of ${sequenceResult.requiredCount}; close this result and choose a different highlighted target.`;
    if (sequenceResult?.stoppedForNoTargets) return " No different legal targets remain, so the repeated attack ends.";
    return "";
  }

  function damageOpponentFoundation(coralId, amount, sourceCard) {
    if (!amount || !opponentCorals.length) return;
    const target = opponentCorals.find((coral) => coral.id === coralId);
    const targetCard = cardsById[target?.cardId];
    if (!target || (targetCard?.kind !== CardKind.CORAL && !isCreatureSchool(targetCard))) return;
    const sourceName = sourceCard?.name ?? "Card effect";
    const abilityName = getOnPlayAbilityName(sourceCard);
    const followupOnPlayAttack = eventOverlay?.followupOnPlayAttack ?? null;
    const result = applyDamage(target.health, amount);
    let message;
    if (result.destroyed) {
      const handLimit = Number((activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit")?.amount ?? Infinity);
      const redistributed = redistributeOrphanCreatures(opponent.corals.filter((coral) => coral.id !== target.id), [...(opponent.orphanCreatures ?? []), ...getOrphanEntriesFromFoundation(target)]);
      const triggerResult = resolveFoundationDestructionTriggers([[target]], opponent.hand, opponent.discardPile, handLimit);
      const nextOpponentProjection = projectNormalizedOpponentState(reconcileOpponentInstances(opponent, {
        ...opponent,
        corals: redistributed.corals,
        orphanCreatures: redistributed.orphans,
        hand: triggerResult.hand,
        discardPile: triggerResult.discardPile,
      }));
      setOpponent(nextOpponentProjection.state);
      const fragmentTrigger = triggerResult.triggers[0];
      const fragmentMessage = fragmentTrigger
        ? fragmentTrigger.cardsToHand.length
          ? ` Fragment returned ${fragmentTrigger.cardsToHand.length} ${cardsById[fragmentTrigger.targetCardId]?.name ?? "matching card"}(s) to the opponent's hand.`
          : fragmentTrigger.cardsToDiscard.length
            ? " Fragment found its card, but the hand limit kept it in discard."
            : ` Fragment triggered but found no ${cardsById[fragmentTrigger.targetCardId]?.name ?? "matching card"}.`
        : "";
      const collapseMessage = getContinuousHealthCollapseMessage(nextOpponentProjection.collateral);
      message = `${sourceName} dealt ${result.appliedDamage} damage and destroyed the opponent's ${targetCard?.name ?? "foundation"}. The foundation was discarded; its creatures filled compatible slots or remained orphaned on the opponent's reef.${fragmentMessage}${collapseMessage ? ` ${collapseMessage}` : ""}`;
    } else {
      setOpponent((current) => ({
        ...current,
        corals: current.corals.map((coral) => coral.id === target.id ? { ...coral, health: result.remainingHealth } : coral),
      }));
      message = `${sourceName} dealt ${result.appliedDamage} damage to the opponent's ${cardsById[target.cardId]?.name}. ${result.remainingHealth}/${target.maxHealth} HP remains.`;
    }
    pushLog(message);
    setEventOverlay({ type: "impact-result", sourceCardId: sourceCard?.id, title: `Player's ${sourceName} used ${abilityName}`, message, success: result.destroyed });
    if (followupOnPlayAttack) {
      beginOnPlayAttack(sourceCard, followupOnPlayAttack.coralId, followupOnPlayAttack.slotId, followupOnPlayAttack.reefIndex, true);
    }
  }

  function attackWithCreature(coralId, slotId) {
    const attackerSlot = playerCorals.find((coral) => coral.id === coralId)?.slots.find((slot) => slot.id === slotId);
    const attackerActionKey = attackerSlot ? getSlotActionKey(attackerSlot) : slotId;
    if (gameResult || gamePhase !== "main" || playingCardId || searchContext || pendingCreatureAction || usedAttackers.includes(attackerActionKey) || turn < Number(actionCooldowns[attackerActionKey] ?? 0)) return;
    const attackerReefIndex = coralId == null && String(slotId).startsWith("reef-") ? findZoneIndexBySlotId(playerReefCreatureInstances, slotId, "reef-") : -1;
    const attackerOrphanIndex = coralId == null && String(slotId).startsWith("orphan-") ? findZoneIndexBySlotId(playerOrphanCreatures, slotId, "orphan-") : -1;
    const attackerCardId = attackerReefIndex >= 0 ? playerReefCreatures[attackerReefIndex] : attackerOrphanIndex >= 0 ? playerOrphanCreatures[attackerOrphanIndex]?.cardId : attackerSlot?.cardId;
    const attacker = cardsById[attackerCardId];
    const attack = getBasicAttackEffect(attacker);
    if (!attack) {
      pushLog(`${attacker?.name ?? "This creature"} has no supported basic attack action.`);
      return;
    }
    if (rp < attack.actionCost) {
      pushLog(`${attacker.name}'s ${attack.actionName} costs ${attack.actionCost} RP, but you only have ${rp} RP.`);
      return;
    }
    const targets = getPlayerAttackTargets(attacker, attack);
    if (!targets.length) {
      pushLog(`${attacker.name} has no legal opponent creature target for ${attack.actionName}.`);
      return;
    }
    setAttackContext(createPlayerAttackContext({ attackerCoralId: coralId, attackerSlotId: slotId, attackerActionKey, attackerCardId, attackerReefIndex, attackerOrphanIndex }, attacker, attack, targets));
    pushLog(`Choose a highlighted opponent creature for ${attacker.name}'s ${attack.actionName}, or cancel the attack.`);
  }

  function beginOnPlayAttack(card, coralId, slotId, reefIndex = -1, forcePending = false) {
    let attack = getOnPlayAttackEffect(card);
    if (!attack) return false;
    const ensnare = getOnPlayEnsnare(card);
    if (ensnare) {
      const coinResult = Math.random() < 0.5 ? "heads" : "tails";
      if (coinResult === "heads") attack = { ...attack, ensnarePenalty: ensnare.penalty };
      pushLog(`${card.name} used ${ensnare.actionName} and flipped ${coinResult}.${coinResult === "heads" ? ` The defender will have -${ensnare.penalty} defense for this attack.` : " No defense penalty was applied."}`);
    }
    if (nextOnPlayAttackBonus) {
      attack = { ...attack, flatBonus: Number(attack.flatBonus ?? 0) + Number(nextOnPlayAttackBonus.amount ?? 0), flatBonusSource: cardsById[nextOnPlayAttackBonus.sourceCardId]?.name ?? "Highlight" };
      setNextOnPlayAttackBonus(null);
    }
    const targets = getPlayerAttackTargets(card, attack);
    if (!targets.length) {
      const message = `${card.name}'s ${attack.actionName} had no legal opponent target.`;
      pushLog(message);
      const noTargetEvent = { type: "utility-result", sourceCardId: card.id, title: `Player's ${card.name} used ${attack.actionName}`, message, success: false };
      if (forcePending) setPendingEvents((events) => [...events, noTargetEvent]);
      else queueEvents([noTargetEvent]);
      return true;
    }
    setAttackContext(createPlayerAttackContext({ attackerCoralId: coralId, attackerSlotId: slotId, attackerCardId: card.id, attackerReefIndex: reefIndex, attackOverride: attack, onPlay: true }, card, attack, targets));
    const message = `${card.name}'s On Play ability ${attack.actionName} triggered automatically. Close this event, then choose one of the highlighted legal targets in the opponent's ecosystem. The card remains in play if you cancel targeting.`;
    pushLog(message);
    const targetPromptEvent = { type: "onplay-target-prompt", sourceCardId: card.id, title: `Player's ${card.name} used ${attack.actionName}`, message };
    if (forcePending) setPendingEvents((events) => [...events, targetPromptEvent]);
    else queueEvents([targetPromptEvent]);
    return true;
  }

  function resolvePlayerAttack(targetCoralId, targetSlotId, rollNow = false, stoppedRoll = null) {
    const selectedTarget = attackContext?.targets.find((target) => target.coralId === targetCoralId && target.slotId === targetSlotId);
    if (!selectedTarget || !canTargetInAttackSequence(attackContext.sequence, selectedTarget.instanceId)) return;
    const attackerSlot = playerCorals.find((coral) => coral.id === attackContext.attackerCoralId)?.slots.find((slot) => slot.id === attackContext.attackerSlotId);
    const attacker = cardsById[attackContext.attackerCardId ?? attackerSlot?.cardId];
    const attack = attackContext.attackOverride ?? getBasicAttackEffect(attacker);
    const reefIndex = targetCoralId === "__reef__" ? findZoneIndexBySlotId(opponent.reefCreatureInstances, targetSlotId, "reef-") : -1;
    const orphanHostedTarget = targetCoralId === "__orphan__" ? parseOrphanHostedTargetSlotId(targetSlotId) : null;
    const orphanIndex = targetCoralId === "__orphan__"
      ? orphanHostedTarget
        ? (opponent.orphanCreatures ?? []).findIndex((entry) => entry.instanceId === orphanHostedTarget.orphanInstanceId)
        : findZoneIndexBySlotId(opponent.orphanCreatures, targetSlotId, "orphan-")
      : -1;
    const hostedTarget = parseHostedTargetSlotId(targetSlotId);
    const targetCoral = opponentCorals.find((coral) => coral.id === targetCoralId);
    const targetSlot = targetCoral?.slots.find((slot) => slot.id === (hostedTarget?.slotId ?? targetSlotId));
    const orphanEntry = orphanIndex >= 0 ? opponent.orphanCreatures?.[orphanIndex] : null;
    const hostedIndex = orphanHostedTarget?.hostedIndex ?? hostedTarget?.hostedIndex ?? -1;
    const targetCardId = targetSlotId === "__foundation__"
      ? targetCoral?.cardId
      : reefIndex >= 0
        ? opponent.reefCreatures?.[reefIndex]
        : orphanHostedTarget
          ? orphanEntry?.hostedCardIds?.[orphanHostedTarget.hostedIndex]
          : orphanIndex >= 0
            ? orphanEntry?.cardId
            : hostedTarget
              ? targetSlot?.hostedCardIds?.[hostedTarget.hostedIndex]
              : targetSlot?.cardId;
    const targetEntry = {
      coral: targetCoral,
      slot: targetSlot,
      reefIndex,
      orphanIndex,
      orphanInstanceId: orphanEntry?.instanceId ?? null,
      hostCardId: orphanHostedTarget ? orphanEntry?.cardId : targetSlot?.cardId,
      hostedIndex,
      card: cardsById[targetCardId],
      instanceId: selectedTarget.instanceId,
    };
    if (!attacker || !attack || !targetEntry.card) {
      setAttackContext(null);
      pushLog("The selected attack target is no longer valid.");
      return;
    }
    const targetAvoidance = getTargetAvoidance(targetEntry.card);
    if (rollNow && targetAvoidance) {
      const coinResult = Math.random() < 0.5 ? "heads" : "tails";
      if (coinResult === targetAvoidance.failureResult) {
        commitPlayerAttackCost(attackContext, attacker, attack);
        const sequenceResult = completePlayerAttackStep(selectedTarget.instanceId, { outcome: "avoided", abilityName: targetAvoidance.abilityName });
        setFaceoffRolling(false);
        setFaceoffPreview(null);
        const message = `${targetEntry.card.name} used ${targetAvoidance.abilityName} and flipped ${coinResult}, so ${attacker.name}'s ${attack.actionName} failed before dice were rolled.${getAttackSequenceContinuationMessage(sequenceResult)}`;
        pushLog(message);
        setEventOverlay({ type: "faceoff-result", sourceCardId: targetEntry.card.id, defenderCardId: attacker.id, title: `${targetAvoidance.abilityName} Evaded the Attack`, message, success: false, continueAttackSequence: sequenceResult.continues });
        return;
      }
    }
    if (targetSlotId === "__foundation__" && isCreatureSchool(targetEntry.card)) {
      if (!rollNow) {
        setEventOverlay({ type: "school-attack-ready", sourceCardId: attacker.id, defenderCardId: targetEntry.card.id, title: `${attacker.name} attacks ${targetEntry.card.name}`, message: `${targetEntry.card.name} has no defense roll. Stop the ${attack.attackDice} attack roll; its result deals ×10 damage.`, targetCoralId, targetSlotId, attackDice: attack.attackDice });
        setFaceoffPreview(null);
        return;
      }
      const hasDisadvantage = attackerHasDisadvantageFromMassive(targetEntry.card);
      const hasAdvantage = cardHasAttackAdvantage(attacker, targetEntry.card, playerHabitats, attack);
      const useAdvantage = hasAdvantage && !hasDisadvantage;
      const useDisadvantage = hasDisadvantage && !hasAdvantage;
      const attackRolls = [(() => {
        const first = stoppedRoll ? { total: stoppedRoll.attack } : rollDie(attack.attackDice);
        const second = useAdvantage || useDisadvantage ? rollDie(attack.attackDice) : null;
        const modifier = getAttackConditionalModifier(attacker, { ...targetEntry.card, health: targetCoral.health, maxHealth: targetCoral.maxHealth }, playerHabitats, playerCorals, playerReefCreatures, attack, playerOrphanCreatures);
        const baseTotal = second ? (useAdvantage ? Math.max(first.total, second.total) : Math.min(first.total, second.total)) : first?.total;
        const rolledBonus = getRolledAttackBonus(attack, baseTotal, playerHabitats);
        const rovLightsBonus = getRovLightsAttackBonus(rovLightsActive, targetEntry.card);
        return first ? { total: baseTotal + modifier.flat + rolledBonus.flat + rovLightsBonus, detail: `${second ? `${first.total}/${second.total} ${useAdvantage ? "advantage" : "disadvantage"}` : `${first.total}${hasAdvantage && hasDisadvantage ? " (advantage and disadvantage canceled)" : ""}`}${modifier.details.length || rolledBonus.detail || rovLightsBonus ? ` [${[...modifier.details, rolledBonus.detail, rovLightsBonus ? "+2 ROV Lights" : null].filter(Boolean).join(", ")}]` : ""}` } : null;
      })()].filter(Boolean);
      const rolledDamage = attackRolls.reduce((total, roll) => total + roll.total * 10, 0);
      const result = applyDamage(targetCoral.health ?? targetCoral.maxHealth, rolledDamage);
      commitPlayerAttackCost(attackContext, attacker, attack);
      setFaceoffRolling(false);
      setFaceoffPreview(null);
      const orphanEntries = result.destroyed ? getOrphanEntriesFromFoundation(targetCoral) : [];
      const recyclesKrill = result.destroyed && cardHasPlenteous(targetEntry.card);
      const availableKrill = targetEntry.card.id === "krill-bloom-base" ? "krill-bloom-base" : opponent.discardPile.includes("krill-bloom-base") ? "krill-bloom-base" : null;
      const recycleId = recyclesKrill ? availableKrill : null;
      const nextDiscard = result.destroyed ? [targetEntry.card.id, ...opponent.discardPile] : opponent.discardPile;
      const redistributed = result.destroyed
        ? redistributeOrphanCreatures(opponent.corals.filter((coral) => coral.id !== targetCoral.id), [...(opponent.orphanCreatures ?? []), ...orphanEntries])
        : { corals: opponent.corals.map((coral) => coral.id === targetCoral.id ? { ...coral, health: result.remainingHealth } : coral), orphans: opponent.orphanCreatures ?? [] };
      const nextOpponentProjection = projectNormalizedOpponentState(reconcileOpponentInstances(opponent, {
        ...opponent,
        corals: redistributed.corals,
        orphanCreatures: redistributed.orphans,
        discardPile: recycleId ? removeOneCard(nextDiscard, recycleId) : nextDiscard,
        foundationDeck: recycleId ? shuffle([...opponent.foundationDeck, recycleId]) : opponent.foundationDeck,
      }));
      const nextOpponentState = nextOpponentProjection.state;
      setOpponent(nextOpponentState);
      const sequenceResult = completePlayerAttackStep(selectedTarget.instanceId, { outcome: result.destroyed ? "destroyed" : "damaged", damage: result.appliedDamage }, { nextTargets: getPlayerAttackTargets(attacker, attack, nextOpponentState) });
      const collapseMessage = getContinuousHealthCollapseMessage(nextOpponentProjection.collateral);
      const message = `${attacker.name} rolled ${attackRolls.map((roll) => roll.detail).join(", ")} and dealt ${result.appliedDamage} damage to ${targetEntry.card.name}.${result.destroyed ? " The Creature School was discarded and its creatures redistributed." : ` ${result.remainingHealth}/${targetCoral.maxHealth} HP remains.`}${recyclesKrill ? " Plenteous recycled a base Krill Bloom into the opponent's Foundation deck when available." : ""}${collapseMessage ? ` ${collapseMessage}` : ""}${getAttackSequenceContinuationMessage(sequenceResult)}`;
      pushLog(message);
      setEventOverlay({ type: "faceoff-result", sourceCardId: attacker.id, defenderCardId: targetEntry.card.id, title: result.destroyed ? "Creature School Destroyed" : "Creature School Damaged", message, success: result.destroyed, continueAttackSequence: sequenceResult.continues });
      return;
    }
    const defenseDice = targetEntry.card.defense?.dice ?? targetEntry.card.defense;
    if (!defenseDice) {
      const message = `${targetEntry.card.name} has no defense die in the current card data, so ${attacker.name}'s attack cannot be resolved without inventing a rule. No RP was spent and neither card moved.`;
      setAttackContext(null);
      pushLog(message);
      setEventOverlay({ type: "utility-result", sourceCardId: attacker.id, defenderCardId: targetEntry.card.id, title: "Attack Could Not Resolve", message, success: false });
      return;
    }
    const attackAdvantage = cardHasAttackAdvantage(attacker, targetEntry.card, playerHabitats, attack);
    const attackDisadvantage = attackerHasDisadvantageFromMassive(targetEntry.card);
    const useAttackAdvantage = attackAdvantage && !attackDisadvantage;
    const useAttackDisadvantage = attackDisadvantage && !attackAdvantage;
    const defenseAdjustment = getDefenseAdjustment(attack, targetEntry.card, playerHabitats);
    const opponentDefenseStatusKey = targetEntry.hostedIndex >= 0
      ? targetEntry.orphanIndex >= 0
        ? getOrphanHostedTargetSlotId(targetEntry.orphanInstanceId, targetEntry.hostedIndex)
        : getHostedTargetSlotId(targetEntry.slot?.id, targetEntry.hostedIndex)
      : targetEntry.slot
        ? getSlotActionKey(targetEntry.slot)
        : targetEntry.reefIndex >= 0
          ? `reef-${targetEntry.instanceId}`
          : targetEntry.orphanIndex >= 0
            ? `orphan-${targetEntry.orphanInstanceId}`
            : null;
    const activeOpponentDefenseStatuses = opponent.creatureStatuses?.[opponentDefenseStatusKey] ?? [];
    const defenseAdvantage = hasDefenseAdvantage({ targetCard: targetEntry.card, statuses: activeOpponentDefenseStatuses, ignoreDefensiveBonuses: defenseAdjustment.ignoresBonuses });
    const attachedDefenseBonus = !defenseAdjustment.ignoresBonuses && targetCoral ? calculateAttachedCreatureDefenseBonus(cardsById[targetCoral.cardId]) : 0;
    const hostedDefenseBonusDice = !defenseAdjustment.ignoresBonuses && targetEntry.hostedIndex >= 0 ? getHostedDefenseBonusDice(cardsById[targetEntry.hostCardId], targetEntry.card) : null;
    const cloakDefenseBonus = !defenseAdjustment.ignoresBonuses ? getCloakDefenseBonus(targetEntry.card) : 0;
    const darknessShroudDefenseBonus = !defenseAdjustment.ignoresBonuses ? getDarknessShroudDefenseBonus(targetEntry.card, opponent.habitats) : 0;
    const rovLightsBonus = getRovLightsAttackBonus(rovLightsActive, targetEntry.card);
    if (!rollNow) {
      setEventOverlay({
        type: "faceoff-ready",
        sourceCardId: attacker.id,
        defenderCardId: targetEntry.card.id,
        title: `${attacker.name} vs ${targetEntry.card.name}`,
        message: `${attacker.name} attacks with ${attack.attackDice}${useAttackAdvantage ? " and has advantage" : useAttackDisadvantage ? " and has disadvantage from Massive" : attackAdvantage && attackDisadvantage ? " (advantage and disadvantage cancel)" : ""}${rovLightsBonus ? " +2 from ROV Lights" : ""}. ${targetEntry.card.name} defends with ${defenseDice}${defenseAdvantage ? " and has defense advantage" : ""}${activeOpponentDefenseStatuses.some((status) => status.type === "defenseBonusDice") ? " plus its active defensive bonus die" : ""}${cloakDefenseBonus ? ` +${cloakDefenseBonus} Cloak` : ""}${darknessShroudDefenseBonus ? ` +${darknessShroudDefenseBonus} Darkness Shroud` : ""}${attachedDefenseBonus ? ` +${attachedDefenseBonus} Shelter` : ""}${hostedDefenseBonusDice ? ` +${hostedDefenseBonusDice} Stinging Fortress` : ""}.`,
        targetCoralId,
        targetSlotId,
        attackDice: attack.attackDice,
        defenseDice,
      });
      setFaceoffPreview(null);
      return;
    }
    const result = stoppedRoll
      ? { resolved: true, attack: { total: stoppedRoll.attack }, defense: { total: stoppedRoll.defense } }
      : resolveOpposedRoll(attack.attackDice, defenseDice);
    if (!result.resolved) {
      pushLog(`Could not parse the dice for ${attacker.name}'s attack.`);
      return;
    }
    const secondAttackRoll = useAttackAdvantage || useAttackDisadvantage ? rollDie(attack.attackDice) : null;
    const chosenAttackRoll = secondAttackRoll
      ? (useAttackAdvantage ? Math.max(result.attack.total, secondAttackRoll.total) : Math.min(result.attack.total, secondAttackRoll.total))
      : result.attack.total;
    const modifier = getAttackConditionalModifier(attacker, targetEntry.card, playerHabitats, playerCorals, playerReefCreatures, attack, playerOrphanCreatures);
    const rolledBonus = getRolledAttackBonus(attack, chosenAttackRoll, playerHabitats);
    let attackTotal = chosenAttackRoll + modifier.flat + rolledBonus.flat + rovLightsBonus;
    const secondDefenseRoll = defenseAdvantage ? rollDie(defenseDice) : null;
    const chosenDefenseRoll = secondDefenseRoll ? Math.max(result.defense.total, secondDefenseRoll.total) : result.defense.total;
    const hostedDefenseRoll = hostedDefenseBonusDice ? rollDie(hostedDefenseBonusDice) : null;
    const statusDefenseRolls = (!defenseAdjustment.ignoresBonuses ? activeOpponentDefenseStatuses : []).filter((status) => status.type === "defenseBonusDice").map((status) => ({ status, roll: rollDie(status.dice) })).filter((entry) => entry.roll);
    const statusDefenseBonus = statusDefenseRolls.reduce((total, entry) => total + entry.roll.total, 0);
    const defenseTotal = Math.max(0, chosenDefenseRoll + defenseAdjustment.flat + cloakDefenseBonus + darknessShroudDefenseBonus + attachedDefenseBonus + Number(hostedDefenseRoll?.total ?? 0) + statusDefenseBonus);
    let scatterDetail = "";
    if (attackTotal > defenseTotal && cardHasScatter(targetEntry.card)) {
      const scatterFirst = rollDie(attack.attackDice);
      const scatterSecond = useAttackAdvantage || useAttackDisadvantage ? rollDie(attack.attackDice) : null;
      const scatterBase = scatterSecond ? (useAttackAdvantage ? Math.max(scatterFirst.total, scatterSecond.total) : Math.min(scatterFirst.total, scatterSecond.total)) : scatterFirst?.total ?? 0;
      const scatterModifier = getAttackConditionalModifier(attacker, targetEntry.card, playerHabitats, playerCorals, playerReefCreatures, attack, playerOrphanCreatures);
      const scatterRolledBonus = getRolledAttackBonus(attack, scatterBase, playerHabitats);
      attackTotal = scatterBase + scatterModifier.flat + scatterRolledBonus.flat + rovLightsBonus;
      scatterDetail = `; Scatter reroll ${attackTotal}`;
    }
    const attackerWins = attackTotal > defenseTotal;
    const rolls = [`${attackTotal}${secondAttackRoll ? ` (${result.attack.total}/${secondAttackRoll.total} ${useAttackAdvantage ? "advantage" : "disadvantage"})` : attackAdvantage && attackDisadvantage ? " (advantage and disadvantage canceled)" : ""}${modifier.details.length || rolledBonus.detail || rovLightsBonus ? ` [${[...modifier.details, rolledBonus.detail, rovLightsBonus ? "+2 ROV Lights" : null].filter(Boolean).join(", ")}]` : ""} vs ${defenseTotal}${secondDefenseRoll ? ` (${result.defense.total}/${secondDefenseRoll.total} defense advantage)` : ""}${defenseAdjustment.flat ? ` (${defenseAdjustment.flat} defense)` : ""}${cloakDefenseBonus ? ` (+${cloakDefenseBonus} Cloak)` : ""}${darknessShroudDefenseBonus ? ` (+${darknessShroudDefenseBonus} Darkness Shroud)` : ""}${attachedDefenseBonus ? ` (+${attachedDefenseBonus} Shelter)` : ""}${hostedDefenseRoll ? ` (+${hostedDefenseRoll.total} Stinging Fortress)` : ""}${statusDefenseRolls.length ? ` (${statusDefenseRolls.map((entry) => `+${entry.roll.total} ${entry.status.dice}`).join(", ")} action defense)` : ""}${scatterDetail}`];
    commitPlayerAttackCost(attackContext, attacker, attack);
    setFaceoffRolling(false);
    setFaceoffPreview(null);
    const attackerCoralId = attackContext.attackerCoralId;
    const attackerReefIndex = attackContext.attackerReefIndex;
    const attackerOrphanIndex = attackContext.attackerOrphanIndex;
    const poisonImmune = poisonImmunityNextPredatorAttack;
    if (attackerWins) {
      const resilienceTriggered = cardHasAncientResilience(targetEntry.card) && !(opponent.resilienceUsedCardIds ?? []).includes(targetEntry.instanceId);
      const regenerateDecision = createRegenerateDecision({ defenderCard: targetEntry.card, defenderWasDefeated: true, controllerRp: opponent.rp, survivalAlreadyApplied: resilienceTriggered });
      const regenerateResolution = regenerateDecision.available ? resolveRegenerateDecision(regenerateDecision, "regenerate") : null;
      const regenerateTriggered = Boolean(regenerateResolution?.keepDefender);
      const defenderKept = resilienceTriggered || regenerateTriggered;
      const toxicResult = resolveToxicConsumption({ attackerCard: attacker, toxicSourceCard: targetEntry.card, consumed: !defenderKept, poisonHealActive: poisonImmune });
      const toxicDiscardedAttacker = toxicResult.discardAttacker;
      const selfDiscardedAttacker = shouldSelfDiscardAfterConsume({ attackerCard: attacker, defenderCard: targetEntry.card, consumed: !defenderKept });
      const attackerDiscardedAfterConsume = toxicDiscardedAttacker || selfDiscardedAttacker;
      const opponentBlueCrabRecycle = !defenderKept && targetEntry.card.category === CardCategory.FISH && !isCreatureSchool(targetEntry.card) && ecosystemHasCard(opponentCorals, opponent.reefCreatures, "blue-crab", opponent.orphanCreatures) && opponent.blueCrabRecycleUsedTurn !== turn;
      const opponentNominalRecycleRp = opponentBlueCrabRecycle ? halfCostRoundedUp(targetEntry.card.cost?.rp) : 0;
      const nextReefInstances = defenderKept || targetEntry.reefIndex < 0 ? opponent.reefCreatureInstances : removeCreatureInstances(opponent.reefCreatureInstances ?? [], [targetEntry.instanceId]).instances;
      const nextOpponentOrphans = defenderKept || targetEntry.orphanIndex < 0
        ? opponent.orphanCreatures ?? []
        : targetEntry.hostedIndex >= 0
          ? (opponent.orphanCreatures ?? []).map((entry) => entry.instanceId === targetEntry.orphanInstanceId
            ? { ...entry, hostedCardIds: removeHostedCardAtIndex(entry.hostedCardIds, targetEntry.hostedIndex) }
            : entry)
          : [
              ...(opponent.orphanCreatures ?? []).filter((entry) => entry.instanceId !== targetEntry.orphanInstanceId),
              ...(opponent.orphanCreatures?.[targetEntry.orphanIndex]?.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`opponent-orphan-${cardId}`))),
            ];
      const nextOpponentProjection = projectNormalizedOpponentState(reconcileOpponentInstances(opponent, {
        ...opponent,
        corals: defenderKept || targetEntry.reefIndex >= 0 || targetEntry.orphanIndex >= 0 ? opponent.corals : opponent.corals.map((coral) => coral.id === targetEntry.coral.id ? {
          ...coral,
          slots: coral.slots.map((slot) => slot.id === targetEntry.slot.id ? targetEntry.hostedIndex >= 0 ? { ...slot, hostedCardIds: removeHostedCardAtIndex(slot.hostedCardIds, targetEntry.hostedIndex) } : { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot),
        } : coral),
        reefCreatures: nextReefInstances.map((instance) => instance.cardId),
        reefCreatureInstances: nextReefInstances,
        orphanCreatures: nextOpponentOrphans,
        discardPile: defenderKept ? opponent.discardPile : [targetEntry.card.id, ...(targetEntry.orphanIndex >= 0 || targetEntry.hostedIndex >= 0 ? [] : (targetEntry.slot?.hostedCardIds ?? []).filter(Boolean)), ...opponent.discardPile],
        rp: Math.max(0, opponent.rp - (regenerateTriggered ? regenerateResolution.rpCost : 0)),
        resilienceUsedCardIds: resilienceTriggered ? [...(opponent.resilienceUsedCardIds ?? []), targetEntry.instanceId] : opponent.resilienceUsedCardIds,
      }));
      let nextOpponentState = nextOpponentProjection.state;
      const opponentRpBeforeRecycle = nextOpponentState.rp;
      const nextOpponentCap = getEcosystemRpCap(nextOpponentState.corals, [...nextOpponentState.habitats, ...nextOpponentState.reefCreatures, ...(nextOpponentState.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])], activeCondition);
      const opponentRpAfterRecycle = addResourceWithinCap(opponentRpBeforeRecycle, opponentNominalRecycleRp, nextOpponentCap);
      const opponentActualRecycleRp = opponentRpAfterRecycle - opponentRpBeforeRecycle;
      nextOpponentState = {
        ...nextOpponentState,
        rp: opponentRpAfterRecycle,
        blueCrabRecycleUsedTurn: opponentBlueCrabRecycle ? turn : nextOpponentState.blueCrabRecycleUsedTurn,
      };
      setOpponent(nextOpponentState);
      if (attackerDiscardedAfterConsume) {
        if (attackerReefIndex >= 0) {
          const attackerInstanceId = playerReefCreatureInstances[attackerReefIndex]?.instanceId;
          setPlayerReefCreatureInstances((current) => removeCreatureInstances(current, [attackerInstanceId]).instances);
        } else if (attackerOrphanIndex >= 0) {
          const attackerInstanceId = playerOrphanCreatures[attackerOrphanIndex]?.instanceId;
          setPlayerOrphanCreatureInstances((current) => {
            const removedEntry = current.find((entry) => entry.instanceId === attackerInstanceId);
            return [...current.filter((entry) => entry.instanceId !== attackerInstanceId), ...(removedEntry?.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`player-orphan-${cardId}`)))];
          });
        }
        else setPlayerCorals((current) => current.map((coral) => coral.id === attackerCoralId ? { ...coral, slots: coral.slots.map((slot) => slot.id === attackerSlot?.id ? { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot) } : coral));
        setDiscardPile((current) => [attacker.id, ...current]);
      }
      const toxicMessage = toxicResult.triggered ? toxicResult.protected ? ` ${toxicResult.protectionSource === "poisonHeal" ? "Poison Heal" : `${attacker.name}'s Toxic Immunity`} prevented the Toxic effect.` : toxicDiscardedAttacker ? " Toxic coin flip: tails, so the consuming attacker was also discarded." : " Toxic coin flip: heads, so the attacker survived." : "";
      const selfDiscardMessage = selfDiscardedAttacker
        ? toxicDiscardedAttacker
          ? ` ${attacker.name}'s consume rule also required it to be discarded; it left play only once.`
          : ` ${attacker.name}'s consume rule discarded it after eating an Apex or Predator.`
        : "";
      const recycleMessage = opponentBlueCrabRecycle
        ? opponentActualRecycleRp > 0
          ? ` Opponent's Blue Crab recycled ${opponentActualRecycleRp} RP (half the Fish's cost, rounded up and capped by its bank).`
          : " Opponent's Blue Crab triggered, but its RP bank was already at its cap."
        : "";
      const survivalMessage = resilienceTriggered ? ` Ancient Resilience kept ${targetEntry.card.name} in play and is now used for this game.` : regenerateTriggered ? ` The opponent automatically paid 1 RP for Regenerate to keep ${targetEntry.card.name} in play.` : ` The defender was discarded.`;
      const sequenceResult = completePlayerAttackStep(selectedTarget.instanceId, { outcome: defenderKept ? "survived" : "discarded" }, { attackerSurvives: !attackerDiscardedAfterConsume, nextTargets: getPlayerAttackTargets(attacker, attack, nextOpponentState) });
      const collapseMessage = getContinuousHealthCollapseMessage(nextOpponentProjection.collateral);
      const message = `${attacker.name} used ${attack.actionName} on ${targetEntry.card.name}: ${rolls.join(", ")}. The attack succeeded.${survivalMessage}${toxicMessage}${selfDiscardMessage}${recycleMessage}${collapseMessage ? ` ${collapseMessage}` : ""}${attack.unsupportedDetails ? ` ${attack.unsupportedDetails}` : ""}${getAttackSequenceContinuationMessage(sequenceResult)}`;
      pushLog(message);
      setEventOverlay({ type: "faceoff-result", sourceCardId: attacker.id, defenderCardId: targetEntry.card.id, title: defenderKept ? "Attack Landed — Defender Survived" : "Successful Attack!", message, success: true, continueAttackSequence: sequenceResult.continues });
    } else {
      const biteBack = getBiteBackAttack(targetEntry.card);
      const attackerDefense = attacker.defense?.dice ?? attacker.defense;
      const counter = biteBack && attackerDefense ? resolveOpposedRoll(biteBack.attackDice, attackerDefense) : null;
      const counterSucceeded = Boolean(counter?.resolved && counter.attackerWins);
      if (counterSucceeded) {
        if (attackerReefIndex >= 0) {
          const attackerInstanceId = playerReefCreatureInstances[attackerReefIndex]?.instanceId;
          setPlayerReefCreatureInstances((current) => removeCreatureInstances(current, [attackerInstanceId]).instances);
        } else if (attackerOrphanIndex >= 0) {
          const attackerInstanceId = playerOrphanCreatures[attackerOrphanIndex]?.instanceId;
          setPlayerOrphanCreatureInstances((current) => {
            const removedEntry = current.find((entry) => entry.instanceId === attackerInstanceId);
            return [...current.filter((entry) => entry.instanceId !== attackerInstanceId), ...(removedEntry?.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`player-orphan-${cardId}`)))];
          });
        }
        else setPlayerCorals((current) => current.map((coral) => coral.id === attackerCoralId ? { ...coral, slots: coral.slots.map((slot) => slot.id === attackerSlot?.id ? { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot) } : coral));
        setDiscardPile((current) => [attacker.id, ...current]);
      }
      const counterMessage = counter?.resolved ? ` ${targetEntry.card.name} triggered Bite Back: ${counter.attack.total} vs ${counter.defense.total}.${counterSucceeded ? ` ${attacker.name} was discarded.` : ` ${attacker.name} defended successfully.`}` : "";
      const sequenceResult = completePlayerAttackStep(selectedTarget.instanceId, { outcome: "defended", biteBack: counterSucceeded }, { attackerSurvives: !counterSucceeded });
      const message = `${attacker.name} used ${attack.actionName} on ${targetEntry.card.name}: ${rolls.join(", ")}. The defender won.${counterMessage}${attack.unsupportedDetails ? ` ${attack.unsupportedDetails}` : ""}${getAttackSequenceContinuationMessage(sequenceResult)}`;
      pushLog(message);
      setEventOverlay({ type: "faceoff-result", sourceCardId: counter?.resolved ? targetEntry.card.id : attacker.id, defenderCardId: counter?.resolved ? attacker.id : targetEntry.card.id, title: counterSucceeded ? "Bite Back Counterattack!" : "Successful Defense!", message, success: false, continueAttackSequence: sequenceResult.continues });
    }
  }

  function applyPlayerOnPlayDeckDiscard(card) {
    const deckDiscard = getOnPlayOpponentDeckDiscard(card);
    if (!deckDiscard) return false;
    const discardedIds = [...opponent.palsDeck, ...opponent.foundationDeck].slice(0, deckDiscard.amount);
    if (!discardedIds.length) return false;
    setOpponent((current) => {
      const palsCount = Math.min(deckDiscard.amount, current.palsDeck.length);
      const foundationCount = Math.min(deckDiscard.amount - palsCount, current.foundationDeck.length);
      return { ...current, palsDeck: current.palsDeck.slice(palsCount), foundationDeck: current.foundationDeck.slice(foundationCount), discardPile: [...current.palsDeck.slice(0, palsCount), ...current.foundationDeck.slice(0, foundationCount), ...current.discardPile] };
    });
    const discardedNames = discardedIds.map((cardId) => cardsById[cardId]?.name ?? cardId).join(", ");
    const message = `${card.name} discarded ${discardedNames} from the top of the opponent's personal decks (Pals first).`;
    pushLog(message);
    setEventOverlay({ type: "impact-result", sourceCardId: card.id, defenderCardId: discardedIds[0], title: `Player's ${card.name} used ${deckDiscard.actionName}`, message, success: true });
    return true;
  }

  function applyPlayerOnPlaySupportBlock(card) {
    const supportBlock = getOnPlaySupportBlock(card);
    if (!supportBlock) return false;
    setOpponent((current) => ({ ...current, supportBlockedUntilRound: round }));
    const message = `${card.name} used ${supportBlock.actionName}. The opponent cannot play Support cards during its next turn.`;
    pushLog(message);
    setEventOverlay({ type: "impact-result", sourceCardId: card.id, title: `Player's ${card.name} used ${supportBlock.actionName}`, message, success: true });
    return true;
  }

  function beginPlayerOnPlaySearch(card, locationKey) {
    const search = getOnPlayUtilitySearch(card);
    if (!search) return false;
    const candidates = [...new Set([...foundationDeck, ...palsDeck].filter((cardId) => {
      const candidate = cardsById[cardId];
      if (!candidate || candidate.kind !== search.effect.targetKind) return false;
      if (search.effect.targetCategories?.length && !search.effect.targetCategories.includes(candidate.category)) return false;
      if (search.effect.targetZone && candidate.zone !== search.effect.targetZone) return false;
      if (search.effect.targetCardId && candidate.id !== search.effect.targetCardId) return false;
      return !search.effect.targetNameIncludes || candidate.name?.toLowerCase().includes(search.effect.targetNameIncludes.toLowerCase());
    }))];
    if (!candidates.length) {
      const message = `${card.name}'s ${search.actionName} found no matching card in either personal deck.`;
      pushLog(message);
      setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: `Player's ${card.name} used ${search.actionName}`, message, success: false });
      return true;
    }
    const amount = Math.max(1, Number(search.effect.amount ?? 1));
    if (amount > 1) {
      setSearchContext({ mode: "onplay-multi-search", sourceCardId: card.id, actionName: search.actionName, candidates, selected: [], max: amount });
      setEventOverlay({ type: "choose-onplay-multi-search", sourceCardId: card.id, title: `Player's ${card.name} used ${search.actionName}`, message: `Choose up to ${amount} matching cards to reveal and add to your hand.` });
      return true;
    }
    const action = { name: search.actionName, text: typeof search.action === "string" ? search.action : search.action.text, cost: { rp: 0 }, oncePerTurn: false };
    setPendingCreatureAction({ action, effect: search.effect, actionKey: `onplay:${locationKey}:${search.actionName}`, sourceCardId: card.id, candidates, actionName: search.actionName, cost: 0 });
    setEventOverlay({ type: "choose-creature-action-search", sourceCardId: card.id, title: `Player's ${card.name} used ${search.actionName}`, message: "Choose the matching card to reveal and add to your hand." });
    return true;
  }

  function beginPlayerOnPlayDraw(card, locationKey) {
    const onPlayDrawCount = getOnPlayDrawCount(card);
    if (!onPlayDrawCount) return false;
    const target = Math.min(onPlayDrawCount, foundationDeck.length + palsDeck.length);
    if (!target) {
      const message = `${card.name}'s mandatory ${getOnPlayAbilityName(card)} draw could not be completed because both personal decks are empty. You lose by deck depletion.`;
      pushLog(message);
      setPendingEvents([]);
      setAttackContext(null);
      setGameResult((current) => current ?? `Defeat: ${card.name} required you to draw ${onPlayDrawCount} card${onPlayDrawCount === 1 ? "" : "s"}, but both personal decks were empty.`);
      setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: `Player's ${card.name} used ${getOnPlayAbilityName(card)}`, message, success: false });
      return true;
    }
    const drawEffect = { type: EffectType.DRAW_CARDS, amount: onPlayDrawCount };
    setPendingCreatureAction({ action: { name: getOnPlayAbilityName(card), cost: { rp: 0 }, oncePerTurn: false }, effect: drawEffect, actionKey: `onplay:${card.id}:${locationKey}`, sourceCardId: card.id, cost: 0, committed: true });
    setTurnDrawSelection({ requested: onPlayDrawCount, target, shortfall: getRequiredDrawShortfall(onPlayDrawCount, target), foundation: 0, pals: 0, mode: "onplay" });
    setEventOverlay({ type: "choose-action-deck", sourceCardId: card.id, title: `Player's ${card.name} used ${getOnPlayAbilityName(card)}`, message: `Allocate ${target} draw${target === 1 ? "" : "s"} between your personal decks.` });
    return true;
  }

  function beginPlayerOnPlayReorder(card, locationKey) {
    const reorder = getOnPlayReorder(card);
    if (!reorder) return false;
    if (!foundationDeck.length && !palsDeck.length) {
      const message = `${card.name}'s ${reorder.actionName} could not inspect either empty personal deck.`;
      pushLog(message);
      setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: `Player's ${card.name} used ${reorder.actionName}`, message, success: false });
      return true;
    }
    setPendingCreatureAction({ action: reorder.action, effect: reorder.effect, actionKey: `onplay:${card.id}:${locationKey}:${reorder.actionName}`, sourceCardId: card.id, actionName: reorder.actionName, cost: 0, committed: true });
    setEventOverlay({ type: "choose-action-reorder-source", sourceCardId: card.id, title: `Player's ${card.name} used ${reorder.actionName}`, message: `Choose a personal deck, then reorder up to its top ${reorder.effect.amount} cards. The On Play ability is optional; skipping it does not undo the card you played.` });
    return true;
  }

  function placeCardToSlot(slotId) {
    if (!playingCardId) return;
    const card = cardsById[playingCardId];
    const coral = findCoralBySlotId(slotId);
    if (!coral) return;
    const slot = coral.slots.find((s) => s.id === slotId);
    if (!slot) return;
    const error = getPlayError(card);
    if (error) {
      setPlayError(error);
      return;
    }
    const hostedCardIds = slot.cardId
      ? placeCardInSpecialHost(cardsById[slot.cardId], card, slot.hostedCardIds, playingCardId)
      : null;
    const isHostedPlacement = Boolean(hostedCardIds);
    if (!canUseSlotWithCard(slot, playingCardId) && !isHostedPlacement) {
      setPlayError("This creature cannot be placed in that slot.");
      return;
    }
    const nextPlayerCorals = playerCorals.map((c) =>
        c.id === coral.id
          ? {
              ...c,
              slots: c.slots.map((s) => (s.id === slotId
                ? isHostedPlacement
                  ? { ...s, hostedCardIds }
                  : { ...s, cardId: playingCardId, cardInstanceId: createStableInstanceId(`player-slot-${playingCardId}`) }
                : s)),
            }
          : c,
      );
    setPlayerCorals(nextPlayerCorals);
    queueBubbleBurstForSlot(slotId);
    const playCost = getPlayerCardPlayCost(card);
    const onPlayResourceGain = getResourceGainFromActions(card.onPlay, "rp");
    const rpAfterCost = Math.max(0, rp - playCost);
    const playerCapAfterPlacement = getEcosystemRpCap(nextPlayerCorals, [
      ...playerHabitats,
      ...playerReefCreatures,
      ...playerOrphanCreatures.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])]),
    ], activeCondition);
    const rpAfterOnPlayGain = addResourceWithinCap(rpAfterCost, onPlayResourceGain, playerCapAfterPlacement);
    const actualOnPlayGain = rpAfterOnPlayGain - rpAfterCost;
    setHand((current) => removeOneCard(current, playingCardId));
    setRp(rpAfterOnPlayGain);
    consumePlayerSchoolDensityDiscount(card);
    setPlayingCardId(null);
    setSelectedHandCard(null);
    setPlayError("");
    pushLog(isHostedPlacement
      ? `Hosted ${card.name} inside ${cardsById[slot.cardId]?.name} for ${playCost} RP.${onPlayResourceGain ? ` Its On Play ability gained ${actualOnPlayGain} RP${actualOnPlayGain < onPlayResourceGain ? ` (limited by the ${playerCapAfterPlacement} RP bank cap)` : ""}.` : ""}`
      : `Placed ${card.name} into a coral slot for ${playCost} RP.${onPlayResourceGain ? ` Its On Play ability gained ${actualOnPlayGain} RP${actualOnPlayGain < onPlayResourceGain ? ` (limited by the ${playerCapAfterPlacement} RP bank cap)` : ""}.` : ""}`);
    const onPlayDamage = getOnPlayFoundationDamage(card, [...playerHabitats, ...playerCorals.map((foundation) => foundation.cardId)]);
    const hasOnPlayAttack = Boolean(getOnPlayAttackEffect(card));
    const deckDiscardAbility = getOnPlayOpponentDeckDiscard(card);
    const onPlayDrawCount = getOnPlayDrawCount(card);
    if (!onPlayDamage && !deckDiscardAbility && !onPlayDrawCount) beginOnPlayAttack(card, coral.id, slotId);
    beginPlayerOnPlaySearch(card, slotId);
    const onPlayHeal = getOnPlayCoralHeal(card);
    const onPlayReorder = getOnPlayReorder(card);
    const randomDiscard = getOnPlayRandomDiscard(card);
    const symbiosisCandidates = cardHasSymbiosis(card) ? hand.filter((cardId) => cardId !== card.id && cardsById[cardId]?.tags?.includes("clownfish")) : [];
    if (cardHasSymbiosis(card)) {
      if (symbiosisCandidates.length) {
        setSearchContext({ mode: "symbiosis", sourceCardId: card.id, coralId: coral.id, slotId, candidates: symbiosisCandidates });
        setEventOverlay({ type: "choose-symbiosis-card", sourceCardId: card.id, title: `Player's ${card.name} used Symbiosis`, message: "Choose a Clownfish from your hand to attach to this Anemone at no additional RP cost. This printed On Play effect is mandatory while a Clownfish is available." });
      } else {
        const message = `${card.name}'s Symbiosis found no Clownfish in your hand, so no card was hosted.`;
        pushLog(message);
        setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: `Player's ${card.name} used Symbiosis`, message, success: false });
      }
    }
    const appliedDeckDiscard = applyPlayerOnPlayDeckDiscard(card);
    const appliedSupportBlock = applyPlayerOnPlaySupportBlock(card);
    if (!onPlayDamage && deckDiscardAbility && hasOnPlayAttack) {
      // Resolve the visible deck-discard event first, then present the mandatory
      // attack target prompt. This keeps multi-part On Play cards from replacing
      // their own event popup before the player can read it.
      beginOnPlayAttack(card, coral.id, slotId, -1, appliedDeckDiscard);
    }
    if (randomDiscard && opponent.hand.length) {
      const discardedIds = shuffle(opponent.hand).slice(0, randomDiscard.amount);
      setOpponent((current) => ({ ...current, hand: discardedIds.reduce((cards, cardId) => removeOneCard(cards, cardId), current.hand), discardPile: [...discardedIds, ...current.discardPile] }));
      const discardedNames = discardedIds.map((cardId) => cardsById[cardId]?.name ?? cardId).join(", ");
      const message = `${card.name} discarded ${discardedNames} at random from the opponent's hand.`;
      pushLog(message);
      setEventOverlay({ type: "impact-result", sourceCardId: card.id, defenderCardId: discardedIds[0], title: `Player's ${card.name} used ${randomDiscard.actionName}`, message, success: true });
    }
    const onPlayDamageTargets = onPlayDamage?.targetType === "creature-school"
      ? opponentCorals.filter((foundation) => isCreatureSchool(cardsById[foundation.cardId]))
      : opponentCoralCards;
    if (onPlayDamage && onPlayDamageTargets.length) {
      setEventOverlay({
        type: "choose-impact-target",
        sourceCardId: card.id,
        title: `Player's ${card.name} used ${onPlayDamage.actionName}`,
        message: `Choose an opponent ${onPlayDamage.targetType === "creature-school" ? "Creature School" : "coral"} to receive ${onPlayDamage.amount} damage.`,
        amount: onPlayDamage.amount,
        targetCoralIds: onPlayDamageTargets.map((coral) => coral.id),
        followupOnPlayAttack: hasOnPlayAttack ? { coralId: coral.id, slotId, reefIndex: -1 } : null,
      });
    } else if (onPlayDamage) {
      const message = `${card.name}'s ${onPlayDamage.actionName} had no legal opponent ${onPlayDamage.targetType === "creature-school" ? "Creature School" : "coral"} target.`;
      pushLog(message);
      setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: `Player's ${card.name} used ${onPlayDamage.actionName}`, message, success: false });
      if (hasOnPlayAttack) beginOnPlayAttack(card, coral.id, slotId, -1, true);
    } else if (onPlayHeal) {
      const candidates = playerCoralCards.filter((candidate) => Number(candidate.health ?? candidate.maxHealth) < Number(candidate.maxHealth)).map((candidate) => candidate.id);
      if (candidates.length) {
        setSearchContext({ mode: "onplay-heal", sourceCardId: card.id, candidates, amount: onPlayHeal.amount, actionName: onPlayHeal.actionName, roll: onPlayHeal.roll });
        setEventOverlay({ type: "choose-onplay-heal-target", sourceCardId: card.id, title: `Player's ${card.name} used ${onPlayHeal.actionName}`, message: `Choose one of your damaged corals to restore ${onPlayHeal.amount} HP${onPlayHeal.roll != null ? ` (rolled ${onPlayHeal.roll})` : ""}.` });
      } else {
        const message = `${card.name}'s ${onPlayHeal.actionName} had no damaged coral to heal.`;
        pushLog(message);
        setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: `Player's ${card.name} used ${onPlayHeal.actionName}`, message, success: false });
      }
    } else if (onPlayDrawCount) {
      beginPlayerOnPlayDraw(card, slotId);
      if (hasOnPlayAttack && foundationDeck.length + palsDeck.length >= onPlayDrawCount) beginOnPlayAttack(card, coral.id, slotId, -1, true);
    }
    else if (onPlayReorder) beginPlayerOnPlayReorder(card, slotId);
    if (onPlayResourceGain && !getOnPlayAttackEffect(card) && !getOnPlayUtilitySearch(card) && !onPlayDamage && !onPlayHeal && !onPlayDrawCount && !onPlayReorder && !randomDiscard && !cardHasSymbiosis(card) && !appliedDeckDiscard && !appliedSupportBlock) {
      const message = `${card.name}'s On Play ability gained ${actualOnPlayGain} RP${actualOnPlayGain < onPlayResourceGain ? `; the rest was prevented by the ${playerCapAfterPlacement} RP bank cap` : ""}. You now have ${rpAfterOnPlayGain}/${playerCapAfterPlacement} RP.`;
      setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: `Player's ${card.name} gained RP`, message, success: actualOnPlayGain > 0 });
    }
  }

  function placeCoralInEcosystem(x, y) {
    if (!playingCardId) return;
    const card = cardsById[playingCardId];
    if (!isFoundationCard(card) || Number(card.stage ?? 0) > 0) return;
    const coralId = createCoralId(playingCardId);
    const slots = createCoralSlots(card, coralId);
    const redistributed = redistributeOrphanCreatures([
      ...playerCorals,
      {
        id: coralId,
        cardId: playingCardId,
        name: card.name,
        image: card.image,
        x,
        y,
        slots,
        health: Number(card.health ?? 0),
        maxHealth: Number(card.health ?? 0),
        playedTurn: turn,
        stageEnteredTurn: turn,
      },
    ], playerOrphanCreatures);
    setPlayerCorals(redistributed.corals);
    setPlayerOrphanCreatures(redistributed.orphans);
    const playCost = getPlayerCardPlayCost(card);
    setHand((current) => removeOneCard(current, playingCardId));
    setRp((current) => Math.max(0, current - playCost));
    setPlayingCardId(null);
    setModal(null);
    setSelectedHandCard(null);
    setPlayError("");
    pushLog(`Played ${card.name} into your ecosystem for ${playCost} RP.${playerOrphanCreatures.length !== redistributed.orphans.length ? ` ${playerOrphanCreatures.length - redistributed.orphans.length} orphaned creature group(s) automatically occupied compatible slots.` : ""}`);
  }

  function upgradeCoral(coralId) {
    if (!isUpgradingCoral || !upgradeableCoralIds.has(coralId)) return;
    const coral = playerCorals.find((candidate) => candidate.id === coralId);
    if (!coral) return;

    const currentCard = cardsById[coral.cardId];
    const nextCard = cardsById[playingCardId];
    const upgradeCost = Number(currentCard?.upgrade?.cost?.rp ?? nextCard?.cost?.rp ?? 0);
    if (!nextCard || currentCard?.upgrade?.nextCardId !== nextCard.id || rp < upgradeCost) return;

    const upgradedCorals = playerCorals.map((candidate) =>
        candidate.id === coralId
          ? (() => {
              const previousMaxHealth = Number(candidate.maxHealth ?? currentCard.health ?? 0);
              const previousHealth = Number(candidate.health ?? previousMaxHealth);
              const nextMaxHealth = Number(nextCard.health ?? previousMaxHealth);
              return {
              ...candidate,
              cardId: nextCard.id,
              name: nextCard.name,
              image: nextCard.image,
              maxHealth: nextMaxHealth,
              health: preserveDamageOnUpgrade(previousHealth, previousMaxHealth, nextMaxHealth),
              slots: mergeUpgradedCoralSlots(candidate.slots, nextCard, candidate.id),
              stageEnteredTurn: turn,
              };
            })()
          : candidate,
      );
    const redistributed = redistributeOrphanCreatures(upgradedCorals, playerOrphanCreatures);
    setPlayerCorals(redistributed.corals);
    setPlayerOrphanCreatures(redistributed.orphans);
    setHand((current) => removeOneCard(current, nextCard.id));
    setRp((current) => current - upgradeCost);
    setPlayingCardId(null);
    setSelectedHandCard(null);
    setPlayError("");
    pushLog(`Upgraded ${currentCard.name} to ${nextCard.stageLabel} for ${upgradeCost} RP.${playerOrphanCreatures.length !== redistributed.orphans.length ? ` ${playerOrphanCreatures.length - redistributed.orphans.length} orphaned creature group(s) occupied the new compatible slots.` : ""}`);
    if (cardHasSchoolMomentum(nextCard)) {
      const candidates = [...new Set([...foundationDeck, ...palsDeck].filter((cardId) => isCreatureSchool(cardsById[cardId]) && cardsById[cardId]?.name !== nextCard.name))];
      if (candidates.length) {
        setSearchContext({ mode: "school-momentum", sourceCardId: nextCard.id, candidates });
        setEventOverlay({ type: "choose-school-momentum", sourceCardId: nextCard.id, title: `Player's ${nextCard.name} used Momentum`, message: "Choose a differently named Creature School from your decks to add to your hand. Both decks will be shuffled afterward." });
      } else {
        pushLog(`${nextCard.name}'s Momentum found no differently named Creature School.`);
      }
    }
  }

  function cancelCardPlay() {
    setPlayingCardId(null);
    setPlayError("");
  }

  function handleEcosystemClick(event) {
    if (!isPlacingCoral) return;
    const { x, y } = getPlacementCoordinates(event, ecosystemZoom, ecosystemOffset);
    placeCoralInEcosystem(x, y);
    queueBubbleBurstAtClientPoint(event.clientX, event.clientY);
  }

  function handleSlotPointerDown(coralId, slotId, event) {
    const slot = playerCorals.find((coral) => coral.id === coralId)?.slots.find((candidate) => candidate.id === slotId);
    if (!slot || playingCardId || isUpgradingCoral) return;
    event.stopPropagation();
    const coralElement = event.currentTarget.closest("[data-coral]");
    const dragElement = event.currentTarget.closest("[data-slot-drag-handle]") ?? event.currentTarget;
    if (!coralElement) return;
    slotWasDraggedRef.current = false;
    const nextSlotDragStart = {
      coralId,
      slotId,
      cardId: slot.cardId ?? null,
      pointerX: event.clientX,
      pointerY: event.clientY,
      coralRect: coralElement.getBoundingClientRect(),
    };
    slotDragStartRef.current = nextSlotDragStart;
    setSlotDragStart(nextSlotDragStart);
    try {
      if (dragElement && event.pointerId != null && dragElement.setPointerCapture) {
        dragElement.setPointerCapture(event.pointerId);
      }
    } catch (e) {
      // ignore pointer capture failures
    }
  }

  function handleCoralPointerDown(coralId, event) {
    event.preventDefault();
    event.stopPropagation();
    if (isUpgradingCoral) return;
    const coral = playerCorals.find((c) => c.id === coralId);
    if (!coral) return;
    coralWasDraggedRef.current = false;
    setDraggingCoralId(coralId);
    setCoralDragStart({
      coralId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: coral.x,
      startY: coral.y,
    });
    try {
      // capture pointer so pointermove/up events continue even if cursor leaves the image
      if (event.target && event.pointerId != null && event.target.setPointerCapture) {
        event.target.setPointerCapture(event.pointerId);
      }
    } catch (e) {
      // ignore
    }
  }

  function handleCoralClick(coralId, event) {
    event.preventDefault();
    event.stopPropagation();
    if (coralWasDraggedRef.current) {
      coralWasDraggedRef.current = false;
      return;
    }
    if (isUpgradingCoral) {
      upgradeCoral(coralId);
      return;
    }
    const coral = playerCorals.find((candidate) => candidate.id === coralId);
    if (coral) setInspectedCard({ owner: "player", cardId: coral.cardId, coralId, slotId: `foundation-${coralId}`, foundation: true });
  }

  function handleCoralDragEnd() {
    setDraggingCoralId(null);
    setCoralDragStart(null);
  }

  function handleSlotDragEnd() {
    slotDragStartRef.current = null;
    setSlotDragStart(null);
  }

  function handleEcosystemPointerDown(event) {
    if (isPlacingCoral) return;
    if (event.target.closest("button") || event.target.closest("[data-coral]")) return;
    event.preventDefault();
    setIsPanning(true);
    setPanStart({ x: event.clientX, y: event.clientY, offsetX: ecosystemOffset.x, offsetY: ecosystemOffset.y });
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch (e) {
      // ignore pointer capture failures
    }
  }

  function handleEcosystemPointerMove(event) {
    const activeSlotDrag = slotDragStartRef.current;
    if (activeSlotDrag) {
      const dragDistance = Math.abs(event.clientX - activeSlotDrag.pointerX) + Math.abs(event.clientY - activeSlotDrag.pointerY);
      if (dragDistance <= 5) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = activeSlotDrag.coralRect;
      slotWasDraggedRef.current = true;
      const left = ((event.clientX - rect.left) / rect.width) * 100;
      const top = ((event.clientY - rect.top) / rect.height) * 100;
      setPlayerCorals((current) =>
        current.map((coral) =>
          coral.id === activeSlotDrag.coralId
            ? {
                ...coral,
                slots: coral.slots.map((slot) =>
                  slot.id === activeSlotDrag.slotId ? { ...slot, position: { top: `${top}%`, left: `${left}%` }, count: 1 } : slot,
                ),
              }
            : coral,
        ),
      );
      return;
    }
    if (coralDragStart) {
      const rect = event.currentTarget.getBoundingClientRect();
      const dx = event.clientX - coralDragStart.pointerX;
      const dy = event.clientY - coralDragStart.pointerY;
      if (Math.abs(dx) + Math.abs(dy) > 5) coralWasDraggedRef.current = true;
      const x = ((coralDragStart.startX / 100) * rect.width + dx) / rect.width * 100;
      const y = ((coralDragStart.startY / 100) * rect.height + dy) / rect.height * 100;
      setPlayerCorals((current) =>
        current.map((coral) =>
          coral.id === coralDragStart.coralId
            ? { ...coral, x, y }
            : coral,
        ),
      );
      return;
    }
    if (!isPanning || !panStart) return;
    const dx = event.clientX - panStart.x;
    const dy = event.clientY - panStart.y;
    setEcosystemOffset({ x: panStart.offsetX + dx, y: panStart.offsetY + dy });
  }

  function handleEcosystemPointerUp(event) {
    const completedSlotGesture = slotDragStartRef.current;
    const shouldInspectChild = event?.type === "pointerup"
      && completedSlotGesture?.cardId
      && !slotWasDraggedRef.current;
    setIsPanning(false);
    setPanStart(null);
    setDraggingCoralId(null);
    setCoralDragStart(null);
    handleSlotDragEnd();
    if (shouldInspectChild) {
      setInspectedCard({
        owner: "player",
        cardId: completedSlotGesture.cardId,
        coralId: completedSlotGesture.coralId,
        slotId: completedSlotGesture.slotId,
      });
    }
  }

  function handleOpponentPointerDown(event) {
    if (event.target.closest("button")) return;
    event.preventDefault();
    setOpponentViewportTouched(true);
    setIsOpponentPanning(true);
    setOpponentPanStart({ x: event.clientX, y: event.clientY, offsetX: opponentEcosystemOffset.x, offsetY: opponentEcosystemOffset.y });
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }

  function handleOpponentPointerMove(event) {
    if (!isOpponentPanning || !opponentPanStart) return;
    setOpponentEcosystemOffset({
      x: opponentPanStart.offsetX + event.clientX - opponentPanStart.x,
      y: opponentPanStart.offsetY + event.clientY - opponentPanStart.y,
    });
  }

  function handleOpponentPointerUp() {
    setIsOpponentPanning(false);
    setOpponentPanStart(null);
  }

  function handleFloatingCardPointerDown(key, event) {
    event.preventDefault();
    event.stopPropagation();
    const offset = floatingCardOffsets[key] ?? { x: 0, y: 0 };
    floatingCardWasDraggedRef.current = false;
    const zoom = key.startsWith("opponent-") ? opponentEcosystemZoom : ecosystemZoom;
    setFloatingCardDrag({ key, pointerX: event.clientX, pointerY: event.clientY, startX: offset.x, startY: offset.y, zoom });
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }

  function handleFloatingCardPointerMove(event) {
    if (!floatingCardDrag) return;
    const zoom = Math.max(0.01, floatingCardDrag.zoom ?? 1);
    const x = floatingCardDrag.startX + (event.clientX - floatingCardDrag.pointerX) / zoom;
    const y = floatingCardDrag.startY + (event.clientY - floatingCardDrag.pointerY) / zoom;
    if (Math.abs(x - floatingCardDrag.startX) > 3 || Math.abs(y - floatingCardDrag.startY) > 3) floatingCardWasDraggedRef.current = true;
    setFloatingCardOffsets((current) => ({ ...current, [floatingCardDrag.key]: { x, y } }));
  }

  function handleFloatingCardPointerUp() {
    setFloatingCardDrag(null);
  }

  function inspectFloatingCard(details) {
    if (floatingCardWasDraggedRef.current) {
      floatingCardWasDraggedRef.current = false;
      return;
    }
    setInspectedCard(details);
  }

  useEffect(() => {
    const attachCursorZoom = (element, setZoom, setOffset, onAdjusted) => {
      if (!element) return () => {};
      const onWheel = (event) => {
        if (event.deltaY === 0) return;
        event.preventDefault();
        event.stopPropagation();
        onAdjusted?.();
        const rect = element.getBoundingClientRect();
        const distanceX = event.clientX - rect.left - rect.width / 2;
        const distanceY = event.clientY - rect.top - rect.height / 2;
        const delta = event.deltaY > 0 ? -0.05 : 0.05;
        setZoom((currentZoom) => {
          const newZoom = clampZoom(currentZoom + delta);
          if (newZoom === currentZoom) return currentZoom;
          setOffset((currentOffset) => ({
            x: distanceX - ((distanceX - currentOffset.x) / currentZoom) * newZoom,
            y: distanceY - ((distanceY - currentOffset.y) / currentZoom) * newZoom,
          }));
          return newZoom;
        });
      };
      element.addEventListener("wheel", onWheel, { passive: false, capture: true });
      return () => element.removeEventListener("wheel", onWheel, { capture: true });
    };
    const detachPlayer = attachCursorZoom(ecosystemRef.current, setEcosystemZoom, setEcosystemOffset);
    const detachOpponent = attachCursorZoom(opponentEcosystemRef.current, setOpponentEcosystemZoom, setOpponentEcosystemOffset, () => setOpponentViewportTouched(true));
    return () => {
      detachPlayer();
      detachOpponent();
    };
  }, []);

  function pushLog(text) {
    setLog((current) => [text, ...current].slice(0, 50));
    setTurnLog((current) => [...current, text].slice(-12));
  }

  function applyCurrentHandLimit(cardIds, currentHandSize = hand.length) {
    const handLimitEffect = (activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit");
    const handLimit = handLimitEffect ? Number(handLimitEffect.amount) : Infinity;
    return drawWithHandLimit(cardIds, currentHandSize, cardIds.length, handLimit);
  }

  function getCardsInPlayForComposition(corals, reefCreatureIds, orphanEntries) {
    return [
      ...(corals ?? []).flatMap((foundation) => [
        foundation.cardId,
        ...(foundation.slots ?? []).flatMap((slot) => getSlotCardIds(slot)),
      ]),
      ...(reefCreatureIds ?? []),
      ...(orphanEntries ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])]),
    ];
  }

  function resolvePlayerEndOfTurnHabitats() {
    const result = resolveEndOfTurnHabitatMaintenance(playerHabitatInstances, {
      cardsInPlay: getCardsInPlayForComposition(playerCorals, playerReefCreatures, playerOrphanCreatures),
      cardLookup: cardsById,
      habitatLookup: cardsById,
    });
    if (!result.events.length) return { ...result, messages: [] };
    setPlayerHabitatInstances(result.habitats);
    if (result.destroyedHabitats.length) {
      setDiscardPile((current) => [...result.destroyedHabitats.map((habitat) => habitat.cardId), ...current]);
    }
    const messages = result.events.map((event) => {
      const message = event.destroyed
        ? `${cardsById[event.cardId]?.name} took ${event.appliedDamage} end-of-turn damage because its ecosystem requirement was not met and was destroyed.`
        : `${cardsById[event.cardId]?.name} took ${event.appliedDamage} end-of-turn damage because its ecosystem requirement was not met. ${event.currentHealth}/${event.previousHealth === event.currentHealth ? event.currentHealth : playerHabitatInstances.find((habitat) => habitat.instanceId === event.instanceId)?.maxHealth ?? event.previousHealth} HP remains.`;
      pushLog(message);
      return message;
    });
    return { ...result, messages };
  }

  function queueEvents(eventsToAdd) {
    if (!eventsToAdd.length) return;
    if (eventOverlay) {
      setPendingEvents((events) => [...events, ...eventsToAdd]);
      return;
    }
    const [firstEvent, ...remainingEvents] = eventsToAdd;
    if (firstEvent?.type === "choose-regenerate") commitEventState(firstEvent);
    setEventOverlay(firstEvent);
    setPendingEvents((events) => [...events, ...remainingEvents]);
  }

  function commitEventState(event) {
    if (event?.opponentStateAfter) setOpponent(event.opponentStateAfter);
    if (event?.playerStateAfter) {
      const next = normalizeProjectedPlayerState(event.playerStateAfter);
      const has = (key) => Object.prototype.hasOwnProperty.call(next, key);
      if (has("corals")) setPlayerCorals(next.corals);
      if (has("reefCreatureInstances")) setPlayerReefCreatureInstances(next.reefCreatureInstances);
      if (has("orphanCreatureInstances")) setPlayerOrphanCreatureInstances(next.orphanCreatureInstances);
      if (has("hand")) setHand(next.hand);
      if (has("discardPile")) setDiscardPile(next.discardPile);
      if (has("foundationDeck")) setFoundationDeck(next.foundationDeck);
      if (has("palsDeck")) setPalsDeck(next.palsDeck);
      if (has("rp")) setRp(next.rp);
      if (has("supportBlockedUntilRound")) setSupportBlockedUntilRound(next.supportBlockedUntilRound);
      if (has("resilienceUsedCardIds")) setResilienceUsedCardIds(next.resilienceUsedCardIds);
      if (has("creatureStatuses")) setCreatureStatuses(next.creatureStatuses);
      if (has("blueCrabRecycleUsedTurn")) setBlueCrabRecycleUsedTurn(next.blueCrabRecycleUsedTurn);
    }
    const eventLogMessages = [
      ...(event?.logMessages ?? []),
      ...(event?.logMessage ? [event.logMessage] : []),
    ].filter(Boolean);
    if (eventLogMessages.length) {
      setLog((current) => [...eventLogMessages].reverse().concat(current).slice(0, 50));
    }
    if (event?.gameResultAfter) setGameResult((current) => current ?? event.gameResultAfter);
  }

  function closeEventOverlay() {
    setFaceoffRolling(false);
    setFaceoffPreview(null);
    commitEventState(eventOverlay);
    if (eventOverlay?.continueAttackSequence) {
      setEventOverlay(null);
      return;
    }
    if (eventOverlay?.beginOpponentAfterClose) {
      setEventOverlay(null);
      setPendingEvents([]);
      if (gameResult) return;
      setGamePhase("opponent");
      setOpponentThinking(true);
      opponentThinkingTimerRef.current = setTimeout(() => {
        opponentThinkingTimerRef.current = null;
        resolveOpponentTurnRef.current?.();
      }, scaleOpponentThinkingDelay(Number(eventOverlay.thinkingDelay ?? 1200), opponentDifficulty));
      return;
    }
    if (eventOverlay?.advanceRoundAfterClose) {
      setEventOverlay(null);
      setPendingEvents([]);
      if (gameResult || eventOverlay.gameResultAfter) return;
      startRound(round + 1, { advanceTurn: true });
      return;
    }
    const [nextEvent, ...remaining] = pendingEvents;
    setPendingEvents(remaining);
    if (nextEvent?.opponentSequence) {
      const isComplexDecision = ["faceoff-result", "opponent-impact", "turn-transition"].includes(nextEvent.type) || playerVp >= victoryTarget - 8 || opponentVp >= victoryTarget - 8;
      const delay = scaleOpponentThinkingDelay(isComplexDecision ? 1500 : 900, opponentDifficulty);
      setEventOverlay(null);
      setOpponentThinking(true);
      opponentThinkingTimerRef.current = setTimeout(() => {
        opponentThinkingTimerRef.current = null;
        setOpponentThinking(false);
        if (nextEvent.type === "choose-regenerate") commitEventState(nextEvent);
        setEventOverlay(nextEvent);
      }, delay);
    } else {
      setEventOverlay(nextEvent ?? null);
    }
  }

  function drawNextCondition() {
    const availableConditionIds = conditionCards.map((card) => card.id).filter((conditionId) => !persistentConditionIds.includes(conditionId));
    const source = conditionDeck.length ? conditionDeck : shuffle(availableConditionIds);
    const conditionId = source[0] ?? null;
    setConditionDeck(source.slice(1));
    setActiveConditionId(conditionId);
    const condition = conditionId ? cardsById[conditionId] : null;
    if (condition?.tags?.includes("persistent")) {
      setPersistentConditionIds((current) => current.includes(conditionId) ? current : [...current, conditionId]);
    }
    return condition;
  }

  function startRound(nextRound, { advanceTurn = false } = {}) {
    const condition = drawNextCondition();
    const ecosystemRp = getEcosystemStartTurnRp(playerCorals, condition);
    const collectedRp = 1 + ecosystemRp;
    const roundRpCap = getEcosystemRpCap(playerCorals, [...playerHabitats, ...playerReefCreatures, ...playerOrphanCreatures.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])], condition);
    const parasiteRequestedRp = getParasiteRequestedRp(
      playerCorals,
      playerReefCreatures,
      playerOrphanCreatures,
      opponent.corals,
      opponent.reefCreatures,
      opponent.orphanCreatures,
    );
    const parasiteTransfer = resolveResourceTransfer({
      requested: parasiteRequestedRp,
      sourceAmount: opponent.rp,
      recipientAmount: rp,
      recipientCap: roundRpCap,
    });
    const parasiteMessage = describeParasiteTransfer("Your Cookie Cutter", parasiteTransfer);
    const rpBeforeCollection = parasiteTransfer.recipientAfter;
    const rpAfterCollection = addResourceWithinCap(rpBeforeCollection, collectedRp, roundRpCap);
    const actualCollectedRp = Math.max(0, rpAfterCollection - Math.min(rpBeforeCollection, roundRpCap));
    const cappedRp = Math.max(0, rpBeforeCollection + collectedRp - rpAfterCollection);
    setRp(rpAfterCollection);
    setPlayerCorals((current) => current.map(({ rpPenaltyNextTurn, ...coral }) => coral));
    if (parasiteRequestedRp) {
      setOpponent((current) => ({ ...current, rp: parasiteTransfer.sourceAfter }));
    }
    const handLimitEffect = (condition?.effects ?? []).find((effect) => effect.type === "setHandLimit");
    const handLimit = Number(handLimitEffect?.amount ?? Infinity);
    const excessCards = Number.isFinite(handLimit) && hand.length > handLimit ? hand.slice(handLimit) : [];
    const opponentExcessCards = Number.isFinite(handLimit) && opponent.hand.length > handLimit ? opponent.hand.slice(handLimit) : [];
    if (excessCards.length) {
      setHand((current) => current.slice(0, handLimit));
      setDiscardPile((current) => [...excessCards, ...current]);
    }
    if (opponentExcessCards.length) {
      setOpponent((current) => ({
        ...current,
        hand: current.hand.slice(0, handLimit),
        discardPile: [...current.hand.slice(handLimit), ...current.discardPile],
      }));
    }
    setRound(nextRound);
    setTurnLog([]);
    setGamePhase("draw");
    setHasDrawnThisTurn(false);
    const requestedDraws = 1 + getConditionExtraDraws(condition);
    const availableDraws = Math.min(requestedDraws, foundationDeck.length + palsDeck.length);
    setTurnDrawSelection({ requested: requestedDraws, target: availableDraws, shortfall: getRequiredDrawShortfall(requestedDraws, availableDraws), foundation: 0, pals: 0 });
    setTurnDrawResult(null);
    if (advanceTurn) setTurn((current) => current + 1);
    setModal(availableDraws > 0 ? "turn-draw" : null);
    setPlayingCardId(null);
    setUsedAttackers([]);
    setUsedCreatureActions([]);
    setPendingCreatureAction(null);
    if (advanceTurn) {
      const nextPlayerTurn = turn + 1;
      setCreatureStatuses((current) => Object.fromEntries(Object.entries(current).map(([slotId, statuses]) => [slotId, statuses.filter((status) => status.expiresTurn > nextPlayerTurn)]).filter(([, statuses]) => statuses.length)));
    }
    setSupportLockSourceId(null);
    setRovLightsActive(false);
    setAttackContext(null);
    setSearchContext(null);
    setPlayError("");
    if (availableDraws === 0) setGameResult((current) => current ?? `Defeat: you were required to draw ${requestedDraws} card${requestedDraws === 1 ? "" : "s"}, but both personal decks were empty.`);
    if (condition) {
      const roundNotes = [
        requestedDraws > 1 ? `This round, each player draws ${requestedDraws} cards during their draw phase.` : null,
        Number.isFinite(handLimit) ? `The hand limit this round is ${handLimit}.` : null,
        condition.tags?.includes("persistent") ? "This condition remains in play after the round ends." : "This condition applies for the current round.",
      ].filter(Boolean);
      setEventOverlay({
        type: "condition-reveal",
        sourceCardId: condition.id,
        title: `Round ${nextRound}`,
        message: condition.text,
        conditionName: condition.name,
        conditionText: condition.text,
        turnCollection: {
          collected: actualCollectedRp,
          available: collectedRp,
          bank: rpAfterCollection,
          cap: roundRpCap,
          capped: cappedRp,
        },
        roundNotes,
      });
    }
    setPendingEvents(parasiteRequestedRp ? [{
      type: "impact-result",
      sourceCardId: "cookie-cutter-shark",
      title: "Player's Cookie Cutter used Parasite",
      message: parasiteMessage,
      success: parasiteTransfer.transferred > 0,
    }] : []);
    pushLog(
      `Round ${nextRound}: revealed ${condition?.name ?? "no condition"}. Collected ${actualCollectedRp} RP from ${collectedRp} available; bank ${rpAfterCollection}/${roundRpCap}.${cappedRp ? ` ${cappedRp} RP was discarded at the cap.` : ""} Now choose your card draw.${parasiteMessage ? ` ${parasiteMessage}` : ""}${excessCards.length ? ` Your hand limit discarded ${excessCards.length} excess card(s).` : ""}${opponentExcessCards.length ? ` The opponent's hand limit discarded ${opponentExcessCards.length} excess card(s).` : ""}`,
    );
  }

  function beginFirstRound() {
    if (!hasCoralInPlay) {
      setPlayError("Play a base Coral or Creature School before beginning round 1.");
      setModal("hand");
      return;
    }
    startRound(1);
  }

  function adjustTurnDraw(deckType, delta) {
    setTurnDrawSelection((current) => {
      if (!current) return current;
      const nextAmount = current[deckType] + delta;
      const available = deckType === "foundation" ? foundationDeck.length : palsDeck.length;
      const nextTotal = current.foundation + current.pals + delta;
      if (nextAmount < 0 || nextAmount > available || nextTotal < 0 || nextTotal > current.target) return current;
      return { ...current, [deckType]: nextAmount };
    });
  }

  function confirmTurnDraw() {
    if (!turnDrawSelection || turnDrawSelection.foundation + turnDrawSelection.pals !== turnDrawSelection.target) return;
    const foundationCards = foundationDeck.slice(0, turnDrawSelection.foundation);
    const palsCards = palsDeck.slice(0, turnDrawSelection.pals);
    const drawnCards = [...foundationCards, ...palsCards];
    const handLimitEffect = (activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit");
    const drawResult = drawWithHandLimit(drawnCards, hand.length, drawnCards.length, handLimitEffect ? Number(handLimitEffect.amount) : Infinity);
    setFoundationDeck((current) => current.slice(foundationCards.length));
    setPalsDeck((current) => current.slice(palsCards.length));
    setHand((current) => [...current, ...drawResult.cardsToHand]);
    if (drawResult.cardsToDiscard.length) setDiscardPile((current) => [...drawResult.cardsToDiscard, ...current]);
    const revealed = drawnCards.map((cardId, index) => ({
      cardId,
      source: index < foundationCards.length ? "Foundation" : "Pals",
      discarded: index >= drawResult.cardsToHand.length,
    }));
    setTurnDrawResult(revealed);
    setHasDrawnThisTurn(true);
    setGamePhase("main");
    setModal("draw-result");
    pushLog(`Drew ${foundationCards.length} from Foundation and ${palsCards.length} from Pals.${drawResult.cardsToDiscard.length ? ` Hand limit discarded ${drawResult.cardsToDiscard.length} card(s).` : ""}${turnDrawSelection.shortfall > 0 ? " The required draw could not be completed, so you lose by deck depletion." : ""}`);
    if (turnDrawSelection.shortfall > 0) {
      setGameResult((current) => current ?? `Defeat: you were required to draw ${turnDrawSelection.requested} cards, but your personal decks contained only ${turnDrawSelection.target}.`);
    }
  }

  function getPlayerOceanicSacrificeChoices(card) {
    const requiresSacrifice = (card?.specialRules ?? []).some((rule) => /discard one oceanic predator or two oceanic fish/i.test(typeof rule === "string" ? rule : rule?.text ?? ""));
    if (!requiresSacrifice) return [];
    const candidates = [
      ...playerCorals.flatMap((coral) => coral.slots.filter((slot) => slot.cardId).map((slot) => ({
        instanceId: getSlotTargetInstanceId(slot),
        cardId: slot.cardId,
        card: cardsById[slot.cardId],
        location: "slot",
        coralId: coral.id,
        slotId: slot.id,
        hostedCardIds: [...(slot.hostedCardIds ?? [])],
      }))),
      ...playerReefCreatureInstances.map((instance) => ({ ...instance, card: cardsById[instance.cardId], location: "reef" })),
      ...playerOrphanCreatureInstances.map((instance) => ({ ...instance, card: cardsById[instance.cardId], location: "orphan" })),
    ];
    return getOceanicApexSacrificeChoices(candidates, cardsById);
  }

  function completePlayerOceanicPlay(cardId, choiceId = null) {
    const card = cardsById[cardId];
    if (!card || !hand.includes(cardId)) return;
    const choices = getPlayerOceanicSacrificeChoices(card);
    const requiresSacrifice = (card.specialRules ?? []).some((rule) => /discard one oceanic predator or two oceanic fish/i.test(typeof rule === "string" ? rule : rule?.text ?? ""));
    const choice = requiresSacrifice ? choices.find((candidate) => candidate.id === choiceId) : { candidates: [] };
    if (requiresSacrifice && !choice) {
      setPlayError(`${card.name}'s sacrifice choices changed. Choose a currently legal option.`);
      setSearchContext(null);
      setEventOverlay(null);
      return;
    }
    const sacrifices = choice.candidates ?? [];
    const sacrificedSlotIds = new Set(sacrifices.filter((entry) => entry.location === "slot").map((entry) => entry.slotId));
    const sacrificedReefIds = sacrifices.filter((entry) => entry.location === "reef").map((entry) => entry.instanceId);
    const sacrificedOrphanIds = sacrifices.filter((entry) => entry.location === "orphan").map((entry) => entry.instanceId);
    const freedHostedCardIds = [
      ...sacrifices.filter((entry) => entry.location === "slot").flatMap((entry) => entry.hostedCardIds ?? []),
      ...sacrifices.filter((entry) => entry.location === "orphan").flatMap((entry) => entry.hostedCardIds ?? []),
    ];
    const nextPlayerCorals = sacrificedSlotIds.size
      ? playerCorals.map((coral) => ({ ...coral, slots: coral.slots.map((slot) => sacrificedSlotIds.has(slot.id) ? { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot) }))
      : playerCorals;
    if (sacrificedSlotIds.size) setPlayerCorals(nextPlayerCorals);
    const remainingReefInstances = removeCreatureInstances(playerReefCreatureInstances, sacrificedReefIds).instances;
    const playedInstance = createCreatureInstance(card.id, createStableInstanceId(`player-reef-${card.id}`), {
      territorialTargetFoundationId: null,
    });
    const nextReefInstances = [...remainingReefInstances, playedInstance];
    setPlayerReefCreatureInstances(nextReefInstances);
    queueBubbleBurst(76, 24);
    const remainingOrphans = removeCreatureInstances(playerOrphanCreatureInstances, sacrificedOrphanIds).instances;
    const nextOrphanInstances = sacrificedOrphanIds.length || freedHostedCardIds.length
      ? [...remainingOrphans, ...freedHostedCardIds.map((hostedCardId) => createCreatureInstance(hostedCardId, createStableInstanceId(`player-orphan-${hostedCardId}`)))]
      : playerOrphanCreatureInstances;
    if (sacrificedOrphanIds.length || freedHostedCardIds.length) setPlayerOrphanCreatureInstances(nextOrphanInstances);
    if (sacrifices.length) setDiscardPile((current) => [...sacrifices.map((entry) => entry.cardId), ...current]);
    const playCost = getPlayerCardPlayCost(card);
    const onPlayResourceGain = getResourceGainFromActions(card.onPlay, "rp");
    const rpAfterCost = Math.max(0, rp - playCost);
    const playerCapAfterPlacement = getEcosystemRpCap(nextPlayerCorals, [
      ...playerHabitats,
      ...nextReefInstances.map((instance) => instance.cardId),
      ...nextOrphanInstances.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])]),
    ], activeCondition);
    const rpAfterOnPlayGain = addResourceWithinCap(rpAfterCost, onPlayResourceGain, playerCapAfterPlacement);
    const actualOnPlayGain = rpAfterOnPlayGain - rpAfterCost;
    setHand((current) => removeOneCard(current, card.id));
    setRp(rpAfterOnPlayGain);
    consumePlayerSchoolDensityDiscount(card);
    setSelectedHandCard(null);
    setPlayError("");
    setSearchContext(null);
    const sacrificeMessage = sacrifices.length ? ` As its additional play cost, ${sacrifices.map((entry) => entry.card.name).join(" and ")} ${sacrifices.length === 1 ? "was" : "were"} discarded by your choice.` : "";
    const territorialCandidates = card.id === "ocean-triggerfish" ? nextPlayerCorals.filter((foundation) => isCreatureSchool(cardsById[foundation.cardId])) : [];
    const territorialMessage = card.id === "ocean-triggerfish" ? territorialCandidates.length ? " Territorial is waiting for you to choose one of your Creature Schools." : " Territorial found no Creature School to protect." : "";
    const resourceMessage = onPlayResourceGain
      ? ` ${getOnPlayAbilityName(card)} gained ${actualOnPlayGain} RP${actualOnPlayGain < onPlayResourceGain ? `; the ${playerCapAfterPlacement} RP bank cap prevented the rest` : ""}.`
      : "";
    const message = `${card.name} entered your open-water ecosystem for ${playCost} RP at ${playerSchoolDensity} School Density.${sacrificeMessage}${territorialMessage}${resourceMessage}`;
    pushLog(message);
    const playedSlotId = `reef-${playedInstance.instanceId}`;
    const onPlayDamage = getOnPlayFoundationDamage(card, [...playerHabitats, ...nextPlayerCorals.map((foundation) => foundation.cardId)]);
    const onPlayDamageTargets = onPlayDamage?.targetType === "creature-school"
      ? opponentCorals.filter((foundation) => isCreatureSchool(cardsById[foundation.cardId]))
      : opponentCoralCards;
    const hasOnPlayAttack = Boolean(getOnPlayAttackEffect(card));
    const discardedOpponentDeck = applyPlayerOnPlayDeckDiscard(card);
    const blockedOpponentSupports = applyPlayerOnPlaySupportBlock(card);
    const beganOnPlaySearch = beginPlayerOnPlaySearch(card, playedSlotId);
    const beganOnPlayAttack = onPlayDamage
      ? false
      : beginOnPlayAttack(card, null, playedSlotId, nextReefInstances.length - 1, discardedOpponentDeck || blockedOpponentSupports);
    let beganOnPlayDamage = false;
    if (onPlayDamage && onPlayDamageTargets.length) {
      beganOnPlayDamage = true;
      setEventOverlay({
        type: "choose-impact-target",
        sourceCardId: card.id,
        title: `Player's ${card.name} used ${onPlayDamage.actionName}`,
        message: `Choose an opponent ${onPlayDamage.targetType === "creature-school" ? "Creature School" : "coral"} to receive ${onPlayDamage.amount} damage.`,
        amount: onPlayDamage.amount,
        targetCoralIds: onPlayDamageTargets.map((foundation) => foundation.id),
        followupOnPlayAttack: hasOnPlayAttack ? { coralId: null, slotId: playedSlotId, reefIndex: nextReefInstances.length - 1 } : null,
      });
    } else if (onPlayDamage) {
      beganOnPlayDamage = true;
      const noTargetMessage = `${card.name}'s ${onPlayDamage.actionName} had no legal opponent ${onPlayDamage.targetType === "creature-school" ? "Creature School" : "coral"} target.`;
      pushLog(noTargetMessage);
      setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: `Player's ${card.name} used ${onPlayDamage.actionName}`, message: noTargetMessage, success: false });
      if (hasOnPlayAttack) beginOnPlayAttack(card, null, playedSlotId, nextReefInstances.length - 1, true);
    }
    const beganOnPlayDraw = !beganOnPlayDamage && !beganOnPlayAttack && !beganOnPlaySearch && !discardedOpponentDeck && !blockedOpponentSupports
      ? beginPlayerOnPlayDraw(card, playedSlotId)
      : false;
    let beganTerritorialChoice = false;
    if (card.id === "ocean-triggerfish" && !beganOnPlayDamage && !beganOnPlayAttack && !beganOnPlaySearch && !beganOnPlayDraw && !discardedOpponentDeck && !blockedOpponentSupports) {
      beganTerritorialChoice = true;
      if (territorialCandidates.length) {
        setSearchContext({ mode: "territorial-target", sourceCardId: card.id, sourceInstanceId: playedInstance.instanceId, candidates: territorialCandidates.map((foundation) => foundation.id) });
        setEventOverlay({ type: "choose-territorial-target", sourceCardId: card.id, title: `Player's ${card.name} used Territorial`, message: "Choose one of your Creature Schools. It gets +10 HP while this Ocean Triggerfish remains in play." });
      } else {
        setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: `Player's ${card.name} used Territorial`, message: `${card.name}'s Territorial had no Creature School to target.`, success: false });
      }
    }
    if (!beganTerritorialChoice && !beganOnPlayDamage && !beganOnPlayAttack && !beganOnPlaySearch && !beganOnPlayDraw && !discardedOpponentDeck && !blockedOpponentSupports) setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: `Player played ${card.name}`, message, success: true });
  }

  function playCardFromHand(cardId) {
    const card = cardsById[cardId];
    if (!card) {
      setPlayError("Select a card first.");
      return;
    }
    const error = getPlayError(card);
    if (error) {
      setPlayError(error);
      return;
    }
    if (isFoundationCard(card)) {
      setPlayingCardId(cardId);
      setModal(null);
      setPlayError("");
      return;
    }
    if (card.kind === CardKind.CREATURE) {
      if (cardUsesOpponentReef(card)) {
        const candidates = opponentCoralCards.flatMap((coral) => (coral.slots ?? []).flatMap((slot) => !slot.cardId ? [{ coralId: coral.id, slotId: slot.id }] : []));
        setSearchContext({ mode: "invasive-placement", cardId: card.id, candidates });
        setSelectedHandCard(null);
        setModal(null);
        setPlayError("");
        setEventOverlay({ type: "choose-invasive-placement", sourceCardId: card.id, title: `Place ${card.name} on the Rival Reef`, message: `${card.name} may occupy any empty opponent coral slot. Choose a slot below, or cancel to spend no card and no RP.` });
        return;
      }
      if (card.zone === CreatureZone.OCEAN && !isCreatureSchool(card)) {
        const choices = getPlayerOceanicSacrificeChoices(card);
        if (choices.length) {
          setSearchContext({ mode: "oceanic-sacrifice", cardId: card.id, choices });
          setEventOverlay({ type: "choose-oceanic-sacrifice", sourceCardId: card.id, title: `Choose ${card.name}'s Sacrifice`, message: "Choose one Oceanic Predator or two Oceanic Fish. No card or RP is spent until you confirm a choice." });
          return;
        }
        completePlayerOceanicPlay(card.id);
        return;
      }
      setPlayingCardId(cardId);
      setModal(null);
      setPlayError("Choose a valid coral slot to place this creature.");
      return;
    }
    if (card.kind === CardKind.HABITAT) {
      const playCost = getPlayerCardPlayCost(card);
      setPlayerHabitats((current) => [...current, card.id]);
      setHand((current) => removeOneCard(current, card.id));
      setRp((current) => Math.max(0, current - playCost));
      setSelectedHandCard(null);
      setPlayError("");
      pushLog(`Played ${card.name} as a habitat for ${playCost} RP.`);
      return;
    }
    if (card.kind === CardKind.SUPPORT) {
      if (card.id === "spearfishing") {
        const candidates = playerCorals.flatMap((coral) => coral.slots.filter((slot) => {
          const target = cardsById[slot.cardId];
          return target && [CardCategory.FISH, CardCategory.PREDATOR].includes(target.category);
        }).map((slot) => ({ coralId: coral.id, slotId: slot.id, cardId: slot.cardId, hostedCardIds: [...(slot.hostedCardIds ?? [])] })));
        playerReefCreatures.forEach((candidateId, reefIndex) => {
          if ([CardCategory.FISH, CardCategory.PREDATOR].includes(cardsById[candidateId]?.category)) candidates.push({ coralId: "__reef__", slotId: getPlayerReefSlotId(reefIndex), cardId: candidateId, reefIndex, instanceId: playerReefCreatureInstances[reefIndex]?.instanceId });
        });
        playerOrphanCreatures.forEach((entry, orphanIndex) => {
          if ([CardCategory.FISH, CardCategory.PREDATOR].includes(cardsById[entry.cardId]?.category)) candidates.push({ coralId: "__orphan__", slotId: getPlayerOrphanSlotId(orphanIndex), cardId: entry.cardId, orphanIndex, instanceId: entry.instanceId });
        });
        setSearchContext({ mode: "spearfishing", supportCardId: card.id, candidates });
        setSelectedHandCard(null);
        setModal(null);
        setEventOverlay({ type: "choose-spearfishing-target", sourceCardId: card.id, title: "Player used Spearfishing", message: "Choose one of your Fish or Predators to discard and recover its printed RP cost. You may cancel without spending the Support card." });
        return;
      }
      if (card.id === "whirlpool" || card.id === "super-whirlpool") {
        const effect = (card.effects ?? []).find((candidate) => candidate.type === EffectType.MODIFY_RP_GENERATION);
        setSearchContext({ mode: "whirlpool", supportCardId: card.id, candidates: opponentCoralCards.map((coral) => coral.id), amount: Math.abs(Number(effect?.amount ?? 0)) });
        setSelectedHandCard(null);
        setModal(null);
        setEventOverlay({ type: "choose-whirlpool-target", sourceCardId: card.id, title: `Player used ${card.name}`, message: `Choose an opponent coral. It will produce ${Math.abs(Number(effect?.amount ?? 0))} less RP during the opponent's next collection. Cancel to spend nothing.` });
        return;
      }
      if (card.id === "coral-heal") {
        const candidates = playerCoralCards.filter((coral) => (coral.statuses ?? []).length || Number(coral.rpPenaltyNextTurn ?? 0) > 0).map((coral) => coral.id);
        setSearchContext({ mode: "clear-coral-status", supportCardId: card.id, candidates });
        setSelectedHandCard(null);
        setModal(null);
        setEventOverlay({ type: "choose-clear-status-target", sourceCardId: card.id, title: `Player used ${card.name}`, message: "Choose one of your affected corals to remove all tracked status effects. You may cancel without spending the Support card." });
        return;
      }
      if (card.id === "poison-heal") {
        const playCost = getPlayerCardPlayCost(card);
        setHand((current) => removeOneCard(current, card.id));
        setDiscardPile((current) => [card.id, ...current]);
        setRp((current) => Math.max(0, current - playCost));
        setPoisonImmunityNextPredatorAttack(true);
        applyExplicitSupportLock(card);
        setSelectedHandCard(null);
        const message = "Poison Heal will make your next attack ignore effects from Toxic, then expire.";
        pushLog(message);
        setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: "Player used Poison Heal", message, success: true });
        return;
      }
      if (card.id === "rov-lights") {
        const playCost = getPlayerCardPlayCost(card);
        setHand((current) => removeOneCard(current, card.id));
        setDiscardPile((current) => [card.id, ...current]);
        setRp((current) => Math.max(0, current - playCost));
        setRovLightsActive(true);
        applyExplicitSupportLock(card);
        setSelectedHandCard(null);
        const message = "ROV Lights gives your attacks +2 when they target Deep creatures until your turn ends.";
        pushLog(message);
        setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: "Player used ROV Lights", message, success: true });
        return;
      }
      if (card.id === "robotic-survey" || card.id === "explorer-jordan") {
        setSearchContext({ mode: "choose-inspection-deck", supportCardId: card.id, candidates: [] });
        setSelectedHandCard(null);
        setModal(null);
        setEventOverlay({ type: "choose-inspection-deck", sourceCardId: card.id, title: `Player used ${card.name}`, message: "Choose which personal deck to inspect. You may cancel before committing the Support card." });
        return;
      }
      if (card.id === "dr-evans") {
        setSearchContext({ mode: "draw-seven", supportCardId: card.id, candidates: [] });
        const target = Math.min(7, foundationDeck.length + palsDeck.length);
        setTurnDrawSelection({ requested: 7, target, shortfall: getRequiredDrawShortfall(7, target), foundation: 0, pals: 0, mode: "dr-evans" });
        setModal("support-draw");
        setSelectedHandCard(null);
        setPlayError("");
        return;
      }
      if (card.id === "coral-cement") {
        const candidates = playerCoralCards.filter((coral) => (coral.health ?? coral.maxHealth) < coral.maxHealth).map((coral) => coral.id);
        setSearchContext({ mode: "heal-coral", supportCardId: card.id, candidates });
        setModal("coral-target");
        setSelectedHandCard(null);
        setPlayError("");
        return;
      }
      if (card.id === "restocking") {
        const candidates = discardPile.filter((candidateId) => {
          const candidate = cardsById[candidateId];
          return candidate?.kind === CardKind.CREATURE && candidate.category === CardCategory.FISH;
        });
        setSearchContext({ mode: "restock", supportCardId: card.id, candidates, selectedIndices: [] });
        setModal("restock");
        setSelectedHandCard(null);
        setPlayError("");
        return;
      }
      if (card.id === "recovery") {
        const cost = getPlayerCardPlayCost(card);
        const recoveredCandidates = [...new Set(discardPile)];
        setHand((current) => removeOneCard(current, card.id));
        setDiscardPile((current) => [card.id, ...current]);
        setRp((current) => Math.max(0, current - cost));
        applyExplicitSupportLock(card);
        setSelectedHandCard(null);
        if (Math.random() < 0.5) {
          setSearchContext({ mode: "recover", supportCardId: card.id, candidates: recoveredCandidates });
          setModal("recover");
          pushLog("Recovery coin flip: heads. Choose a card that was already in your discard pile.");
        } else {
          setModal("hand");
          pushLog("Recovery coin flip: tails. No card was recovered, and Recovery was discarded.");
        }
        return;
      }
      if (card.id === "scientist-jes") {
        setSearchContext({ mode: "scientist-jes-choice", supportCardId: card.id, candidates: [] });
        setSelectedHandCard(null);
        setModal(null);
        setPlayError("");
        setEventOverlay({ type: "choose-scientist-jes", sourceCardId: card.id, title: "Player used Scientist Jes", message: "Choose one effect: search your personal decks for a Habitat, or draw two cards split however you like between Foundation and Pals." });
        return;
      }
      const searchEffect = (card.effects ?? []).find((effect) => effect.type === EffectType.SEARCH_DECK);
      const candidates = [...new Set([...foundationDeck, ...palsDeck].filter((candidateId) => {
        const candidate = cardsById[candidateId];
        if (!candidate || candidate.kind !== searchEffect?.targetKind) return false;
        if (searchEffect.targetCategories?.length && !searchEffect.targetCategories.includes(candidate.category)) return false;
        if (searchEffect.targetTags?.some((tag) => !candidate.tags?.includes(tag))) return false;
        return !searchEffect.excludeTags?.some((tag) => candidate.tags?.includes(tag));
      }))];
      setSearchContext({ mode: "deck", supportCardId: card.id, candidates, maxSelect: Math.max(1, Number(searchEffect?.amount ?? 1)), selected: [] });
      setModal("search");
      setSelectedHandCard(null);
      setPlayError("");
      return;
    }
    setPlayError("This card type cannot be placed yet.");
  }

  function completeInvasivePlacement(coralId, slotId) {
    if (searchContext?.mode !== "invasive-placement" || !searchContext.candidates.some((candidate) => candidate.coralId === coralId && candidate.slotId === slotId)) return;
    const card = cardsById[searchContext.cardId];
    const targetCoral = opponent.corals.find((coral) => coral.id === coralId && cardsById[coral.cardId]?.kind === CardKind.CORAL);
    const targetSlot = targetCoral?.slots.find((slot) => slot.id === slotId);
    if (!card || !cardUsesOpponentReef(card) || !hand.includes(card.id) || !targetSlot || targetSlot.cardId) {
      const message = "That rival slot is no longer available. No card or RP was spent.";
      setSearchContext(null);
      setEventOverlay({ type: "utility-result", sourceCardId: card?.id, title: "Invasive Placement Canceled", message, success: false });
      return;
    }
    const cost = getPlayerCardPlayCost(card);
    if (rp < cost) {
      const message = `${card.name} costs ${cost} RP, but only ${rp} RP remains. No card was spent.`;
      setSearchContext(null);
      setEventOverlay({ type: "utility-result", sourceCardId: card.id, title: "Invasive Placement Canceled", message, success: false });
      return;
    }
    const cardInstanceId = createStableInstanceId(`player-invader-${card.id}`);
    setOpponent((current) => ({
      ...current,
      corals: current.corals.map((coral) => coral.id === coralId ? {
        ...coral,
        slots: coral.slots.map((slot) => slot.id === slotId && !slot.cardId ? {
          ...slot,
          cardId: card.id,
          cardInstanceId,
          hostedCardIds: [],
          controller: "player",
          invasiveOwner: "player",
        } : slot),
      } : coral),
    }));
    setHand((current) => removeOneCard(current, card.id));
    setRp((current) => Math.max(0, current - cost));
    consumePlayerSchoolDensityDiscount(card);
    setSearchContext(null);
    setSelectedHandCard(null);
    const message = `${card.name} invaded an empty slot on the opponent's ${cardsById[targetCoral.cardId]?.name} for ${cost} RP. It remains your creature; the opponent may remove it with a legal attack or specialized Support card.`;
    pushLog(message);
    setEventOverlay({ type: "impact-result", sourceCardId: card.id, defenderCardId: targetCoral.cardId, title: `Player placed ${card.name} on the Rival Reef`, message, success: true });
  }

  function applyExplicitSupportLock(card) {
    if (supportExplicitlyLocksFurtherSupports(card)) setSupportLockSourceId(card.id);
  }

  function chooseScientistJes(mode) {
    if (searchContext?.mode !== "scientist-jes-choice") return;
    const supportCard = cardsById[searchContext.supportCardId];
    if (!supportCard || !hand.includes(supportCard.id)) return;
    if (mode === "search") {
      const searchEffect = (supportCard.effects ?? []).find((effect) => effect.type === EffectType.SEARCH_DECK);
      const candidates = [...new Set([...foundationDeck, ...palsDeck].filter((cardId) => cardMatchesSearchCriteria(cardsById[cardId], searchEffect)))];
      if (!candidates.length) {
        setEventOverlay({ type: "choose-scientist-jes", sourceCardId: supportCard.id, title: "Scientist Jes", message: "There is no Habitat left to search for. Choose Draw Two or cancel without spending the card." });
        return;
      }
      setSearchContext({ mode: "deck", supportCardId: supportCard.id, candidates, maxSelect: 1, selected: [], scientistJesChoice: "search" });
      setModal("search");
      setEventOverlay(null);
      return;
    }
    if (mode === "draw") {
      const drawEffect = (supportCard.effects ?? []).find((effect) => effect.type === EffectType.DRAW_CARDS);
      const target = Math.min(Number(drawEffect?.amount ?? 2), foundationDeck.length + palsDeck.length);
      if (!target) {
        setEventOverlay({ type: "choose-scientist-jes", sourceCardId: supportCard.id, title: "Scientist Jes", message: "Both personal decks are empty. Choose Habitat Search or cancel without spending the card." });
        return;
      }
      spendResolvedSupport(supportCard);
      setPendingCreatureAction({ action: { name: "Scientist Jes — Draw Two", cost: { rp: 0 }, oncePerTurn: false }, effect: drawEffect, actionKey: `support:${supportCard.id}`, sourceCardId: supportCard.id, actionName: "Draw Two", cost: 0, committed: true });
      const requested = Number(drawEffect?.amount ?? 2);
      setTurnDrawSelection({ requested, target, shortfall: getRequiredDrawShortfall(requested, target), foundation: 0, pals: 0, mode: "support" });
      setSearchContext(null);
      setModal(null);
      setEventOverlay({ type: "choose-action-deck", sourceCardId: supportCard.id, title: "Player used Scientist Jes — Draw Two", message: `Allocate ${target} draw(s) between your personal decks.` });
      return;
    }
    setSearchContext(null);
    setEventOverlay(null);
    setModal(null);
  }

  function completeSpearfishing(target) {
    if (searchContext?.mode !== "spearfishing" || !searchContext.candidates.some((candidate) => candidate.coralId === target.coralId && candidate.slotId === target.slotId)) return;
    const supportCard = cardsById[searchContext.supportCardId];
    const targetCard = cardsById[target.cardId];
    if (!supportCard || !targetCard || !hand.includes(supportCard.id)) return;
    if (target.coralId === "__reef__") {
      setPlayerReefCreatureInstances((current) => removeCreatureInstances(current, [target.instanceId]).instances);
    } else if (target.coralId === "__orphan__") {
      setPlayerOrphanCreatureInstances((current) => {
        const removed = current.find((entry) => entry.instanceId === target.instanceId);
        return [...current.filter((entry) => entry.instanceId !== target.instanceId), ...(removed?.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`player-orphan-${cardId}`)))];
      });
    } else {
      setPlayerCorals((current) => current.map((coral) => coral.id === target.coralId ? { ...coral, slots: coral.slots.map((slot) => slot.id === target.slotId ? { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot) } : coral));
      if (target.hostedCardIds?.some(Boolean)) setPlayerOrphanCreatures((current) => [...current, ...target.hostedCardIds.filter(Boolean).map((cardId) => ({ cardId, hostedCardIds: [] }))]);
      setCreatureStatuses((current) => Object.fromEntries(Object.entries(current).filter(([slotId]) => slotId !== target.slotId)));
    }
    const supportCost = getPlayerCardPlayCost(supportCard);
    const recoveredRp = Number(targetCard.cost?.rp ?? 0);
    setHand((current) => removeOneCard(current, supportCard.id));
    setDiscardPile((current) => [supportCard.id, targetCard.id, ...current]);
    setRp((current) => addResourceWithinCap(Math.max(0, current - supportCost), recoveredRp, playerRpCap));
    applyExplicitSupportLock(supportCard);
    setSearchContext(null);
    setEventOverlay({ type: "impact-result", sourceCardId: supportCard.id, defenderCardId: targetCard.id, title: "Player used Spearfishing", message: `${targetCard.name} and Spearfishing were discarded. You recovered ${recoveredRp} RP, up to your ${playerRpCap} RP bank cap.`, success: true });
    pushLog(`Spearfishing discarded ${targetCard.name} and recovered ${recoveredRp} RP, capped at ${playerRpCap}.`);
  }

  function completeWhirlpool(coralId) {
    if (searchContext?.mode !== "whirlpool" || !searchContext.candidates.includes(coralId)) return;
    const supportCard = cardsById[searchContext.supportCardId];
    const target = opponentCorals.find((coral) => coral.id === coralId);
    if (!supportCard || !target || !hand.includes(supportCard.id)) return;
    const amount = Number(searchContext.amount ?? 0);
    setOpponent((current) => ({ ...current, corals: current.corals.map((coral) => coral.id === coralId ? { ...coral, rpPenaltyNextTurn: Number(coral.rpPenaltyNextTurn ?? 0) + amount } : coral) }));
    setHand((current) => removeOneCard(current, supportCard.id));
    setDiscardPile((current) => [supportCard.id, ...current]);
    setRp((current) => Math.max(0, current - getPlayerCardPlayCost(supportCard)));
    applyExplicitSupportLock(supportCard);
    setSearchContext(null);
    const message = `${supportCard.name} targeted ${cardsById[target.cardId]?.name}. It will produce ${amount} less RP during the opponent's next collection.`;
    pushLog(message);
    setEventOverlay({ type: "impact-result", sourceCardId: supportCard.id, defenderCardId: target.cardId, title: `Player used ${supportCard.name}`, message, success: true });
  }

  function completeSchoolMomentum(cardId) {
    if (searchContext?.mode !== "school-momentum" || !searchContext.candidates.includes(cardId)) return;
    const sourceCard = cardsById[searchContext.sourceCardId];
    const foundCard = cardsById[cardId];
    if (!sourceCard || !foundCard) return;
    setFoundationDeck((current) => shuffle(removeOneCard(current, cardId)));
    setPalsDeck((current) => shuffle(removeOneCard(current, cardId)));
    const handLimit = Number((activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit")?.amount ?? Infinity);
    const handResult = addCardsToHandWithLimit(hand, [cardId], discardPile, handLimit);
    setHand(handResult.hand);
    setDiscardPile(handResult.discardPile);
    setSearchContext(null);
    const message = handResult.cardsToHand.length
      ? `${sourceCard.name}'s Momentum added ${foundCard.name} to your hand and shuffled your personal decks.`
      : `${sourceCard.name}'s Momentum found and revealed ${foundCard.name}, but the active hand limit sent it to your discard pile. Your personal decks were shuffled.`;
    pushLog(message);
    setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, defenderCardId: foundCard.id, title: `Player's ${sourceCard.name} used Momentum`, message, success: true });
  }

  function spendResolvedSupport(supportCard) {
    setHand((current) => removeOneCard(current, supportCard.id));
    setDiscardPile((current) => [supportCard.id, ...current]);
    setRp((current) => Math.max(0, current - getPlayerCardPlayCost(supportCard)));
    applyExplicitSupportLock(supportCard);
  }

  function chooseInspectionDeck(deckType) {
    if (searchContext?.mode !== "choose-inspection-deck" || !["foundation", "pals"].includes(deckType)) return;
    const deck = deckType === "foundation" ? foundationDeck : palsDeck;
    if (!deck.length) return;
    const supportCard = cardsById[searchContext.supportCardId];
    const topCards = deck.slice(0, 5);
    if (supportCard?.id === "robotic-survey") {
      setSearchContext({ mode: "reorder-deck", supportCardId: supportCard.id, deckType, topCards });
      setEventOverlay({ type: "reorder-deck", sourceCardId: supportCard.id, title: `Player used ${supportCard.name}`, message: `Reorder the top ${topCards.length} cards of your ${deckType} deck, then confirm.` });
      return;
    }
    const candidates = topCards.filter((cardId) => cardsById[cardId]?.kind === CardKind.CREATURE);
    setSearchContext({ mode: "explorer-top-five", supportCardId: supportCard.id, deckType, topCards, candidates });
    setEventOverlay({ type: "choose-explorer-card", sourceCardId: supportCard.id, title: `Player used ${supportCard.name}`, message: candidates.length ? "Choose one Creature from the top five to add to your hand, or choose no card and shuffle all five back." : "There were no Creatures in the top five. Confirm to shuffle them back." });
  }

  function moveInspectedDeckCard(index, delta) {
    if (searchContext?.mode !== "reorder-deck") return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= searchContext.topCards.length) return;
    setSearchContext((current) => {
      const topCards = [...current.topCards];
      [topCards[index], topCards[nextIndex]] = [topCards[nextIndex], topCards[index]];
      return { ...current, topCards };
    });
  }

  function commitDeckInspection(selectedCardId = null) {
    if (!searchContext || !["reorder-deck", "explorer-top-five"].includes(searchContext.mode)) return;
    const supportCard = cardsById[searchContext.supportCardId];
    if (!supportCard || !hand.includes(supportCard.id)) return;
    const deck = searchContext.deckType === "foundation" ? foundationDeck : palsDeck;
    let replacementTop;
    if (searchContext.mode === "reorder-deck") replacementTop = searchContext.topCards;
    else {
      if (selectedCardId && !searchContext.candidates.includes(selectedCardId)) return;
      replacementTop = shuffle(selectedCardId ? removeOneCard(searchContext.topCards, selectedCardId) : searchContext.topCards);
    }
    const nextDeck = [...replacementTop, ...deck.slice(searchContext.topCards.length)];
    if (searchContext.deckType === "foundation") setFoundationDeck(nextDeck);
    else setPalsDeck(nextDeck);
    setHand((current) => [...removeOneCard(current, supportCard.id), ...(selectedCardId ? [selectedCardId] : [])]);
    setDiscardPile((current) => [supportCard.id, ...current]);
    setRp((current) => Math.max(0, current - getPlayerCardPlayCost(supportCard)));
    applyExplicitSupportLock(supportCard);
    const message = searchContext.mode === "reorder-deck"
      ? `${supportCard.name} rearranged the top ${searchContext.topCards.length} cards of your ${searchContext.deckType} deck.`
      : selectedCardId ? `${supportCard.name} added ${cardsById[selectedCardId]?.name} to your hand and shuffled the other inspected cards.` : `${supportCard.name} found no chosen Creature and shuffled the inspected cards back.`;
    setSearchContext(null);
    pushLog(message);
    setEventOverlay({ type: "utility-result", sourceCardId: supportCard.id, defenderCardId: selectedCardId, title: `Player used ${supportCard.name}`, message, success: true });
  }

  function completeSupportSearch(cardId) {
    if (!searchContext?.candidates.includes(cardId)) return;
    const supportCard = cardsById[searchContext.supportCardId];
    if (!supportCard || !hand.includes(supportCard.id)) return;
    let nextFoundation = removeOneCard(foundationDeck, cardId);
    let nextPals = removeOneCard(palsDeck, cardId);
    setFoundationDeck(shuffle(nextFoundation));
    setPalsDeck(shuffle(nextPals));
    setHand((current) => [...removeOneCard(current, supportCard.id), cardId]);
    setDiscardPile((current) => [supportCard.id, ...current]);
    const cost = getPlayerCardPlayCost(supportCard);
    setRp((current) => Math.max(0, current - cost));
    applyExplicitSupportLock(supportCard);
    const drawEffect = (supportCard.effects ?? []).find((effect) => effect.type === EffectType.DRAW_CARDS);
    const additionalDrawCount = supportCard.id === "scientist-jes" ? 0 : Math.max(0, Number(drawEffect?.amount ?? 0));
    if (additionalDrawCount) {
      const target = Math.min(additionalDrawCount, nextFoundation.length + nextPals.length);
      if (target) {
        setPendingCreatureAction({ action: { name: `${supportCard.name} Draw`, cost: { rp: 0 } }, effect: drawEffect, actionKey: `support:${supportCard.id}`, sourceCardId: supportCard.id, cost: 0, committed: true });
        setTurnDrawSelection({ requested: additionalDrawCount, target, shortfall: getRequiredDrawShortfall(additionalDrawCount, target), foundation: 0, pals: 0, mode: "support" });
        setSearchContext(null);
        setModal(null);
        setEventOverlay({ type: "choose-action-deck", sourceCardId: supportCard.id, title: `Player used ${supportCard.name}`, message: `${cardsById[cardId]?.name} was added to your hand. Allocate the additional ${target} draw(s) between your personal decks.` });
      } else {
        setSearchContext(null);
        setModal("hand");
        setGameResult((current) => current ?? `Defeat: ${supportCard.name} required an additional draw, but both personal decks were empty.`);
        setSelectedHandCard(cardId);
      }
    } else {
      setSearchContext(null);
      setModal("hand");
      setSelectedHandCard(cardId);
    }
    pushLog(`${supportCard.name} found ${cardsById[cardId]?.name}.${additionalDrawCount && nextFoundation.length + nextPals.length ? ` Choose how to allocate up to ${additionalDrawCount} additional draw(s).` : additionalDrawCount ? " No cards remained for its additional draws." : ""} The Support card was discarded.`);
  }

  function toggleSupportSearchCard(cardId) {
    if (searchContext?.mode !== "deck" || !searchContext.candidates.includes(cardId) || searchContext.maxSelect <= 1) return;
    const availableCopies = [...foundationDeck, ...palsDeck].filter((candidateId) => candidateId === cardId).length;
    setSearchContext((current) => {
      const selectedCopies = current.selected.filter((selectedId) => selectedId === cardId).length;
      return {
        ...current,
        selected: selectedCopies < availableCopies && current.selected.length < current.maxSelect
          ? [...current.selected, cardId]
          : current.selected.filter((selectedId) => selectedId !== cardId),
      };
    });
  }

  function completeMultipleSupportSearch() {
    if (searchContext?.mode !== "deck" || searchContext.maxSelect <= 1 || !searchContext.selected.length) return;
    const supportCard = cardsById[searchContext.supportCardId];
    if (!supportCard || !hand.includes(supportCard.id)) return;
    let nextFoundation = foundationDeck;
    let nextPals = palsDeck;
    searchContext.selected.forEach((cardId) => {
      if (nextFoundation.includes(cardId)) nextFoundation = removeOneCard(nextFoundation, cardId);
      else nextPals = removeOneCard(nextPals, cardId);
    });
    setFoundationDeck(shuffle(nextFoundation));
    setPalsDeck(shuffle(nextPals));
    const handWithoutSupport = removeOneCard(hand, supportCard.id);
    const handResult = applyCurrentHandLimit(searchContext.selected, handWithoutSupport.length);
    setHand([...handWithoutSupport, ...handResult.cardsToHand]);
    setDiscardPile((current) => [supportCard.id, ...handResult.cardsToDiscard, ...current]);
    setRp((current) => Math.max(0, current - getPlayerCardPlayCost(supportCard)));
    applyExplicitSupportLock(supportCard);
    const names = searchContext.selected.map((cardId) => cardsById[cardId]?.name ?? cardId).join(", ");
    setSearchContext(null);
    setModal("hand");
    setSelectedHandCard(searchContext.selected[0]);
    pushLog(`${supportCard.name} found ${names}. The Support card was discarded and both personal decks were shuffled.${handResult.cardsToDiscard.length ? ` ${handResult.cardsToDiscard.length} searched card(s) exceeded the hand limit and were discarded.` : ""}`);
  }

  function cancelSupportSearch() {
    setSearchContext(null);
    setTurnDrawSelection(null);
    setModal("hand");
    setPlayError("Support search cancelled. No RP or card was spent.");
  }

  function completeRecovery(cardId) {
    if (searchContext?.mode !== "recover" || !searchContext.candidates.includes(cardId) || !discardPile.includes(cardId)) return;
    const handResult = applyCurrentHandLimit([cardId]);
    if (handResult.cardsToHand.length) {
      setDiscardPile((current) => cardId === searchContext.supportCardId ? removeLastCard(current, cardId) : removeOneCard(current, cardId));
      setHand((current) => [...current, cardId]);
    }
    setSearchContext(null);
    setModal(null);
    setSelectedHandCard(handResult.cardsToHand.length ? cardId : null);
    pushLog(handResult.cardsToHand.length ? `Recovery returned ${cardsById[cardId]?.name ?? cardId} from your discard pile to your hand.` : `Recovery found ${cardsById[cardId]?.name ?? cardId}, but it stayed in the discard pile because your hand is at its limit.`);
  }

  function completeCoralHeal(coralId) {
    if (searchContext?.mode !== "heal-coral" || !searchContext.candidates.includes(coralId)) return;
    const supportCard = cardsById[searchContext.supportCardId];
    const target = playerCorals.find((coral) => coral.id === coralId);
    if (!supportCard || !target || !hand.includes(supportCard.id)) return;
    const previousHealth = Number(target.health ?? target.maxHealth);
    const healedHealth = Math.min(target.maxHealth, previousHealth + 20);
    setPlayerCorals((current) => current.map((coral) => coral.id === coralId ? { ...coral, health: healedHealth } : coral));
    setHand((current) => removeOneCard(current, supportCard.id));
    setDiscardPile((current) => [supportCard.id, ...current]);
    setRp((current) => Math.max(0, current - getPlayerCardPlayCost(supportCard)));
    applyExplicitSupportLock(supportCard);
    setSearchContext(null);
    setModal("hand");
    setSelectedHandCard(null);
    pushLog(`${supportCard.name} healed ${cardsById[target.cardId]?.name} for ${healedHealth - previousHealth} HP. The Support card was discarded.`);
  }

  function completeOnPlayCoralHeal(coralId) {
    if (!["onplay-heal", "passive-heal"].includes(searchContext?.mode) || !searchContext.candidates.includes(coralId)) return;
    const target = playerCorals.find((coral) => coral.id === coralId);
    const sourceCard = cardsById[searchContext.sourceCardId];
    if (!target || !sourceCard) return;
    const previousHealth = Number(target.health ?? target.maxHealth);
    const healedHealth = Math.min(Number(target.maxHealth), previousHealth + Number(searchContext.amount ?? 0));
    setPlayerCorals((current) => current.map((coral) => coral.id === coralId ? { ...coral, health: healedHealth } : coral));
    if (searchContext.mode === "passive-heal" && searchContext.actionKey) setUsedCreatureActions((current) => [...current, searchContext.actionKey]);
    const message = `${sourceCard.name}'s ${searchContext.actionName} restored ${healedHealth - previousHealth} HP to ${cardsById[target.cardId]?.name}.${searchContext.roll != null ? ` The healing roll was ${searchContext.roll}.` : ""}`;
    pushLog(message);
    setSearchContext(null);
    setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, defenderCardId: target.cardId, title: `Player's ${sourceCard.name} used ${searchContext.actionName}`, message, success: healedHealth > previousHealth });
  }

  function beginPassiveCoralHeal(passive) {
    if (!inspectedCardData || inspectedCard?.owner !== "player" || gamePhase !== "main") return;
    const heal = getPassiveCoralHeal(passive);
    const actionKey = `${inspectedActionKey}:${typeof passive === "object" ? passive.id ?? passive.name : heal?.actionName}`;
    if (!heal || usedCreatureActions.includes(actionKey)) return;
    const candidates = playerCoralCards.filter((coral) => coral.health < coral.maxHealth).map((coral) => coral.id);
    if (!candidates.length) {
      pushLog(`${inspectedCardData.name}'s ${heal.actionName} has no damaged coral to heal.`);
      return;
    }
    setSearchContext({ mode: "passive-heal", sourceCardId: inspectedCardData.id, candidates, amount: heal.amount, actionName: heal.actionName, actionKey });
    setInspectedCard(null);
    setEventOverlay({ type: "choose-onplay-heal-target", sourceCardId: inspectedCardData.id, title: `Player's ${inspectedCardData.name} used ${heal.actionName}`, message: `Choose one damaged coral to restore ${heal.amount} HP.` });
  }

  function getJointedStructureSources() {
    return playerCoralCards.flatMap((sourceCoral) => (sourceCoral.slots ?? []).flatMap((sourceSlot) => {
      const creature = cardsById[sourceSlot.cardId];
      if (!creature || creature.kind !== CardKind.CREATURE) return [];
      const hasDestination = playerCoralCards.some((destinationCoral) => destinationCoral.id !== sourceCoral.id
        && (destinationCoral.slots ?? []).some((destinationSlot) => !destinationSlot.cardId && canCardOccupySlot(creature, destinationSlot)));
      return hasDestination ? [{ coralId: sourceCoral.id, slotId: sourceSlot.id, cardId: creature.id }] : [];
    }));
  }

  function beginJointedStructureMove(passive) {
    if (!inspectedCardData || inspectedCard?.owner !== "player" || !inspectedCard?.foundation || gamePhase !== "main") return;
    const move = getJointedStructureMove(passive);
    const actionKey = `${inspectedActionKey}:${move?.actionName}`;
    if (!move || usedCreatureActions.includes(actionKey)) return;
    const candidates = getJointedStructureSources();
    if (!candidates.length) {
      const message = playerCoralCards.length < 2
        ? "Jointed Structure needs two different corals in your ecosystem."
        : "No slotted creature currently has a compatible empty slot on another coral.";
      pushLog(message);
      setEventOverlay({ type: "utility-result", sourceCardId: inspectedCardData.id, title: "Jointed Structure Could Not Resolve", message, success: false });
      return;
    }
    setSearchContext({ mode: "jointed-structure-source", sourceCardId: inspectedCardData.id, abilityFoundationId: inspectedCard.coralId, actionKey, actionName: move.actionName, candidates });
    setInspectedCard(null);
    setEventOverlay({ type: "choose-jointed-structure-source", sourceCardId: inspectedCardData.id, title: `Player's ${inspectedCardData.name} used ${move.actionName}`, message: "Choose one creature to move. Its identity and any creatures it hosts will move with it." });
  }

  function chooseJointedStructureSource(sourceFoundationId, sourceSlotId) {
    if (searchContext?.mode !== "jointed-structure-source") return;
    const source = searchContext.candidates.find((candidate) => candidate.coralId === sourceFoundationId && candidate.slotId === sourceSlotId);
    const sourceCoral = playerCoralCards.find((coral) => coral.id === sourceFoundationId);
    const sourceSlot = sourceCoral?.slots.find((slot) => slot.id === sourceSlotId);
    const creature = cardsById[sourceSlot?.cardId];
    if (!source || !creature) return;
    const destinations = playerCoralCards.flatMap((destinationCoral) => destinationCoral.id === sourceFoundationId ? [] : (destinationCoral.slots ?? []).flatMap((destinationSlot) => (
      !destinationSlot.cardId && canCardOccupySlot(creature, destinationSlot)
        ? [{ coralId: destinationCoral.id, slotId: destinationSlot.id, cardId: destinationCoral.cardId }]
        : []
    )));
    if (!destinations.length) {
      setSearchContext(null);
      setEventOverlay({ type: "utility-result", sourceCardId: searchContext.sourceCardId, title: "Jointed Structure Could Not Resolve", message: "That creature no longer has a compatible empty slot on another coral.", success: false });
      return;
    }
    setSearchContext((current) => ({ ...current, mode: "jointed-structure-destination", sourceFoundationId, sourceSlotId, movedCardId: creature.id, candidates: destinations }));
    setEventOverlay({ type: "choose-jointed-structure-destination", sourceCardId: searchContext.sourceCardId, defenderCardId: creature.id, title: "Choose the Destination Slot", message: `Choose a compatible empty slot on another coral for ${creature.name}.` });
  }

  function completeJointedStructureMove(destinationFoundationId, destinationSlotId) {
    if (searchContext?.mode !== "jointed-structure-destination" || !searchContext.candidates.some((candidate) => candidate.coralId === destinationFoundationId && candidate.slotId === destinationSlotId)) return;
    const abilityFoundation = playerCoralCards.find((coral) => coral.id === searchContext.abilityFoundationId);
    const result = moveSlottedCreatureBetweenFoundations(playerCorals, {
      sourceFoundationId: searchContext.sourceFoundationId,
      sourceSlotId: searchContext.sourceSlotId,
      destinationFoundationId,
      destinationSlotId,
    }, (cardId, slot) => canCardOccupySlot(cardsById[cardId], slot));
    if (!result.moved || !abilityFoundation) {
      const message = result.error ?? "The Black Coral that granted Jointed Structure is no longer in play.";
      setSearchContext(null);
      pushLog(message);
      setEventOverlay({ type: "utility-result", sourceCardId: searchContext.sourceCardId, title: "Jointed Structure Could Not Resolve", message, success: false });
      return;
    }
    const sourceFoundation = playerCorals.find((coral) => coral.id === result.sourceFoundationId);
    const destinationFoundation = playerCorals.find((coral) => coral.id === result.destinationFoundationId);
    const creature = cardsById[result.cardId];
    const message = `${cardsById[abilityFoundation.cardId]?.name}'s Jointed Structure moved ${creature?.name} from ${cardsById[sourceFoundation?.cardId]?.name} to ${cardsById[destinationFoundation?.cardId]?.name}.`;
    setPlayerCorals(result.foundations);
    setUsedCreatureActions((current) => current.includes(searchContext.actionKey) ? current : [...current, searchContext.actionKey]);
    setSearchContext(null);
    pushLog(message);
    setEventOverlay({ type: "utility-result", sourceCardId: abilityFoundation.cardId, defenderCardId: creature?.id, title: `Player's ${cardsById[abilityFoundation.cardId]?.name} used Jointed Structure`, message, success: true });
  }

  function getDamageCounterMoveAvailability(passive, abilityFoundationId = inspectedCard?.coralId) {
    const move = getDamageCounterMove(passive);
    if (!move) return null;
    const abilityFoundation = playerCoralCards.find((coral) => coral.id === abilityFoundationId);
    const destinationCandidatesFor = (sourceFoundationId) => playerCoralCards.filter((coral) => (
      coral.id !== sourceFoundationId
      && Number(coral.health ?? coral.maxHealth) > move.counterHp
    ));
    const sourceCandidates = playerCoralCards.filter((coral) => (
      Number(coral.maxHealth) - Number(coral.health ?? coral.maxHealth) >= move.counterHp
      && destinationCandidatesFor(coral.id).length > 0
    ));

    let reason = "";
    if (gamePhase !== "main") reason = "Neural Network can only be used during your action phase.";
    else if (!abilityFoundation) reason = "This Brain Coral is no longer in your ecosystem.";
    else if ((abilityFoundation.statuses ?? []).length) reason = "Neural Network cannot be used while this Brain Coral is stunned or affected by a special condition.";
    else if (playerCoralCards.length < 2) reason = "Neural Network needs two different corals in your ecosystem.";
    else if (!playerCoralCards.some((coral) => Number(coral.maxHealth) - Number(coral.health ?? coral.maxHealth) >= move.counterHp)) reason = `No coral has a full ${move.counterHp} HP damage counter to move.`;
    else if (!sourceCandidates.length) reason = "No legal destination can take the counter without being destroyed.";

    return { ...move, abilityFoundation, sourceCandidates, destinationCandidatesFor, reason };
  }

  function startDamageCounterMove(passive, abilityFoundationId, sourceCardId) {
    const availability = getDamageCounterMoveAvailability(passive, abilityFoundationId);
    if (!availability || availability.reason) {
      const message = availability?.reason ?? "Neural Network is not available.";
      pushLog(message);
      setEventOverlay({ type: "utility-result", sourceCardId, title: "Neural Network Could Not Resolve", message, success: false });
      return;
    }
    setSearchContext({
      mode: "neural-network-source",
      sourceCardId,
      abilityFoundationId,
      counterHp: availability.counterHp,
      candidates: availability.sourceCandidates.map((coral) => coral.id),
    });
    setInspectedCard(null);
    setEventOverlay({
      type: "choose-neural-network-source",
      sourceCardId,
      title: "Use Neural Network",
      message: `Choose a damaged coral to remove one ${availability.counterHp} HP damage counter from.`,
    });
  }

  function beginDamageCounterMove(passive) {
    if (!inspectedCardData || inspectedCard?.owner !== "player" || !inspectedCard?.foundation) return;
    startDamageCounterMove(passive, inspectedCard.coralId, inspectedCardData.id);
  }

  function repeatDamageCounterMove(abilityFoundationId) {
    const abilityFoundation = playerCoralCards.find((coral) => coral.id === abilityFoundationId);
    const sourceCard = cardsById[abilityFoundation?.cardId];
    const passive = sourceCard?.passives?.find((candidate) => getDamageCounterMove(candidate));
    startDamageCounterMove(passive, abilityFoundationId, sourceCard?.id);
  }

  function failDamageCounterMove(message) {
    const sourceCardId = searchContext?.sourceCardId;
    setSearchContext(null);
    pushLog(message);
    setEventOverlay({ type: "utility-result", sourceCardId, title: "Neural Network Could Not Resolve", message, success: false });
  }

  function chooseDamageCounterSource(sourceFoundationId) {
    if (searchContext?.mode !== "neural-network-source" || !searchContext.candidates.includes(sourceFoundationId)) return;
    const abilityFoundation = playerCoralCards.find((coral) => coral.id === searchContext.abilityFoundationId);
    const sourceCard = cardsById[abilityFoundation?.cardId];
    const passive = sourceCard?.passives?.find((candidate) => getDamageCounterMove(candidate));
    const availability = getDamageCounterMoveAvailability(passive, searchContext.abilityFoundationId);
    if (!availability || availability.reason) {
      failDamageCounterMove(availability?.reason ?? "The Brain Coral that granted Neural Network is no longer in play.");
      return;
    }
    const source = availability.sourceCandidates.find((coral) => coral.id === sourceFoundationId);
    const destinations = source ? availability.destinationCandidatesFor(sourceFoundationId) : [];
    if (!source || !destinations.length) {
      failDamageCounterMove("That damage counter no longer has a legal destination.");
      return;
    }
    setSearchContext((current) => ({
      ...current,
      mode: "neural-network-destination",
      counterHp: availability.counterHp,
      sourceFoundationId,
      candidates: destinations.map((coral) => coral.id),
    }));
    setEventOverlay({
      type: "choose-neural-network-destination",
      sourceCardId: searchContext.sourceCardId,
      defenderCardId: source.cardId,
      title: "Choose the Destination Coral",
      message: `Choose a different coral to receive the ${availability.counterHp} HP damage counter. A choice that would destroy a coral is not legal.`,
    });
  }

  function completeDamageCounterMove(destinationFoundationId) {
    if (searchContext?.mode !== "neural-network-destination" || !searchContext.candidates.includes(destinationFoundationId)) return;
    const abilityFoundation = playerCoralCards.find((coral) => coral.id === searchContext.abilityFoundationId);
    const abilityCard = cardsById[abilityFoundation?.cardId];
    const passive = abilityCard?.passives?.find((candidate) => getDamageCounterMove(candidate));
    const availability = getDamageCounterMoveAvailability(passive, searchContext.abilityFoundationId);
    if (!availability || availability.reason) {
      failDamageCounterMove(availability?.reason ?? "The Brain Coral that granted Neural Network is no longer in play.");
      return;
    }
    const source = playerCoralCards.find((coral) => coral.id === searchContext.sourceFoundationId);
    const destination = playerCoralCards.find((coral) => coral.id === destinationFoundationId);
    if (!source || !destination || cardsById[source.cardId]?.kind !== CardKind.CORAL || cardsById[destination.cardId]?.kind !== CardKind.CORAL) {
      failDamageCounterMove("Both Neural Network targets must still be corals in your ecosystem.");
      return;
    }
    const result = moveFoundationDamageCounter(playerCorals, {
      sourceFoundationId: source.id,
      destinationFoundationId: destination.id,
      counterHp: availability.counterHp,
    });
    if (!result.moved) {
      failDamageCounterMove(result.error);
      return;
    }

    const nextSource = result.foundations.find((coral) => coral.id === source.id);
    const nextDestination = result.foundations.find((coral) => coral.id === destination.id);
    const sourceName = cardsById[source.cardId]?.name ?? "source coral";
    const destinationName = cardsById[destination.cardId]?.name ?? "destination coral";
    const message = `${abilityCard.name}'s Neural Network moved one ${result.amount} HP damage counter from ${sourceName} to ${destinationName}. ${sourceName} is now at ${nextSource.health}/${nextSource.maxHealth} HP; ${destinationName} is now at ${nextDestination.health}/${nextDestination.maxHealth} HP.`;
    setPlayerCorals(result.foundations);
    setSearchContext(null);
    pushLog(message);
    setEventOverlay({
      type: "utility-result",
      sourceCardId: abilityCard.id,
      defenderCardId: destination.cardId,
      title: `Player's ${abilityCard.name} used Neural Network`,
      message,
      success: true,
      repeatDamageCounterAbilityId: abilityFoundation.id,
    });
  }

  function completeCoralStatusClear(coralId) {
    if (searchContext?.mode !== "clear-coral-status" || !searchContext.candidates.includes(coralId)) return;
    const supportCard = cardsById[searchContext.supportCardId];
    const target = playerCorals.find((coral) => coral.id === coralId);
    if (!supportCard || !target || !hand.includes(supportCard.id)) return;
    const removed = [...(target.statuses ?? []).map((status) => status.type), Number(target.rpPenaltyNextTurn ?? 0) > 0 ? "RP penalty" : null].filter(Boolean).join(", ");
    setPlayerCorals((current) => current.map((coral) => {
      if (coral.id !== coralId) return coral;
      const { rpPenaltyNextTurn, ...clearedCoral } = coral;
      return { ...clearedCoral, statuses: [] };
    }));
    spendResolvedSupport(supportCard);
    setSearchContext(null);
    const message = `${supportCard.name} removed ${removed || "all effects"} from ${cardsById[target.cardId]?.name}.`;
    pushLog(message);
    setEventOverlay({ type: "utility-result", sourceCardId: supportCard.id, defenderCardId: target.cardId, title: `Player used ${supportCard.name}`, message, success: true });
  }

  function toggleRestockCard(candidateIndex) {
    if (searchContext?.mode !== "restock" || !searchContext.candidates[candidateIndex]) return;
    setSearchContext((current) => {
      const selectedIndices = current.selectedIndices.includes(candidateIndex)
        ? current.selectedIndices.filter((index) => index !== candidateIndex)
        : current.selectedIndices.length < 3 ? [...current.selectedIndices, candidateIndex] : current.selectedIndices;
      return { ...current, selectedIndices };
    });
  }

  function completeRestocking() {
    if (searchContext?.mode !== "restock" || !searchContext.selectedIndices.length) return;
    const supportCard = cardsById[searchContext.supportCardId];
    if (!supportCard || !hand.includes(supportCard.id)) return;
    const selectedCards = searchContext.selectedIndices.map((index) => searchContext.candidates[index]).filter(Boolean);
    const foundationCards = selectedCards.filter((cardId) => getPersonalDeckType(cardsById[cardId]) === "foundation");
    const palsCards = selectedCards.filter((cardId) => getPersonalDeckType(cardsById[cardId]) === "pals");
    setDiscardPile((current) => [supportCard.id, ...selectedCards.reduce((pile, cardId) => removeOneCard(pile, cardId), current)]);
    if (foundationCards.length) setFoundationDeck((current) => shuffle([...current, ...foundationCards]));
    if (palsCards.length) setPalsDeck((current) => shuffle([...current, ...palsCards]));
    setHand((current) => removeOneCard(current, supportCard.id));
    setRp((current) => Math.max(0, current - getPlayerCardPlayCost(supportCard)));
    applyExplicitSupportLock(supportCard);
    const names = selectedCards.map((cardId) => cardsById[cardId]?.name ?? cardId).join(", ");
    setSearchContext(null);
    setModal(null);
    setSelectedHandCard(null);
    pushLog(`Restocking shuffled ${names} into ${foundationCards.length && palsCards.length ? "their correct Foundation and Pals decks" : foundationCards.length ? "your Foundation deck" : "your Pals deck"} and was discarded.`);
  }

  function completeDrEvans() {
    if (searchContext?.mode !== "draw-seven" || !turnDrawSelection || turnDrawSelection.foundation + turnDrawSelection.pals !== turnDrawSelection.target) return;
    const supportCard = cardsById[searchContext.supportCardId];
    if (!supportCard || !hand.includes(supportCard.id)) return;
    const foundationCards = foundationDeck.slice(0, turnDrawSelection.foundation);
    const palsCards = palsDeck.slice(0, turnDrawSelection.pals);
    const drawnCards = [...foundationCards, ...palsCards];
    const discardedHand = removeOneCard(hand, supportCard.id);
    const handLimit = Number((activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit")?.amount ?? Infinity);
    const drawResult = drawWithHandLimit(drawnCards, 0, drawnCards.length, handLimit);
    const shortfall = Number(turnDrawSelection.shortfall ?? getRequiredDrawShortfall(turnDrawSelection.requested, drawnCards.length));
    setFoundationDeck((current) => current.slice(foundationCards.length));
    setPalsDeck((current) => current.slice(palsCards.length));
    setHand(drawResult.cardsToHand);
    setDiscardPile((current) => [supportCard.id, ...discardedHand, ...drawResult.cardsToDiscard, ...current]);
    setRp((current) => Math.max(0, current - getPlayerCardPlayCost(supportCard)));
    applyExplicitSupportLock(supportCard);
    setSearchContext(null);
    setTurnDrawSelection(null);
    setModal(null);
    setSelectedHandCard(drawResult.cardsToHand[0] ?? null);
    const message = `Dr. Evans discarded ${discardedHand.length} card(s) from your hand and drew ${foundationCards.length} from Foundation plus ${palsCards.length} from Pals.${drawResult.cardsToDiscard.length ? ` ${drawResult.cardsToDiscard.length} exceeded the active hand limit and was discarded.` : ""}${shortfall ? ` The mandatory seven-card draw was ${shortfall} card${shortfall === 1 ? "" : "s"} short, so you lose by deck depletion.` : ""}`;
    pushLog(message);
    if (shortfall) setGameResult((current) => current ?? `Defeat: Dr. Evans required seven cards, but your personal decks contained only ${drawnCards.length}.`);
    setEventOverlay({
      type: "utility-result",
      sourceCardId: supportCard.id,
      title: "Player used Dr. Evans",
      message,
      success: !shortfall,
      drawnCards: drawnCards.map((cardId, index) => ({ cardId, source: index < foundationCards.length ? "Foundation" : "Pals", discarded: index >= drawResult.cardsToHand.length })),
    });
  }

  function beginCreatureUtilityAction(action) {
    if (!inspectedCard || inspectedCard.owner !== "player") return;
    const effect = getSupportedUtilityEffect(action);
    const actionName = getActionName(action);
    const actionKey = `${inspectedActionKey}:${action.id ?? actionName}`;
    const cost = getActionCost(action);
    if (!effect || gameResult || gamePhase !== "main" || attackContext || playingCardId || rp < cost || (actionIsOncePerTurn(action) && usedCreatureActions.includes(actionKey))) return;
    const sourceCard = cardsById[inspectedCard.cardId];
    if (effect.type === EffectType.STUN_CORAL) {
      if (!opponentCoralCards.length) {
        pushLog(`${sourceCard.name}'s ${actionName} has no opponent coral to target.`);
        return;
      }
      setPendingCreatureAction({ action, effect, actionKey, sourceCardId: sourceCard.id, actionName, cost, costCommitted: false, candidates: opponentCoralCards.map((coral) => coral.id) });
      setInspectedCard(null);
      setEventOverlay({ type: "choose-coral-effect-target", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${actionName}`, message: `Choose an opponent coral to Stun. Cancel to spend no RP${actionIsOncePerTurn(action) ? " and preserve the once-per-turn action" : ""}.` });
      return;
    }
    if (effect.type === "grantNextOnPlayAttackBonus") {
      setRp((current) => Math.max(0, current - cost));
      if (actionIsOncePerTurn(action)) setUsedCreatureActions((current) => [...current, actionKey]);
      setNextOnPlayAttackBonus({ amount: Number(effect.amount ?? 0), sourceCardId: sourceCard.id, actionName });
      setInspectedCard(null);
      const message = `${sourceCard.name}'s ${actionName} gives +${effect.amount} to your next On Play attack.`;
      pushLog(message);
      setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${actionName}`, message, success: true });
      return;
    }
    if (effect.type === "reorderTopDeck") {
      if (!foundationDeck.length && !palsDeck.length) {
        pushLog(`${sourceCard.name}'s ${actionName} cannot inspect an empty pair of personal decks.`);
        return;
      }
      setPendingCreatureAction({ action, effect, actionKey, sourceCardId: sourceCard.id, actionName, cost });
      setInspectedCard(null);
      setEventOverlay({ type: "choose-action-reorder-source", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${actionName}`, message: `Choose a personal deck, then reorder up to its top ${effect.amount} cards. Cancel to spend nothing.` });
      return;
    }
    if (effect.type === EffectType.DRAW_CARDS) {
      setPendingCreatureAction({ action, effect, actionKey, sourceCardId: sourceCard.id, actionName, cost });
      const requested = Number(effect.amount ?? 0);
      const target = Math.min(requested, foundationDeck.length + palsDeck.length);
      setTurnDrawSelection({ requested, target, shortfall: getRequiredDrawShortfall(requested, target), foundation: 0, pals: 0, mode: "action" });
      setInspectedCard(null);
      setEventOverlay({ type: "choose-action-deck", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${actionName}`, message: `Allocate up to ${effect.amount} card(s) between your personal decks.` });
      return;
    }
    if (effect.type === EffectType.SEARCH_DECK) {
      const candidates = [...new Set([...foundationDeck, ...palsDeck].filter((cardId) => {
        const candidate = cardsById[cardId];
        if (!candidate || candidate.kind !== effect.targetKind) return false;
        if (effect.targetCardId && candidate.id !== effect.targetCardId) return false;
        if (effect.targetCategories?.length && !effect.targetCategories.includes(candidate.category)) return false;
        if (effect.targetNameIncludes && !candidate.name?.toLowerCase().includes(effect.targetNameIncludes.toLowerCase())) return false;
        return !effect.targetZone || candidate.zone === effect.targetZone;
      }))];
      if (!candidates.length) {
        pushLog(`${sourceCard.name}'s ${actionName} has no matching card remaining in your personal decks.`);
        return;
      }
      setPendingCreatureAction({ action, effect, actionKey, sourceCardId: sourceCard.id, candidates, actionName, cost });
      setInspectedCard(null);
      setEventOverlay({ type: "choose-creature-action-search", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${actionName}`, message: "Choose a matching card to add to your hand. Cancel to spend no RP." });
      return;
    }
    if (effect.type === EffectType.RECOVER_CARD_FROM_DISCARD || effect.type === "recoverCardFromDiscard") {
      if (!discardPile.length) {
        pushLog(`${sourceCard.name}'s ${actionName} has no legal target because your discard pile is empty.`);
        return;
      }
      setPendingCreatureAction({ action, effect, actionKey, sourceCardId: sourceCard.id, actionName, cost });
      setInspectedCard(null);
      setEventOverlay({ type: "choose-action-discard", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${actionName}`, message: effect.destination === "deck" ? "Choose a discarded card to shuffle into its correct personal deck: Corals and Creature Schools return to Foundation; all other cards return to Pals." : "Choose a card from your discard pile to return to your hand." });
      return;
    }
    if (effect.type === "discardThenSearchDeck" || effect.type === "discardThenDraw") {
      const discardCount = Math.max(0, Number(effect.discard?.amount ?? effect.discard?.min ?? 0));
      const maxDiscard = Math.max(discardCount, Number(effect.discard?.max ?? discardCount));
      if (hand.length < discardCount || (!foundationDeck.length && !palsDeck.length)) {
        pushLog(`${sourceCard.name}'s ${actionName} needs ${discardCount} card(s) in your hand and at least one card remaining in a personal deck.`);
        return;
      }
      setPendingCreatureAction({ action, effect, actionKey, sourceCardId: sourceCard.id, actionName, cost, handEntries: hand.map((cardId, index) => ({ cardId, index })), selectedIndices: [], minDiscard: discardCount, maxDiscard });
      setInspectedCard(null);
      setEventOverlay({ type: "choose-action-hand-discard", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${actionName}`, message: effect.type === "discardThenDraw" ? `Choose ${discardCount} to ${maxDiscard} cards to discard, then draw the same number.` : `Choose exactly ${discardCount} cards from your hand to discard. You may cancel before paying RP or discarding.` });
      return;
    }
    if (effect.type === "modifyDefenseRoll" || effect.type === EffectType.GRANT_DEFENSE_ADVANTAGE) {
      const categories = action.target?.categories ?? [];
      const matchesTarget = (cardId) => cardId && (!categories.length || categories.includes(cardsById[cardId]?.category));
      const candidates = playerCorals.flatMap((coral) => coral.slots.flatMap((slot) => [
        ...(matchesTarget(slot.cardId) ? [{ coralId: coral.id, slotId: slot.id, statusKey: getSlotActionKey(slot), cardId: slot.cardId }] : []),
        ...(slot.hostedCardIds ?? []).flatMap((cardId, hostedIndex) => matchesTarget(cardId) ? [{ coralId: coral.id, slotId: getHostedTargetSlotId(slot.id, hostedIndex), statusKey: getHostedTargetSlotId(slot.id, hostedIndex), cardId }] : []),
      ]));
      playerReefCreatures.forEach((cardId, index) => { if (matchesTarget(cardId)) candidates.push({ coralId: null, slotId: getPlayerReefSlotId(index), cardId }); });
      playerOrphanCreatures.forEach((entry, index) => { if (matchesTarget(entry.cardId)) candidates.push({ coralId: null, slotId: getPlayerOrphanSlotId(index), cardId: entry.cardId }); });
      if (!candidates.length) {
        pushLog(`${sourceCard.name}'s ${action.name} has no legal friendly target.`);
        return;
      }
      setPendingCreatureAction({ action, effect, actionKey, sourceCardId: sourceCard.id, candidates });
      setInspectedCard(null);
      setEventOverlay({ type: "choose-friendly-creature", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${action.name}`, message: "Choose one highlighted friendly creature to receive the defensive effect." });
      return;
    }
    if (effect.type === EffectType.FLIP_COIN) {
      if (!opponentCoralCards.length) {
        pushLog(`${sourceCard.name}'s ${actionName} has no legal opponent coral target.`);
        return;
      }
      const heads = Math.random() < 0.5;
      setRp((current) => Math.max(0, current - cost));
      if (actionIsOncePerTurn(action)) setUsedCreatureActions((current) => [...current, actionKey]);
      setInspectedCard(null);
      if (!heads) {
        const message = `${sourceCard.name} flipped tails for ${actionName}. The ${cost} RP action had no effect.`;
        pushLog(message);
        setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${actionName}`, message, success: false });
        return;
      }
      setPendingCreatureAction({ action, effect, actionKey, sourceCardId: sourceCard.id, actionName, cost, costCommitted: true, candidates: opponentCoralCards.map((coral) => coral.id) });
      setEventOverlay({ type: "choose-coin-coral-target", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${actionName}`, message: "Heads! Choose an opponent coral for the effect. The action cost has already been paid." });
      return;
    }
    if (effect.type === "rollDiceForResource") {
      const roll = rollDie(effect.dice);
      if (!roll) return;
      const success = effect.successValues?.includes(roll.total);
      const reward = success ? Number(effect.onSuccess?.amount ?? 0) : 0;
      setRp((current) => addResourceWithinCap(Math.max(0, current - cost), reward, playerRpCap));
      if (actionIsOncePerTurn(action)) setUsedCreatureActions((current) => [...current, actionKey]);
      const message = `${sourceCard.name} rolled ${roll.total} on ${effect.dice}.${success ? ` Gained ${reward} RP.` : " The action did not succeed."}`;
      pushLog(message);
      setInspectedCard(null);
      setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${action.name}`, message, success });
    }
  }

  function completeCreatureDrawAction() {
    if (!pendingCreatureAction) return;
    if (!turnDrawSelection || turnDrawSelection.foundation + turnDrawSelection.pals !== turnDrawSelection.target) return;
    const cost = pendingCreatureAction.cost ?? getActionCost(pendingCreatureAction.action);
    const foundationCards = foundationDeck.slice(0, turnDrawSelection.foundation);
    const palsCards = palsDeck.slice(0, turnDrawSelection.pals);
    const selectedCards = [...foundationCards, ...palsCards];
    const handLimitEffect = (activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit");
    const drawResult = drawWithHandLimit(selectedCards, hand.length, selectedCards.length, handLimitEffect ? Number(handLimitEffect.amount) : Infinity);
    setFoundationDeck((current) => current.slice(foundationCards.length));
    setPalsDeck((current) => current.slice(palsCards.length));
    setHand((current) => [...current, ...drawResult.cardsToHand]);
    if (drawResult.cardsToDiscard.length) setDiscardPile((current) => [...drawResult.cardsToDiscard, ...current]);
    setRp((current) => Math.max(0, current - cost));
    if (actionIsOncePerTurn(pendingCreatureAction.action)) setUsedCreatureActions((current) => [...current, pendingCreatureAction.actionKey]);
    const sourceCard = cardsById[pendingCreatureAction.sourceCardId];
    const shortfall = Number(turnDrawSelection.shortfall ?? getRequiredDrawShortfall(turnDrawSelection.requested, selectedCards.length));
    const message = `${sourceCard.name} drew ${foundationCards.length} from Foundation and ${palsCards.length} from Pals.${drawResult.cardsToDiscard.length ? ` ${drawResult.cardsToDiscard.length} exceeded the hand limit and were discarded.` : ""}${shortfall ? ` The mandatory draw was ${shortfall} card${shortfall === 1 ? "" : "s"} short, so you lose by deck depletion.` : ""}`;
    const revealed = selectedCards.map((cardId, index) => ({ cardId, source: index < foundationCards.length ? "Foundation" : "Pals", discarded: index >= drawResult.cardsToHand.length }));
    pushLog(message);
    setPendingCreatureAction(null);
    setTurnDrawSelection(null);
    if (shortfall) {
      setPendingEvents([]);
      setAttackContext(null);
      setGameResult((current) => current ?? `Defeat: ${sourceCard.name} required you to draw ${turnDrawSelection.requested} cards, but your personal decks contained only ${selectedCards.length}.`);
    }
    setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${pendingCreatureAction.actionName ?? getActionName(pendingCreatureAction.action)}`, message, success: shortfall === 0, drawnCards: revealed });
  }

  function completeCreatureRecovery(cardId) {
    if (!pendingCreatureAction || !discardPile.includes(cardId)) return;
    const cost = pendingCreatureAction.cost ?? getActionCost(pendingCreatureAction.action);
    const sourceCard = cardsById[pendingCreatureAction.sourceCardId];
    const handResult = pendingCreatureAction.effect.destination === "deck" ? null : applyCurrentHandLimit([cardId]);
    setDiscardPile((current) => handResult?.cardsToDiscard.length ? [cardId, ...removeOneCard(current, cardId)] : removeOneCard(current, cardId));
    const recoveredDeckType = getPersonalDeckType(cardsById[cardId]);
    if (pendingCreatureAction.effect.destination === "deck" && recoveredDeckType === "foundation") setFoundationDeck((current) => shuffle([...current, cardId]));
    else if (pendingCreatureAction.effect.destination === "deck") setPalsDeck((current) => shuffle([...current, cardId]));
    else if (handResult.cardsToHand.length) setHand((current) => [...current, cardId]);
    setRp((current) => Math.max(0, current - cost));
    if (actionIsOncePerTurn(pendingCreatureAction.action)) setUsedCreatureActions((current) => [...current, pendingCreatureAction.actionKey]);
    const destination = pendingCreatureAction.effect.destination === "deck" ? `your ${recoveredDeckType === "foundation" ? "Foundation" : "Pals"} deck` : "your hand";
    const message = `${sourceCard.name} moved ${cardsById[cardId]?.name ?? cardId} from your discard pile to ${destination} for ${cost} RP.${handResult?.cardsToDiscard.length ? " The hand limit returned it to the discard pile." : ""}`;
    pushLog(message);
    setPendingCreatureAction(null);
    setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} used ${pendingCreatureAction.actionName ?? getActionName(pendingCreatureAction.action)}`, message, success: true });
  }

  function completeCreatureActionSearch(cardId) {
    if (!pendingCreatureAction?.candidates?.includes(cardId)) return;
    const sourceCard = cardsById[pendingCreatureAction.sourceCardId];
    if (!sourceCard) return;
    const cost = pendingCreatureAction.cost ?? getActionCost(pendingCreatureAction.action);
    setFoundationDeck((current) => shuffle(removeOneCard(current, cardId)));
    setPalsDeck((current) => shuffle(removeOneCard(current, cardId)));
    const handResult = applyCurrentHandLimit([cardId]);
    if (handResult.cardsToHand.length) setHand((current) => [...current, cardId]);
    if (handResult.cardsToDiscard.length) setDiscardPile((current) => [cardId, ...current]);
    setRp((current) => Math.max(0, current - cost));
    if (actionIsOncePerTurn(pendingCreatureAction.action)) setUsedCreatureActions((current) => [...current, pendingCreatureAction.actionKey]);
    const message = `${sourceCard.name}'s ${pendingCreatureAction.actionName ?? getActionName(pendingCreatureAction.action)} found ${cardsById[cardId]?.name ?? cardId} for ${cost} RP and shuffled both personal decks.${handResult.cardsToDiscard.length ? " The card exceeded the hand limit and was discarded." : " It was added to your hand."}`;
    pushLog(message);
    setPendingCreatureAction(null);
    setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, defenderCardId: cardId, title: `Player's ${sourceCard.name} searched`, message, success: true });
  }

  function chooseCreatureActionReorderDeck(deckType) {
    if (!pendingCreatureAction || !["foundation", "pals"].includes(deckType)) return;
    const deck = deckType === "foundation" ? foundationDeck : palsDeck;
    if (!deck.length) return;
    setPendingCreatureAction((current) => ({ ...current, deckType, topCards: deck.slice(0, Number(current.effect.amount ?? 3)) }));
    setEventOverlay({ type: "reorder-creature-action-deck", sourceCardId: pendingCreatureAction.sourceCardId, title: `Player's ${cardsById[pendingCreatureAction.sourceCardId]?.name} used ${pendingCreatureAction.actionName}`, message: `Set the new top-to-bottom order for your ${deckType} deck.` });
  }

  function moveCreatureActionDeckCard(index, delta) {
    if (!pendingCreatureAction?.topCards) return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= pendingCreatureAction.topCards.length) return;
    setPendingCreatureAction((current) => { const topCards = [...current.topCards]; [topCards[index], topCards[nextIndex]] = [topCards[nextIndex], topCards[index]]; return { ...current, topCards }; });
  }

  function commitCreatureActionReorder() {
    if (!pendingCreatureAction?.topCards?.length) return;
    const sourceCard = cardsById[pendingCreatureAction.sourceCardId];
    const deck = pendingCreatureAction.deckType === "foundation" ? foundationDeck : palsDeck;
    const nextDeck = [...pendingCreatureAction.topCards, ...deck.slice(pendingCreatureAction.topCards.length)];
    if (pendingCreatureAction.deckType === "foundation") setFoundationDeck(nextDeck);
    else setPalsDeck(nextDeck);
    setRp((current) => Math.max(0, current - pendingCreatureAction.cost));
    if (actionIsOncePerTurn(pendingCreatureAction.action)) setUsedCreatureActions((current) => [...current, pendingCreatureAction.actionKey]);
    const message = `${sourceCard.name}'s ${pendingCreatureAction.actionName} rearranged the top ${pendingCreatureAction.topCards.length} cards of your ${pendingCreatureAction.deckType} deck for ${pendingCreatureAction.cost} RP.`;
    pushLog(message);
    setPendingCreatureAction(null);
    setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, title: `Player's ${sourceCard.name} completed deck rearrangement`, message, success: true });
  }

  function toggleActionHandDiscard(index) {
    if (!pendingCreatureAction?.handEntries?.some((entry) => entry.index === index)) return;
    const maxDiscard = pendingCreatureAction.maxDiscard ?? Math.max(0, Number(pendingCreatureAction.effect.discard?.amount ?? 0));
    setPendingCreatureAction((current) => ({ ...current, selectedIndices: current.selectedIndices.includes(index) ? current.selectedIndices.filter((selectedIndex) => selectedIndex !== index) : current.selectedIndices.length < maxDiscard ? [...current.selectedIndices, index] : current.selectedIndices }));
  }

  function confirmActionHandDiscard() {
    if (!pendingCreatureAction?.handEntries) return;
    const required = pendingCreatureAction.minDiscard ?? Math.max(0, Number(pendingCreatureAction.effect.discard?.amount ?? 0));
    const maxDiscard = pendingCreatureAction.maxDiscard ?? required;
    if (pendingCreatureAction.selectedIndices.length < required || pendingCreatureAction.selectedIndices.length > maxDiscard) return;
    const selectedCards = pendingCreatureAction.selectedIndices.map((index) => pendingCreatureAction.handEntries.find((entry) => entry.index === index)?.cardId).filter(Boolean);
    const cost = pendingCreatureAction.cost ?? getActionCost(pendingCreatureAction.action);
    let remainingHand = hand;
    selectedCards.forEach((cardId) => { remainingHand = removeOneCard(remainingHand, cardId); });
    setHand(remainingHand);
    setDiscardPile((current) => [...selectedCards, ...current]);
    if (pendingCreatureAction.effect.type === "discardThenDraw") {
      const drawCount = selectedCards.length;
      setPendingCreatureAction((current) => ({ ...current, effect: { type: EffectType.DRAW_CARDS, amount: drawCount }, discardedCards: selectedCards, handEntries: null, selectedIndices: [], committed: true }));
      setTurnDrawSelection({ requested: drawCount, target: Math.min(drawCount, foundationDeck.length + palsDeck.length), foundation: 0, pals: 0, mode: "action" });
      setEventOverlay({ type: "choose-action-deck", sourceCardId: pendingCreatureAction.sourceCardId, title: `Player's ${cardsById[pendingCreatureAction.sourceCardId]?.name} used ${pendingCreatureAction.actionName ?? getActionName(pendingCreatureAction.action)}`, message: `The ${selectedCards.length} discarded card(s) are committed. Allocate the same number of draws between your personal decks.` });
      return;
    }
    setRp((current) => Math.max(0, current - cost));
    if (actionIsOncePerTurn(pendingCreatureAction.action)) setUsedCreatureActions((current) => [...current, pendingCreatureAction.actionKey]);
    const candidates = [...new Set([...foundationDeck, ...palsDeck])];
    setPendingCreatureAction((current) => ({ ...current, discardedCards: selectedCards, searchCandidates: candidates }));
    setEventOverlay({ type: "choose-action-search-card", sourceCardId: pendingCreatureAction.sourceCardId, title: `Player's ${cardsById[pendingCreatureAction.sourceCardId]?.name} used ${pendingCreatureAction.action.name}`, message: "Choose any card from either personal deck. The discarded cards and RP cost are now committed." });
  }

  function completeActionDeckSearch(cardId) {
    if (!pendingCreatureAction?.searchCandidates?.includes(cardId)) return;
    const sourceCard = cardsById[pendingCreatureAction.sourceCardId];
    if (!sourceCard) return;
    setFoundationDeck((current) => shuffle(removeOneCard(current, cardId)));
    setPalsDeck((current) => shuffle(removeOneCard(current, cardId)));
    const handResult = applyCurrentHandLimit([cardId]);
    if (handResult.cardsToHand.length) setHand((current) => [...current, cardId]);
    if (handResult.cardsToDiscard.length) setDiscardPile((current) => [cardId, ...current]);
    const discardedNames = (pendingCreatureAction.discardedCards ?? []).map((discardedId) => cardsById[discardedId]?.name ?? discardedId).join(", ");
    const message = `${sourceCard.name} discarded ${discardedNames}, found ${cardsById[cardId]?.name}, revealed it, and shuffled both personal decks.${handResult.cardsToDiscard.length ? " The found card exceeded the hand limit and was discarded." : ""}`;
    pushLog(message);
    setPendingCreatureAction(null);
    setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, defenderCardId: cardId, title: `Player's ${sourceCard.name} completed Scavenge`, message, success: true });
  }

  function completeDefensiveBuff(slotId) {
    if (!pendingCreatureAction?.candidates?.some((candidate) => candidate.slotId === slotId)) return;
    const { action, effect, actionKey, sourceCardId } = pendingCreatureAction;
    const cost = Number(action.cost?.rp ?? 0);
    const targetEntry = pendingCreatureAction.candidates.find((candidate) => candidate.slotId === slotId);
    const status = effect.type === EffectType.GRANT_DEFENSE_ADVANTAGE
      ? { type: "defenseAdvantage", expiresTurn: turn + 1, sourceCardId }
      : { type: "defenseBonusDice", dice: effect.amount?.dice ?? "D4", expiresTurn: turn + 1, sourceCardId };
    const statusKey = targetEntry.statusKey ?? slotId;
    setCreatureStatuses((current) => ({ ...current, [statusKey]: [...(current[statusKey] ?? []), status] }));
    setRp((current) => Math.max(0, current - cost));
    if (actionIsOncePerTurn(action)) setUsedCreatureActions((current) => [...current, actionKey]);
    const sourceCard = cardsById[sourceCardId];
    const targetCard = cardsById[targetEntry.cardId];
    const message = `${sourceCard.name} gave ${targetCard.name} ${status.type === "defenseAdvantage" ? "advantage on defense rolls" : `+${status.dice} to defense rolls`} until your next turn for ${cost} RP.`;
    pushLog(message);
    setPendingCreatureAction(null);
    setEventOverlay({ type: "utility-result", sourceCardId, defenderCardId: targetCard.id, title: `Player's ${sourceCard.name} used ${action.name}`, message, success: true });
  }

  function completeCoinCoralEffect(coralId) {
    if (!pendingCreatureAction?.candidates?.includes(coralId)) return;
    const target = opponentCorals.find((coral) => coral.id === coralId);
    const sourceCard = cardsById[pendingCreatureAction.sourceCardId];
    const effect = pendingCreatureAction.effect.onSuccess ?? pendingCreatureAction.effect;
    if (!target || !sourceCard || !effect) return;
    let message = "";
    if (effect.type === EffectType.DAMAGE) {
      const amount = Number(effect.amount?.value ?? effect.amount ?? 0);
      const result = applyDamage(target.health ?? target.maxHealth, amount);
      if (result.destroyed) {
        const targetCard = cardsById[target.cardId];
        const handLimit = Number((activeCondition?.effects ?? []).find((candidate) => candidate.type === "setHandLimit")?.amount ?? Infinity);
        const previewTriggers = resolveFoundationDestructionTriggers([[target]], opponent.hand, opponent.discardPile, handLimit);
        setOpponent((current) => {
          const currentTarget = current.corals.find((coral) => coral.id === coralId) ?? target;
          const redistributed = redistributeOrphanCreatures(current.corals.filter((coral) => coral.id !== coralId), [...(current.orphanCreatures ?? []), ...getOrphanEntriesFromFoundation(currentTarget)]);
          const triggerResult = resolveFoundationDestructionTriggers([[currentTarget]], current.hand, current.discardPile, handLimit);
          return { ...current, corals: redistributed.corals, orphanCreatures: redistributed.orphans, hand: triggerResult.hand, discardPile: triggerResult.discardPile };
        });
        const fragmentTrigger = previewTriggers.triggers[0];
        const fragmentMessage = fragmentTrigger
          ? fragmentTrigger.cardsToHand.length
            ? ` Fragment returned ${fragmentTrigger.cardsToHand.length} ${cardsById[fragmentTrigger.targetCardId]?.name ?? "matching card"}(s) to the opponent's hand.`
            : fragmentTrigger.cardsToDiscard.length
              ? " Fragment found its card, but the hand limit kept it in discard."
              : ` Fragment triggered but found no ${cardsById[fragmentTrigger.targetCardId]?.name ?? "matching card"}.`
          : "";
        message = `${sourceCard.name} dealt ${result.appliedDamage} damage and destroyed the opponent's ${targetCard?.name}. The creatures filled compatible slots or remained orphaned on the opponent's reef.${fragmentMessage}`;
      } else {
        setOpponent((current) => ({ ...current, corals: current.corals.map((coral) => coral.id === coralId ? { ...coral, health: result.remainingHealth } : coral) }));
        message = `${sourceCard.name} dealt ${result.appliedDamage} damage to the opponent's ${cardsById[target.cardId]?.name}. ${result.remainingHealth}/${target.maxHealth} HP remains.`;
      }
    } else if (effect.type === EffectType.MODIFY_RP_GENERATION || effect.type === "modifyRpGeneration") {
      const penalty = Math.abs(Number(effect.amount ?? 0));
      setOpponent((current) => ({ ...current, corals: current.corals.map((coral) => coral.id === coralId ? { ...coral, rpPenaltyNextTurn: Number(coral.rpPenaltyNextTurn ?? 0) + penalty } : coral) }));
      message = `${sourceCard.name} made the opponent's ${cardsById[target.cardId]?.name} produce ${penalty} less RP during its next collection.`;
    } else if (effect.type === EffectType.STUN_CORAL) {
      setOpponent((current) => ({ ...current, corals: current.corals.map((coral) => coral.id === coralId ? { ...coral, statuses: [...(coral.statuses ?? []), { type: "stunned", sourceCardId: sourceCard.id }] } : coral) }));
      message = `${sourceCard.name} stunned the opponent's ${cardsById[target.cardId]?.name}. The card data does not define an automatic gameplay consequence for Stunned, so the status is tracked visibly until an effect removes it.`;
    }
    if (!pendingCreatureAction.costCommitted) {
      const cost = pendingCreatureAction.cost ?? getActionCost(pendingCreatureAction.action);
      setRp((current) => Math.max(0, current - cost));
      if (actionIsOncePerTurn(pendingCreatureAction.action)) setUsedCreatureActions((current) => current.includes(pendingCreatureAction.actionKey) ? current : [...current, pendingCreatureAction.actionKey]);
    }
    pushLog(message);
    setPendingCreatureAction(null);
    setEventOverlay({ type: "impact-result", sourceCardId: sourceCard.id, defenderCardId: target.cardId, title: `Player's ${sourceCard.name} used ${pendingCreatureAction.actionName ?? getActionName(pendingCreatureAction.action)}`, message, success: true });
  }

  function completeSymbiosis(cardId = null) {
    if (searchContext?.mode !== "symbiosis") return;
    const sourceCard = cardsById[searchContext.sourceCardId];
    const sourceCoral = playerCorals.find((coral) => coral.id === searchContext.coralId);
    const sourceSlot = sourceCoral?.slots.find((slot) => slot.id === searchContext.slotId && slot.cardId === sourceCard?.id);
    const nextHostedCardIds = cardId && sourceSlot
      ? placeCardInSpecialHost(sourceCard, cardsById[cardId], sourceSlot.hostedCardIds, cardId)
      : null;
    if (cardId && searchContext.candidates.includes(cardId) && hand.includes(cardId) && nextHostedCardIds) {
      setPlayerCorals((current) => current.map((coral) => coral.id === searchContext.coralId ? { ...coral, slots: coral.slots.map((slot) => slot.id === searchContext.slotId && slot.cardId === sourceCard.id ? { ...slot, hostedCardIds: nextHostedCardIds } : slot) } : coral));
      setHand((current) => removeOneCard(current, cardId));
      const message = `${sourceCard.name}'s Symbiosis hosted ${cardsById[cardId]?.name} from your hand. The hosted card counts toward VP and receives the Anemone's defensive protection.`;
      pushLog(message);
      setSearchContext(null);
      setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, defenderCardId: cardId, title: `Player's ${sourceCard.name} used Symbiosis`, message, success: true });
      return;
    }
    const message = cardId
      ? `${sourceCard?.name ?? "Anemone"} could not host that Clownfish because the host moved, changed, or no longer has space.`
      : `${sourceCard?.name ?? "Anemone"}'s optional Clownfish attachment was skipped.`;
    pushLog(message);
    setSearchContext(null);
    setEventOverlay({ type: "utility-result", sourceCardId: sourceCard?.id, title: "Symbiosis Skipped", message, success: false });
  }

  function completeTerritorialTarget(coralId) {
    if (searchContext?.mode !== "territorial-target" || !searchContext.candidates.includes(coralId)) return;
    const target = playerCorals.find((foundation) => foundation.id === coralId && isCreatureSchool(cardsById[foundation.cardId]));
    if (!target) {
      setSearchContext(null);
      setEventOverlay(null);
      pushLog("Territorial could not resolve because the chosen Creature School is no longer in play.");
      return;
    }
    setPlayerReefCreatureInstances((current) => current.map((instance) => instance.instanceId === searchContext.sourceInstanceId
      ? { ...instance, territorialTargetFoundationId: target.id }
      : instance));
    const sourceCard = cardsById[searchContext.sourceCardId];
    const message = `${sourceCard?.name ?? "Ocean Triggerfish"}'s Territorial gives ${cardsById[target.cardId]?.name} +10 HP while that Triggerfish remains in play.`;
    pushLog(message);
    setSearchContext(null);
    setEventOverlay({ type: "utility-result", sourceCardId: sourceCard?.id, defenderCardId: target.cardId, title: `Player's ${sourceCard?.name ?? "Ocean Triggerfish"} used Territorial`, message, success: true });
  }

  function toggleOnPlaySearchCard(cardId) {
    if (searchContext?.mode !== "onplay-multi-search" || !searchContext.candidates.includes(cardId)) return;
    setSearchContext((current) => {
      const availableCopies = [...foundationDeck, ...palsDeck].filter((candidateId) => candidateId === cardId).length;
      const selectedCopies = current.selected.filter((selectedId) => selectedId === cardId).length;
      const selected = selectedCopies < availableCopies && current.selected.length < current.max
        ? [...current.selected, cardId]
        : current.selected.filter((selectedId) => selectedId !== cardId);
      return { ...current, selected };
    });
  }

  function completeOnPlayMultiSearch(selectedOverride = null) {
    if (searchContext?.mode !== "onplay-multi-search") return;
    const selected = selectedOverride ?? searchContext.selected;
    const handLimit = Number((activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit")?.amount ?? Infinity);
    const availableSpace = Number.isFinite(handLimit) ? Math.max(0, handLimit - hand.length) : selected.length;
    const toHand = selected.slice(0, availableSpace);
    const toDiscard = selected.slice(availableSpace);
    setFoundationDeck((current) => shuffle(selected.reduce((deck, cardId) => removeOneCard(deck, cardId), current)));
    setPalsDeck((current) => shuffle(selected.reduce((deck, cardId) => removeOneCard(deck, cardId), current)));
    if (toHand.length) setHand((current) => [...current, ...toHand]);
    if (toDiscard.length) setDiscardPile((current) => [...toDiscard, ...current]);
    const sourceCard = cardsById[searchContext.sourceCardId];
    const message = selected.length ? `${sourceCard.name}'s ${searchContext.actionName} revealed ${selected.map((cardId) => cardsById[cardId]?.name).join(" and ")}.${toDiscard.length ? ` ${toDiscard.length} exceeded the hand limit and was discarded.` : ""}` : `${sourceCard.name}'s optional search selected no cards.`;
    pushLog(message);
    setSearchContext(null);
    setEventOverlay({ type: "utility-result", sourceCardId: sourceCard.id, defenderCardId: selected[0], title: `Player's ${sourceCard.name} used ${searchContext.actionName}`, message, success: selected.length > 0 });
  }

  function runOpponentSupports(opponentState) {
    if (opponentState.supportBlockedUntilRound >= round) return { state: opponentState, summaries: [], impacts: [], events: [], lost: false, lossSummary: "" };
    let next = opponentState;
    const summaries = [];
    const impacts = [];
    const events = [];
    let lossSummary = "";
    // A non-locking search can find another Support, which is also legal to play
    // this turn. Use the finite cards in the opponent's zones as a safety bound
    // instead of freezing the count to Supports that began in hand.
    const availableSupportPlays = Math.max(1, opponentState.hand.length + opponentState.palsDeck.length + opponentState.foundationDeck.length + opponentState.discardPile.length);
    const supportPlaySafetyLimit = limitOpponentOptionalActions(availableSupportPlays, opponentDifficulty, "support");
    for (let playCount = 0; playCount < supportPlaySafetyLimit; playCount += 1) {
      let chosen = null;
      const scoreSupport = (cardId) => {
        const card = cardsById[cardId];
        if (!card || card.kind !== CardKind.SUPPORT) return -Infinity;
        if (card.id === "super-whirlpool") return 110;
        if (card.id === "whirlpool") return 100;
        if (card.id === "coral-cement" || card.id === "coral-heal") return 90;
        if (card.id === "restocking" || card.id === "recovery") return 78;
        if (card.id === "scientist-jes") return 72;
        if (card.id === "dr-evans") return next.hand.length <= 3 ? 70 : 15;
        if (card.id === "explorer-jordan") return 68;
        if (card.id === "robotic-survey") return 48;
        if ((card.effects ?? []).some((effect) => effect.type === EffectType.SEARCH_DECK || effect.type === EffectType.DRAW_CARDS)) return 65;
        if (card.id === "rov-lights" || card.id === "poison-heal") return 55;
        if (card.id === "spearfishing") return 25;
        return 45;
      };
      for (const cardId of orderOpponentChoices(next.hand, opponentDifficulty, scoreSupport)) {
        const card = cardsById[cardId];
        if (card?.kind !== CardKind.SUPPORT || getConditionPlayRestriction(card, activeCondition)) continue;
        const cost = getCardPlayCost(card, activeCondition);
        if (cost > next.rp) continue;
        const effects = card.effects ?? [];
        const searchEffect = effects.find((effect) => effect.type === EffectType.SEARCH_DECK);
        const chooseTopEffect = effects.find((effect) => effect.type === "chooseFromTopDeck");
        const reorderEffect = effects.find((effect) => effect.type === "peekAndReorderDeck");
        const hasSearchTarget = searchEffect && [...next.palsDeck, ...next.foundationDeck].some((candidateId) => cardMatchesSearchCriteria(cardsById[candidateId], searchEffect));
        const hasSpearfishingTarget = card.id === "spearfishing" && ([...(next.reefCreatures ?? []), ...(next.orphanCreatures ?? []).map((entry) => entry.cardId), ...next.corals.flatMap((coral) => coral.slots.map((slot) => slot.cardId))].some((candidateId) => [CardCategory.FISH, CardCategory.PREDATOR].includes(cardsById[candidateId]?.category)));
        const canUseScientistJesDraw = card.id === "scientist-jes" && Boolean(next.palsDeck.length || next.foundationDeck.length);
        const hasTopDeckCards = Boolean(next.palsDeck.length || next.foundationDeck.length);
        const usable = hasSearchTarget || (chooseTopEffect && hasTopDeckCards) || (reorderEffect && hasTopDeckCards) || canUseScientistJesDraw || (card.id === "dr-evans" && next.hand.length <= 3) || (card.id === "coral-cement" && next.corals.some((coral) => cardsById[coral.cardId]?.kind === CardKind.CORAL && coral.health < coral.maxHealth)) || (card.id === "coral-heal" && next.corals.some((coral) => cardsById[coral.cardId]?.kind === CardKind.CORAL && (coral.statuses?.length || Number(coral.rpPenaltyNextTurn ?? 0) > 0))) || (card.id === "recovery" && next.discardPile.length) || (card.id === "restocking" && next.discardPile.some((candidateId) => cardsById[candidateId]?.category === CardCategory.FISH)) || card.id === "poison-heal" || card.id === "rov-lights" || hasSpearfishingTarget || (["whirlpool", "super-whirlpool"].includes(card.id) && playerCoralCards.length);
        if (usable) { chosen = { card, cost, effects, searchEffect, chooseTopEffect, reorderEffect }; break; }
      }
      if (!chosen) break;
      const { card, cost, effects, searchEffect, chooseTopEffect, reorderEffect } = chosen;
      next = { ...next, hand: removeOneCard(next.hand, card.id), discardPile: [card.id, ...next.discardPile], rp: Math.max(0, next.rp - cost) };
      const details = [];
      let revealedCardIds = [];
      const scientistJesChoosesSearch = card.id === "scientist-jes"
        && !next.habitats.length
        && !next.hand.some((cardId) => cardsById[cardId]?.kind === CardKind.HABITAT)
        && Boolean(searchEffect && [...next.palsDeck, ...next.foundationDeck].some((candidateId) => cardMatchesSearchCriteria(cardsById[candidateId], searchEffect)));
      if (searchEffect && (card.id !== "scientist-jes" || scientistJesChoosesSearch)) {
        const candidates = [...next.palsDeck, ...next.foundationDeck].filter((candidateId) => cardMatchesSearchCriteria(cardsById[candidateId], searchEffect)).slice(0, Math.max(1, Number(searchEffect.amount ?? 1)));
        next = { ...next, palsDeck: shuffle(candidates.reduce((deck, cardId) => removeOneCard(deck, cardId), next.palsDeck)), foundationDeck: shuffle(candidates.reduce((deck, cardId) => removeOneCard(deck, cardId), next.foundationDeck)), hand: [...next.hand, ...candidates] };
        details.push(`found ${candidates.map((cardId) => cardsById[cardId]?.name).join(" and ")}`);
        if (searchEffect.revealToOpponent || /show (?:it|them) to your opponent/i.test(card.text ?? "")) revealedCardIds = candidates;
      }
      if (chooseTopEffect) {
        const amount = Math.max(1, Number(chooseTopEffect.amount ?? 5));
        const deckOptions = ["palsDeck", "foundationDeck"].map((deckKey) => ({
          deckKey,
          candidates: next[deckKey].slice(0, amount).filter((cardId) => {
            const candidate = cardsById[cardId];
            return candidate && (!chooseTopEffect.targetKind || candidate.kind === chooseTopEffect.targetKind);
          }),
        }));
        const choice = deckOptions.flatMap((option) => option.candidates.map((cardId) => ({ deckKey: option.deckKey, cardId, score: Number(cardsById[cardId]?.victoryPoints?.value ?? cardsById[cardId]?.victoryPoints ?? cardsById[cardId]?.vp ?? 0) * 10 + (cardsById[cardId]?.actions?.length ?? 0) * 3 }))).sort((left, right) => right.score - left.score)[0];
        if (choice) {
          next = { ...next, [choice.deckKey]: shuffle(removeOneCard(next[choice.deckKey], choice.cardId)), hand: [...next.hand, choice.cardId] };
          details.push(`inspected the top cards and added ${cardsById[choice.cardId]?.name} to its hand`);
          if (chooseTopEffect.revealToOpponent) revealedCardIds = [choice.cardId];
        } else details.push("inspected the top cards but found no matching creature");
      } else if (reorderEffect) {
        const amount = Math.max(1, Number(reorderEffect.amount ?? 5));
        const deckKey = next.palsDeck.length ? "palsDeck" : "foundationDeck";
        const top = next[deckKey].slice(0, amount).sort((leftId, rightId) => {
          const left = cardsById[leftId];
          const right = cardsById[rightId];
          const score = (candidate) => Number(candidate?.victoryPoints?.value ?? candidate?.victoryPoints ?? candidate?.vp ?? 0) * 10 + getCardStartTurnRp(candidate) * 8 + (candidate?.actions?.length ?? 0) * 3 - Number(candidate?.cost?.rp ?? 0);
          return score(right) - score(left);
        });
        next = { ...next, [deckKey]: [...top, ...next[deckKey].slice(top.length)] };
        details.push(`reordered the top ${top.length} cards of its ${deckKey === "palsDeck" ? "Pals" : "Foundation"} deck`);
      }
      const drawEffect = effects.find((effect) => effect.type === EffectType.DRAW_CARDS);
      if (card.id === "dr-evans") {
        const oldHand = next.hand;
        next = { ...next, hand: [], discardPile: [...oldHand, ...next.discardPile] };
        let drawn = 0;
        while (drawn < 7 && (next.palsDeck.length || next.foundationDeck.length)) {
          const deckKey = drawn % 2 === 0 && next.palsDeck.length ? "palsDeck" : next.foundationDeck.length ? "foundationDeck" : "palsDeck";
          next = { ...next, hand: [...next.hand, next[deckKey][0]], [deckKey]: next[deckKey].slice(1) };
          drawn += 1;
        }
        details.push(`discarded its hand and drew ${drawn}`);
        const shortfall = getRequiredDrawShortfall(7, drawn);
        if (shortfall) lossSummary = `Opponent's ${card.name} required a seven-card draw, but its personal decks contained only ${drawn}. The opponent loses by deck depletion.`;
      } else if (drawEffect && (card.id !== "scientist-jes" || !scientistJesChoosesSearch)) {
        const requested = Math.max(0, Number(drawEffect.amount ?? 0));
        let drawn = 0;
        while (drawn < requested && (next.palsDeck.length || next.foundationDeck.length)) {
          const deckKey = drawn % 2 === 0 && next.palsDeck.length ? "palsDeck" : next.foundationDeck.length ? "foundationDeck" : "palsDeck";
          next = { ...next, hand: [...next.hand, next[deckKey][0]], [deckKey]: next[deckKey].slice(1) };
          drawn += 1;
        }
        if (drawn) details.push(`drew ${drawn}`);
        const shortfall = getRequiredDrawShortfall(requested, drawn);
        if (shortfall) lossSummary = `Opponent's ${card.name} required ${requested} drawn card${requested === 1 ? "" : "s"}, but its personal decks contained only ${drawn}. The opponent loses by deck depletion.`;
      }
      if (card.id === "coral-cement") {
        const target = next.corals.find((coral) => cardsById[coral.cardId]?.kind === CardKind.CORAL && coral.health < coral.maxHealth);
        if (target) next = { ...next, corals: next.corals.map((coral) => coral.id === target.id ? { ...coral, health: Math.min(coral.maxHealth, coral.health + 20) } : coral) };
        if (target) details.push(`healed ${cardsById[target.cardId]?.name} for up to 20 HP`);
      } else if (card.id === "coral-heal") {
        const target = next.corals.find((coral) => cardsById[coral.cardId]?.kind === CardKind.CORAL && (coral.statuses?.length || Number(coral.rpPenaltyNextTurn ?? 0) > 0));
        if (target) next = { ...next, corals: next.corals.map((coral) => {
          if (coral.id !== target.id) return coral;
          const { rpPenaltyNextTurn, ...clearedCoral } = coral;
          return { ...clearedCoral, statuses: [] };
        }) };
        if (target) details.push(`removed all effects from ${cardsById[target.cardId]?.name}`);
      } else if (card.id === "recovery") {
        const coin = Math.random() < 0.5 ? "heads" : "tails";
        if (coin === "heads") {
          const playedRecoveryId = next.discardPile[0];
          const recoverableDiscard = next.discardPile.slice(1);
          const recoveredId = recoverableDiscard[0];
          if (recoveredId) next = { ...next, hand: [...next.hand, recoveredId], discardPile: [playedRecoveryId, ...removeOneCard(recoverableDiscard, recoveredId)] };
          details.push(recoveredId ? `flipped heads and recovered ${cardsById[recoveredId]?.name}` : "flipped heads but had no other card to recover");
        } else details.push("flipped tails and recovered nothing");
      } else if (card.id === "restocking") {
        const recoveredIds = next.discardPile.filter((cardId) => cardsById[cardId]?.category === CardCategory.FISH).slice(0, 3);
        const recoveredFoundationIds = recoveredIds.filter((cardId) => getPersonalDeckType(cardsById[cardId]) === "foundation");
        const recoveredPalsIds = recoveredIds.filter((cardId) => getPersonalDeckType(cardsById[cardId]) === "pals");
        next = { ...next, discardPile: recoveredIds.reduce((pile, cardId) => removeOneCard(pile, cardId), next.discardPile), foundationDeck: shuffle([...next.foundationDeck, ...recoveredFoundationIds]), palsDeck: shuffle([...next.palsDeck, ...recoveredPalsIds]) };
        details.push(`restocked ${recoveredIds.length} Fish`);
      } else if (card.id === "spearfishing") {
        const slottedTarget = next.corals.flatMap((coral) => coral.slots.filter((slot) => [CardCategory.FISH, CardCategory.PREDATOR].includes(cardsById[slot.cardId]?.category)).map((slot) => ({ coralId: coral.id, slotId: slot.id, cardId: slot.cardId, hostedCardIds: [...(slot.hostedCardIds ?? [])] }))).at(0);
        const orphanIndex = slottedTarget ? -1 : (next.orphanCreatures ?? []).findIndex((entry) => [CardCategory.FISH, CardCategory.PREDATOR].includes(cardsById[entry.cardId]?.category));
        const reefIndex = slottedTarget || orphanIndex >= 0 ? -1 : (next.reefCreatureInstances ?? []).findIndex((entry) => [CardCategory.FISH, CardCategory.PREDATOR].includes(cardsById[entry.cardId]?.category));
        const orphanTarget = orphanIndex >= 0 ? next.orphanCreatures[orphanIndex] : null;
        const reefTarget = reefIndex >= 0 ? next.reefCreatureInstances[reefIndex] : null;
        const targetId = slottedTarget?.cardId ?? orphanTarget?.cardId ?? reefTarget?.cardId;
        const recoveredRp = Number(cardsById[targetId]?.cost?.rp ?? 0);
        const nextOrphans = orphanIndex >= 0
          ? [...next.orphanCreatures.filter((entry) => entry.instanceId !== orphanTarget.instanceId), ...(orphanTarget.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`opponent-orphan-${cardId}`)))]
          : [...(next.orphanCreatures ?? []), ...(slottedTarget?.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`opponent-orphan-${cardId}`)))];
        const nextReefInstances = reefTarget ? removeCreatureInstances(next.reefCreatureInstances, [reefTarget.instanceId]).instances : next.reefCreatureInstances;
        next = { ...next, corals: slottedTarget ? next.corals.map((coral) => coral.id === slottedTarget.coralId ? { ...coral, slots: coral.slots.map((slot) => slot.id === slottedTarget.slotId ? { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot) } : coral) : next.corals, orphanCreatures: nextOrphans, reefCreatureInstances: nextReefInstances, reefCreatures: nextReefInstances.map((entry) => entry.cardId), discardPile: [targetId, ...next.discardPile], rp: addResourceWithinCap(next.rp, recoveredRp, getEcosystemRpCap(next.corals, [...next.habitats, ...nextReefInstances.map((entry) => entry.cardId), ...(nextOrphans ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])], activeCondition)) };
        details.push(`discarded ${cardsById[targetId]?.name} and recovered ${recoveredRp} RP`);
      } else if (card.id === "whirlpool" || card.id === "super-whirlpool") {
        const amount = card.id === "super-whirlpool" ? 2 : 1;
        impacts.push({ sourceCardId: card.id, actionName: card.name, rpPenalty: amount });
        details.push(`made your first coral produce ${amount} less RP during its next collection`);
      } else if (card.id === "poison-heal") next = { ...next, poisonImmunityNextPredatorAttack: true };
      else if (card.id === "rov-lights") next = { ...next, rovLightsActive: true };
      const handLimit = Number((activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit")?.amount ?? Infinity);
      if (Number.isFinite(handLimit) && next.hand.length > handLimit) next = { ...next, discardPile: [...next.hand.slice(handLimit), ...next.discardPile], hand: next.hand.slice(0, handLimit) };
      summaries.push(`Opponent played ${card.name}${cost ? ` for ${cost} RP` : ""}${details.length ? ` and ${details.join(", ")}` : ""}.`);
      events.push({ type: "opponent-play", sourceCardId: card.id, title: revealedCardIds.length ? `Opponent played ${card.name} and revealed ${revealedCardIds.length === 1 ? cardsById[revealedCardIds[0]]?.name : `${revealedCardIds.length} cards`}` : `Opponent played ${card.name}`, message: `${card.name}${cost ? ` cost ${cost} RP` : " cost 0 RP"}.${details.length ? ` It ${details.join(", ")}.` : ""}${revealedCardIds.length ? " The searched card selection is revealed below." : ""}`, revealedCards: revealedCardIds, success: true, opponentStateAfter: reconcileOpponentInstances(opponentState, next) });
      if (lossSummary || supportExplicitlyLocksFurtherSupports(card)) break;
    }
    return { state: reconcileOpponentInstances(opponentState, next), summaries, impacts, events, lost: Boolean(lossSummary), lossSummary };
  }

  function runOpponentTurn(current) {
    const income = 1 + getEcosystemStartTurnRp(current.corals, activeCondition);
    let next = {
      ...current,
      creatureStatuses: Object.fromEntries(Object.entries(current.creatureStatuses ?? {}).map(([statusKey, statuses]) => [statusKey, statuses.filter((status) => Number(status.expiresTurn ?? Infinity) > turn)]).filter(([, statuses]) => statuses.length)),
    };
    const collectionCap = getEcosystemRpCap(next.corals, [...next.habitats, ...next.reefCreatures, ...(next.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])], activeCondition);
    const rpBeforeCollection = next.rp;
    const rpAfterCollection = addResourceWithinCap(rpBeforeCollection, income, collectionCap);
    const collectedIncome = Math.max(0, rpAfterCollection - Math.min(rpBeforeCollection, collectionCap));
    const cappedIncome = Math.max(0, rpBeforeCollection + income - rpAfterCollection);
    next = {
      ...next,
      corals: next.corals.map(({ rpPenaltyNextTurn, ...coral }) => coral),
      rp: rpAfterCollection,
    };
    const collectionSummary = `Opponent collected ${collectedIncome} RP from ${income} available; bank ${rpAfterCollection}/${collectionCap}.${cappedIncome ? ` ${cappedIncome} RP was discarded at the cap.` : ""}`;
    const requestedDraws = 1 + getConditionExtraDraws(activeCondition);
    const startOfTurnCollection = {
      collected: collectedIncome,
      available: income,
      bank: rpAfterCollection,
      cap: collectionCap,
      capped: cappedIncome,
      requestedDraws,
    };
    const preferredDeck = chooseOpponentPreferredDeck({
      difficulty: opponentDifficulty,
      round,
      coralCount: next.corals.length,
      emptySlotCount: next.corals.reduce((total, coral) => total + coral.slots.filter((slot) => !slot.cardId).length, 0),
      foundationCardsInHand: next.hand.filter((cardId) => isFoundationCard(cardsById[cardId])).length,
      creaturesInHand: next.hand.filter((cardId) => cardsById[cardId]?.kind === CardKind.CREATURE && !isCreatureSchool(cardsById[cardId])).length,
    });
    if (!next.foundationDeck.length && !next.palsDeck.length) {
      const summary = `${collectionSummary} Opponent could not draw because both personal decks were empty and loses by deck depletion.`;
      return { state: next, startOfTurnState: reconcileOpponentInstances(current, next), startOfTurnSummary: summary, startOfTurnDetails: { ...startOfTurnCollection, drawn: 0, foundationDrawn: 0, palsDrawn: 0, drawShortfall: requestedDraws, handLimitDiscarded: 0 }, lost: true, summary };
    }
    const drawnFrom = [];
    for (let index = 0; index < requestedDraws; index += 1) {
      const firstChoice = index % 2 === 0 ? preferredDeck : preferredDeck === "palsDeck" ? "foundationDeck" : "palsDeck";
      const deckKey = next[firstChoice].length ? firstChoice : firstChoice === "palsDeck" ? "foundationDeck" : "palsDeck";
      if (!next[deckKey].length) break;
      const cardId = next[deckKey][0];
      drawnFrom.push(deckKey === "palsDeck" ? "Pals" : "Foundation");
      next = { ...next, [deckKey]: next[deckKey].slice(1), hand: [...next.hand, cardId] };
    }
    const drawSummary = drawnFrom.reduce((counts, deckName) => ({ ...counts, [deckName]: (counts[deckName] ?? 0) + 1 }), {});
    const drawSummaryText = Object.entries(drawSummary).map(([deckName, count]) => `${count} from ${deckName}`).join(" and ");
    if (getRequiredDrawShortfall(requestedDraws, drawnFrom.length) > 0) {
      const summary = `Opponent was required to draw ${requestedDraws} cards, but its personal decks contained only ${drawnFrom.length}. The opponent loses by deck depletion.`;
      return {
        state: reconcileOpponentInstances(current, next),
        startOfTurnState: reconcileOpponentInstances(current, next),
        startOfTurnSummary: `${collectionSummary}${drawSummaryText ? ` Opponent drew ${drawSummaryText}.` : ""} ${summary}`,
        startOfTurnDetails: { ...startOfTurnCollection, drawn: drawnFrom.length, foundationDrawn: Number(drawSummary.Foundation ?? 0), palsDrawn: Number(drawSummary.Pals ?? 0), drawShortfall: Math.max(0, requestedDraws - drawnFrom.length), handLimitDiscarded: 0 },
        lost: true,
        summary: `${collectionSummary} ${summary}`,
      };
    }
    const handLimitEffect = (activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit");
    const opponentHandLimit = Number(handLimitEffect?.amount ?? Infinity);
    const excessHandCards = Number.isFinite(opponentHandLimit) && next.hand.length > opponentHandLimit ? next.hand.slice(opponentHandLimit) : [];
    if (excessHandCards.length) next = { ...next, hand: next.hand.slice(0, opponentHandLimit), discardPile: [...excessHandCards, ...next.discardPile] };
    let handLimitSummary = excessHandCards.length ? ` ${excessHandCards.length} excess card(s) were discarded by the hand limit.` : "";
    const startOfTurnState = reconcileOpponentInstances(current, next);
    const startOfTurnSummary = `${collectionSummary} Opponent drew ${drawSummaryText || "no cards"}.${handLimitSummary}`;
    const startOfTurnDetails = { ...startOfTurnCollection, drawn: drawnFrom.length, foundationDrawn: Number(drawSummary.Foundation ?? 0), palsDrawn: Number(drawSummary.Pals ?? 0), drawShortfall: 0, handLimitDiscarded: excessHandCards.length };
    const supportResult = runOpponentSupports(next);
    next = supportResult.state;
    const supportSummary = supportResult.summaries.length ? ` ${supportResult.summaries.join(" ")}` : "";
    if (supportResult.lost) {
      return {
        state: next,
        startOfTurnState,
        startOfTurnSummary,
        startOfTurnDetails,
        supportImpacts: supportResult.impacts,
        supportPlays: supportResult.events,
        lost: true,
        summary: `${collectionSummary} Opponent drew ${drawSummaryText}.${supportSummary} ${supportResult.lossSummary}`,
      };
    }

    const findUpgradeTarget = (card) => next.corals.find((coral) => {
      const currentCard = cardsById[coral.cardId];
      return currentCard?.upgrade?.canUpgrade && currentCard.upgrade.nextCardId === card.id && turn > Number(coral.stageEnteredTurn ?? coral.playedTurn ?? turn);
    });
    const getOpponentPlayCost = (card) => {
      const upgradeTarget = isFoundationCard(card) && Number(card.stage ?? 0) > 0 ? findUpgradeTarget(card) : null;
      const baseCost = upgradeTarget ? Number(cardsById[upgradeTarget.cardId]?.upgrade?.cost?.rp ?? card.cost?.rp ?? 0) : getCardPlayCost(card, activeCondition);
      return Math.max(0, baseCost + getOpposingPlayCostModifier(card, playerCorals, playerReefCreatures, playerOrphanCreatures));
    };
    const playableCards = next.hand.filter((cardId) => {
      const card = cardsById[cardId];
      if (!card || getConditionPlayRestriction(card, activeCondition) || getOpponentPlayCost(card) > next.rp) return false;
      if (card.kind === CardKind.HABITAT) {
        if (getHabitatRequirementError(card, next.habitats)) return false;
        return !getCompositionRequirementError(card, next.corals, [...next.reefCreatures, ...(next.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])]);
      }
      if (isFoundationCard(card)) return Number(card.stage ?? 0) === 0 || Boolean(findUpgradeTarget(card));
      if (card.kind !== CardKind.CREATURE) return false;
      const densityRequirement = getEffectiveSchoolDensityRequirement(card, schoolDensityConditionIds, next.conditionDensityUses ?? {});
      if (densityRequirement.effectiveRequirement > getSchoolDensity(next.corals)) return false;
      if (getHabitatRequirementError(card, next.habitats)) return false;
      if (getCompositionRequirementError(card, next.corals, [...next.reefCreatures, ...(next.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])])) return false;
      if (card.zone === CreatureZone.OCEAN) return true;
      const unmetHabitat = (card.playRequirements ?? []).some((requirement) =>
        requirement.requiredKind === CardKind.HABITAT &&
        (requirement.type === "cardInPlay" ? !next.habitats.includes(requirement.cardId) : !next.habitats.length),
      );
      if (unmetHabitat) return false;
      return next.corals.some((coral) => coral.slots.some((slot) => (
        (!slot.cardId && canCardOccupySlot(card, slot))
        || (slot.cardId && canHostSpecialPlacement(cardsById[slot.cardId], card, slot.hostedCardIds))
      )));
    });
    const scoreOpponentPlay = (cardId) => {
      const card = cardsById[cardId];
      const cost = getOpponentPlayCost(card);
      const printedVp = Number(card?.victoryPoints?.value ?? card?.vp ?? 0);
      const income = getCardStartTurnRp(card);
      const actionable = (card?.actions ?? []).length + (card?.onPlay ?? []).length;
      if (isFoundationCard(card) && Number(card.stage ?? 0) > 0 && findUpgradeTarget(card)) return 120 + printedVp * 5 + income * 8 - cost;
      if (isFoundationCard(card) && Number(card.stage ?? 0) === 0) return (next.corals.length ? 35 : 100) + printedVp * 5 + income * 10 - cost;
      if (card.kind === CardKind.HABITAT) {
        const unlocksCards = next.hand.filter((candidateId) => getHabitatRequirementError(cardsById[candidateId], [...next.habitats, card.id]) === "" && getHabitatRequirementError(cardsById[candidateId], next.habitats)).length;
        return 30 + unlocksCards * 18 + printedVp * 5 - (next.habitats.includes(card.id) ? 20 : 0) - cost;
      }
      return 25 + printedVp * 7 + income * 8 + actionable * 6 - cost;
    };
    const scoreHardOpponentPlay = (cardId) => {
      const card = cardsById[cardId];
      const printedVp = Number(card?.victoryPoints?.value ?? card?.victoryPoints ?? card?.vp ?? 0);
      const income = getCardStartTurnRp(card);
      const cost = getOpponentPlayCost(card);
      const reachesVictory = opponentVp + printedVp >= victoryTarget;
      const createsAttack = Boolean(getBasicAttackEffect(card) || getOnPlayAttackEffect(card));
      const hasPlayerTarget = Boolean(playerCorals.length || playerReefCreatures.length || playerOrphanCreatures.length);
      return scoreOpponentPlay(cardId)
        + (reachesVictory ? 1000 : 0)
        + printedVp * 8
        + income * (round <= 3 ? 7 : 3)
        + (createsAttack && hasPlayerTarget ? 12 : 0)
        - cost;
    };
    const playable = selectOpponentChoice(playableCards, opponentDifficulty, {
      mediumScore: scoreOpponentPlay,
      hardScore: scoreHardOpponentPlay,
    });

    if (!playable) {
      return {
        state: next,
        startOfTurnState,
        startOfTurnSummary,
        startOfTurnDetails,
        supportImpacts: supportResult.impacts,
        supportPlays: supportResult.events,
        summary: `${collectionSummary} Opponent drew ${drawSummaryText}.${supportSummary} It then passed with no legal affordable permanent card.${handLimitSummary}`,
      };
    }

    const card = cardsById[playable];
    const cost = getOpponentPlayCost(card);
    next = { ...next, hand: removeOneCard(next.hand, playable), rp: next.rp - cost };
    let playedCreatureLocation = null;
    let sacrificeSummary = "";
    let symbiosisSummary = "";
    let placementSummary = "";
    let densityDiscountSummary = "";
    if (card.kind === CardKind.HABITAT) {
      next = { ...next, habitats: [...next.habitats, card.id] };
    } else if (isFoundationCard(card)) {
      const upgradeTarget = Number(card.stage ?? 0) > 0 ? findUpgradeTarget(card) : null;
      if (upgradeTarget) {
        next = { ...next, corals: next.corals.map((coral) => {
          if (coral.id !== upgradeTarget.id) return coral;
          const nextMaxHealth = Number(card.health ?? coral.maxHealth);
          return {
            ...coral,
            cardId: card.id,
            maxHealth: nextMaxHealth,
            health: preserveDamageOnUpgrade(coral.health, coral.maxHealth, nextMaxHealth),
            slots: mergeUpgradedCoralSlots(coral.slots, card, coral.id),
            stageEnteredTurn: turn,
          };
        }) };
      } else {
        const coralId = createCoralId(`opponent-${card.id}`);
        next = {
          ...next,
          corals: [...next.corals, {
            id: coralId,
            cardId: card.id,
            health: Number(card.health ?? 0),
            maxHealth: Number(card.health ?? 0),
            slots: createCoralSlots(card, coralId),
            playedTurn: turn,
            stageEnteredTurn: turn,
          }],
        };
      }
    } else if (card.zone === CreatureZone.OCEAN) {
      const sacrifices = getOceanicPlaySacrifices(card, next.corals, next.reefCreatures, next.orphanCreatures);
      const sacrificedSlotIds = new Set(sacrifices.filter((entry) => entry.slotId).map((entry) => entry.slotId));
      const sacrificedReefIndexes = new Set(sacrifices.filter((entry) => entry.reefIndex >= 0).map((entry) => entry.reefIndex));
      const sacrificedOrphanIndexes = new Set(sacrifices.filter((entry) => entry.orphanIndex >= 0).map((entry) => entry.orphanIndex));
      const freedHostedCards = [...next.corals.flatMap((coral) => coral.slots.filter((slot) => sacrificedSlotIds.has(slot.id)).flatMap((slot) => slot.hostedCardIds ?? [])), ...(next.orphanCreatures ?? []).filter((_, index) => sacrificedOrphanIndexes.has(index)).flatMap((entry) => entry.hostedCardIds ?? [])];
      const sacrificedReefInstanceIds = [...sacrificedReefIndexes].map((index) => next.reefCreatureInstances?.[index]?.instanceId).filter(Boolean);
      const sacrificedOrphanInstanceIds = [...sacrificedOrphanIndexes].map((index) => next.orphanCreatures?.[index]?.instanceId).filter(Boolean);
      const remainingReefInstances = removeCreatureInstances(next.reefCreatureInstances ?? [], sacrificedReefInstanceIds).instances;
      const territorialTarget = card.id === "ocean-triggerfish" ? next.corals.find((foundation) => isCreatureSchool(cardsById[foundation.cardId])) : null;
      const playedInstance = createCreatureInstance(card.id, createStableInstanceId(`opponent-reef-${card.id}`), {
        territorialTargetFoundationId: territorialTarget?.id ?? null,
      });
      const nextReefInstances = [...remainingReefInstances, playedInstance];
      next = {
        ...next,
        corals: sacrificedSlotIds.size ? next.corals.map((coral) => ({ ...coral, slots: coral.slots.map((slot) => sacrificedSlotIds.has(slot.id) ? { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot) })) : next.corals,
        reefCreatures: nextReefInstances.map((entry) => entry.cardId),
        reefCreatureInstances: nextReefInstances,
        orphanCreatures: [...(next.orphanCreatures ?? []).filter((entry) => !sacrificedOrphanInstanceIds.includes(entry.instanceId)), ...freedHostedCards.map((hostedCardId) => createCreatureInstance(hostedCardId, createStableInstanceId(`opponent-orphan-${hostedCardId}`)))],
        discardPile: sacrifices.length ? [...sacrifices.map((entry) => entry.cardId), ...next.discardPile] : next.discardPile,
      };
      if (sacrifices.length) sacrificeSummary = ` As its additional play cost, ${sacrifices.map((entry) => entry.card.name).join(" and ")} ${sacrifices.length === 1 ? "was" : "were"} discarded.`;
      if (territorialTarget) sacrificeSummary += ` Territorial gives ${cardsById[territorialTarget.cardId]?.name} +10 HP while Ocean Triggerfish remains in play.`;
      playedCreatureLocation = { reefIndex: next.reefCreatures.length - 1, instanceId: playedInstance.instanceId };
    } else {
      const specialHostTarget = next.corals.flatMap((coral) => coral.slots.map((slot) => ({ coral, slot })))
        .find(({ slot }) => slot.cardId && canHostSpecialPlacement(cardsById[slot.cardId], card, slot.hostedCardIds));
      if (specialHostTarget) {
        const previousHostedCardIds = specialHostTarget.slot.hostedCardIds ?? [];
        const nextHostedCardIds = placeCardInSpecialHost(cardsById[specialHostTarget.slot.cardId], card, previousHostedCardIds, card.id);
        const hostedIndex = nextHostedCardIds?.findIndex((cardId, index) => cardId === card.id && previousHostedCardIds[index] !== cardId) ?? -1;
        next = {
          ...next,
          corals: next.corals.map((coral) => coral.id === specialHostTarget.coral.id ? {
            ...coral,
            slots: coral.slots.map((slot) => slot.id === specialHostTarget.slot.id ? { ...slot, hostedCardIds: nextHostedCardIds } : slot),
          } : coral),
        };
        playedCreatureLocation = { coralId: specialHostTarget.coral.id, slotId: specialHostTarget.slot.id, hostedIndex };
        placementSummary = ` ${card.name} occupied an available space inside ${cardsById[specialHostTarget.slot.cardId]?.name}.`;
      } else {
        let placed = false;
        next = {
          ...next,
          corals: next.corals.map((coral) => ({
            ...coral,
            slots: coral.slots.map((slot) => {
              if (!placed && !slot.cardId && canCardOccupySlot(card, slot)) {
                placed = true;
                playedCreatureLocation = { coralId: coral.id, slotId: slot.id };
                return { ...slot, cardId: card.id, cardInstanceId: createStableInstanceId(`opponent-slot-${card.id}`) };
              }
              return slot;
            }),
          })),
        };
      }
    }
    if (card.kind === CardKind.CREATURE && playedCreatureLocation) {
      const discountResult = consumeSchoolDensityConditionDiscount(card, schoolDensityConditionIds, next.conditionDensityUses ?? {});
      next = { ...next, conditionDensityUses: discountResult.usedByCondition };
      if (discountResult.discount) densityDiscountSummary = ` ${discountResult.discount.label} reduced its School Density requirement by ${discountResult.discount.amount}; the opponent's one-time reduction is now used.`;
    }
    if (isFoundationCard(card) && (next.orphanCreatures ?? []).length) {
      const redistributed = redistributeOrphanCreatures(next.corals, next.orphanCreatures);
      const placedCount = next.orphanCreatures.length - redistributed.orphans.length;
      next = { ...next, corals: redistributed.corals, orphanCreatures: redistributed.orphans };
      if (placedCount) sacrificeSummary += ` ${placedCount} orphaned creature group(s) automatically occupied compatible slots.`;
    }
    if (cardHasSymbiosis(card) && playedCreatureLocation?.slotId) {
      const clownfishId = next.hand.find((cardId) => cardsById[cardId]?.tags?.includes("clownfish"));
      const hostSlot = next.corals.find((coral) => coral.id === playedCreatureLocation.coralId)?.slots.find((slot) => slot.id === playedCreatureLocation.slotId && slot.cardId === card.id);
      const nextHostedCardIds = clownfishId && hostSlot
        ? placeCardInSpecialHost(card, cardsById[clownfishId], hostSlot.hostedCardIds, clownfishId)
        : null;
      if (clownfishId && nextHostedCardIds) {
        next = { ...next, hand: removeOneCard(next.hand, clownfishId), corals: next.corals.map((coral) => coral.id === playedCreatureLocation.coralId ? { ...coral, slots: coral.slots.map((slot) => slot.id === playedCreatureLocation.slotId && slot.cardId === card.id ? { ...slot, hostedCardIds: nextHostedCardIds } : slot) } : coral) };
        symbiosisSummary = ` Symbiosis hosted ${cardsById[clownfishId]?.name} from the opponent's hand.`;
      } else symbiosisSummary = clownfishId ? " Symbiosis could not host a Clownfish because the Anemone no longer had space." : " Symbiosis found no Clownfish in the opponent's hand.";
    }
    let onPlayResourceSummary = "";
    const onPlayResourceGain = getResourceGainFromActions(card.onPlay, "rp");
    if (onPlayResourceGain) {
      const cap = getEcosystemRpCap(next.corals, [
        ...next.habitats,
        ...next.reefCreatures,
        ...(next.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])]),
      ], activeCondition);
      const rpBeforeGain = next.rp;
      const rpAfterGain = addResourceWithinCap(rpBeforeGain, onPlayResourceGain, cap);
      const actualGain = rpAfterGain - rpBeforeGain;
      next = { ...next, rp: rpAfterGain };
      onPlayResourceSummary = ` Its On Play ability gained ${actualGain} RP${actualGain < onPlayResourceGain ? ` (limited by the ${cap} RP bank cap)` : ""}.`;
    }
    let momentumSummary = "";
    if (cardHasSchoolMomentum(card)) {
      const momentumCardId = [...next.foundationDeck, ...next.palsDeck].find((cardId) => isCreatureSchool(cardsById[cardId]) && cardsById[cardId]?.name !== card.name);
      if (momentumCardId) {
        next = { ...next, foundationDeck: shuffle(removeOneCard(next.foundationDeck, momentumCardId)), palsDeck: shuffle(removeOneCard(next.palsDeck, momentumCardId)), hand: [...next.hand, momentumCardId] };
        momentumSummary = ` Momentum found ${cardsById[momentumCardId]?.name} and added it to the opponent's hand.`;
      } else momentumSummary = " Momentum found no differently named Creature School.";
    }
    let onPlayDrawSummary = "";
    let onPlayDrawLossSummary = "";
    const onPlayDrawCount = getOnPlayDrawCount(card);
    if (onPlayDrawCount) {
      const drawnIds = [];
      const drawnSources = [];
      for (let index = 0; index < onPlayDrawCount; index += 1) {
        const preferred = index % 2 === 0 ? "palsDeck" : "foundationDeck";
        const deckKey = next[preferred].length ? preferred : preferred === "palsDeck" ? "foundationDeck" : "palsDeck";
        if (!next[deckKey].length) break;
        drawnIds.push(next[deckKey][0]);
        drawnSources.push(deckKey === "palsDeck" ? "Pals" : "Foundation");
        next = { ...next, [deckKey]: next[deckKey].slice(1), hand: [...next.hand, next[deckKey][0]] };
      }
      const postDrawExcess = Number.isFinite(opponentHandLimit) && next.hand.length > opponentHandLimit ? next.hand.slice(opponentHandLimit) : [];
      if (postDrawExcess.length) next = { ...next, hand: next.hand.slice(0, opponentHandLimit), discardPile: [...postDrawExcess, ...next.discardPile] };
      const shortfall = getRequiredDrawShortfall(onPlayDrawCount, drawnIds.length);
      onPlayDrawSummary = ` ${getOnPlayAbilityName(card)} drew ${drawnIds.length} card(s)${drawnSources.length ? ` (${drawnSources.join(", ")})` : ""}.${postDrawExcess.length ? ` ${postDrawExcess.length} exceeded the hand limit and was discarded.` : ""}`;
      if (shortfall) onPlayDrawLossSummary = ` The mandatory draw was ${shortfall} card${shortfall === 1 ? "" : "s"} short, so the opponent loses by deck depletion.`;
    }
    let onPlayReorderSummary = "";
    const onPlayReorder = getOnPlayReorder(card);
    if (onPlayReorder) {
      const deckKey = next.palsDeck.length ? "palsDeck" : next.foundationDeck.length ? "foundationDeck" : null;
      if (deckKey) {
        const amount = Math.max(1, Number(onPlayReorder.effect.amount ?? 3));
        const scoreCard = (cardId) => {
          const candidate = cardsById[cardId];
          return Number(candidate?.victoryPoints?.value ?? candidate?.victoryPoints ?? candidate?.vp ?? 0) * 10 + getCardStartTurnRp(candidate) * 8 + (candidate?.actions?.length ?? 0) * 3 - Number(candidate?.cost?.rp ?? 0);
        };
        const topCards = next[deckKey].slice(0, amount).sort((leftId, rightId) => scoreCard(rightId) - scoreCard(leftId));
        next = { ...next, [deckKey]: [...topCards, ...next[deckKey].slice(topCards.length)] };
        onPlayReorderSummary = ` ${onPlayReorder.actionName} reordered the top ${topCards.length} cards of the opponent's ${deckKey === "palsDeck" ? "Pals" : "Foundation"} deck.`;
      } else onPlayReorderSummary = ` ${onPlayReorder.actionName} found both personal decks empty.`;
    }
    let onPlaySearchSummary = "";
    let onPlayRevealedCardIds = [];
    const onPlaySearch = getOnPlayUtilitySearch(card);
    if (onPlaySearch) {
      const targetIds = [...next.palsDeck, ...next.foundationDeck].filter((cardId) => {
        const candidate = cardsById[cardId];
        if (!candidate || candidate.kind !== onPlaySearch.effect.targetKind) return false;
        if (onPlaySearch.effect.targetCategories?.length && !onPlaySearch.effect.targetCategories.includes(candidate.category)) return false;
        if (onPlaySearch.effect.targetZone && candidate.zone !== onPlaySearch.effect.targetZone) return false;
        if (onPlaySearch.effect.targetCardId && candidate.id !== onPlaySearch.effect.targetCardId) return false;
        return !onPlaySearch.effect.targetNameIncludes || candidate.name?.toLowerCase().includes(onPlaySearch.effect.targetNameIncludes.toLowerCase());
      }).slice(0, Math.max(1, Number(onPlaySearch.effect.amount ?? 1)));
      if (targetIds.length) {
        next = { ...next, palsDeck: shuffle(targetIds.reduce((deck, cardId) => removeOneCard(deck, cardId), next.palsDeck)), foundationDeck: shuffle(targetIds.reduce((deck, cardId) => removeOneCard(deck, cardId), next.foundationDeck)), hand: [...next.hand, ...targetIds] };
        onPlaySearchSummary = ` ${onPlaySearch.actionName} found ${targetIds.map((cardId) => cardsById[cardId]?.name).join(" and ")}, revealed them, and added them to the opponent's hand.`;
        onPlayRevealedCardIds = targetIds;
      } else onPlaySearchSummary = ` ${onPlaySearch.actionName} found no matching card.`;
    }
    if (Number.isFinite(opponentHandLimit) && next.hand.length > opponentHandLimit) {
      const excess = next.hand.slice(opponentHandLimit);
      next = { ...next, hand: next.hand.slice(0, opponentHandLimit), discardPile: [...excess, ...next.discardPile] };
      handLimitSummary += ` ${excess.length} additional searched card(s) exceeded the hand limit and were discarded.`;
    }
    let opponentOnPlayAttack = card.kind === CardKind.CREATURE ? getOnPlayAttackEffect(card) : null;
    let onPlayAttackBonusSummary = "";
    if (opponentOnPlayAttack && next.nextOnPlayAttackBonus) {
      const bonus = next.nextOnPlayAttackBonus;
      opponentOnPlayAttack = {
        ...opponentOnPlayAttack,
        flatBonus: Number(opponentOnPlayAttack.flatBonus ?? 0) + Number(bonus.amount ?? 0),
        flatBonusSource: cardsById[bonus.sourceCardId]?.name ?? "Highlight",
      };
      next = { ...next, nextOnPlayAttackBonus: null };
      onPlayAttackBonusSummary = ` ${cardsById[bonus.sourceCardId]?.name ?? "Highlight"} added +${Number(bonus.amount ?? 0)} to this On Play attack.`;
    }
    let ensnareSummary = "";
    const ensnare = getOnPlayEnsnare(card);
    if (opponentOnPlayAttack && ensnare) {
      const coinResult = Math.random() < 0.5 ? "heads" : "tails";
      if (coinResult === "heads") opponentOnPlayAttack = { ...opponentOnPlayAttack, ensnarePenalty: ensnare.penalty };
      ensnareSummary = ` Ensnare flipped ${coinResult}.${coinResult === "heads" ? ` Your defender gets -${ensnare.penalty} defense for this attack.` : " No defense penalty was applied."}`;
    }
    return {
      state: next,
      startOfTurnState,
      startOfTurnSummary,
      startOfTurnDetails,
      supportImpacts: supportResult.impacts,
      supportPlays: supportResult.events,
      lost: Boolean(onPlayDrawLossSummary),
      playedCardId: card.id,
      onPlayRevealedCardIds,
      playSummary: `Opponent played ${card.name} for ${cost} RP.${placementSummary}${densityDiscountSummary}${sacrificeSummary}${symbiosisSummary}${onPlayResourceSummary}${momentumSummary}${onPlayDrawSummary}${onPlayDrawLossSummary}${onPlayReorderSummary}${onPlaySearchSummary}${onPlayAttackBonusSummary}${ensnareSummary}`,
      foundationDamage: card.kind === CardKind.CREATURE ? getOnPlayFoundationDamage(card, [...next.habitats, ...next.corals.map((foundation) => foundation.cardId)]) : null,
      randomDiscard: card.kind === CardKind.CREATURE ? getOnPlayRandomDiscard(card) : null,
      deckDiscard: card.kind === CardKind.CREATURE ? getOnPlayOpponentDeckDiscard(card) : null,
      supportBlock: card.kind === CardKind.CREATURE ? getOnPlaySupportBlock(card) : null,
      onPlayAttack: card.kind === CardKind.CREATURE && playedCreatureLocation ? {
        cardId: card.id,
        ...playedCreatureLocation,
        attack: opponentOnPlayAttack,
      } : null,
      damageSourceName: card.name,
      damageSourceCardId: card.id,
      summary: `${collectionSummary} Opponent drew ${drawSummaryText}.${supportSummary} It played ${card.name} for ${cost} RP.${placementSummary}${densityDiscountSummary}${sacrificeSummary}${symbiosisSummary}${onPlayResourceSummary}${momentumSummary}${onPlayDrawSummary}${onPlayDrawLossSummary}${onPlayReorderSummary}${onPlaySearchSummary}${onPlayAttackBonusSummary}${ensnareSummary}${handLimitSummary}`,
    };
  }

  function applyOpponentFoundationDamage(currentPlayerCorals, currentOrphans, damageEffect, sourceName, currentHand = hand, availableDiscard = discardPile, handLimit = Infinity) {
    const amount = Number(damageEffect?.amount ?? 0);
    if (!amount || !currentPlayerCorals.length) return null;
    const target = currentPlayerCorals.find((foundation) => damageEffect.targetType === "creature-school"
      ? isCreatureSchool(cardsById[foundation.cardId])
      : cardsById[foundation.cardId]?.kind === CardKind.CORAL);
    if (!target) return null;
    const result = applyDamage(target.health ?? target.maxHealth ?? cardsById[target.cardId]?.health, amount);
    if (!result.destroyed) {
      return {
        corals: currentPlayerCorals.map((coral) => coral.id === target.id ? { ...coral, health: result.remainingHealth } : coral),
        orphanCreatures: currentOrphans,
        discardedCardIds: [],
        summary: `Opponent's ${sourceName} dealt ${result.appliedDamage} damage to your ${cardsById[target.cardId]?.name}. ${result.remainingHealth}/${target.maxHealth} HP remains.`,
      };
    }
    const redistributed = redistributeOrphanCreatures(currentPlayerCorals.filter((coral) => coral.id !== target.id), [...currentOrphans, ...getOrphanEntriesFromFoundation(target)]);
    const triggerResult = resolveFoundationDestructionTriggers([[target]], currentHand, availableDiscard, handLimit);
    const fragmentTrigger = triggerResult.triggers[0];
    const fragmentSummary = fragmentTrigger
      ? fragmentTrigger.cardsToHand.length
        ? ` Fragment returned ${fragmentTrigger.cardsToHand.length} ${cardsById[fragmentTrigger.targetCardId]?.name ?? "matching card"}(s) to your hand.`
        : fragmentTrigger.cardsToDiscard.length
          ? " Fragment found its card, but your hand limit kept it in discard."
          : ` Fragment triggered but found no ${cardsById[fragmentTrigger.targetCardId]?.name ?? "matching card"}.`
      : "";
    return {
      corals: redistributed.corals,
      orphanCreatures: redistributed.orphans,
      discardedCardIds: [target.cardId],
      hand: triggerResult.hand,
      discardPile: triggerResult.discardPile,
      fragmentTriggers: triggerResult.triggers,
      summary: `Opponent's ${sourceName} dealt ${result.appliedDamage} damage and destroyed your ${cardsById[target.cardId]?.name}. Its creatures filled compatible slots; ${redistributed.orphans.length} remain orphaned on your reef.${fragmentSummary}`,
    };
  }

  function runOpponentUtilityAction(opponentState, currentPlayerState) {
    const currentPlayerFoundations = currentPlayerState?.corals ?? [];
    const handLimit = Number((activeCondition?.effects ?? []).find((candidate) => candidate.type === "setHandLimit")?.amount ?? Infinity);
    const entries = [
      ...opponentState.corals.flatMap((coral) => coral.slots.flatMap((slot) => [
        ...(slot.cardId ? [{ card: cardsById[slot.cardId], locationKey: getSlotActionKey(slot), statusKey: getSlotActionKey(slot) }] : []),
        ...(slot.hostedCardIds ?? []).map((cardId, hostedIndex) => ({ card: cardsById[cardId], locationKey: getHostedTargetSlotId(slot.id, hostedIndex), statusKey: getHostedTargetSlotId(slot.id, hostedIndex) })),
      ])),
      ...(opponentState.reefCreatures ?? []).map((cardId, reefIndex) => ({ card: cardsById[cardId], locationKey: `reef-${opponentState.reefCreatureInstances?.[reefIndex]?.instanceId ?? reefIndex}`, statusKey: `reef-${opponentState.reefCreatureInstances?.[reefIndex]?.instanceId ?? reefIndex}` })),
      ...(opponentState.orphanCreatures ?? []).flatMap((entry, orphanIndex) => {
        const orphanInstanceId = entry.instanceId ?? orphanIndex;
        return [
          { card: cardsById[entry.cardId], locationKey: `orphan-${orphanInstanceId}`, statusKey: `orphan-${orphanInstanceId}` },
          ...(entry.hostedCardIds ?? []).flatMap((cardId, hostedIndex) => cardId ? [{ card: cardsById[cardId], locationKey: getOrphanHostedTargetSlotId(orphanInstanceId, hostedIndex), statusKey: getOrphanHostedTargetSlotId(orphanInstanceId, hostedIndex) }] : []),
        ];
      }),
    ];
    const scoreCard = (cardId) => {
      const card = cardsById[cardId];
      return Number(card?.victoryPoints?.value ?? card?.victoryPoints ?? card?.vp ?? 0) * 10
        + getCardStartTurnRp(card) * 8
        + (card?.actions?.length ?? 0) * 3
        - Number(card?.cost?.rp ?? 0);
    };
    const commitAction = (state, actionKey, cost, oncePerTurn) => ({
      ...state,
      rp: Math.max(0, Number(state.rp ?? 0) - cost),
      actionUses: oncePerTurn
        ? markOpponentActionUsed(state.actionUses, actionKey, turn)
        : state.actionUses,
    });
    const applyPlayerCoralEffect = (effect, target, sourceCardId) => {
      if (!target || !effect) return { state: currentPlayerState, summary: "had no legal coral target", success: false };
      const targetCard = cardsById[target.cardId];
      if (effect.type === EffectType.STUN_CORAL) {
        return {
          state: {
            ...currentPlayerState,
            corals: currentPlayerFoundations.map((foundation) => foundation.id === target.id
              ? { ...foundation, statuses: [...(foundation.statuses ?? []), { type: "stunned", sourceCardId }] }
              : foundation),
          },
          summary: `stunned your ${targetCard?.name}`,
          success: true,
        };
      }
      if (effect.type === EffectType.MODIFY_RP_GENERATION || effect.type === "modifyRpGeneration") {
        const penalty = Math.abs(Number(effect.amount ?? 0));
        return {
          state: {
            ...currentPlayerState,
            corals: currentPlayerFoundations.map((foundation) => foundation.id === target.id
              ? { ...foundation, rpPenaltyNextTurn: Number(foundation.rpPenaltyNextTurn ?? 0) + penalty }
              : foundation),
          },
          summary: `made your ${targetCard?.name} produce ${penalty} less RP during its next collection`,
          success: penalty > 0,
        };
      }
      if (effect.type === EffectType.DAMAGE) {
        const amount = Number(effect.amount?.value ?? effect.amount ?? 0);
        const damage = applyDamage(target.health ?? target.maxHealth, amount);
        if (!damage.destroyed) {
          return {
            state: {
              ...currentPlayerState,
              corals: currentPlayerFoundations.map((foundation) => foundation.id === target.id ? { ...foundation, health: damage.remainingHealth } : foundation),
            },
            summary: `dealt ${damage.appliedDamage} damage to your ${targetCard?.name}; ${damage.remainingHealth}/${target.maxHealth} HP remains`,
            success: damage.appliedDamage > 0,
          };
        }
        const redistributed = redistributeOrphanCreatures(
          currentPlayerFoundations.filter((foundation) => foundation.id !== target.id),
          [...(currentPlayerState.orphanCreatureInstances ?? []), ...getOrphanEntriesFromFoundation(target)],
        );
        const triggerResult = resolveFoundationDestructionTriggers(
          [[target]],
          currentPlayerState.hand ?? [],
          currentPlayerState.discardPile ?? [],
          handLimit,
        );
        const projected = projectNormalizedPlayerState({
          ...currentPlayerState,
          corals: redistributed.corals,
          orphanCreatureInstances: redistributed.orphans,
          hand: triggerResult.hand,
          discardPile: triggerResult.discardPile,
        });
        const fragmentSummary = triggerResult.triggers.map((trigger) => trigger.cardsToHand.length
          ? ` Fragment returned ${trigger.cardsToHand.length} ${cardsById[trigger.targetCardId]?.name ?? "matching card"} to your hand.`
          : trigger.cardsToDiscard.length
            ? " Fragment found its card, but the hand limit kept it in discard."
            : ` Fragment found no ${cardsById[trigger.targetCardId]?.name ?? "matching card"}.`).join("");
        return {
          state: projected.state,
          summary: `dealt ${damage.appliedDamage} damage and destroyed your ${targetCard?.name}; its creatures filled compatible slots or became orphans.${fragmentSummary}${getContinuousHealthCollapseMessage(projected.collateral) ? ` ${getContinuousHealthCollapseMessage(projected.collateral)}` : ""}`,
          success: true,
        };
      }
      return { state: currentPlayerState, summary: "has an effect that is not implemented", success: false };
    };
    for (const foundation of opponentState.corals) {
      const sourceCard = cardsById[foundation.cardId];
      for (const [passiveIndex, passive] of (sourceCard?.passives ?? []).entries()) {
        const heal = getPassiveCoralHeal(passive);
        if (heal) {
          const actionKey = getOpponentActionUseKey(`foundation-${foundation.id}`, passive, passiveIndex);
          if (wasOpponentActionUsedThisTurn(opponentState.actionUses, actionKey, turn)) continue;
          const target = opponentState.corals
            .filter((candidate) => cardsById[candidate.cardId]?.kind === CardKind.CORAL && Number(candidate.health ?? candidate.maxHealth) < Number(candidate.maxHealth ?? 0))
            .sort((left, right) => Number(left.health ?? 0) - Number(right.health ?? 0))[0];
          if (!target) continue;
          const healedHealth = Math.min(Number(target.maxHealth), Number(target.health ?? target.maxHealth) + heal.amount);
          const next = {
            ...opponentState,
            corals: opponentState.corals.map((candidate) => candidate.id === target.id ? { ...candidate, health: healedHealth } : candidate),
            actionUses: markOpponentActionUsed(opponentState.actionUses, actionKey, turn),
          };
          return { state: next, sourceCardId: sourceCard.id, defenderCardId: target.cardId, actionName: heal.actionName, success: true, summary: `Opponent's ${sourceCard.name} used ${heal.actionName} and healed ${cardsById[target.cardId]?.name} for ${healedHealth - Number(target.health ?? target.maxHealth)} HP.` };
        }
        const counterMove = getDamageCounterMove(passive);
        if (!counterMove || (foundation.statuses ?? []).length) continue;
        const actionKey = getOpponentActionUseKey(`foundation-${foundation.id}`, passive, passiveIndex);
        if (wasOpponentActionUsedThisTurn(opponentState.actionUses, actionKey, turn)) continue;
        const sources = opponentState.corals
          .filter((candidate) => Number(candidate.maxHealth ?? 0) - Number(candidate.health ?? candidate.maxHealth ?? 0) >= counterMove.counterHp)
          .sort((left, right) => Number(left.health ?? 0) - Number(right.health ?? 0));
        let resolution = null;
        let source = null;
        let destination = null;
        for (const candidateSource of sources) {
          const destinations = opponentState.corals
            .filter((candidate) => candidate.id !== candidateSource.id && Number(candidate.health ?? candidate.maxHealth ?? 0) - counterMove.counterHp > 0)
            .sort((left, right) => Number(right.health ?? 0) - Number(left.health ?? 0));
          for (const candidateDestination of destinations) {
            const attempt = moveFoundationDamageCounter(opponentState.corals, { sourceFoundationId: candidateSource.id, destinationFoundationId: candidateDestination.id, counterHp: counterMove.counterHp });
            if (!attempt.moved) continue;
            resolution = attempt;
            source = candidateSource;
            destination = candidateDestination;
            break;
          }
          if (resolution) break;
        }
        if (!resolution) continue;
        return {
          // Neural Network is repeatable for a player. The deterministic AI makes
          // one legal move per turn so it cannot oscillate damage counters forever.
          state: { ...opponentState, corals: resolution.foundations, actionUses: markOpponentActionUsed(opponentState.actionUses, actionKey, turn) },
          sourceCardId: sourceCard.id,
          defenderCardId: destination.cardId,
          actionName: counterMove.actionName,
          success: true,
          summary: `Opponent's ${sourceCard.name} used ${counterMove.actionName} to move one ${counterMove.counterHp} HP damage counter from ${cardsById[source.cardId]?.name} to ${cardsById[destination.cardId]?.name}.`,
        };
      }
    }
    for (const entry of entries) {
      for (const [actionIndex, action] of (entry.card?.actions ?? []).entries()) {
        const effect = getSupportedUtilityEffect(action);
        const cost = getActionCost(action);
        const actionKey = getOpponentActionUseKey(entry.locationKey, action, actionIndex);
        const oncePerTurn = actionIsOncePerTurn(action);
        if (!effect || cost > opponentState.rp || (oncePerTurn && wasOpponentActionUsedThisTurn(opponentState.actionUses, actionKey, turn))) continue;
        if (effect.type === EffectType.STUN_CORAL) {
          const target = currentPlayerFoundations.find((foundation) => cardsById[foundation.cardId]?.kind === CardKind.CORAL);
          if (!target) continue;
          const playerEffect = applyPlayerCoralEffect(effect, target, entry.card.id);
          return {
            state: commitAction(opponentState, actionKey, cost, oncePerTurn),
            playerState: playerEffect.state,
            sourceCardId: entry.card.id,
            defenderCardId: target.cardId,
            actionName: getActionName(action),
            success: playerEffect.success,
            summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP and ${playerEffect.summary}.`,
          };
        }
        if (effect.type === EffectType.FLIP_COIN) {
          const target = currentPlayerFoundations.find((foundation) => cardsById[foundation.cardId]?.kind === CardKind.CORAL);
          if (!target) continue;
          const heads = Math.random() < 0.5;
          const committedState = commitAction(opponentState, actionKey, cost, oncePerTurn);
          if (!heads) return { state: committedState, playerState: currentPlayerState, sourceCardId: entry.card.id, defenderCardId: target.cardId, actionName: getActionName(action), success: false, summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP and flipped tails, so it had no effect.` };
          const playerEffect = applyPlayerCoralEffect(effect.onSuccess, target, entry.card.id);
          return { state: committedState, playerState: playerEffect.state, sourceCardId: entry.card.id, defenderCardId: target.cardId, actionName: getActionName(action), success: playerEffect.success, summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP, flipped heads, and ${playerEffect.summary}.` };
        }
        if (effect.type === "grantNextOnPlayAttackBonus") {
          if (opponentState.nextOnPlayAttackBonus) continue;
          const next = commitAction({ ...opponentState, nextOnPlayAttackBonus: { amount: Number(effect.amount ?? 0), sourceCardId: entry.card.id, actionName: getActionName(action) } }, actionKey, cost, oncePerTurn);
          return { state: next, sourceCardId: entry.card.id, actionName: getActionName(action), success: true, summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP; its next On Play attack gets +${Number(effect.amount ?? 0)}.` };
        }
        if (effect.type === "reorderTopDeck") {
          const deckKey = opponentState.palsDeck.length > 1 ? "palsDeck" : opponentState.foundationDeck.length > 1 ? "foundationDeck" : null;
          if (!deckKey) continue;
          const amount = Math.max(1, Number(effect.amount ?? 3));
          const top = opponentState[deckKey].slice(0, amount).sort((leftId, rightId) => scoreCard(rightId) - scoreCard(leftId));
          const next = commitAction({ ...opponentState, [deckKey]: [...top, ...opponentState[deckKey].slice(top.length)] }, actionKey, cost, oncePerTurn);
          return { state: next, sourceCardId: entry.card.id, actionName: getActionName(action), success: true, summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP and reordered the top ${top.length} cards of its ${deckKey === "palsDeck" ? "Pals" : "Foundation"} deck.` };
        }
        if (effect.type === EffectType.DRAW_CARDS) {
          const amount = Math.max(0, Number(effect.amount ?? 0));
          if (!amount || (!opponentState.foundationDeck.length && !opponentState.palsDeck.length)) continue;
          let next = commitAction(opponentState, actionKey, cost, oncePerTurn);
          const drawn = [];
          for (let index = 0; index < amount; index += 1) {
            const preferred = index % 2 === 0 ? "palsDeck" : "foundationDeck";
            const deckKey = next[preferred].length ? preferred : preferred === "palsDeck" ? "foundationDeck" : "palsDeck";
            if (!next[deckKey].length) break;
            drawn.push({ cardId: next[deckKey][0], source: deckKey === "palsDeck" ? "Pals" : "Foundation" });
            next = { ...next, [deckKey]: next[deckKey].slice(1), hand: [...next.hand, next[deckKey][0]] };
          }
          const excess = Number.isFinite(handLimit) && next.hand.length > handLimit ? next.hand.slice(handLimit) : [];
          if (excess.length) next = { ...next, hand: next.hand.slice(0, handLimit), discardPile: [...excess, ...next.discardPile] };
          const shortfall = getRequiredDrawShortfall(amount, drawn.length);
          return {
            state: next,
            sourceCardId: entry.card.id,
            actionName: getActionName(action),
            success: shortfall === 0,
            lost: shortfall > 0,
            summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP and drew ${drawn.length} card(s)${drawn.length ? ` (${drawn.map((card) => card.source).join(", ")})` : ""}.${excess.length ? ` ${excess.length} exceeded the hand limit and was discarded.` : ""}${shortfall ? ` The mandatory draw was ${shortfall} card${shortfall === 1 ? "" : "s"} short, so the opponent loses by deck depletion.` : ""}`,
          };
        }
        if (effect.type === EffectType.SEARCH_DECK) {
          const targetId = [...opponentState.palsDeck, ...opponentState.foundationDeck].find((cardId) => {
            const candidate = cardsById[cardId];
            if (!candidate || candidate.kind !== effect.targetKind) return false;
            if (effect.targetCategories?.length && !effect.targetCategories.includes(candidate.category)) return false;
            if (effect.targetZone && candidate.zone !== effect.targetZone) return false;
            return !effect.targetNameIncludes || candidate.name?.toLowerCase().includes(effect.targetNameIncludes.toLowerCase());
          });
          if (!targetId) continue;
          const handResult = addCardsToHandWithLimit(opponentState.hand, [targetId], opponentState.discardPile, handLimit);
          const next = commitAction({ ...opponentState, palsDeck: shuffle(removeOneCard(opponentState.palsDeck, targetId)), foundationDeck: shuffle(removeOneCard(opponentState.foundationDeck, targetId)), hand: handResult.hand, discardPile: handResult.discardPile }, actionKey, cost, oncePerTurn);
          return { state: next, sourceCardId: entry.card.id, actionName: getActionName(action), revealedCards: [targetId], success: true, summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP and found ${cardsById[targetId]?.name}.${handResult.cardsToDiscard.length ? " It was revealed, then exceeded the hand limit and was discarded." : " It was revealed and added to the opponent's hand."}` };
        }
        if (effect.type === EffectType.RECOVER_CARD_FROM_DISCARD || effect.type === "recoverCardFromDiscard") {
          const targetId = opponentState.discardPile[0];
          if (!targetId) continue;
          const recoveredDeckType = getPersonalDeckType(cardsById[targetId]);
          const destination = effect.destination === "deck" ? `${recoveredDeckType === "foundation" ? "Foundation" : "Pals"} deck` : "hand";
          const recoveredPile = removeOneCard(opponentState.discardPile, targetId);
          const handResult = addCardsToHandWithLimit(opponentState.hand, [targetId], recoveredPile, handLimit);
          const next = effect.destination === "deck"
            ? {
                ...opponentState,
                discardPile: removeOneCard(opponentState.discardPile, targetId),
                foundationDeck: recoveredDeckType === "foundation" ? shuffle([...opponentState.foundationDeck, targetId]) : opponentState.foundationDeck,
                palsDeck: recoveredDeckType === "pals" ? shuffle([...opponentState.palsDeck, targetId]) : opponentState.palsDeck,
              }
            : { ...opponentState, discardPile: handResult.discardPile, hand: handResult.hand };
          const committed = commitAction(next, actionKey, cost, oncePerTurn);
          return { state: committed, sourceCardId: entry.card.id, actionName: getActionName(action), success: true, summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP and moved ${cardsById[targetId]?.name} from its discard pile to its ${destination}.${effect.destination !== "deck" && handResult.cardsToDiscard.length ? " The hand limit immediately returned it to the discard pile." : ""}` };
        }
        if (effect.type === "discardThenSearchDeck") {
          const discardCount = Math.max(0, Number(effect.discard?.amount ?? 0));
          const deckCards = [...opponentState.palsDeck, ...opponentState.foundationDeck];
          if (!discardCount || opponentState.hand.length < discardCount || !deckCards.length) continue;
          const discardedIds = [...opponentState.hand].sort((leftId, rightId) => scoreCard(leftId) - scoreCard(rightId)).slice(0, discardCount);
          const targetId = [...deckCards].sort((leftId, rightId) => scoreCard(rightId) - scoreCard(leftId))[0];
          let remainingHand = opponentState.hand;
          discardedIds.forEach((cardId) => { remainingHand = removeOneCard(remainingHand, cardId); });
          const handResult = addCardsToHandWithLimit(remainingHand, [targetId], [...discardedIds, ...opponentState.discardPile], handLimit);
          const next = commitAction({ ...opponentState, hand: handResult.hand, discardPile: handResult.discardPile, palsDeck: shuffle(removeOneCard(opponentState.palsDeck, targetId)), foundationDeck: shuffle(removeOneCard(opponentState.foundationDeck, targetId)) }, actionKey, cost, oncePerTurn);
          return { state: next, sourceCardId: entry.card.id, actionName: getActionName(action), revealedCards: [targetId], success: true, summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP, discarded ${discardedIds.map((cardId) => cardsById[cardId]?.name).join(" and ")}, and revealed ${cardsById[targetId]?.name}.${handResult.cardsToDiscard.includes(targetId) ? " The found card exceeded the hand limit and was discarded." : " It was added to the opponent's hand."}` };
        }
        if (effect.type === "discardThenDraw") {
          const minimum = Math.max(0, Number(effect.discard?.min ?? effect.discard?.amount ?? 0));
          const maximum = Math.max(minimum, Number(effect.discard?.max ?? minimum));
          const discardCount = Math.min(maximum, opponentState.hand.length, opponentState.palsDeck.length + opponentState.foundationDeck.length);
          if (!discardCount || discardCount < minimum) continue;
          const discardedIds = [...opponentState.hand].sort((leftId, rightId) => scoreCard(leftId) - scoreCard(rightId)).slice(0, discardCount);
          let remainingHand = opponentState.hand;
          discardedIds.forEach((cardId) => { remainingHand = removeOneCard(remainingHand, cardId); });
          let next = { ...opponentState, hand: remainingHand, discardPile: [...discardedIds, ...opponentState.discardPile] };
          const drawnIds = [];
          for (let index = 0; index < discardCount; index += 1) {
            const preferred = index % 2 === 0 ? "palsDeck" : "foundationDeck";
            const deckKey = next[preferred].length ? preferred : preferred === "palsDeck" ? "foundationDeck" : "palsDeck";
            if (!next[deckKey].length) break;
            const cardId = next[deckKey][0];
            drawnIds.push(cardId);
            next = { ...next, [deckKey]: next[deckKey].slice(1), hand: [...next.hand, cardId] };
          }
          const handResult = addCardsToHandWithLimit([], next.hand, next.discardPile, handLimit);
          next = commitAction({ ...next, hand: handResult.hand, discardPile: handResult.discardPile }, actionKey, cost, oncePerTurn);
          return { state: next, sourceCardId: entry.card.id, actionName: getActionName(action), success: true, summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP, discarded ${discardCount} card(s), and drew ${drawnIds.length}.${handResult.cardsToDiscard.length ? ` ${handResult.cardsToDiscard.length} exceeded the hand limit and was discarded.` : ""}` };
        }
        if (effect.type === "modifyDefenseRoll" || effect.type === EffectType.GRANT_DEFENSE_ADVANTAGE) {
          const categories = action?.target?.categories ?? [];
          const target = entries.find((candidate) => candidate.card && (!categories.length || categories.includes(candidate.card.category)));
          if (!target) continue;
          const status = effect.type === EffectType.GRANT_DEFENSE_ADVANTAGE
            ? { type: "defenseAdvantage", expiresTurn: turn + 1, sourceCardId: entry.card.id }
            : { type: "defenseBonusDice", dice: effect.amount?.dice ?? "D4", expiresTurn: turn + 1, sourceCardId: entry.card.id };
          const nextStatuses = { ...(opponentState.creatureStatuses ?? {}), [target.statusKey]: [...(opponentState.creatureStatuses?.[target.statusKey] ?? []), status] };
          const next = commitAction({ ...opponentState, creatureStatuses: nextStatuses }, actionKey, cost, oncePerTurn);
          return { state: next, sourceCardId: entry.card.id, defenderCardId: target.card.id, actionName: getActionName(action), success: true, summary: `Opponent's ${entry.card.name} used ${getActionName(action)} for ${cost} RP and gave ${target.card.name} ${status.type === "defenseAdvantage" ? "advantage on defense rolls" : `+${status.dice} to defense rolls`} until its next turn.` };
        }
        if (effect.type === "rollDiceForResource") {
          const roll = rollDie(effect.dice);
          if (!roll) continue;
          const success = (effect.successValues ?? []).includes(roll.total);
          const gained = success ? Number(effect.onSuccess?.amount ?? 0) : 0;
          const cap = getEcosystemRpCap(opponentState.corals, [...opponentState.habitats, ...opponentState.reefCreatures, ...(opponentState.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])], activeCondition);
          const committed = commitAction(opponentState, actionKey, cost, oncePerTurn);
          const next = { ...committed, rp: addResourceWithinCap(committed.rp, gained, cap) };
          return { state: next, sourceCardId: entry.card.id, actionName: getActionName(action), success, summary: `Opponent's ${entry.card.name} used ${getActionName(action)} and rolled ${roll.total} on ${effect.dice}.${success ? ` It gained ${gained} RP, up to its ${cap} RP cap.` : " It gained no RP."}` };
        }
      }
    }
    return null;
  }

  function runOpponentUtilityActions(opponentState, currentPlayerState) {
    let nextOpponent = opponentState;
    let nextPlayer = currentPlayerState;
    const actions = [];
    const creatureActionCount = [
      ...opponentState.corals.flatMap((coral) => coral.slots.flatMap((slot) => [slot.cardId, ...(slot.hostedCardIds ?? [])])),
      ...(opponentState.reefCreatures ?? []),
      ...(opponentState.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])]),
    ].filter(Boolean).reduce((total, cardId) => total + (cardsById[cardId]?.actions?.length ?? 0), 0);
    const foundationActionCount = opponentState.corals.reduce((total, foundation) => total + (cardsById[foundation.cardId]?.passives ?? []).filter((passive) => getPassiveCoralHeal(passive) || getDamageCounterMove(passive)).length, 0);
    const availableActionCount = Math.max(1, creatureActionCount + foundationActionCount);
    const safetyLimit = limitOpponentOptionalActions(availableActionCount, opponentDifficulty, "utility");
    for (let index = 0; index < safetyLimit; index += 1) {
      const result = runOpponentUtilityAction(nextOpponent, nextPlayer);
      if (!result) break;
      nextOpponent = result.state;
      nextPlayer = result.playerState ?? nextPlayer;
      actions.push(result);
      if (result.lost) break;
    }
    return {
      state: nextOpponent,
      playerState: nextPlayer,
      actions,
      lost: actions.some((action) => action.lost),
      summary: actions.map((action) => action.summary).filter(Boolean).join(" "),
    };
  }

  function runOpponentAttackStep(opponentState, currentPlayerCorals, currentPlayerReefEntries, currentPlayerOrphans, onPlayAttack = null, excludedTargetInstanceIds = [], controllerState = {}) {
    const currentPlayerReefInstances = reconcileCreatureZone(currentPlayerReefEntries, currentPlayerReefEntries, "player-reef");
    const currentPlayerReefCreatures = currentPlayerReefInstances.map((instance) => instance.cardId);
    const controllerRp = Number(controllerState.rp ?? rp);
    const controllerCreatureStatuses = controllerState.creatureStatuses ?? creatureStatuses;
    const controllerResilienceUsedCardIds = controllerState.resilienceUsedCardIds ?? resilienceUsedCardIds;
    const actionCostAlreadyPaid = Boolean(controllerState.actionCostAlreadyPaid);
    const excludedTargets = new Set(excludedTargetInstanceIds);
    const attackerEntries = opponentState.corals.flatMap((coral) =>
      coral.slots.filter((slot) => {
        const isTriggeredAttacker = onPlayAttack?.coralId === coral.id && onPlayAttack?.slotId === slot.id && onPlayAttack?.cardId === slot.cardId;
        const attack = isTriggeredAttacker ? onPlayAttack.attack : onPlayAttack ? null : getBasicAttackEffect(cardsById[slot.cardId]);
        const locationKey = getSlotActionKey(slot);
        const actionUseKey = attack ? getOpponentActionUseKey(locationKey, attack) : null;
        return attack
          && (actionCostAlreadyPaid || attack.actionCost <= opponentState.rp)
          && (onPlayAttack || turn >= Number(opponentState.actionCooldowns?.[locationKey] ?? 0))
          && (onPlayAttack || actionCostAlreadyPaid || !wasOpponentActionUsedThisTurn(opponentState.actionUses, actionUseKey, turn));
      }).map((slot) => ({
        coral,
        slot,
        locationKey: getSlotActionKey(slot),
        card: cardsById[slot.cardId],
        attack: onPlayAttack?.coralId === coral.id && onPlayAttack?.slotId === slot.id ? onPlayAttack.attack : getBasicAttackEffect(cardsById[slot.cardId]),
      })),
    );
    (opponentState.reefCreatures ?? []).forEach((cardId, reefIndex) => {
      const card = cardsById[cardId];
      const reefInstanceId = opponentState.reefCreatureInstances?.[reefIndex]?.instanceId;
      const isTriggeredAttacker = onPlayAttack?.cardId === cardId && (onPlayAttack?.reefInstanceId ? onPlayAttack.reefInstanceId === reefInstanceId : onPlayAttack?.reefIndex === reefIndex);
      const attack = isTriggeredAttacker ? onPlayAttack.attack : onPlayAttack ? null : getBasicAttackEffect(card);
      const stableSlotId = `reef-${reefInstanceId ?? reefIndex}`;
      const actionUseKey = attack ? getOpponentActionUseKey(stableSlotId, attack) : null;
      if (attack && (actionCostAlreadyPaid || attack.actionCost <= opponentState.rp) && (onPlayAttack || turn >= Number(opponentState.actionCooldowns?.[stableSlotId] ?? 0)) && (onPlayAttack || actionCostAlreadyPaid || !wasOpponentActionUsedThisTurn(opponentState.actionUses, actionUseKey, turn))) attackerEntries.push({ coral: null, slot: null, reefIndex, instanceId: reefInstanceId, locationKey: stableSlotId, card, attack });
    });
    (opponentState.orphanCreatures ?? []).forEach((entry, orphanIndex) => {
      const card = cardsById[entry.cardId];
      const isTriggeredAttacker = onPlayAttack?.cardId === entry.cardId && (onPlayAttack?.orphanInstanceId ? onPlayAttack.orphanInstanceId === entry.instanceId : onPlayAttack?.orphanIndex === orphanIndex);
      const attack = isTriggeredAttacker ? onPlayAttack.attack : onPlayAttack ? null : getBasicAttackEffect(card);
      const stableSlotId = `orphan-${entry.instanceId ?? orphanIndex}`;
      const actionUseKey = attack ? getOpponentActionUseKey(stableSlotId, attack) : null;
      if (attack && (actionCostAlreadyPaid || attack.actionCost <= opponentState.rp) && (onPlayAttack || turn >= Number(opponentState.actionCooldowns?.[stableSlotId] ?? 0)) && (onPlayAttack || actionCostAlreadyPaid || !wasOpponentActionUsedThisTurn(opponentState.actionUses, actionUseKey, turn))) attackerEntries.push({ coral: null, slot: null, reefIndex: -1, orphanIndex, instanceId: entry.instanceId, locationKey: stableSlotId, card, attack });
    });
    const scoreAttacker = (entry) => {
      const diceSides = Number(String(entry.attack?.attackDice ?? "").match(/D(\d+)/i)?.[1] ?? 0);
      const repeatAttacks = Math.max(1, Number(entry.attack?.repeatAttacks ?? 1));
      const printedVp = Number(entry.card?.victoryPoints?.value ?? entry.card?.victoryPoints ?? entry.card?.vp ?? 0);
      return diceSides * repeatAttacks + printedVp * 2 - Number(entry.attack?.actionCost ?? 0);
    };
    const attackerEntry = opponentDifficulty === OpponentDifficulty.HARD
      ? selectOpponentChoice(attackerEntries, opponentDifficulty, { mediumScore: scoreAttacker, hardScore: scoreAttacker })
      : attackerEntries[0];
    if (!attackerEntry) return null;
    const opponentAttackActionKey = onPlayAttack ? null : getOpponentActionUseKey(attackerEntry.locationKey, attackerEntry.attack);
    const opponentCooldownKey = !onPlayAttack && attackerEntry.attack.skipNextTurn ? (attackerEntry.slot ? getSlotActionKey(attackerEntry.slot) : attackerEntry.orphanIndex >= 0 ? `orphan-${attackerEntry.instanceId ?? attackerEntry.orphanIndex}` : `reef-${attackerEntry.instanceId ?? attackerEntry.reefIndex}`) : null;
    const targetEntries = currentPlayerCorals.flatMap((coral) => coral.slots.flatMap((slot) => [{ cardId: slot.cardId, hostedIndex: -1, instanceId: getSlotTargetInstanceId(slot) }, ...(slot.hostedCardIds ?? []).map((cardId, hostedIndex) => ({ cardId, hostedIndex, instanceId: `hosted:${getHostedTargetSlotId(slot.id, hostedIndex)}` }))].filter((entry) => {
      const card = cardsById[entry.cardId];
      return cardMatchesAttackTarget(card, attackerEntry.attack) && (!cardIsHiddenByAbyss(card, playerHabitats) || cardCanTargetHiddenByAbyss(attackerEntry.card, attackerEntry.attack));
    }).map((entry) => ({ coral, slot, hostedIndex: entry.hostedIndex, card: cardsById[entry.cardId], instanceId: entry.instanceId }))));
    (currentPlayerReefCreatures ?? []).forEach((cardId, reefIndex) => {
      const card = cardsById[cardId];
      if (cardMatchesAttackTarget(card, attackerEntry.attack) && (!cardIsHiddenByAbyss(card, playerHabitats) || cardCanTargetHiddenByAbyss(attackerEntry.card, attackerEntry.attack))) targetEntries.push({ coral: null, slot: null, reefIndex, instanceId: currentPlayerReefInstances[reefIndex]?.instanceId, card });
    });
    (currentPlayerOrphans ?? []).forEach((entry, orphanIndex) => {
      const canTargetCard = (card) => cardMatchesAttackTarget(card, attackerEntry.attack)
        && (!cardIsHiddenByAbyss(card, playerHabitats) || cardCanTargetHiddenByAbyss(attackerEntry.card, attackerEntry.attack));
      const card = cardsById[entry.cardId];
      if (canTargetCard(card)) targetEntries.push({ coral: null, slot: null, reefIndex: -1, orphanIndex, hostedIndex: -1, orphanInstanceId: entry.instanceId, instanceId: entry.instanceId, card });
      (entry.hostedCardIds ?? []).forEach((hostedCardId, hostedIndex) => {
        const hostedCard = cardsById[hostedCardId];
        if (!hostedCardId || !canTargetCard(hostedCard)) return;
        const hostedSlotId = getOrphanHostedTargetSlotId(entry.instanceId ?? `legacy-${orphanIndex}`, hostedIndex);
        targetEntries.push({
          coral: null,
          slot: null,
          reefIndex: -1,
          orphanIndex,
          hostedIndex,
          orphanInstanceId: entry.instanceId,
          hostCardId: entry.cardId,
          instanceId: `hosted:${hostedSlotId}`,
          card: hostedCard,
        });
      });
    });
    currentPlayerCorals.forEach((foundation) => {
      const card = cardsById[foundation.cardId];
      if (isCreatureSchool(card) && cardMatchesAttackTarget(card, attackerEntry.attack)) targetEntries.push({ coral: foundation, slot: null, school: true, card, instanceId: `foundation:${foundation.id}` });
    });
    const availableTargetEntries = targetEntries.filter((entry) => entry.instanceId && !excludedTargets.has(entry.instanceId));
    const scoreTarget = (entry) => {
      const printedVp = Number(entry.card?.victoryPoints?.value ?? entry.card?.victoryPoints ?? entry.card?.vp ?? 0);
      const income = getCardStartTurnRp(entry.card);
      const defenseSides = Number(String(entry.card?.defense?.dice ?? entry.card?.defense ?? "").match(/D(\d+)/i)?.[1] ?? 0);
      const actionValue = Number(entry.card?.actions?.length ?? 0) * 5;
      const damagedSchoolValue = entry.school ? Math.max(0, Number(entry.coral?.maxHealth ?? 0) - Number(entry.coral?.health ?? entry.coral?.maxHealth ?? 0)) / 5 : 0;
      return printedVp * 15 + income * 10 + Number(entry.card?.cost?.rp ?? 0) * 2 + actionValue + (entry.school ? 18 : 0) + damagedSchoolValue - defenseSides;
    };
    const targetEntry = opponentDifficulty === OpponentDifficulty.HARD
      ? selectOpponentChoice(availableTargetEntries, opponentDifficulty, { mediumScore: scoreTarget, hardScore: scoreTarget })
      : availableTargetEntries[0];
    if (!targetEntry) {
      if (!onPlayAttack) return null;
      return {
        corals: currentPlayerCorals,
        reefCreatures: currentPlayerReefCreatures,
        discardedCardId: null,
        attackerCardId: attackerEntry.card.id,
        defenderCardId: null,
        attackerWins: false,
        actionCost: 0,
        noLegalTarget: true,
        summary: `Opponent's ${attackerEntry.card.name} used ${attackerEntry.attack.actionName}, but there was no legal target.`,
      };
    }
    const targetAvoidance = getTargetAvoidance(targetEntry.card);
    if (targetAvoidance) {
      const coinResult = Math.random() < 0.5 ? "heads" : "tails";
      if (coinResult === targetAvoidance.failureResult) {
        return {
          corals: currentPlayerCorals,
          reefCreatures: currentPlayerReefCreatures,
          discardedCardId: null,
          attackerCardId: attackerEntry.card.id,
          defenderCardId: targetEntry.card.id,
          targetInstanceId: targetEntry.instanceId,
          eventSourceCardId: targetEntry.card.id,
          attackerWins: false,
          defenderEvaded: true,
          actionCost: attackerEntry.attack.actionCost,
          opponentCooldownKey,
          opponentAttackActionKey,
          summary: `${targetEntry.card.name} used ${targetAvoidance.abilityName} and flipped ${coinResult}, so Opponent's ${attackerEntry.card.name}${onPlayAttack ? ` ${attackerEntry.attack.actionName}` : " attack"} failed before dice were rolled.`,
        };
      }
    }
    if (targetEntry.school) {
      const hasDisadvantage = attackerHasDisadvantageFromMassive(targetEntry.card);
      const hasAdvantage = cardHasAttackAdvantage(attackerEntry.card, targetEntry.card, opponentState.habitats, attackerEntry.attack);
      const useAdvantage = hasAdvantage && !hasDisadvantage;
      const useDisadvantage = hasDisadvantage && !hasAdvantage;
      const rolls = [0].map(() => {
        const first = rollDie(attackerEntry.attack.attackDice);
        const second = useAdvantage || useDisadvantage ? rollDie(attackerEntry.attack.attackDice) : null;
        const modifier = getAttackConditionalModifier(attackerEntry.card, { ...targetEntry.card, health: targetEntry.coral.health, maxHealth: targetEntry.coral.maxHealth }, opponentState.habitats, opponentState.corals, opponentState.reefCreatures, attackerEntry.attack, opponentState.orphanCreatures);
        const baseTotal = second ? (useAdvantage ? Math.max(first.total, second.total) : Math.min(first.total, second.total)) : first?.total;
        const rolledBonus = getRolledAttackBonus(attackerEntry.attack, baseTotal, opponentState.habitats);
        const rovLightsBonus = getRovLightsAttackBonus(opponentState.rovLightsActive, targetEntry.card);
        return first ? { total: baseTotal + modifier.flat + rolledBonus.flat + rovLightsBonus, detail: `${second ? `${first.total}/${second.total} ${useAdvantage ? "advantage" : "disadvantage"}` : `${first.total}${hasAdvantage && hasDisadvantage ? " (advantage and disadvantage canceled)" : ""}`}${modifier.details.length || rolledBonus.detail || rovLightsBonus ? ` [${[...modifier.details, rolledBonus.detail, rovLightsBonus ? "+2 ROV Lights" : null].filter(Boolean).join(", ")}]` : ""}` } : null;
      }).filter(Boolean);
      if (!rolls.length) return null;
      const result = applyDamage(targetEntry.coral.health ?? targetEntry.coral.maxHealth, rolls.reduce((total, roll) => total + roll.total * 10, 0));
      const redistributed = result.destroyed ? redistributeOrphanCreatures(currentPlayerCorals.filter((foundation) => foundation.id !== targetEntry.coral.id), [...currentPlayerOrphans, ...getOrphanEntriesFromFoundation(targetEntry.coral)]) : { corals: currentPlayerCorals.map((foundation) => foundation.id === targetEntry.coral.id ? { ...foundation, health: result.remainingHealth } : foundation), orphans: currentPlayerOrphans };
      return { corals: redistributed.corals, orphanCreatures: redistributed.orphans, reefCreatures: currentPlayerReefCreatures, reefCreatureInstances: currentPlayerReefInstances, discardedCardId: result.destroyed ? targetEntry.card.id : null, attackerCardId: attackerEntry.card.id, defenderCardId: targetEntry.card.id, targetInstanceId: targetEntry.instanceId, attackerWins: true, actionCost: attackerEntry.attack.actionCost, opponentCooldownKey, opponentAttackActionKey, summary: `Opponent's ${attackerEntry.card.name}${onPlayAttack ? ` used ${attackerEntry.attack.actionName} on` : " attacked"} ${targetEntry.card.name}, rolled ${rolls.map((roll) => roll.detail).join(", ")}, and dealt ${result.appliedDamage} damage.${result.destroyed ? ` Your Creature School was discarded; ${redistributed.orphans.length} creature group(s) remain orphaned after redistribution.` : ` ${result.remainingHealth}/${targetEntry.coral.maxHealth} HP remains.`}` };
    }
    const defenseDice = targetEntry.card.defense?.dice ?? targetEntry.card.defense;
    if (!defenseDice) return {
      corals: currentPlayerCorals,
      reefCreatures: currentPlayerReefCreatures,
      orphanCreatures: currentPlayerOrphans,
      opponentCorals: opponentState.corals,
      opponentReefCreatures: opponentState.reefCreatures,
      opponentOrphanCreatures: opponentState.orphanCreatures,
      attackerCardId: attackerEntry.card.id,
      defenderCardId: targetEntry.card.id,
      targetInstanceId: targetEntry.instanceId,
      eventSourceCardId: attackerEntry.card.id,
      actionCost: 0,
      noLegalTarget: true,
      resolutionUnsupported: true,
      summary: `Opponent's ${attackerEntry.card.name} could not resolve its attack against ${targetEntry.card.name} because that card has no defense die in the current data. No RP was spent and neither card moved.`,
    };
    const rolls = [];
    let attackerWins = false;
    const targetStatusKey = targetEntry.hostedIndex >= 0
      ? targetEntry.orphanIndex >= 0
        ? getOrphanHostedTargetSlotId(targetEntry.orphanInstanceId, targetEntry.hostedIndex)
        : getHostedTargetSlotId(targetEntry.slot?.id, targetEntry.hostedIndex)
      : targetEntry.slot ? getSlotActionKey(targetEntry.slot) : targetEntry.reefIndex >= 0 ? `reef-${targetEntry.instanceId ?? targetEntry.reefIndex}` : targetEntry.orphanIndex >= 0 ? `orphan-${targetEntry.instanceId ?? targetEntry.orphanIndex}` : null;
    const activeDefenseStatuses = controllerCreatureStatuses[targetStatusKey] ?? [];
    const attackAdvantage = cardHasAttackAdvantage(attackerEntry.card, targetEntry.card, opponentState.habitats, attackerEntry.attack);
    const defenseAdjustment = getDefenseAdjustment(attackerEntry.attack, targetEntry.card, opponentState.habitats);
    const attackDisadvantage = attackerHasDisadvantageFromMassive(targetEntry.card);
    const useAttackAdvantage = attackAdvantage && !attackDisadvantage;
    const useAttackDisadvantage = attackDisadvantage && !attackAdvantage;
    const defenseAdvantage = hasDefenseAdvantage({ targetCard: targetEntry.card, statuses: activeDefenseStatuses, ignoreDefensiveBonuses: defenseAdjustment.ignoresBonuses });
    const attachedDefenseBonus = !defenseAdjustment.ignoresBonuses && targetEntry.coral ? calculateAttachedCreatureDefenseBonus(cardsById[targetEntry.coral.cardId]) : 0;
    const hostedDefenseBonusDice = !defenseAdjustment.ignoresBonuses && targetEntry.hostedIndex >= 0 ? getHostedDefenseBonusDice(cardsById[targetEntry.hostCardId ?? targetEntry.slot?.cardId], targetEntry.card) : null;
    const cloakDefenseBonus = !defenseAdjustment.ignoresBonuses ? getCloakDefenseBonus(targetEntry.card) : 0;
    const darknessShroudDefenseBonus = !defenseAdjustment.ignoresBonuses ? getDarknessShroudDefenseBonus(targetEntry.card, playerHabitats) : 0;
    const rovLightsBonus = getRovLightsAttackBonus(opponentState.rovLightsActive, targetEntry.card);
    for (let index = 0; index < 1 && !attackerWins; index += 1) {
      const result = resolveOpposedRoll(attackerEntry.attack.attackDice, defenseDice);
      if (!result.resolved) return null;
      const secondDefenseRoll = defenseAdvantage ? rollDie(defenseDice) : null;
      const chosenDefenseRoll = secondDefenseRoll ? Math.max(result.defense.total, secondDefenseRoll.total) : result.defense.total;
      let defenseTotal = Math.max(0, chosenDefenseRoll + defenseAdjustment.flat + cloakDefenseBonus + darknessShroudDefenseBonus + attachedDefenseBonus);
      const rollDetails = [];
      if (secondDefenseRoll) rollDetails.push(`Massive/defense advantage ${result.defense.total}/${secondDefenseRoll.total}`);
      if (cloakDefenseBonus) rollDetails.push(`+${cloakDefenseBonus} Cloak`);
      if (darknessShroudDefenseBonus) rollDetails.push(`+${darknessShroudDefenseBonus} Darkness Shroud`);
      if (attachedDefenseBonus) rollDetails.push(`+${attachedDefenseBonus} Shelter`);
      const hostedDefenseRoll = hostedDefenseBonusDice ? rollDie(hostedDefenseBonusDice) : null;
      if (hostedDefenseRoll) {
        defenseTotal += hostedDefenseRoll.total;
        rollDetails.push(`+${hostedDefenseRoll.total} Stinging Fortress`);
      }
      (!defenseAdjustment.ignoresBonuses ? activeDefenseStatuses : []).filter((status) => status.type === "defenseBonusDice").forEach((status) => {
        const bonusRoll = rollDie(status.dice);
        if (bonusRoll) {
          defenseTotal += bonusRoll.total;
          rollDetails.push(`+${bonusRoll.total} from ${status.dice}`);
        }
      });
      const advantageRoll = useAttackAdvantage || useAttackDisadvantage ? rollDie(attackerEntry.attack.attackDice) : null;
      const modifier = getAttackConditionalModifier(attackerEntry.card, targetEntry.card, opponentState.habitats, opponentState.corals, opponentState.reefCreatures, attackerEntry.attack, opponentState.orphanCreatures);
      const chosenAttackRoll = advantageRoll ? (useAttackAdvantage ? Math.max(result.attack.total, advantageRoll.total) : Math.min(result.attack.total, advantageRoll.total)) : result.attack.total;
      const rolledBonus = getRolledAttackBonus(attackerEntry.attack, chosenAttackRoll, opponentState.habitats);
      let attackTotal = chosenAttackRoll + modifier.flat + rolledBonus.flat + rovLightsBonus;
      let scatterDetail = "";
      if (attackTotal > defenseTotal && cardHasScatter(targetEntry.card)) {
        const scatterFirst = rollDie(attackerEntry.attack.attackDice);
        const scatterSecond = useAttackAdvantage || useAttackDisadvantage ? rollDie(attackerEntry.attack.attackDice) : null;
        const scatterBase = scatterSecond ? (useAttackAdvantage ? Math.max(scatterFirst.total, scatterSecond.total) : Math.min(scatterFirst.total, scatterSecond.total)) : scatterFirst?.total ?? 0;
        const scatterModifier = getAttackConditionalModifier(attackerEntry.card, targetEntry.card, opponentState.habitats, opponentState.corals, opponentState.reefCreatures, attackerEntry.attack, opponentState.orphanCreatures);
        const scatterRolledBonus = getRolledAttackBonus(attackerEntry.attack, scatterBase, opponentState.habitats);
        attackTotal = scatterBase + scatterModifier.flat + scatterRolledBonus.flat + rovLightsBonus;
        scatterDetail = `; Scatter reroll ${attackTotal}`;
      }
      rolls.push(`${attackTotal}${advantageRoll ? ` (${result.attack.total}/${advantageRoll.total} ${useAttackAdvantage ? "advantage" : "disadvantage"})` : attackAdvantage && attackDisadvantage ? " (advantage and disadvantage canceled)" : ""}${modifier.details.length || rolledBonus.detail || rovLightsBonus ? ` [${[...modifier.details, rolledBonus.detail, rovLightsBonus ? "+2 ROV Lights" : null].filter(Boolean).join(", ")}]` : ""} vs ${defenseTotal}${defenseAdjustment.flat ? ` (${defenseAdjustment.flat} defense)` : ""}${defenseAdjustment.ignoresBonuses ? " (defensive bonuses ignored)" : rollDetails.length ? ` (${rollDetails.join(", ")})` : ""}${scatterDetail}`);
      attackerWins = attackTotal > defenseTotal;
    }
    if (!attackerWins) {
      const biteBack = getBiteBackAttack(targetEntry.card);
      const attackerDefense = attackerEntry.card.defense?.dice ?? attackerEntry.card.defense;
      const counter = biteBack && attackerDefense ? resolveOpposedRoll(biteBack.attackDice, attackerDefense) : null;
      const counterSucceeded = Boolean(counter?.resolved && counter.attack.total > counter.defense.total);
      const opponentCorals = counterSucceeded && attackerEntry.coral ? opponentState.corals.map((coral) => coral.id === attackerEntry.coral.id ? {
        ...coral,
        slots: coral.slots.map((slot) => slot.id === attackerEntry.slot.id ? { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot),
      } : coral) : opponentState.corals;
      const opponentReefCreatureInstances = counterSucceeded && attackerEntry.reefIndex >= 0
        ? removeCreatureInstances(opponentState.reefCreatureInstances ?? [], [attackerEntry.instanceId]).instances
        : opponentState.reefCreatureInstances ?? [];
      const opponentReefCreatures = opponentReefCreatureInstances.map((instance) => instance.cardId);
      const opponentOrphanCreatures = counterSucceeded && attackerEntry.orphanIndex >= 0
        ? [...(opponentState.orphanCreatures ?? []).filter((entry) => entry.instanceId !== attackerEntry.instanceId), ...(opponentState.orphanCreatures?.[attackerEntry.orphanIndex]?.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`opponent-orphan-${cardId}`)))]
        : opponentState.orphanCreatures ?? [];
      return {
        corals: currentPlayerCorals,
        reefCreatures: currentPlayerReefCreatures,
        discardedCardId: null,
        opponentCorals,
        opponentReefCreatures,
        opponentReefCreatureInstances,
        opponentOrphanCreatures,
        opponentDiscardedCardId: counterSucceeded ? attackerEntry.card.id : null,
        attackerCardId: attackerEntry.card.id,
        defenderCardId: targetEntry.card.id,
        targetInstanceId: targetEntry.instanceId,
        counterCardId: counter?.resolved ? targetEntry.card.id : null,
        counterSucceeded,
        attackerWins: false,
        actionCost: attackerEntry.attack.actionCost,
        opponentCooldownKey,
        opponentAttackActionKey,
        summary: `Opponent's ${attackerEntry.card.name}${onPlayAttack ? ` used ${attackerEntry.attack.actionName} on` : " attacked"} ${targetEntry.card.name}: ${rolls.join(", ")}. Your defender won.${counter?.resolved ? ` ${targetEntry.card.name} used ${biteBack.actionName} (${counter.attack.total} vs ${counter.defense.total}) and ${counterSucceeded ? `discarded ${attackerEntry.card.name}` : "the counterattack failed"}.` : ""}${attackerEntry.attack.unsupportedDetails ? ` ${attackerEntry.attack.unsupportedDetails}` : ""}`,
      };
    }
    const defeatedCorals = targetEntry.reefIndex >= 0 || targetEntry.orphanIndex >= 0 ? currentPlayerCorals : currentPlayerCorals.map((coral) => coral.id === targetEntry.coral.id ? {
      ...coral,
      slots: coral.slots.map((slot) => slot.id === targetEntry.slot.id ? targetEntry.hostedIndex >= 0 ? { ...slot, hostedCardIds: removeHostedCardAtIndex(slot.hostedCardIds, targetEntry.hostedIndex) } : { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot),
    } : coral);
    const defeatedReefInstances = targetEntry.reefIndex >= 0 ? removeCreatureInstances(currentPlayerReefInstances, [targetEntry.instanceId]).instances : currentPlayerReefInstances;
    const defeatedOrphans = targetEntry.orphanIndex < 0
      ? currentPlayerOrphans
      : targetEntry.hostedIndex >= 0
        ? currentPlayerOrphans.map((entry) => entry.instanceId === targetEntry.orphanInstanceId
          ? { ...entry, hostedCardIds: removeHostedCardAtIndex(entry.hostedCardIds, targetEntry.hostedIndex) }
          : entry)
        : [
            ...currentPlayerOrphans.filter((entry) => entry.instanceId !== targetEntry.orphanInstanceId),
            ...(currentPlayerOrphans[targetEntry.orphanIndex]?.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`player-orphan-${cardId}`))),
          ];
    const defeatedDiscardIds = [targetEntry.card.id, ...(targetEntry.orphanIndex >= 0 || targetEntry.hostedIndex >= 0 ? [] : (targetEntry.slot?.hostedCardIds ?? []).filter(Boolean))];
    const resilienceTriggered = cardHasAncientResilience(targetEntry.card) && !controllerResilienceUsedCardIds.includes(targetEntry.instanceId);
    const regenerateDecision = createRegenerateDecision({ defenderCard: targetEntry.card, defenderWasDefeated: true, controllerRp, survivalAlreadyApplied: resilienceTriggered });
    if (resilienceTriggered || regenerateDecision.available) {
      return {
        corals: currentPlayerCorals,
        reefCreatures: currentPlayerReefCreatures,
        reefCreatureInstances: currentPlayerReefInstances,
        orphanCreatures: currentPlayerOrphans,
        discardedCardId: null,
        attackerCardId: attackerEntry.card.id,
        defenderCardId: targetEntry.card.id,
        targetInstanceId: targetEntry.instanceId,
        attackerWins: true,
        defenderSurvived: true,
        playerResilienceUsedCardId: resilienceTriggered ? targetEntry.instanceId : null,
        pendingRegenerate: regenerateDecision.available ? {
          decision: regenerateDecision,
          defeatedCorals,
          defeatedReefInstances,
          defeatedOrphans,
          discardedCardIds: defeatedDiscardIds,
          attackerCardId: attackerEntry.card.id,
          attackerLocation: { coralId: attackerEntry.coral?.id ?? null, slotId: attackerEntry.slot?.id ?? null, reefInstanceId: attackerEntry.reefIndex >= 0 ? attackerEntry.instanceId : null, orphanInstanceId: attackerEntry.orphanIndex >= 0 ? attackerEntry.instanceId : null },
          targetLocation: {
            coralId: targetEntry.coral?.id ?? null,
            slotId: targetEntry.slot?.id ?? null,
            hostedIndex: targetEntry.hostedIndex,
            reefInstanceId: targetEntry.reefIndex >= 0 ? targetEntry.instanceId : null,
            orphanInstanceId: targetEntry.orphanIndex >= 0 ? targetEntry.orphanInstanceId : null,
          },
          toxicSourceCardId: targetEntry.card.id,
          opponentPoisonHealActive: Boolean(opponentState.poisonImmunityNextPredatorAttack),
        } : null,
        actionCost: attackerEntry.attack.actionCost,
        opponentCooldownKey,
        opponentAttackActionKey,
        summary: `Opponent's ${attackerEntry.card.name}${onPlayAttack ? ` used ${attackerEntry.attack.actionName} on` : " attacked"} ${targetEntry.card.name}: ${rolls.join(", ")}. The attack succeeded, but ${resilienceTriggered ? `Ancient Resilience kept ${targetEntry.card.name} in play and is now used for this game` : `${targetEntry.card.name}'s Regenerate is waiting for your decision`}.`,
      };
    }
    const toxicResult = resolveToxicConsumption({ attackerCard: attackerEntry.card, toxicSourceCard: targetEntry.card, consumed: true, poisonHealActive: opponentState.poisonImmunityNextPredatorAttack });
    const toxicDiscardedAttacker = toxicResult.discardAttacker;
    const selfDiscardedAttacker = shouldSelfDiscardAfterConsume({ attackerCard: attackerEntry.card, defenderCard: targetEntry.card, consumed: true });
    const attackerDiscardedAfterConsume = toxicDiscardedAttacker || selfDiscardedAttacker;
    const opponentReefInstancesAfterToxic = attackerDiscardedAfterConsume && attackerEntry.reefIndex >= 0 ? removeCreatureInstances(opponentState.reefCreatureInstances ?? [], [attackerEntry.instanceId]).instances : opponentState.reefCreatureInstances ?? [];
    return {
      corals: defeatedCorals,
      reefCreatures: defeatedReefInstances.map((instance) => instance.cardId),
      reefCreatureInstances: defeatedReefInstances,
      orphanCreatures: defeatedOrphans,
      discardedCardId: targetEntry.card.id,
      discardedCardIds: defeatedDiscardIds,
      opponentCorals: attackerDiscardedAfterConsume && attackerEntry.coral ? opponentState.corals.map((coral) => coral.id === attackerEntry.coral.id ? { ...coral, slots: coral.slots.map((slot) => slot.id === attackerEntry.slot.id ? { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot) } : coral) : opponentState.corals,
      opponentReefCreatures: opponentReefInstancesAfterToxic.map((instance) => instance.cardId),
      opponentReefCreatureInstances: opponentReefInstancesAfterToxic,
      opponentOrphanCreatures: attackerDiscardedAfterConsume && attackerEntry.orphanIndex >= 0 ? [...(opponentState.orphanCreatures ?? []).filter((entry) => entry.instanceId !== attackerEntry.instanceId), ...(opponentState.orphanCreatures?.[attackerEntry.orphanIndex]?.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`opponent-orphan-${cardId}`)))] : opponentState.orphanCreatures ?? [],
      opponentDiscardedCardId: attackerDiscardedAfterConsume ? attackerEntry.card.id : null,
      attackerCardId: attackerEntry.card.id,
      defenderCardId: targetEntry.card.id,
      targetInstanceId: targetEntry.instanceId,
      attackerWins: true,
      actionCost: attackerEntry.attack.actionCost,
      opponentCooldownKey,
      opponentAttackActionKey,
      summary: `Opponent's ${attackerEntry.card.name}${onPlayAttack ? ` used ${attackerEntry.attack.actionName} on` : " attacked"} ${targetEntry.card.name}: ${rolls.join(", ")}. ${targetEntry.card.name} was discarded.${toxicResult.triggered ? toxicResult.protected ? ` ${toxicResult.protectionSource === "poisonHeal" ? "Poison Heal" : `${attackerEntry.card.name}'s Toxic Immunity`} prevented Toxic.` : toxicDiscardedAttacker ? " Toxic coin flip: tails, so the opponent's consuming attacker was also discarded." : " Toxic coin flip: heads, so the opponent's attacker survived." : ""}${selfDiscardedAttacker ? toxicDiscardedAttacker ? ` ${attackerEntry.card.name}'s consume rule also required it to be discarded; it left play only once.` : ` ${attackerEntry.card.name}'s consume rule discarded it after eating an Apex or Predator.` : ""}${attackerEntry.attack.unsupportedDetails ? ` ${attackerEntry.attack.unsupportedDetails}` : ""}`,
    };
  }

  function runOpponentAttack(opponentState, currentPlayerCorals, currentPlayerReefEntries, currentPlayerOrphans, onPlayAttack = null, continuation = null, controllerState = {}) {
    let workingOpponent = normalizeProjectedOpponentState(reconcileOpponentInstances(opponentState, opponentState));
    let workingCorals = currentPlayerCorals;
    let workingReefInstances = reconcileCreatureZone(currentPlayerReefEntries, currentPlayerReefEntries, "player-reef");
    let workingOrphans = reconcileCreatureZone(currentPlayerOrphans, currentPlayerOrphans, "player-orphan");
    const normalizedOpeningBoard = reconcileFoundationHealthToFixedPoint(workingCorals, workingReefInstances, workingOrphans);
    workingCorals = normalizedOpeningBoard.corals;
    workingOrphans = normalizedOpeningBoard.orphans;
    let workingControllerRp = Number(controllerState.rp ?? rp);
    let workingBlueCrabRecycleUsedTurn = Object.prototype.hasOwnProperty.call(controllerState, "blueCrabRecycleUsedTurn")
      ? controllerState.blueCrabRecycleUsedTurn
      : blueCrabRecycleUsedTurn;
    const workingCreatureStatuses = controllerState.creatureStatuses ?? creatureStatuses;
    const baseResilienceUsedCardIds = controllerState.resilienceUsedCardIds ?? resilienceUsedCardIds;
    const excludedTargetIds = [...(continuation?.excludedTargetInstanceIds ?? [])];
    const attackOffset = Math.max(0, Number(continuation?.attackOffset ?? 0));
    const steps = [];
    const discardedCardIds = [];
    const opponentDiscardedCardIds = [];
    const playerResilienceUsedCardIds = [];
    let requiredAttacks = Math.max(1, Number(continuation?.remainingAttacks ?? 1));

    for (let attackNumber = 0; attackNumber < requiredAttacks; attackNumber += 1) {
      let step = runOpponentAttackStep(workingOpponent, workingCorals, workingReefInstances, workingOrphans, onPlayAttack, excludedTargetIds, {
        rp: workingControllerRp,
        creatureStatuses: workingCreatureStatuses,
        resilienceUsedCardIds: [...new Set([...baseResilienceUsedCardIds, ...playerResilienceUsedCardIds])],
        actionCostAlreadyPaid: Boolean(continuation),
      });
      if (!step) break;
      if (attackNumber === 0 && !continuation) {
        const attackEffect = onPlayAttack?.attack ?? getBasicAttackEffect(cardsById[step.attackerCardId]);
        requiredAttacks = getDynamicAttackRepeat(cardsById[step.attackerCardId], attackEffect, opponentState.corals, opponentState.reefCreatures, opponentState.habitats);
      }
      if (step.noLegalTarget && attackNumber > 0) break;
      if (step.targetInstanceId) excludedTargetIds.push(step.targetInstanceId);
      workingCorals = step.corals ?? workingCorals;
      workingReefInstances = step.reefCreatureInstances ?? reconcileCreatureZone(workingReefInstances, step.reefCreatures ?? workingReefInstances, "player-reef");
      workingOrphans = step.orphanCreatures ?? workingOrphans;
      const normalizedPlayerBoard = reconcileFoundationHealthToFixedPoint(workingCorals, workingReefInstances, workingOrphans);
      workingCorals = normalizedPlayerBoard.corals;
      workingOrphans = normalizedPlayerBoard.orphans;
      discardedCardIds.push(...(step.discardedCardIds ?? (step.discardedCardId ? [step.discardedCardId] : [])));
      if (step.opponentDiscardedCardId) opponentDiscardedCardIds.push(step.opponentDiscardedCardId);
      if (step.playerResilienceUsedCardId) playerResilienceUsedCardIds.push(step.playerResilienceUsedCardId);
      workingOpponent = reconcileOpponentInstances(workingOpponent, {
        ...workingOpponent,
        corals: step.opponentCorals ?? workingOpponent.corals,
        reefCreatures: step.opponentReefCreatures ?? workingOpponent.reefCreatures,
        reefCreatureInstances: step.opponentReefCreatureInstances ?? workingOpponent.reefCreatureInstances,
        orphanCreatures: step.opponentOrphanCreatures ?? workingOpponent.orphanCreatures,
      });
      if (step.targetInstanceId) {
        workingOpponent = { ...workingOpponent, poisonImmunityNextPredatorAttack: false };
      }
      workingOpponent = normalizeProjectedOpponentState(workingOpponent);
      const playerRpCapAfterStep = getEcosystemRpCap(workingCorals, [...playerHabitats, ...workingReefInstances.map((instance) => instance.cardId), ...workingOrphans.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])], activeCondition);
      const rpOverflowLost = Math.max(0, workingControllerRp - playerRpCapAfterStep);
      if (rpOverflowLost) {
        workingControllerRp = playerRpCapAfterStep;
        step = { ...step, playerRpAfter: workingControllerRp, playerRpCapOverflowLost: rpOverflowLost };
      }
      const defeatedCard = cardsById[step.discardedCardId];
      const blueCrabCanRecycle = Boolean(
        defeatedCard
          && defeatedCard.category === CardCategory.FISH
          && !isCreatureSchool(defeatedCard)
          && ecosystemHasCard(workingCorals, workingReefInstances.map((instance) => instance.cardId), "blue-crab", workingOrphans)
          && workingBlueCrabRecycleUsedTurn !== turn
      );
      if (blueCrabCanRecycle) {
        const nominalRecoveredRp = halfCostRoundedUp(defeatedCard.cost?.rp);
        const cap = getEcosystemRpCap(workingCorals, [...playerHabitats, ...workingReefInstances.map((instance) => instance.cardId), ...workingOrphans.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])], activeCondition);
        const rpBeforeRecycle = workingControllerRp;
        workingControllerRp = addResourceWithinCap(workingControllerRp, nominalRecoveredRp, cap);
        workingBlueCrabRecycleUsedTurn = turn;
        step = {
          ...step,
          playerBlueCrabRecoveredRp: workingControllerRp - rpBeforeRecycle,
          playerBlueCrabNominalRp: nominalRecoveredRp,
          playerRpAfter: workingControllerRp,
          playerBlueCrabRecycleUsedTurnAfter: workingBlueCrabRecycleUsedTurn,
        };
      }
      steps.push({ ...step, attackNumber: attackOffset + attackNumber + 1, requiredAttacks: attackOffset + requiredAttacks });
      if (step.pendingRegenerate) {
        const attackEffect = onPlayAttack?.attack ?? getBasicAttackEffect(cardsById[step.attackerCardId]);
        const remainingAttacks = requiredAttacks - attackNumber - 1;
        step.pendingRegenerate = {
          ...step.pendingRegenerate,
          continuation: remainingAttacks > 0 ? {
            remainingAttacks,
            attackOffset: attackOffset + attackNumber + 1,
            excludedTargetInstanceIds: [...excludedTargetIds],
            forcedAttack: {
              cardId: step.attackerCardId,
              coralId: step.pendingRegenerate.attackerLocation.coralId,
              slotId: step.pendingRegenerate.attackerLocation.slotId,
              reefInstanceId: step.pendingRegenerate.attackerLocation.reefInstanceId,
              orphanInstanceId: step.pendingRegenerate.attackerLocation.orphanInstanceId,
              attack: attackEffect,
            },
          } : null,
        };
        steps[steps.length - 1] = { ...step, attackNumber: attackOffset + attackNumber + 1, requiredAttacks: attackOffset + requiredAttacks };
        break;
      }
      if (step.opponentDiscardedCardId || step.noLegalTarget || step.resolutionUnsupported) break;
    }

    if (!steps.length) return null;
    const [firstStep] = steps;
    const lastStep = steps[steps.length - 1];
    const sequenceStoppedEarly = steps.length < requiredAttacks && !lastStep.pendingRegenerate && !lastStep.noLegalTarget && !lastStep.resolutionUnsupported;
    const summary = `${steps.map((step) => step.summary).join(" ")}${sequenceStoppedEarly ? " The repeated attack ended because the attacker left play or no different legal target remained." : ""}`;
    return {
      ...lastStep,
      corals: workingCorals,
      reefCreatures: workingReefInstances.map((instance) => instance.cardId),
      reefCreatureInstances: workingReefInstances,
      orphanCreatures: workingOrphans,
      opponentCorals: workingOpponent.corals,
      opponentReefCreatures: workingOpponent.reefCreatures,
      opponentReefCreatureInstances: workingOpponent.reefCreatureInstances,
      opponentOrphanCreatures: workingOpponent.orphanCreatures,
      opponentPoisonImmunityNextPredatorAttack: workingOpponent.poisonImmunityNextPredatorAttack,
      opponentDiscardedCardId: opponentDiscardedCardIds[0] ?? null,
      opponentDiscardedCardIds,
      discardedCardId: discardedCardIds[0] ?? null,
      discardedCardIds,
      attackerCardId: firstStep.attackerCardId,
      actionCost: firstStep.actionCost,
      opponentCooldownKey: firstStep.opponentCooldownKey,
      opponentAttackActionKey: firstStep.opponentAttackActionKey,
      playerResilienceUsedCardIds,
      playerRpAfter: workingControllerRp,
      playerBlueCrabRecycleUsedTurnAfter: workingBlueCrabRecycleUsedTurn,
      steps,
      summary,
    };
  }

  function buildOpponentAttackEventSequence(attackResult, initialPlayerState, initialOpponentState, { actionCostAlreadyPaid = false } = {}) {
    if (!attackResult) return { events: [], playerState: initialPlayerState, opponentState: initialOpponentState, summary: "" };
    let nextPlayer = normalizeProjectedPlayerState({ ...initialPlayerState });
    let nextOpponent = normalizeProjectedOpponentState(reconcileOpponentInstances(initialOpponentState, initialOpponentState));
    const events = [];
    const summaryParts = [];
    const steps = attackResult.steps ?? [attackResult];

    steps.forEach((step, stepIndex) => {
      const nextCorals = step.corals ?? nextPlayer.corals;
      const nextReefInstances = step.reefCreatureInstances
        ?? reconcileCreatureZone(nextPlayer.reefCreatureInstances, step.reefCreatures ?? nextPlayer.reefCreatureInstances, "player-reef");
      const nextOrphanInstances = step.orphanCreatures
        ? reconcileCreatureZone(nextPlayer.orphanCreatureInstances, step.orphanCreatures, "player-orphan")
        : nextPlayer.orphanCreatureInstances;
      let nextDiscardPile = nextPlayer.discardPile;
      let nextFoundationDeck = nextPlayer.foundationDeck;
      const stepExtras = [];
      const discardedIds = step.discardedCardIds ?? (step.discardedCardId ? [step.discardedCardId] : []);
      if (discardedIds.length) {
        nextDiscardPile = [...discardedIds, ...nextDiscardPile];
        const primaryDefeatedCard = cardsById[step.discardedCardId];
        if (cardHasPlenteous(primaryDefeatedCard) && nextDiscardPile.includes("krill-bloom-base")) {
          nextDiscardPile = removeOneCard(nextDiscardPile, "krill-bloom-base");
          nextFoundationDeck = shuffle([...nextFoundationDeck, "krill-bloom-base"]);
          stepExtras.push("Plenteous recycled a base Krill Bloom into your Foundation deck.");
        }
      }
      if (step.playerRpCapOverflowLost) {
        stepExtras.push(`Your RP bank cap fell and ${step.playerRpCapOverflowLost} excess RP was returned before any recovery was applied.`);
      }
      if (Object.prototype.hasOwnProperty.call(step, "playerBlueCrabRecoveredRp")) {
        stepExtras.push(step.playerBlueCrabRecoveredRp > 0
          ? `Blue Crab recycled ${step.playerBlueCrabRecoveredRp} RP (up to half the defeated Fish's cost, capped by your RP bank).`
          : `Blue Crab triggered, but your RP bank was already at its cap.`);
      }
      const occupiedSlotIds = new Set([
        ...nextCorals.flatMap((coral) => coral.slots.flatMap((slot) => slot.cardId ? [getSlotActionKey(slot), ...(slot.hostedCardIds ?? []).flatMap((cardId, hostedIndex) => cardId ? [getHostedTargetSlotId(slot.id, hostedIndex)] : [])] : [])),
        ...nextReefInstances.map((instance) => `reef-${instance.instanceId}`),
        ...nextOrphanInstances.map((instance) => `orphan-${instance.instanceId}`),
      ]);
      nextPlayer = {
        ...nextPlayer,
        corals: nextCorals,
        reefCreatureInstances: nextReefInstances,
        orphanCreatureInstances: nextOrphanInstances,
        discardPile: nextDiscardPile,
        foundationDeck: nextFoundationDeck,
        rp: step.playerRpAfter ?? nextPlayer.rp,
        blueCrabRecycleUsedTurn: step.playerBlueCrabRecycleUsedTurnAfter ?? nextPlayer.blueCrabRecycleUsedTurn,
        resilienceUsedCardIds: step.playerResilienceUsedCardId
          ? [...new Set([...nextPlayer.resilienceUsedCardIds, step.playerResilienceUsedCardId])]
          : nextPlayer.resilienceUsedCardIds,
        creatureStatuses: Object.fromEntries(Object.entries(nextPlayer.creatureStatuses).filter(([slotId]) => occupiedSlotIds.has(slotId))),
      };
      const playerProjection = projectNormalizedPlayerState(nextPlayer);
      nextPlayer = playerProjection.state;
      const playerCollateral = playerProjection.collateral;

      const normalizedOccupiedSlotIds = new Set([
        ...nextPlayer.corals.flatMap((coral) => coral.slots.flatMap((slot) => slot.cardId ? [getSlotActionKey(slot), ...(slot.hostedCardIds ?? []).flatMap((cardId, hostedIndex) => cardId ? [getHostedTargetSlotId(slot.id, hostedIndex)] : [])] : [])),
        ...nextPlayer.reefCreatureInstances.map((instance) => `reef-${instance.instanceId}`),
        ...nextPlayer.orphanCreatureInstances.map((instance) => `orphan-${instance.instanceId}`),
      ]);
      nextPlayer = {
        ...nextPlayer,
        creatureStatuses: Object.fromEntries(Object.entries(nextPlayer.creatureStatuses).filter(([slotId]) => normalizedOccupiedSlotIds.has(slotId))),
      };

      nextOpponent = reconcileOpponentInstances(nextOpponent, {
        ...nextOpponent,
        corals: step.opponentCorals ?? nextOpponent.corals,
        reefCreatures: step.opponentReefCreatures ?? nextOpponent.reefCreatures,
        reefCreatureInstances: step.opponentReefCreatureInstances ?? nextOpponent.reefCreatureInstances,
        orphanCreatures: step.opponentOrphanCreatures ?? nextOpponent.orphanCreatures,
      });
      if (step.opponentDiscardedCardId) {
        nextOpponent = { ...nextOpponent, discardPile: [step.opponentDiscardedCardId, ...nextOpponent.discardPile] };
      }
      if (stepIndex === 0 && !actionCostAlreadyPaid) {
        nextOpponent = {
          ...nextOpponent,
          rp: Math.max(0, nextOpponent.rp - Number(attackResult.actionCost ?? step.actionCost ?? 0)),
          actionCooldowns: attackResult.opponentCooldownKey
            ? { ...(nextOpponent.actionCooldowns ?? {}), [attackResult.opponentCooldownKey]: turn + 2 }
            : nextOpponent.actionCooldowns,
          actionUses: attackResult.opponentAttackActionKey
            ? markOpponentActionUsed(nextOpponent.actionUses, attackResult.opponentAttackActionKey, turn)
            : nextOpponent.actionUses,
        };
      }
      if (step.targetInstanceId) {
        nextOpponent = { ...nextOpponent, poisonImmunityNextPredatorAttack: false };
      }
      const opponentProjection = projectNormalizedOpponentState({ ...nextOpponent, rovLightsActive: false });
      nextOpponent = opponentProjection.state;
      const opponentCollateral = opponentProjection.collateral;

      const message = `${step.summary}${stepExtras.length ? ` ${stepExtras.join(" ")}` : ""}`;
      summaryParts.push(message);
      if (step.pendingRegenerate) {
        events.push({
          type: "choose-regenerate",
          sourceCardId: step.attackerCardId,
          defenderCardId: step.defenderCardId,
          title: `${cardsById[step.defenderCardId]?.name} Can Regenerate`,
          message: `${message} Choose whether to spend 1 RP to keep ${cardsById[step.defenderCardId]?.name} in play.`,
          regenerate: step.pendingRegenerate,
          success: false,
          playerStateAfter: nextPlayer,
          opponentStateAfter: nextOpponent,
          logMessage: message,
          opponentSequence: true,
        });
        return;
      }
      events.push({
        type: step.noLegalTarget ? "opponent-impact" : "faceoff-result",
        sourceCardId: step.counterCardId ?? step.eventSourceCardId ?? step.attackerCardId,
        defenderCardId: step.counterCardId ? step.attackerCardId : step.defenderCardId,
        title: step.resolutionUnsupported ? "Opponent Attack Could Not Resolve" : step.noLegalTarget ? "Opponent On Play Had No Target" : step.defenderEvaded ? "Your Creature Evaded" : step.counterSucceeded ? "Bite Back Counterattack!" : step.defenderSurvived ? "Your Defender Survived" : step.attackerWins ? `Opponent Attack ${step.attackNumber ?? 1} Succeeded` : `Your Creature Defended Attack ${step.attackNumber ?? 1}`,
        message,
        success: step.noLegalTarget ? false : step.counterCardId ? step.counterSucceeded : !step.attackerWins,
        playerStateAfter: nextPlayer,
        opponentStateAfter: nextOpponent,
        logMessage: message,
        opponentSequence: true,
      });
      const playerCollapseEvent = buildContinuousHealthCollapseEvent(playerCollateral, {
        sourceCardId: step.attackerCardId,
        playerStateAfter: nextPlayer,
        opponentStateAfter: nextOpponent,
        opponentSequence: true,
      });
      const opponentCollapseEvent = buildContinuousHealthCollapseEvent(opponentCollateral, {
        sourceCardId: step.counterCardId ?? step.defenderCardId,
        playerStateAfter: nextPlayer,
        opponentStateAfter: nextOpponent,
        opponentSequence: true,
      });
      [playerCollapseEvent, opponentCollapseEvent].filter(Boolean).forEach((collapseEvent) => {
        events.push(collapseEvent);
        summaryParts.push(collapseEvent.message);
      });
    });

    return { events, playerState: nextPlayer, opponentState: nextOpponent, summary: summaryParts.join(" ") };
  }

  function resolvePlayerRegenerateChoice(choice) {
    const pending = eventOverlay?.regenerate;
    if (eventOverlay?.type !== "choose-regenerate" || !pending) return;
    const resolution = resolveRegenerateDecision(pending.decision, choice);
    if (!resolution.resolved) return;
    const defender = cardsById[pending.toxicSourceCardId];
    const attacker = cardsById[pending.attackerCardId];
    const targetLocation = pending.targetLocation ?? {};
    let nextPlayerCorals = playerCorals;
    let nextPlayerReefInstances = playerReefCreatureInstances;
    let nextPlayerOrphans = playerOrphanCreatures;
    let nextPlayerHand = hand;
    let nextPlayerDiscardPile = discardPile;
    let nextPlayerFoundationDeck = foundationDeck;
    let nextPlayerRp = Math.max(0, rp - (resolution.keepDefender ? resolution.rpCost : 0));
    let nextBlueCrabRecycleUsedTurn = blueCrabRecycleUsedTurn;
    let nextOpponent = {
      ...opponent,
      poisonImmunityNextPredatorAttack: pending.opponentPoisonHealActive
        ? false
        : opponent.poisonImmunityNextPredatorAttack,
    };
    let toxicResult = { triggered: false, discardAttacker: false };
    let toxicMessage = "";
    let selfDiscardMessage = "";
    let attackerDiscardedAfterConsume = false;
    let recycleMessage = "";
    let regeneratePlayerCollateral = null;
    let regenerateOpponentCollateral = null;
    if (!resolution.keepDefender) {
      if (targetLocation.coralId) {
        nextPlayerCorals = playerCorals.map((coral) => coral.id === targetLocation.coralId ? {
          ...coral,
          slots: coral.slots.map((slot) => slot.id === targetLocation.slotId
            ? targetLocation.hostedIndex >= 0
              ? { ...slot, hostedCardIds: removeHostedCardAtIndex(slot.hostedCardIds, targetLocation.hostedIndex) }
              : { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] }
            : slot),
        } : coral);
      }
      if (targetLocation.reefInstanceId) {
        nextPlayerReefInstances = removeCreatureInstances(playerReefCreatureInstances, [targetLocation.reefInstanceId]).instances;
      }
      if (targetLocation.orphanInstanceId) {
        const removedEntry = playerOrphanCreatures.find((entry) => entry.instanceId === targetLocation.orphanInstanceId);
        nextPlayerOrphans = targetLocation.hostedIndex >= 0
          ? playerOrphanCreatures.map((entry) => entry.instanceId === targetLocation.orphanInstanceId
            ? { ...entry, hostedCardIds: removeHostedCardAtIndex(entry.hostedCardIds, targetLocation.hostedIndex) }
            : entry)
          : [
              ...playerOrphanCreatures.filter((entry) => entry.instanceId !== targetLocation.orphanInstanceId),
              ...(removedEntry?.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`player-orphan-${cardId}`))),
            ];
      }
      nextPlayerDiscardPile = [...(pending.discardedCardIds ?? []).filter(Boolean), ...nextPlayerDiscardPile];
      toxicResult = resolveToxicConsumption({ attackerCard: attacker, toxicSourceCard: defender, consumed: true, poisonHealActive: pending.opponentPoisonHealActive });
      const selfDiscardedAttacker = shouldSelfDiscardAfterConsume({ attackerCard: attacker, defenderCard: defender, consumed: true });
      attackerDiscardedAfterConsume = toxicResult.discardAttacker || selfDiscardedAttacker;
      if (toxicResult.triggered) {
        toxicMessage = toxicResult.protected
          ? ` ${toxicResult.protectionSource === "poisonHeal" ? "The opponent's Poison Heal" : `${attacker.name}'s Toxic Immunity`} prevented Toxic.`
          : toxicResult.discardAttacker ? " Toxic rolled tails, so the opponent's consuming attacker was also discarded." : " Toxic rolled heads, so the opponent's attacker survived.";
      }
      if (selfDiscardedAttacker) {
        selfDiscardMessage = toxicResult.discardAttacker
          ? ` ${attacker.name}'s consume rule also required it to be discarded; it left play only once.`
          : ` ${attacker.name}'s consume rule discarded it after eating an Apex or Predator.`;
      }
      if (attackerDiscardedAfterConsume) {
        if (pending.attackerLocation.coralId) {
          nextOpponent = { ...nextOpponent, corals: nextOpponent.corals.map((coral) => coral.id === pending.attackerLocation.coralId ? { ...coral, slots: coral.slots.map((slot) => slot.id === pending.attackerLocation.slotId ? { ...slot, cardId: null, cardInstanceId: null, hostedCardIds: [] } : slot) } : coral) };
        } else if (pending.attackerLocation.reefInstanceId) {
          const removed = removeCreatureInstances(nextOpponent.reefCreatureInstances ?? [], [pending.attackerLocation.reefInstanceId]);
          nextOpponent = { ...nextOpponent, reefCreatureInstances: removed.instances, reefCreatures: removed.instances.map((instance) => instance.cardId) };
        } else if (pending.attackerLocation.orphanInstanceId) {
          const removedEntry = nextOpponent.orphanCreatures.find((entry) => entry.instanceId === pending.attackerLocation.orphanInstanceId);
          nextOpponent = { ...nextOpponent, orphanCreatures: [...nextOpponent.orphanCreatures.filter((entry) => entry.instanceId !== pending.attackerLocation.orphanInstanceId), ...(removedEntry?.hostedCardIds ?? []).filter(Boolean).map((cardId) => createCreatureInstance(cardId, createStableInstanceId(`opponent-orphan-${cardId}`)))] };
        }
        nextOpponent = { ...nextOpponent, discardPile: [attacker.id, ...nextOpponent.discardPile] };
      }

      const recycleKrill = cardHasPlenteous(defender) && nextPlayerDiscardPile.includes("krill-bloom-base");
      if (recycleKrill) {
        nextPlayerDiscardPile = removeOneCard(nextPlayerDiscardPile, "krill-bloom-base");
        nextPlayerFoundationDeck = shuffle([...nextPlayerFoundationDeck, "krill-bloom-base"]);
        recycleMessage += " Plenteous recycled a base Krill Bloom into your Foundation deck.";
      }
      const stateBeforeBlueCrabProjection = projectNormalizedPlayerState({
        corals: nextPlayerCorals,
        reefCreatureInstances: nextPlayerReefInstances,
        orphanCreatureInstances: nextPlayerOrphans,
        hand: nextPlayerHand,
        discardPile: nextPlayerDiscardPile,
        foundationDeck: nextPlayerFoundationDeck,
        palsDeck,
        rp: nextPlayerRp,
        supportBlockedUntilRound,
        resilienceUsedCardIds,
        creatureStatuses,
        blueCrabRecycleUsedTurn: nextBlueCrabRecycleUsedTurn,
      });
      const stateBeforeBlueCrab = stateBeforeBlueCrabProjection.state;
      regeneratePlayerCollateral = stateBeforeBlueCrabProjection.collateral;
      const overflowLost = Math.max(0, nextPlayerRp - stateBeforeBlueCrab.rp);
      nextPlayerCorals = stateBeforeBlueCrab.corals;
      nextPlayerReefInstances = stateBeforeBlueCrab.reefCreatureInstances;
      nextPlayerOrphans = stateBeforeBlueCrab.orphanCreatureInstances;
      nextPlayerHand = stateBeforeBlueCrab.hand;
      nextPlayerDiscardPile = stateBeforeBlueCrab.discardPile;
      nextPlayerFoundationDeck = stateBeforeBlueCrab.foundationDeck;
      nextPlayerRp = stateBeforeBlueCrab.rp;
      if (overflowLost) recycleMessage += ` Your RP bank cap fell and ${overflowLost} excess RP was returned before Blue Crab resolved.`;
      const blueCrabCanRecycle = defender?.category === CardCategory.FISH
        && !isCreatureSchool(defender)
        && ecosystemHasCard(nextPlayerCorals, nextPlayerReefInstances.map((instance) => instance.cardId), "blue-crab", nextPlayerOrphans)
        && nextBlueCrabRecycleUsedTurn !== turn;
      if (blueCrabCanRecycle) {
        const nominalRecoveredRp = halfCostRoundedUp(defender.cost?.rp);
        const cap = getEcosystemRpCap(nextPlayerCorals, [...playerHabitats, ...nextPlayerReefInstances.map((instance) => instance.cardId), ...nextPlayerOrphans.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])], activeCondition);
        const rpBeforeRecycle = nextPlayerRp;
        nextPlayerRp = addResourceWithinCap(nextPlayerRp, nominalRecoveredRp, cap);
        const actualRecoveredRp = nextPlayerRp - rpBeforeRecycle;
        nextBlueCrabRecycleUsedTurn = turn;
        recycleMessage += actualRecoveredRp > 0
          ? ` Blue Crab recycled ${actualRecoveredRp} RP before the bank cap.`
          : " Blue Crab triggered, but your RP bank was already at its cap.";
      }
    }

    const occupiedSlotIds = new Set([
      ...nextPlayerCorals.flatMap((coral) => coral.slots.flatMap((slot) => slot.cardId ? [getSlotActionKey(slot), ...(slot.hostedCardIds ?? []).flatMap((cardId, hostedIndex) => cardId ? [getHostedTargetSlotId(slot.id, hostedIndex)] : [])] : [])),
      ...nextPlayerReefInstances.map((instance) => `reef-${instance.instanceId}`),
      ...nextPlayerOrphans.map((instance) => `orphan-${instance.instanceId}`),
    ]);
    const choicePlayerState = normalizeProjectedPlayerState({
      corals: nextPlayerCorals,
      reefCreatureInstances: nextPlayerReefInstances,
      orphanCreatureInstances: nextPlayerOrphans,
      hand: nextPlayerHand,
      discardPile: nextPlayerDiscardPile,
      foundationDeck: nextPlayerFoundationDeck,
      palsDeck,
      rp: nextPlayerRp,
      supportBlockedUntilRound,
      resilienceUsedCardIds,
      creatureStatuses: Object.fromEntries(Object.entries(creatureStatuses).filter(([slotId]) => occupiedSlotIds.has(slotId))),
      blueCrabRecycleUsedTurn: nextBlueCrabRecycleUsedTurn,
    });
    const choiceOpponentProjection = projectNormalizedOpponentState(reconcileOpponentInstances(opponent, nextOpponent));
    const choiceOpponentState = choiceOpponentProjection.state;
    regenerateOpponentCollateral = choiceOpponentProjection.collateral;

    const continuation = !attackerDiscardedAfterConsume ? pending.continuation : null;
    const continuationResult = continuation ? runOpponentAttack(
      choiceOpponentState,
      choicePlayerState.corals,
      choicePlayerState.reefCreatureInstances,
      choicePlayerState.orphanCreatureInstances,
      continuation.forcedAttack,
      continuation,
      {
        rp: choicePlayerState.rp,
        blueCrabRecycleUsedTurn: choicePlayerState.blueCrabRecycleUsedTurn,
        creatureStatuses: choicePlayerState.creatureStatuses,
        resilienceUsedCardIds: choicePlayerState.resilienceUsedCardIds,
      },
    ) : null;
    const continuationResolution = continuationResult
      ? buildOpponentAttackEventSequence(continuationResult, choicePlayerState, choiceOpponentState, { actionCostAlreadyPaid: true })
      : { events: [], playerState: choicePlayerState, opponentState: choiceOpponentState, summary: "" };
    const remainingRegenerate = continuationResolution.events.some((event) => event.type === "choose-regenerate");
    const maintenanceEvents = [];
    let finalOpponentState = normalizeProjectedOpponentState(continuationResolution.opponentState);
    if (!remainingRegenerate) {
      const maintenance = resolveEndOfTurnHabitatMaintenance(finalOpponentState.habitatInstances, {
        cardsInPlay: getCardsInPlayForComposition(finalOpponentState.corals, finalOpponentState.reefCreatures, finalOpponentState.orphanCreatures),
        cardLookup: cardsById,
        habitatLookup: cardsById,
      });
      maintenance.events.forEach((event) => {
        const maintenanceMessage = event.destroyed
          ? `Opponent's ${cardsById[event.cardId]?.name} took ${event.appliedDamage} end-of-turn damage and was destroyed.`
          : `Opponent's ${cardsById[event.cardId]?.name} took ${event.appliedDamage} end-of-turn damage. ${event.currentHealth} HP remains.`;
        const nextHabitats = event.destroyed
          ? finalOpponentState.habitatInstances.filter((habitat) => habitat.instanceId !== event.instanceId)
          : finalOpponentState.habitatInstances.map((habitat) => habitat.instanceId === event.instanceId ? { ...habitat, currentHealth: event.currentHealth } : habitat);
        finalOpponentState = {
          ...finalOpponentState,
          habitats: nextHabitats.map((habitat) => habitat.cardId),
          habitatInstances: nextHabitats,
          discardPile: event.destroyed ? [event.cardId, ...finalOpponentState.discardPile] : finalOpponentState.discardPile,
        };
        maintenanceEvents.push({ type: "opponent-impact", sourceCardId: event.cardId, title: event.destroyed ? "Opponent Habitat Destroyed" : "Opponent Habitat Deteriorated", message: maintenanceMessage, success: event.destroyed, opponentStateAfter: finalOpponentState, logMessage: maintenanceMessage, opponentSequence: true });
      });
    }

    const message = resolution.keepDefender
      ? `You chose Regenerate and paid ${resolution.rpCost} RP. ${defender.name} remains in play.`
      : `You declined Regenerate. ${defender.name} was discarded.${toxicMessage}${selfDiscardMessage}${recycleMessage}`;
    const regenerateCollapseEvents = [
      buildContinuousHealthCollapseEvent(regeneratePlayerCollateral, {
        sourceCardId: attacker?.id,
        playerStateAfter: choicePlayerState,
        opponentStateAfter: choiceOpponentState,
        opponentSequence: true,
      }),
      buildContinuousHealthCollapseEvent(regenerateOpponentCollateral, {
        sourceCardId: defender?.id,
        playerStateAfter: choicePlayerState,
        opponentStateAfter: choiceOpponentState,
        opponentSequence: true,
      }),
    ].filter(Boolean);
    const postChoicePlayerState = normalizeProjectedPlayerState(continuationResolution.playerState);
    const postChoicePlayerVp = getEcosystemVictoryPoints(
      postChoicePlayerState.corals,
      playerHabitats,
      [
        ...postChoicePlayerState.reefCreatureInstances.map((instance) => instance.cardId),
        ...postChoicePlayerState.orphanCreatureInstances.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])]),
      ],
    );
    const postChoiceOpponentVp = getEcosystemVictoryPoints(finalOpponentState.corals, finalOpponentState.habitats, [...finalOpponentState.reefCreatures, ...(finalOpponentState.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])]);
    const postChoiceVictoryResult = remainingRegenerate ? null : determineVictoryResult(postChoicePlayerVp, postChoiceOpponentVp, victoryTarget);
    setPendingEvents((current) => {
      const extraSummaryActions = [
        message,
        ...regenerateCollapseEvents.map((event) => event.message),
        ...splitTurnActionLines(continuationResolution.summary),
        ...maintenanceEvents.map((event) => event.message),
      ];
      const updatedEvents = current.map((event) => event.type === "turn-transition"
        ? {
            ...event,
            actions: extraSummaryActions.length ? [...(event.actions ?? []), ...extraSummaryActions] : event.actions,
            opponentStateAfter: finalOpponentState,
            gameResultAfter: event.gameResultAfter ?? postChoiceVictoryResult?.message ?? null,
          }
        : event);
      const transitionIndex = updatedEvents.findIndex((event) => event.type === "turn-transition");
      const insertionIndex = transitionIndex < 0 ? updatedEvents.length : transitionIndex;
      return [
        ...updatedEvents.slice(0, insertionIndex),
        ...regenerateCollapseEvents,
        ...continuationResolution.events,
        ...maintenanceEvents,
        ...updatedEvents.slice(insertionIndex),
      ];
    });
    setEventOverlay({
      ...eventOverlay,
      type: "faceoff-result",
      title: resolution.keepDefender ? "Regenerate Chosen" : "Regenerate Declined",
      message,
      success: resolution.keepDefender,
      regenerate: null,
      playerStateAfter: choicePlayerState,
      opponentStateAfter: choiceOpponentState,
      logMessage: message,
    });
  }

  function endTurn() {
    if (isSetup) {
      beginFirstRound();
      return;
    }
    if (isStartOfTurn) {
      pushLog("You must choose a personal deck and draw before ending your turn.");
      return;
    }
    if (opponentThinking) return;
    if (playingCardId || attackContext || searchContext || pendingCreatureAction) {
      pushLog("Finish or cancel your current placement, attack, or card effect before ending your turn.");
      return;
    }
    const boardComplexity = playerCorals.length + opponentCorals.length + playerReefCreatures.length + opponent.reefCreatures.length + playerOrphanCreatures.length + (opponent.orphanCreatures?.length ?? 0);
    const endgameDecision = playerVp >= victoryTarget - 8 || opponentVp >= victoryTarget - 8;
    const thinkingDelay = Math.min(5200, 1100 + boardComplexity * 140 + (endgameDecision ? 1400 : 0));
    const habitatMaintenance = resolvePlayerEndOfTurnHabitats();
    const actions = [...turnLog, ...(habitatMaintenance.messages ?? [])].filter(Boolean);
    setGamePhase("transition");
    setModal(null);
    setEventOverlay({
      type: "turn-transition",
      title: "Opponent's Turn",
      message: "Your turn is complete.",
      actions: actions.length ? actions : ["You ended your turn without taking an action."],
      beginOpponentAfterClose: true,
      thinkingDelay,
    });
  }

  function resolveOpponentTurn() {
    setOpponentThinking(false);
    setEventOverlay(null);
    const turnEvents = [];
    let stagedPlayerState = normalizeProjectedPlayerState({
      corals: playerCorals,
      reefCreatureInstances: playerReefCreatureInstances,
      orphanCreatureInstances: playerOrphanCreatureInstances,
      hand,
      discardPile,
      foundationDeck,
      palsDeck,
      rp,
      supportBlockedUntilRound,
      resilienceUsedCardIds,
      creatureStatuses,
      blueCrabRecycleUsedTurn,
    });
    const stagePlayerState = (updates) => {
      stagedPlayerState = normalizeProjectedPlayerState({ ...stagedPlayerState, ...updates });
      return stagedPlayerState;
    };
    const opponentParasiteRequestedRp = getParasiteRequestedRp(
      opponent.corals,
      opponent.reefCreatures,
      opponent.orphanCreatures,
      playerCorals,
      playerReefCreatures,
      playerOrphanCreatures,
    );
    const opponentStartCap = getEcosystemRpCap(opponent.corals, [
      ...opponent.habitats,
      ...opponent.reefCreatures,
      ...(opponent.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])]),
    ], activeCondition);
    const opponentParasiteTransfer = resolveResourceTransfer({
      requested: opponentParasiteRequestedRp,
      sourceAmount: stagedPlayerState.rp,
      recipientAmount: opponent.rp,
      recipientCap: opponentStartCap,
    });
    const opponentParasiteMessage = describeParasiteTransfer("Opponent's Cookie Cutter", opponentParasiteTransfer);
    const opponentForTurn = opponentParasiteRequestedRp
      ? { ...opponent, rp: opponentParasiteTransfer.recipientAfter }
      : opponent;
    const playerStateAfterOpponentParasite = opponentParasiteRequestedRp
      ? stagePlayerState({ rp: opponentParasiteTransfer.sourceAfter })
      : stagedPlayerState;
    const opponentResult = runOpponentTurn(opponentForTurn);
    const opponentStateAfterPlay = normalizeProjectedOpponentState(reconcileOpponentInstances(opponent, opponentResult.state));
    const opponentVpAfterPlay = getEcosystemVictoryPoints(opponentStateAfterPlay.corals, opponentStateAfterPlay.habitats, [...opponentStateAfterPlay.reefCreatures, ...(opponentStateAfterPlay.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])]);
    const opponentReachedVictoryOnPlay = opponentVpAfterPlay >= victoryTarget;
    if (opponentParasiteRequestedRp) {
      turnEvents.push({
        type: "opponent-impact",
        sourceCardId: "cookie-cutter-shark",
        title: "Opponent's Cookie Cutter used Parasite",
        message: opponentParasiteMessage,
        success: opponentParasiteTransfer.transferred > 0,
        playerStateAfter: playerStateAfterOpponentParasite,
        opponentStateAfter: normalizeProjectedOpponentState(reconcileOpponentInstances(opponent, opponentForTurn)),
        logMessage: opponentParasiteMessage,
      });
    }
    if (opponentResult.startOfTurnState) {
      turnEvents.push({
        type: "opponent-status",
        title: "Opponent Starts Turn",
        message: opponentResult.startOfTurnSummary,
        turnCollection: opponentResult.startOfTurnDetails,
        success: true,
        opponentStateAfter: opponentResult.startOfTurnState,
        logMessage: opponentResult.startOfTurnSummary,
      });
    }
    const opponentRandomDiscardIds = opponentResult.randomDiscard ? shuffle(hand).slice(0, opponentResult.randomDiscard.amount) : [];
    const opponentDeckDiscardIds = opponentResult.deckDiscard ? [...palsDeck, ...foundationDeck].slice(0, opponentResult.deckDiscard.amount) : [];
    const supportTargetCoral = playerCoralCards[0] ?? null;
    const supportImpactStages = [];
    let playerCoralsAfterSupports = playerCorals;
    (opponentResult.supportImpacts ?? []).forEach((impact) => {
      if (!supportTargetCoral) return;
      playerCoralsAfterSupports = playerCoralsAfterSupports.map((coral) => coral.id === supportTargetCoral.id ? {
        ...coral,
        rpPenaltyNextTurn: Number(coral.rpPenaltyNextTurn ?? 0) + Number(impact.rpPenalty ?? 0),
      } : coral);
      supportImpactStages.push({ impact, playerStateAfter: stagePlayerState({ corals: playerCoralsAfterSupports }) });
    });
    const playerStateAfterSupportBlock = opponentResult.supportBlock
      ? stagePlayerState({ supportBlockedUntilRound: round + 1 })
      : stagedPlayerState;
    let playerStateAfterDeckDiscard = stagedPlayerState;
    if (opponentDeckDiscardIds.length) {
      const palsCount = Math.min(opponentResult.deckDiscard.amount, stagedPlayerState.palsDeck.length);
      const foundationCount = Math.min(opponentResult.deckDiscard.amount - palsCount, stagedPlayerState.foundationDeck.length);
      playerStateAfterDeckDiscard = stagePlayerState({
        palsDeck: stagedPlayerState.palsDeck.slice(palsCount),
        foundationDeck: stagedPlayerState.foundationDeck.slice(foundationCount),
        discardPile: [...opponentDeckDiscardIds, ...stagedPlayerState.discardPile],
      });
    }
    let playerStateAfterRandomDiscard = stagedPlayerState;
    if (opponentRandomDiscardIds.length) {
      playerStateAfterRandomDiscard = stagePlayerState({
        hand: opponentRandomDiscardIds.reduce((cards, cardId) => removeOneCard(cards, cardId), stagedPlayerState.hand),
        discardPile: [...opponentRandomDiscardIds, ...stagedPlayerState.discardPile],
      });
    }
    const currentHandLimit = Number((activeCondition?.effects ?? []).find((effect) => effect.type === "setHandLimit")?.amount ?? Infinity);
    const coralDamageResult = opponentResult.lost ? null : applyOpponentFoundationDamage(playerCoralsAfterSupports, stagedPlayerState.orphanCreatureInstances, opponentResult.foundationDamage, opponentResult.damageSourceName, stagedPlayerState.hand, stagedPlayerState.discardPile, currentHandLimit);
    let coralDamageSummary = "";
    let coralDamageCollateral = null;
    let playerStateAfterCoralDamage = stagedPlayerState;
    if (coralDamageResult) {
      const orphanCreatureInstances = reconcileCreatureZone(stagedPlayerState.orphanCreatureInstances, coralDamageResult.orphanCreatures ?? stagedPlayerState.orphanCreatureInstances, "player-orphan");
      const coralDamageProjection = projectNormalizedPlayerState({
        ...stagedPlayerState,
        corals: coralDamageResult.corals,
        orphanCreatureInstances,
        hand: coralDamageResult.hand ?? stagedPlayerState.hand,
        discardPile: coralDamageResult.discardPile ?? stagedPlayerState.discardPile,
      });
      playerStateAfterCoralDamage = coralDamageProjection.state;
      coralDamageCollateral = coralDamageProjection.collateral;
      stagedPlayerState = playerStateAfterCoralDamage;
      coralDamageSummary = coralDamageResult.summary;
    }
    const playerCoralsAfterDamage = playerStateAfterCoralDamage.corals ?? playerCoralsAfterSupports;
    const opponentUtilities = opponentResult.lost || opponentReachedVictoryOnPlay || opponentResult.onPlayAttack?.attack ? null : runOpponentUtilityActions(opponentStateAfterPlay, playerStateAfterCoralDamage);
    const opponentStateAfterUtility = opponentUtilities?.state ?? opponentStateAfterPlay;
    const playerStateAfterUtility = opponentUtilities?.actions.length ? stagePlayerState(opponentUtilities.playerState) : stagedPlayerState;
    const playerCoralsBeforeAttack = playerStateAfterUtility.corals ?? playerCoralsAfterDamage;
    const opponentLostAfterUtility = opponentResult.lost || Boolean(opponentUtilities?.lost);
    const opponentAttack = opponentLostAfterUtility || (opponentReachedVictoryOnPlay && !opponentResult.onPlayAttack?.attack) ? null : runOpponentAttack(
      opponentStateAfterUtility,
      playerCoralsBeforeAttack,
      playerStateAfterUtility.reefCreatureInstances,
      playerStateAfterUtility.orphanCreatureInstances,
      opponentResult.onPlayAttack?.attack ? opponentResult.onPlayAttack : null,
      null,
      {
        rp: playerStateAfterUtility.rp,
        blueCrabRecycleUsedTurn: playerStateAfterUtility.blueCrabRecycleUsedTurn,
        creatureStatuses: playerStateAfterUtility.creatureStatuses,
        resilienceUsedCardIds: playerStateAfterUtility.resilienceUsedCardIds,
      },
    );
    const opponentAttackResolution = opponentAttack
      ? buildOpponentAttackEventSequence(opponentAttack, stagedPlayerState, opponentStateAfterUtility)
      : { events: [], playerState: stagedPlayerState, opponentState: { ...opponentStateAfterUtility, rovLightsActive: false }, summary: "" };
    if (opponentAttack) stagePlayerState(opponentAttackResolution.playerState);
    const opponentStateAfterAttack = opponentAttackResolution.opponentState;
    const opponentStateWithInstances = normalizeProjectedOpponentState(reconcileOpponentInstances(opponent, opponentStateAfterAttack));
    const opponentVpAfterMandatoryResolution = getEcosystemVictoryPoints(opponentStateWithInstances.corals, opponentStateWithInstances.habitats, [...opponentStateWithInstances.reefCreatures, ...(opponentStateWithInstances.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])]);
    const opponentVictoryLocked = !opponentLostAfterUtility && opponentReachedVictoryOnPlay && opponentVpAfterMandatoryResolution >= victoryTarget;
    const hasPendingRegenerate = opponentAttackResolution.events.some((event) => event.type === "choose-regenerate");
    const opponentHabitatMaintenance = hasPendingRegenerate || opponentLostAfterUtility || opponentVictoryLocked ? {
      habitats: opponentStateWithInstances.habitatInstances,
      destroyedHabitats: [],
      events: [],
    } : resolveEndOfTurnHabitatMaintenance(opponentStateWithInstances.habitatInstances, {
      cardsInPlay: getCardsInPlayForComposition(opponentStateWithInstances.corals, opponentStateWithInstances.reefCreatures, opponentStateWithInstances.orphanCreatures),
      cardLookup: cardsById,
      habitatLookup: cardsById,
    });
    let finalOpponentState = opponentStateWithInstances;
    const habitatTurnEvents = [];
    opponentHabitatMaintenance.events.forEach((event) => {
      const message = event.destroyed
        ? `Opponent's ${cardsById[event.cardId]?.name} took ${event.appliedDamage} end-of-turn damage because its ecosystem requirement was not met and was destroyed.`
        : `Opponent's ${cardsById[event.cardId]?.name} took ${event.appliedDamage} end-of-turn damage because its ecosystem requirement was not met. ${event.currentHealth} HP remains.`;
      const nextHabitats = event.destroyed
        ? finalOpponentState.habitatInstances.filter((habitat) => habitat.instanceId !== event.instanceId)
        : finalOpponentState.habitatInstances.map((habitat) => habitat.instanceId === event.instanceId ? { ...habitat, currentHealth: event.currentHealth } : habitat);
      finalOpponentState = {
        ...finalOpponentState,
        habitats: nextHabitats.map((habitat) => habitat.cardId),
        habitatInstances: nextHabitats,
        discardPile: event.destroyed ? [event.cardId, ...finalOpponentState.discardPile] : finalOpponentState.discardPile,
      };
      habitatTurnEvents.push({ type: "opponent-impact", sourceCardId: event.cardId, title: event.destroyed ? "Opponent Habitat Destroyed" : "Opponent Habitat Deteriorated", message, success: event.destroyed, opponentStateAfter: finalOpponentState, logMessage: message });
    });
    if (!opponentHabitatMaintenance.events.length) {
      finalOpponentState = {
        ...finalOpponentState,
        habitats: opponentHabitatMaintenance.habitats.map((habitat) => habitat.cardId),
        habitatInstances: opponentHabitatMaintenance.habitats,
        discardPile: [...opponentHabitatMaintenance.destroyedHabitats.map((habitat) => habitat.cardId), ...finalOpponentState.discardPile],
      };
    }

    const supportImpactEvents = supportImpactStages.map(({ impact, playerStateAfter }) => {
      const message = `Opponent played ${cardsById[impact.sourceCardId]?.name}; your ${cardsById[supportTargetCoral.cardId]?.name} will produce ${impact.rpPenalty} less RP during its next collection.`;
      return { type: "opponent-impact", sourceCardId: impact.sourceCardId, defenderCardId: supportTargetCoral.cardId, title: `Opponent's ${cardsById[impact.sourceCardId]?.name} used ${impact.actionName}`, message, success: true, playerStateAfter, logMessage: message };
    });
    const remainingSupportImpacts = [...supportImpactEvents];
    (opponentResult.supportPlays ?? []).forEach((supportEvent) => {
      turnEvents.push({ ...supportEvent, logMessage: supportEvent.message });
      const matchingImpactIndex = remainingSupportImpacts.findIndex((impactEvent) => impactEvent.sourceCardId === supportEvent.sourceCardId);
      if (matchingImpactIndex >= 0) turnEvents.push(...remainingSupportImpacts.splice(matchingImpactIndex, 1));
    });
    turnEvents.push(...remainingSupportImpacts);
    if (opponentResult.playedCardId) {
      const message = `${opponentResult.playSummary}${opponentResult.onPlayRevealedCardIds?.length ? " Its searched card selection is revealed below." : ""}`;
      turnEvents.push({ type: "opponent-play", sourceCardId: opponentResult.playedCardId, title: `Opponent played ${cardsById[opponentResult.playedCardId]?.name}`, message, revealedCards: opponentResult.onPlayRevealedCardIds ?? [], success: true, opponentStateAfter: opponentStateAfterPlay, logMessage: message });
    }
    if (opponentResult.supportBlock) {
      const message = `Opponent's ${opponentResult.damageSourceName} used ${opponentResult.supportBlock.actionName}. You cannot play Support cards during your next turn.`;
      turnEvents.push({ type: "opponent-impact", sourceCardId: opponentResult.damageSourceCardId, title: `Opponent's ${opponentResult.damageSourceName} used ${opponentResult.supportBlock.actionName}`, message, success: true, playerStateAfter: playerStateAfterSupportBlock, logMessage: message });
    }
    if (opponentDeckDiscardIds.length) {
      const names = opponentDeckDiscardIds.map((cardId) => cardsById[cardId]?.name ?? cardId).join(", ");
      const message = `Opponent's ${opponentResult.damageSourceName} discarded ${names} from the top of your personal decks (Pals first).`;
      turnEvents.push({ type: "opponent-impact", sourceCardId: opponentResult.damageSourceCardId, defenderCardId: opponentDeckDiscardIds[0], title: `Opponent's ${opponentResult.damageSourceName} used ${opponentResult.deckDiscard.actionName}`, message, success: true, playerStateAfter: playerStateAfterDeckDiscard, logMessage: message });
    }
    if (opponentRandomDiscardIds.length) {
      const names = opponentRandomDiscardIds.map((cardId) => cardsById[cardId]?.name ?? cardId).join(", ");
      const message = `Opponent's ${opponentResult.damageSourceName} discarded ${names} at random from your hand.`;
      turnEvents.push({ type: "opponent-impact", sourceCardId: opponentResult.damageSourceCardId, defenderCardId: opponentRandomDiscardIds[0], title: `Opponent's ${opponentResult.damageSourceName} used ${opponentResult.randomDiscard.actionName}`, message, success: true, playerStateAfter: playerStateAfterRandomDiscard, logMessage: message });
    }
    if (coralDamageResult) {
      turnEvents.push({
        type: "opponent-impact",
        sourceCardId: opponentResult.damageSourceCardId,
        title: `Opponent's ${opponentResult.damageSourceName} used ${opponentResult.foundationDamage?.actionName ?? getOnPlayAbilityName(cardsById[opponentResult.damageSourceCardId])}`,
        message: coralDamageSummary,
        success: coralDamageResult.discardedCardIds.length > 0,
        playerStateAfter: playerStateAfterCoralDamage,
        logMessage: coralDamageSummary,
      });
      const collapseEvent = buildContinuousHealthCollapseEvent(coralDamageCollateral, {
        sourceCardId: opponentResult.damageSourceCardId,
        playerStateAfter: playerStateAfterCoralDamage,
        opponentSequence: true,
      });
      if (collapseEvent) turnEvents.push(collapseEvent);
    }
    (opponentUtilities?.actions ?? []).forEach((opponentUtility) => {
      const message = `${opponentUtility.summary}${opponentUtility.revealedCards?.length ? " The searched card is revealed below." : ""}`;
      turnEvents.push({ type: "utility-result", sourceCardId: opponentUtility.sourceCardId, defenderCardId: opponentUtility.defenderCardId, title: `Opponent's ${cardsById[opponentUtility.sourceCardId]?.name} used ${opponentUtility.actionName}`, message, revealedCards: opponentUtility.revealedCards ?? [], success: opponentUtility.success !== false, opponentStateAfter: opponentUtility.state, playerStateAfter: opponentUtility.playerState, logMessage: message });
    });
    turnEvents.push(...opponentAttackResolution.events);
    const opponentSummary = [opponentParasiteMessage, opponentResult.summary, coralDamageResult?.summary, getContinuousHealthCollapseMessage(coralDamageCollateral), opponentUtilities?.summary, opponentAttackResolution.summary, ...habitatTurnEvents.map((event) => event.message)].filter(Boolean).join(" ");
    turnEvents.push(...habitatTurnEvents);
    const normalizedFinalPlayerState = normalizeProjectedPlayerState(stagedPlayerState);
    const finalPlayerVp = getEcosystemVictoryPoints(
      normalizedFinalPlayerState.corals,
      playerHabitats,
      [
        ...normalizedFinalPlayerState.reefCreatureInstances.map((instance) => instance.cardId),
        ...normalizedFinalPlayerState.orphanCreatureInstances.flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])]),
      ],
    );
    const finalOpponentVp = getEcosystemVictoryPoints(finalOpponentState.corals, finalOpponentState.habitats, [...finalOpponentState.reefCreatures, ...(finalOpponentState.orphanCreatures ?? []).flatMap((entry) => [entry.cardId, ...(entry.hostedCardIds ?? [])])]);
    const stagedVictoryResult = hasPendingRegenerate ? null : determineVictoryResult(finalPlayerVp, finalOpponentVp, victoryTarget);
    turnEvents.push({
      type: "turn-transition",
      title: "Your Turn",
      message: "The opponent's turn is complete.",
      actions: splitTurnActionLines(opponentSummary),
      advanceRoundAfterClose: true,
      opponentStateAfter: finalOpponentState,
      gameResultAfter: opponentLostAfterUtility ? "Victory: the opponent could not complete a required draw from its personal decks." : opponentVictoryLocked ? `Defeat: the opponent was first to reach ${victoryTarget} VP.` : stagedVictoryResult?.message ?? null,
    });
    queueEvents(turnEvents.map((event) => ({ ...event, opponentSequence: true })));
  }

  function restartGame(deckId = selectedDeckId, opponentDeckId = selectedOpponentDeckId, nextVictoryTarget = pendingVictoryTarget, nextOpponentDifficulty = pendingOpponentDifficulty) {
    const nextGame = createInitialGameState(deckId, opponentDeckId);
    const deckName = prebuiltDecks.find((deck) => deck.id === deckId)?.name ?? deckId;
    const opponentDeckName = prebuiltDecks.find((deck) => deck.id === opponentDeckId)?.name ?? opponentDeckId;
    const normalizedDifficulty = normalizeOpponentDifficulty(nextOpponentDifficulty);
    const difficultyLabel = getOpponentDifficultyProfile(normalizedDifficulty).label;
    setSelectedDeckId(deckId);
    setSelectedOpponentDeckId(opponentDeckId);
    setOpponentDifficulty(normalizedDifficulty);
    setPendingOpponentDifficulty(normalizedDifficulty);
    setVictoryTarget(nextVictoryTarget);
    setPendingVictoryTarget(nextVictoryTarget);
    setFoundationDeck(nextGame.foundationDeck);
    setPalsDeck(nextGame.palsDeck);
    setHand(nextGame.hand);
    setPlayerCorals([]);
    setBubbleBursts([]);
    setPlayerHabitats([]);
    setPlayerReefCreatures([]);
    setPlayerOrphanCreatures([]);
    setOpponent(nextGame.opponent);
    setOpponentThinking(false);
    if (opponentThinkingTimerRef.current) clearTimeout(opponentThinkingTimerRef.current);
    opponentThinkingTimerRef.current = null;
    setDiscardPile([]);
    setLostZone([]);
    setConditionDeck(nextGame.conditionDeck);
    setActiveConditionId(null);
    setPersistentConditionIds([]);
    setConditionDensityUses({});
    setBlueCrabRecycleUsedTurn(null);
    setResilienceUsedCardIds([]);
    setRound(0);
    setGamePhase("setup");
    setTurn(1);
    setRp(3);
    setHasDrawnThisTurn(false);
    setTurnDrawSelection(null);
    setTurnDrawResult(null);
    setModal(null);
    setSelectedHandCard(null);
    setHandPopoverCardId(null);
    setPlayingCardId(null);
    setUsedAttackers([]);
    setActionCooldowns({});
    setSupportLockSourceId(null);
    setSupportBlockedUntilRound(0);
    setUsedCreatureActions([]);
    setPendingCreatureAction(null);
    setCreatureStatuses({});
    setPoisonImmunityNextPredatorAttack(false);
    setRovLightsActive(false);
    setNextOnPlayAttackBonus(null);
    setAttackContext(null);
    setSearchContext(null);
    setGameResult(null);
    setInspectedCard(null);
    setEventOverlay({
      type: "round-transition",
      title: "Setup Round",
      message: "Build the foundation of your ecosystem. You have 3 RP and eight opening cards: play a valid base Coral or Creature School, then begin Round 1 when your foundation is ready.",
      success: true,
    });
    setPendingEvents([]);
    setFaceoffRolling(false);
    setFaceoffPreview(null);
    setTurnLog(["Setup began with 3 RP and an eight-card hand."]);
    setPlayError("");
    setEcosystemZoom(1);
    setEcosystemOffset({ x: 0, y: 0 });
    setOpponentEcosystemZoom(1);
    setOpponentEcosystemOffset({ x: 0, y: 0 });
    setOpponentViewportTouched(false);
    setFloatingCardOffsets({});
    setFloatingCardDrag(null);
    const unavailablePlayerCards = getUnavailableDeckEntries(deckId);
    const unavailableOpponentCards = getUnavailableDeckEntries(opponentDeckId);
    const unavailableWarnings = [
      unavailablePlayerCards.length ? `Deck data warning: ${unavailablePlayerCards.map((entry) => `${entry.unavailableName ?? entry.cardId} ×${entry.quantity}`).join(", ")} ${unavailablePlayerCards.length === 1 ? "is" : "are"} listed in your deck but have no card rules in the repository, so those copies are excluded.` : null,
      unavailableOpponentCards.length ? `Opponent deck data warning: ${unavailableOpponentCards.map((entry) => `${entry.unavailableName ?? entry.cardId} ×${entry.quantity}`).join(", ")} ${unavailableOpponentCards.length === 1 ? "is" : "are"} missing repository card rules and excluded.` : null,
    ].filter(Boolean);
    setLog([...unavailableWarnings, `New ${difficultyLabel} game started: your ${deckName} versus the opponent's ${opponentDeckName}. Setup: play a base Coral or Creature School using your 3 RP.`]);
  }

  function openNewGameSetup() {
    setPendingVictoryTarget(victoryTarget);
    setPendingOpponentDifficulty(opponentDifficulty);
    setEventOverlay({
      type: "new-game-setup",
      title: "Start a New SeaPals Game",
      message: "Choose a deck for each side. You will open with four Foundation and four Pals cards, play a base Coral or Creature School during setup, then race to the selected VP target.",
    });
  }

  const modalCards = useMemo(() => {
    if (modal === "hand") return hand;
    if (modal === "discard") return discardPile;
    if (modal === "lost") return lostZone;
    if (modal === "search" || modal === "recover" || modal === "coral-target" || modal === "restock") return searchContext?.candidates ?? [];
    return [];
  }, [modal, hand, discardPile, lostZone, searchContext]);

  const modalTitle = modal === "hand" ? "Your Hand" : modal === "discard" ? "Discard Pile" : modal === "search" ? "Search Your Decks" : modal === "recover" ? "Recover a Card" : modal === "coral-target" ? "Choose a Coral" : modal === "restock" ? "Choose Up to Three Fish" : modal === "support-draw" ? "Choose Dr. Evans' Cards" : modal === "turn-draw" ? "Choose Your Cards" : modal === "draw-result" ? "Cards Drawn" : "Lost Zone";
  const isDarkZoneModal = Boolean(modal);
  const selectedHandPlayError =
    modal === "hand" && selectedHandCard ? getPlayError(cardsById[selectedHandCard]) : "";
  const handPopoverCard = handPopoverCardId && hand.includes(handPopoverCardId) ? cardsById[handPopoverCardId] : null;
  const handPopoverPlayError = handPopoverCard ? getPlayError(handPopoverCard) : "";
  const visiblePlayError = playError || selectedHandPlayError;

  return (
    <main className="seapals-game-shell fixed inset-0 z-30 overflow-hidden bg-[#061522] p-2 text-slate-100 sm:p-4">
      <style jsx global>{`
        @keyframes seapalsDrawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes seapalsEventPop { 0% { transform: scale(.88); opacity: 0; } 65% { transform: scale(1.025); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes seapalsHudGlow { 0%, 100% { box-shadow: 0 0 0 rgba(34,211,238,0); } 50% { box-shadow: 0 0 26px rgba(34,211,238,.16); } }
        @keyframes seapalsPlayableCard { 0%, 49% { background-color: rgba(52,211,153,.26); box-shadow: inset 0 0 24px rgba(110,231,183,.12), 0 0 18px rgba(52,211,153,.18); } 50%, 100% { background-color: rgba(34,211,238,.08); box-shadow: none; } }
        @keyframes seapalsSlotBeacon { 0%, 49% { background-color: rgba(110,231,183,.28); box-shadow: 0 0 0 10px rgba(52,211,153,.12), 0 0 42px rgba(52,211,153,.65); filter: brightness(1.25); } 50%, 100% { background-color: rgba(16,185,129,.07); box-shadow: 0 0 0 4px rgba(52,211,153,.05); filter: brightness(.92); } }
        .seapals-game-shell {
          background-image:
            radial-gradient(circle at 12% 8%, rgba(14,165,233,.18), transparent 30%),
            radial-gradient(circle at 88% 92%, rgba(16,185,129,.14), transparent 34%),
            linear-gradient(145deg, #061522 0%, #071b2d 48%, #04111d 100%);
        }
        .seapals-hud-panel { background: linear-gradient(145deg, rgba(15,35,52,.96), rgba(8,24,39,.96)); }
        .seapals-arena-frame { box-shadow: 0 24px 80px rgba(0,0,0,.42), inset 0 1px rgba(255,255,255,.06); }
        .seapals-turn-button:not(:disabled) { animation: seapalsHudGlow 2.4s ease-in-out infinite; }
        .seapals-setup-playable-card { animation: seapalsPlayableCard 1s step-end infinite; }
        .seapals-slot-target { animation: seapalsSlotBeacon 1s step-end infinite; }
        .seapals-card-art-well,
        .seapals-game-shell img[data-card-art-fallback="true"],
        .seapals-game-shell img[src*="SeaPalsTCGLogoWhite.svg"] {
          background:
            radial-gradient(circle at 24% 18%, rgba(103,232,249,.22), transparent 32%),
            radial-gradient(circle at 78% 82%, rgba(52,211,153,.18), transparent 38%),
            linear-gradient(155deg, #0e7490 0%, #07506c 42%, #082f49 100%) !important;
        }
        .seapals-game-shell img[data-card-art-fallback="true"],
        .seapals-game-shell img[src*="SeaPalsTCGLogoWhite.svg"] { padding: 12%; object-fit: contain !important; }
        @media (prefers-reduced-motion: reduce) {
          .seapals-setup-playable-card, .seapals-slot-target { animation: none; }
          .seapals-setup-playable-card { background-color: rgba(52,211,153,.2); border-color: rgba(167,243,208,.9); }
          .seapals-slot-target { background-color: rgba(52,211,153,.2); border-color: rgba(167,243,208,.9); box-shadow: 0 0 30px rgba(52,211,153,.45); }
        }
        .seapals-card-drawer { animation: seapalsDrawerIn 260ms ease-out; }
        .seapals-event-card { animation: seapalsEventPop 320ms ease-out; }
      `}</style>
      <section className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-[minmax(0,1fr)_9rem_auto]">
        <div className="seapals-hud-panel seapals-arena-frame relative flex h-full min-h-0 flex-col rounded-[1.65rem] border border-cyan-400/25 p-4 shadow-2xl xl:col-start-1 xl:row-span-3 xl:row-start-1">
          <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <Link href="/" aria-label="Exit simulator and return home" className="group flex h-12 items-center gap-3 rounded-2xl border border-cyan-300/25 bg-cyan-400/10 px-5 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,.12)] transition hover:border-cyan-200/50 hover:bg-cyan-300/15">
                  <span className="text-lg font-black transition group-hover:-translate-x-0.5">←</span><span className="hidden text-sm font-black uppercase tracking-wider sm:inline">Home</span>
                </Link>
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-white">SeaPals Simulator</h1>
                  <p className="hidden text-xs text-cyan-100/60 sm:block">Build your reef. Outsmart the opposing ecosystem.</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-xl border border-white/10 bg-slate-950/45 shadow-lg xl:hidden" aria-label="Victory points in play">
                <div className="border-r border-white/10 px-4 py-1.5 text-center">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-300">Your Reef</div>
                  <div className="text-xl font-black tabular-nums text-white">{playerVp}<span className="text-xs text-emerald-300">/{victoryTarget} VP</span></div>
                  <div className="text-[9px] font-semibold text-cyan-300/70">{playerSchoolDensity} school density</div>
                </div>
                <div className="px-4 py-1.5 text-center">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-rose-300">Rival Reef · {opponentDifficultyProfile.label}</div>
                  <div className="text-xl font-black tabular-nums text-white">{opponentVp}<span className="text-xs text-rose-300">/{victoryTarget} VP</span></div>
                  <div className="text-[9px] font-semibold text-rose-300/80">{opponent.rp}/{opponentRpCap} RP · {opponentSchoolDensity} school density</div>
                </div>
              </div>
              <div className="rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-violet-100 shadow-sm">
                {isSetup ? "Setup Round" : `Round ${round} • Turn ${turn}`} • {gamePhase === "draw" ? "Choose cards" : gamePhase === "main" ? "Play & Act" : gamePhase === "opponent" ? "Opponent turn" : "Transition"}
              </div>
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-2xl border border-white/10 bg-slate-950/70 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-100 shadow-lg transition hover:bg-white/10 [&::-webkit-details-marker]:hidden">Menu</summary>
                <div className="absolute right-0 top-11 z-[70] w-48 rounded-xl border border-cyan-300/20 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl">
                  <button type="button" onClick={openNewGameSetup} className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-slate-200 hover:bg-white/10">Start New Game</button>
                  <Link href="/" className="mt-1 block rounded-lg px-3 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">Exit to Home</Link>
                </div>
              </details>
              <div className="hidden items-center gap-1 rounded-xl border border-white/10 bg-slate-950/45 p-1 shadow-sm" aria-label="Game controls">
                <div className="px-2 text-center" title={`Reef Points: ${rp} of ${playerRpCap}`}>
                  <div className="text-[9px] font-black uppercase tracking-wider text-emerald-600">RP</div>
                  <div className="text-lg font-black leading-none text-emerald-700">{rp}</div>
                </div>
                <button type="button" onClick={() => setModal("hand")} className="rounded-lg px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-white/10">Hand ({hand.length})</button>
                <button type="button" onClick={() => setModal("discard")} className="hidden rounded-lg px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 sm:block">Discard</button>
                <button type="button" onClick={() => setModal("lost")} className="hidden rounded-lg px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 sm:block">Lost</button>
                <button type="button" onClick={openNewGameSetup} className="hidden rounded-lg px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 xl:block">New Game</button>
                <button type="button" onClick={endTurn} disabled={Boolean(gameResult) || opponentThinking || (isSetup && !hasCoralInPlay) || isStartOfTurn} className="seapals-turn-button rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 py-2 text-xs font-black text-slate-950 shadow-lg disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40">
                  {opponentThinking ? "Thinking…" : isSetup ? "Round 1" : "End Turn"}
                </button>
              </div>
            </div>
          </div>

          <div className="hidden">
            <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-cyan-50 shadow-inner" role="status">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">Mission prompt</div>
              <div className="mt-0.5 text-sm font-semibold">
                {isSetup
                  ? "Setup: play a base Coral or Creature School from your opening hand, then begin round 1."
                  : isStartOfTurn
                    ? "Choose cards from either personal deck for this turn."
                    : "Play cards, use abilities, and make legal attacks in any order before ending your turn."}
              </div>
              {poisonImmunityNextPredatorAttack ? <div className="mt-2 inline-flex rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-900">Poison Heal: next attack ignores Toxic</div> : null}
              {rovLightsActive ? <div className="ml-2 mt-2 inline-flex rounded-full border border-cyan-300 bg-cyan-100 px-3 py-1 text-xs font-black text-cyan-900">ROV Lights: +2 attack against Deep creatures</div> : null}
              {nextOnPlayAttackBonus ? <div className="ml-2 mt-2 inline-flex rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">{cardsById[nextOnPlayAttackBonus.sourceCardId]?.name}: +{nextOnPlayAttackBonus.amount} next On Play attack</div> : null}
              {round > 0 && round <= supportBlockedUntilRound ? <div className="ml-2 mt-2 inline-flex rounded-full border border-rose-300 bg-rose-100 px-3 py-1 text-xs font-black text-rose-900">Echo Disruption: Support cards unavailable this turn</div> : null}
            </div>
            <div className="rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 py-2 text-violet-50 shadow-inner">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Active condition</div>
              <div className="mt-0.5 text-sm font-semibold">{activeCondition?.name ?? "Reveals when round 1 begins"}</div>
              {activeCondition?.text ? <div className="mt-0.5 max-w-md text-xs text-violet-100/75">{activeCondition.text}</div> : null}
              {unsupportedConditionEffects.length ? (
                <div className="mt-2 rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
                  This condition's special effect is displayed but not implemented yet.
                </div>
              ) : null}
              {persistentConditions.length ? (
                <div className="mt-3 border-t border-violet-200 pt-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">Persistent events</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {persistentConditions.map((condition) => {
                      const playerUsed = Boolean(conditionDensityUses[condition.id]);
                      const opponentUsed = Boolean(opponent.conditionDensityUses?.[condition.id]);
                      const conditionMessage = `${condition.text} Your reduction is ${playerUsed ? "used" : "available"}; the opponent's reduction is ${opponentUsed ? "used" : "available"}.`;
                      return <button key={condition.id} type="button" onClick={() => setEventOverlay({ type: "condition-detail", sourceCardId: condition.id, title: condition.name, message: conditionMessage, success: true })} className="rounded-full border border-violet-300 bg-white px-3 py-1 text-xs font-bold text-violet-800 hover:bg-violet-100">
                        {condition.name} · You {playerUsed ? "used" : "ready"} / Rival {opponentUsed ? "used" : "ready"}
                      </button>
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {gameResult ? (
            <div className="mb-4 rounded-2xl border-2 border-amber-400 bg-amber-100 px-6 py-4 text-center text-lg font-black text-amber-950" role="alert">
              {gameResult}
            </div>
          ) : null}

          <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-slate-950/55 p-1 xl:hidden" aria-label="Choose ecosystem to view">
            <button type="button" onClick={() => setMobileBoardView("player")} className={`rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider transition ${mobileBoardView === "player" ? "bg-emerald-400 text-slate-950 shadow-lg" : "text-slate-300 hover:bg-white/5"}`}>Your Reef</button>
            <button type="button" onClick={() => setMobileBoardView("opponent")} className={`rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider transition ${mobileBoardView === "opponent" ? "bg-rose-400 text-slate-950 shadow-lg" : "text-slate-300 hover:bg-white/5"}`}>Rival Reef{opponentThinking ? " • Thinking" : ""}</button>
          </div>

          <div className="min-h-0 w-full flex-1 rounded-2xl border border-cyan-300/20 bg-[#06111d] shadow-[0_18px_60px_rgba(0,0,0,.35)]">
            <div className="h-full min-h-0 overflow-hidden rounded-2xl bg-[#071724]">
              <div className={`${mobileBoardView === "opponent" ? "h-full" : "hidden"} border-b border-cyan-300/20 bg-slate-900 xl:block xl:h-[45%]`}>
                <div className="flex h-10 items-center justify-between gap-4 border-b border-white/5 bg-gradient-to-r from-rose-500/10 via-slate-900 to-slate-900 px-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-rose-200"><span className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,.8)]" /> Rival Ecosystem</div>
                  {attackContext ? (
                    <div className="flex items-center gap-2" role="status">
                      <div className="rounded-full bg-emerald-400 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-950 shadow-lg">Choose a highlighted target</div>
                      {!attackContext.costCommitted ? <button type="button" onClick={() => setAttackContext(null)} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-bold text-slate-200 hover:bg-white/10">Cancel</button> : <span className="text-[10px] font-bold text-emerald-200">Finish each repeated attack</span>}
                    </div>
                  ) : null}
                </div>
                <div
                  ref={opponentEcosystemRef}
                  className="seapals-ecosystem-ocean relative h-[calc(100%-40px)] w-full overflow-hidden"
                  onPointerDown={handleOpponentPointerDown}
                  onPointerMove={handleOpponentPointerMove}
                  onPointerUp={handleOpponentPointerUp}
                  onPointerCancel={handleOpponentPointerUp}
                  onLostPointerCapture={handleOpponentPointerUp}
                  style={{ touchAction: "none", overscrollBehavior: "contain", cursor: isOpponentPanning ? "grabbing" : "grab" }}
                >
                  <div className="absolute right-2 top-1/2 z-40 flex -translate-y-1/2 flex-col overflow-hidden rounded-full border border-rose-300/25 bg-slate-950/85 text-white shadow-xl backdrop-blur" aria-label="Opponent ecosystem zoom controls">
                    <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setOpponentViewportTouched(true); setOpponentEcosystemZoom((current) => clampZoom(current + 0.1)); }} className="flex h-10 w-10 items-center justify-center text-xl font-bold hover:bg-white/10" aria-label="Zoom in on opponent ecosystem">+</button>
                    <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setOpponentViewportTouched(true); zoomEcosystemToFit("opponent"); }} className="border-y border-white/10 px-1 py-1 text-[9px] font-black uppercase text-rose-200" aria-label="Fit opponent ecosystem to view">Fit</button>
                    <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setOpponentViewportTouched(true); setOpponentEcosystemZoom((current) => clampZoom(current - 0.1)); }} className="flex h-10 w-10 items-center justify-center text-xl font-bold hover:bg-white/10" aria-label="Zoom out on opponent ecosystem">−</button>
                  </div>
                  <div className="absolute inset-0" style={{ transform: `translate(${opponentEcosystemOffset.x}px, ${opponentEcosystemOffset.y}px) scale(${opponentEcosystemZoom})`, transformOrigin: "center center" }}>
                    <div className="absolute inset-0">
                      {opponent.habitats.length ? (
                        <div className="absolute left-4 top-4 z-30 flex max-w-[30%] flex-wrap gap-2">
                          {opponent.habitatInstances.map((habitatInstance) => {
                            const cardId = habitatInstance.cardId;
                            const card = cardsById[cardId];
                            const key = `opponent-habitat-${habitatInstance.instanceId}`;
                            const offset = floatingCardOffsets[key] ?? { x: 0, y: 0 };
                            return (
                              <button key={habitatInstance.instanceId} type="button" onPointerDown={(event) => handleFloatingCardPointerDown(key, event)} onPointerMove={handleFloatingCardPointerMove} onPointerUp={handleFloatingCardPointerUp} onClick={() => inspectFloatingCard({ owner: "opponent", cardId, coralId: null, slotId: key, habitatInstanceId: habitatInstance.instanceId, foundation: true, zone: "habitat", currentHealth: habitatInstance.currentHealth, maxHealth: habitatInstance.maxHealth })} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} className="seapals-in-play-card relative w-[120px] cursor-grab rounded-xl text-center active:cursor-grabbing">
                                <InPlayHoverLabel card={card} zoom={opponentEcosystemZoom} />
                                <img src={card?.image} alt={card?.name} className="h-[150px] w-[120px] rounded-xl bg-white object-contain shadow-lg" />
                                <span className="block truncate text-[9px] font-bold text-amber-950">{card?.name}</span>
                                {habitatInstance.maxHealth ? <span className="block text-[8px] font-black text-rose-700">{habitatInstance.currentHealth}/{habitatInstance.maxHealth} HP</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {(opponent.reefCreatures ?? []).length ? <div className="absolute left-1/2 top-4 z-30 flex max-w-[34%] -translate-x-1/2 flex-wrap justify-center gap-2 rounded-xl border border-violet-300 bg-violet-50/95 p-2 shadow-lg">{opponent.reefCreatures.map((cardId, index) => { const card = cardsById[cardId]; const targetSlotId = getOpponentReefSlotId(index); const isTarget = attackContext?.targets.some((target) => target.coralId === "__reef__" && target.slotId === targetSlotId); const key = `opponent-${targetSlotId}`; const offset = floatingCardOffsets[key] ?? { x: 0, y: 0 }; return <button key={opponent.reefCreatureInstances?.[index]?.instanceId ?? `${cardId}-${index}`} type="button" onPointerDown={(event) => handleFloatingCardPointerDown(key, event)} onPointerMove={handleFloatingCardPointerMove} onPointerUp={handleFloatingCardPointerUp} onClick={() => isTarget ? resolvePlayerAttack("__reef__", targetSlotId) : inspectFloatingCard({ owner: "opponent", cardId, coralId: null, slotId: key })} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} className={`seapals-in-play-card relative w-[120px] cursor-grab rounded-lg text-center active:cursor-grabbing ${isTarget ? "animate-pulse ring-4 ring-emerald-400" : ""}`}><InPlayHoverLabel card={card} zoom={opponentEcosystemZoom} /><img src={card?.image} alt={card?.name} className="h-[150px] w-[120px] rounded-lg bg-white object-contain" /><span className="block truncate text-[9px] font-bold text-violet-950">{card?.name}</span></button>; })}</div> : null}
                      {(opponent.orphanCreatures ?? []).length ? (
                        <div className="absolute right-4 top-4 z-30 flex max-w-[34%] flex-wrap justify-end gap-2 rounded-xl border-2 border-dashed border-orange-400 bg-orange-50/95 p-2 shadow-lg">
                          <div className="absolute -top-3 right-2 rounded-full bg-orange-600 px-2 py-1 text-[8px] font-black uppercase text-white">Orphaned</div>
                          {opponent.orphanCreatures.map((entry, index) => {
                            const card = cardsById[entry.cardId];
                            const targetSlotId = getOpponentOrphanSlotId(index);
                            const isTarget = attackContext?.targets.some((target) => target.coralId === "__orphan__" && target.slotId === targetSlotId);
                            return (
                              <div key={entry.instanceId ?? `${entry.cardId}-${index}`} className="rounded-lg bg-orange-100/90 p-1 text-center">
                                <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => isTarget ? resolvePlayerAttack("__orphan__", targetSlotId) : setInspectedCard({ owner: "opponent", cardId: entry.cardId, coralId: null, slotId: `opponent-${targetSlotId}`, orphanIndex: index })} className={`seapals-in-play-card relative w-14 rounded-lg text-center ${isTarget ? "animate-pulse ring-4 ring-emerald-400" : ""}`}>
                                  <InPlayHoverLabel card={card} zoom={opponentEcosystemZoom} />
                                  <img src={card?.image} alt={card?.name} className="h-20 w-14 rounded-lg object-contain" />
                                  <span className="block truncate text-[8px] font-bold text-orange-950">{card?.name}</span>
                                </button>
                                {(entry.hostedCardIds ?? []).some(Boolean) ? (
                                  <div className="mt-1 flex justify-center gap-1 border-t border-fuchsia-300 pt-1">
                                    {entry.hostedCardIds.map((hostedCardId, hostedIndex) => {
                                      if (!hostedCardId) return null;
                                      const hostedCard = cardsById[hostedCardId];
                                      const hostedSlotId = getOrphanHostedTargetSlotId(entry.instanceId ?? `legacy-${index}`, hostedIndex);
                                      const hostedIsTarget = attackContext?.targets.some((target) => target.coralId === "__orphan__" && target.slotId === hostedSlotId);
                                      return (
                                        <button key={`${hostedCardId}-${hostedIndex}`} type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => hostedIsTarget ? resolvePlayerAttack("__orphan__", hostedSlotId) : setInspectedCard({ owner: "opponent", cardId: hostedCardId, coralId: null, slotId: `opponent-${hostedSlotId}`, orphanIndex: index, hostedIndex })} className={`seapals-in-play-card relative ${hostedIsTarget ? "animate-pulse rounded ring-4 ring-emerald-400" : "rounded"}`} title={`Hosted by ${card?.name}`}>
                                          <InPlayHoverLabel card={hostedCard} zoom={opponentEcosystemZoom} />
                                          <img src={hostedCard?.image} alt={hostedCard?.name} className="h-12 w-9 rounded bg-white object-contain" />
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {opponentCorals.length ? opponentCorals.map((coral, coralIndex) => {
                        const card = cardsById[coral.cardId];
                        const anchorPositions = getOpponentSlotPositions(coral.slots.length);
                        const isFoundationTarget = attackContext?.targets.some((target) => target.coralId === coral.id && target.slotId === "__foundation__");
                        const gridOffset = getOpponentCoralGridOffset(coralIndex, opponentCorals.length);
                        return (
                          <div key={coral.id} className="absolute h-[210px] w-[180px] -translate-x-1/2 -translate-y-1/2" style={{ left: `calc(50% + ${gridOffset.x}px)`, top: `calc(50% + ${gridOffset.y + (opponent.habitats.length || opponent.reefCreatures.length || (opponent.orphanCreatures?.length ?? 0) ? 360 : 0)}px)` }}>
                            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => isFoundationTarget ? resolvePlayerAttack(coral.id, "__foundation__") : setInspectedCard({ owner: "opponent", cardId: coral.cardId, coralId: coral.id, slotId: `opponent-foundation-${coral.id}`, foundation: true })} className={`seapals-in-play-card relative z-20 mx-auto block h-[200px] w-[160px] rounded-[1.25rem] border-4 bg-white/95 p-2 shadow-2xl ${isFoundationTarget ? "animate-pulse border-emerald-400 ring-4 ring-emerald-300" : "border-rose-300"}`}>
                              <InPlayHoverLabel card={card} zoom={opponentEcosystemZoom} />
                              <img src={card?.image} alt={card?.name} className="h-[160px] w-full rounded-xl object-contain" />
                              <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-rose-500" style={{ width: `${coral.maxHealth ? (coral.health / coral.maxHealth) * 100 : 0}%` }} /></div>
                              <div className="mt-1 text-center text-[10px] font-black text-rose-700">{coral.health}/{coral.maxHealth} HP</div>
                              {(coral.statuses ?? []).length ? <div className="absolute -right-2 -top-2 rounded-full bg-amber-500 px-2 py-1 text-[9px] font-black uppercase text-slate-950 shadow-lg">{coral.statuses.map((status) => status.type).join(", ")}</div> : null}
                              {coral.rpPenaltyNextTurn ? <div className="mt-1 rounded-full bg-cyan-100 px-2 py-0.5 text-center text-[9px] font-black text-cyan-800">−{coral.rpPenaltyNextTurn} RP next collection</div> : null}
                            </button>
                            {coral.slots.map((slot, slotIndex) => {
                              const position = slot.position ?? anchorPositions[slotIndex];
                              const slotCard = cardsById[slot.cardId];
                              const isTarget = attackContext?.targets.some((target) => target.coralId === coral.id && target.slotId === slot.id);
                              return (
                                <div key={slot.id} className="absolute inset-0">
                                  <div className="pointer-events-none absolute bg-slate-400 opacity-70" style={getSlotConnectorStyle(position)} />
                                  <button
                                    type="button"
                                    disabled={!slotCard}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={() => {
                                      if (isTarget) resolvePlayerAttack(coral.id, slot.id);
                                      else if (slotCard) setInspectedCard({ owner: "opponent", cardId: slot.cardId, coralId: coral.id, slotId: slot.id });
                                    }}
                                    className={`seapals-in-play-card absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center ${
                                      slotCard
                                        ? `h-[150px] w-[120px] rounded-[1.25rem] shadow-xl ${isTarget ? "animate-pulse ring-4 ring-emerald-300" : ""}`
                                        : "h-[96px] w-[96px] rounded-full border border-cyan-200/25 bg-slate-950/55 shadow-[inset_0_0_22px_rgba(34,211,238,.08),0_8px_24px_rgba(0,0,0,.25)]"
                                    }`}
                                    style={{ left: position.left, top: position.top }}
                                  >
                                    {slotCard ? <><InPlayHoverLabel card={slotCard} zoom={opponentEcosystemZoom} /><img src={slotCard.image} alt={slotCard.name} className="h-full w-full rounded-[1.15rem] object-contain" /></> : <><EmptySlotHoverLabel slot={slot} zoom={opponentEcosystemZoom} position={position} /><img src={getSlotIconPath(slot)} alt={`${getCreatureSlotLabel(slot)} empty slot`} className="h-28 w-28 max-w-none object-contain opacity-90" /></>}
                                  </button>
                                  {(slot.hostedCardIds ?? []).some(Boolean) ? <div className="absolute z-30 flex gap-1 rounded-lg border border-fuchsia-300 bg-fuchsia-50/95 p-1 shadow-lg" style={{ left: `calc(${position.left} + 48px)`, top: `calc(${position.top} - 68px)` }}>{slot.hostedCardIds.map((hostedCardId, hostedIndex) => { if (!hostedCardId) return null; const hostedCard = cardsById[hostedCardId]; const hostedTargetSlotId = getHostedTargetSlotId(slot.id, hostedIndex); const hostedIsTarget = attackContext?.targets.some((target) => target.coralId === coral.id && target.slotId === hostedTargetSlotId); return <button key={`${hostedCardId}-${hostedIndex}`} type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => hostedIsTarget ? resolvePlayerAttack(coral.id, hostedTargetSlotId) : setInspectedCard({ owner: "opponent", cardId: hostedCardId, coralId: coral.id, slotId: hostedTargetSlotId, hostedBySlotId: slot.id })} className={`seapals-in-play-card relative ${hostedIsTarget ? "animate-pulse rounded-md ring-4 ring-emerald-400" : "rounded-md"}`} title={`Hosted by ${slotCard?.name}`}><InPlayHoverLabel card={hostedCard} zoom={opponentEcosystemZoom} /><img src={hostedCard?.image} alt={hostedCard?.name} className="h-16 w-11 rounded-md bg-white object-contain" /></button>; })}</div> : null}
                                </div>
                              );
                            })}
                          </div>
                        );
                      }) : <div className="absolute inset-0 flex items-center justify-center"><div className="rounded-2xl border border-rose-200 bg-white/90 px-6 py-4 font-semibold text-rose-700">The opponent has no coral in play.</div></div>}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`${mobileBoardView === "player" ? "h-full" : "hidden"} bg-slate-900 xl:block xl:h-[55%]`}>
                <div className="flex h-10 items-center justify-between gap-4 border-b border-white/5 bg-gradient-to-r from-emerald-500/10 via-slate-900 to-slate-900 px-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.8)]" /> Your Ecosystem</div>
                  {isPlacingCoral && (
                    <div className="flex items-center gap-2" role="status">
                      <div className="rounded-full bg-emerald-400 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-950 shadow-lg">Click to place your {isCreatureSchool(playingCard) ? "Creature School" : "Coral"}</div>
                      <button type="button" onClick={cancelCardPlay} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-bold text-slate-200 hover:bg-white/10">Cancel</button>
                    </div>
                  )}
                  {isUpgradingCoral && (
                    <div className="flex items-center gap-2" role="status">
                      <div className="rounded-full bg-emerald-400 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-950 shadow-lg">Choose a highlighted coral</div>
                      <button
                        type="button"
                        onClick={cancelCardPlay}
                        className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-bold text-slate-200 hover:bg-white/10"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                <div
                  ref={ecosystemRef}
                  className={`seapals-ecosystem-ocean relative h-[calc(100%-40px)] w-full ${isPlacingCoral ? "cursor-crosshair" : ""}`}
                  onPointerDown={handleEcosystemPointerDown}
                  onPointerMove={handleEcosystemPointerMove}
                  onPointerUp={handleEcosystemPointerUp}
                  onPointerCancel={handleEcosystemPointerUp}
                  onLostPointerCapture={handleEcosystemPointerUp}
                  style={{ touchAction: "none", overscrollBehavior: "contain", userSelect: "none" }}
                >
                  {!isPlacingCoral && !isUpgradingCoral ? (
                    <div className="absolute right-2 top-1/2 z-40 flex -translate-y-1/2 flex-col overflow-hidden rounded-full border border-emerald-300/25 bg-slate-950/85 text-white shadow-xl backdrop-blur" aria-label="Your ecosystem zoom controls">
                      <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setEcosystemZoom((current) => clampZoom(current + 0.1))} className="flex h-10 w-10 items-center justify-center text-xl font-bold hover:bg-white/10" aria-label="Zoom in on your ecosystem">+</button>
                      <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => zoomEcosystemToFit("player")} className="border-y border-white/10 px-1 py-1 text-[9px] font-black uppercase text-emerald-200" aria-label="Fit your ecosystem to view">Fit</button>
                      <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setEcosystemZoom((current) => clampZoom(current - 0.1))} className="flex h-10 w-10 items-center justify-center text-xl font-bold hover:bg-white/10" aria-label="Zoom out on your ecosystem">−</button>
                    </div>
                  ) : null}
                  <div className="absolute inset-0 overflow-hidden">
                    <div
                      className="absolute inset-0 h-full w-full"
                      style={{
                        transform: `translate(${ecosystemOffset.x}px, ${ecosystemOffset.y}px) scale(${ecosystemZoom})`,
                        transformOrigin: "center center",
                        cursor: isPanning ? "grabbing" : "grab",
                        userSelect: "none",
                      }}
                    >
                      {playerHabitats.length ? (
                        <div className="absolute left-6 top-6 z-30 flex max-w-[70%] gap-3">
                          {playerHabitatInstances.map((habitatInstance, index) => {
                            const cardId = habitatInstance.cardId;
                            const habitat = cardsById[cardId];
                            const key = `player-habitat-${habitatInstance.instanceId}`;
                            const offset = floatingCardOffsets[key] ?? { x: 0, y: 0 };
                            return (
                              <button key={habitatInstance.instanceId} type="button" onPointerDown={(event) => handleFloatingCardPointerDown(key, event)} onPointerMove={handleFloatingCardPointerMove} onPointerUp={handleFloatingCardPointerUp} onClick={() => inspectFloatingCard({ owner: "player", cardId, coralId: null, slotId: key, habitatInstanceId: habitatInstance.instanceId })} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} className="seapals-in-play-card relative w-[120px] cursor-grab text-center active:cursor-grabbing">
                                <InPlayHoverLabel card={habitat} zoom={ecosystemZoom} />
                                <img src={habitat?.image} alt={habitat?.name} className="h-[150px] w-[120px] rounded-xl bg-white object-contain shadow-lg" />
                                <span className="mt-1 block truncate text-[10px] font-bold text-amber-950">{habitat?.name}</span>
                                {habitatInstance.maxHealth ? <span className="block text-[9px] font-black text-rose-700">{habitatInstance.currentHealth}/{habitatInstance.maxHealth} HP</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {playerReefCreatures.length ? (
                        <div className="absolute right-6 top-6 z-30 flex gap-3 rounded-2xl border border-violet-300 bg-violet-50/95 p-3 shadow-lg">
                          <div className="absolute -top-3 right-3 rounded-full bg-violet-700 px-3 py-1 text-[9px] font-black uppercase tracking-wider text-white">Open Water</div>
                          {playerReefCreatures.map((cardId, index) => {
                            const card = cardsById[cardId];
                            const targetSlotId = getPlayerReefSlotId(index);
                            const key = `player-${targetSlotId}`;
                            const offset = floatingCardOffsets[key] ?? { x: 0, y: 0 };
                            return <button key={playerReefCreatureInstances[index]?.instanceId ?? `${cardId}-${index}`} type="button" onPointerDown={(event) => handleFloatingCardPointerDown(key, event)} onPointerMove={handleFloatingCardPointerMove} onPointerUp={handleFloatingCardPointerUp} onClick={() => inspectFloatingCard({ owner: "player", cardId, coralId: null, slotId: targetSlotId })} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} className="seapals-in-play-card relative w-[120px] cursor-grab text-center active:cursor-grabbing"><InPlayHoverLabel card={card} zoom={ecosystemZoom} /><img src={card?.image} alt={card?.name} className="h-[150px] w-[120px] rounded-xl bg-white object-contain" /><span className="mt-1 block truncate text-[10px] font-bold text-violet-950">{card?.name}</span></button>;
                          })}
                        </div>
                      ) : null}
                      {playerOrphanCreatures.length ? (
                        <div className="absolute right-6 top-48 z-30 flex max-w-[48%] flex-wrap gap-2 rounded-2xl border-2 border-dashed border-orange-400 bg-orange-50/95 p-3 shadow-lg">
                          <div className="absolute -top-3 right-3 rounded-full bg-orange-600 px-3 py-1 text-[9px] font-black uppercase tracking-wider text-white">Orphaned — waiting for slots</div>
                          {playerOrphanCreatures.map((entry, index) => { const card = cardsById[entry.cardId]; const hostedCount = (entry.hostedCardIds ?? []).filter(Boolean).length; return <button key={entry.instanceId ?? `${entry.cardId}-${index}`} type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setInspectedCard({ owner: "player", cardId: entry.cardId, coralId: null, slotId: getPlayerOrphanSlotId(index), orphanIndex: index })} className="seapals-in-play-card relative w-20 text-center"><InPlayHoverLabel card={card} zoom={ecosystemZoom} /><img src={card?.image} alt={card?.name} className="h-24 w-20 rounded-xl object-contain" /><span className="mt-1 block truncate text-[9px] font-bold text-orange-950">{card?.name}</span>{hostedCount ? <span className="absolute right-0 top-0 rounded-full bg-fuchsia-600 px-1.5 py-0.5 text-[8px] font-black text-white">+{hostedCount}</span> : null}</button>; })}
                        </div>
                      ) : null}
                      {playerCorals.map((coral) => {
                        const anchorPositions = getBracketSlotPositions(coral.slots.length);
                        const canUpgradeThisCoral = upgradeableCoralIds.has(coral.id);
                        return (
                          <div
                            key={coral.id}
                            data-coral
                            data-card-id={coral.cardId}
                            className="absolute -translate-x-1/2 -translate-y-1/2"
                            style={{ top: `${coral.y}%`, left: `${coral.x}%`, width: "240px", height: "280px" }}
                          >
                            <div className="relative h-full w-full">
                               <div
                                 data-upgrade-target={canUpgradeThisCoral ? "true" : undefined}
                                 role="button"
                                 tabIndex={0}
                                 aria-label={`Inspect ${coral.name}`}
                                 className={`seapals-in-play-card relative z-20 mx-auto h-[260px] w-[220px] rounded-[1.5rem] bg-slate-100 shadow-xl ${
                                   draggingCoralId === coral.id ? "ring-2 ring-emerald-300" : ""
                                 } ${
                                   canUpgradeThisCoral ? "cursor-pointer" : ""
                                 }`}
                                 onPointerDown={(event) => handleCoralPointerDown(coral.id, event)}
                                 onClick={(event) => handleCoralClick(coral.id, event)}
                                 onKeyDown={(event) => {
                                   if (event.key === "Enter" || event.key === " ") handleCoralClick(coral.id, event);
                                 }}
                                >
                                <InPlayHoverLabel card={cardsById[coral.cardId]} zoom={ecosystemZoom} />
                                <img
                                  src={coral.image}
                                  alt={coral.name}
                                  onDragStart={(event) => event.preventDefault()}
                                  className={`absolute inset-x-0 top-4 mx-auto h-[220px] w-[180px] rounded-[1.5rem] object-contain ${
                                    canUpgradeThisCoral
                                      ? "cursor-pointer"
                                      : draggingCoralId === coral.id
                                        ? "cursor-grabbing"
                                        : "cursor-grab"
                                  }`}
                                />
                                <div className="absolute inset-x-4 bottom-3 rounded-xl bg-white/95 px-3 py-2 shadow-sm">
                                  <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-label={`${coral.health ?? coral.maxHealth} of ${coral.maxHealth} health`}>
                                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${coral.maxHealth ? ((coral.health ?? coral.maxHealth) / coral.maxHealth) * 100 : 0}%` }} />
                                  </div>
                                  <div className="mt-1 text-center text-[10px] font-black text-emerald-800">{coral.health ?? coral.maxHealth}/{coral.maxHealth} HP</div>
                                </div>
                                {(coral.statuses ?? []).length ? <div className="absolute -right-2 -top-2 rounded-full bg-amber-500 px-2 py-1 text-[9px] font-black uppercase text-slate-950 shadow-lg">{coral.statuses.map((status) => status.type).join(", ")}</div> : null}
                              </div>
                              {coral.slots.map((slot, index) => {
                                const position = slot.position ?? anchorPositions[index];
                                const slotFilled = Boolean(slot.cardId);
                                const slotCard = slotFilled ? cardsById[slot.cardId] : null;
                                const validHostTarget = Boolean(slotFilled && playingCardId && canHostCardInSlot(slot, playingCardId));
                                const validTarget = Boolean(playingCardId && (canUseSlotWithCard(slot, playingCardId) || validHostTarget));
                                const emptyPlacementMode = Boolean(!slotFilled && playingCardId && !isUpgradingCoral);
                                return (
                                  <div key={slot.id} className="absolute top-0 left-0 h-full w-full">
                                    <div
                                      className="pointer-events-none absolute bg-slate-400 opacity-70"
                                      style={getSlotConnectorStyle(position)}
                                    />
                                     <div
                                       data-slot-drag-handle
                                       data-slot-id={slot.id}
                                      onPointerDown={(event) => {
                                        if (validHostTarget || validTarget) {
                                          event.stopPropagation();
                                          return;
                                        }
                                        handleSlotPointerDown(coral.id, slot.id, event);
                                      }}
                                      onPointerMove={handleEcosystemPointerMove}
                                      onPointerUp={handleEcosystemPointerUp}
                                      onPointerCancel={handleEcosystemPointerUp}
                                      onLostPointerCapture={handleSlotDragEnd}
                                      className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center transition ${!slotFilled ? "seapals-in-play-card" : ""} ${
                                        slotFilled
                                          ? `h-[220px] w-[180px] rounded-[1.5rem] shadow-2xl ${validHostTarget ? "ring-4 ring-emerald-300" : ""}`
                                          : emptyPlacementMode
                                            ? validTarget
                                              ? "seapals-slot-target z-30 h-[190px] w-[190px] rounded-full border-4 bg-transparent shadow-none"
                                              : "h-[112px] w-[112px] rounded-full border border-white/10 bg-slate-950/35 opacity-30 shadow-inner"
                                            : "h-[112px] w-[112px] cursor-grab rounded-full border-2 border-cyan-200/25 bg-slate-950/55 shadow-[inset_0_0_24px_rgba(34,211,238,.08),0_10px_28px_rgba(0,0,0,.28)] active:cursor-grabbing"
                                      }`}
                                      style={{ top: position.top, left: position.left, touchAction: 'none' }}
                                    >
                                      {!slotFilled ? <EmptySlotHoverLabel slot={slot} zoom={ecosystemZoom} position={position} /> : null}
                                      {slotFilled ? (
                                        <button
                                          type="button"
                                          onPointerDown={(event) => validHostTarget ? event.stopPropagation() : handleSlotPointerDown(coral.id, slot.id, event)}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            if (validHostTarget) {
                                              placeCardToSlot(slot.id);
                                              return;
                                            }
                                            if (slotWasDraggedRef.current) {
                                              slotWasDraggedRef.current = false;
                                              return;
                                            }
                                            setInspectedCard({ owner: "player", cardId: slot.cardId, coralId: coral.id, slotId: slot.id });
                                          }}
                                          className={`seapals-in-play-card relative h-full w-full rounded-[1.5rem] transition ${validHostTarget ? "cursor-pointer ring-4 ring-emerald-400" : "cursor-grab ring-cyan-400 hover:ring-4 active:cursor-grabbing"}`}
                                          style={{ touchAction: "none" }}
                                        >
                                          <InPlayHoverLabel card={slotCard} zoom={ecosystemZoom} />
                                          <img
                                            src={slotCard?.image}
                                            alt={slotCard?.name}
                                            draggable={false}
                                            className="pointer-events-none h-full w-full select-none rounded-[1.5rem] object-contain"
                                          />
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={!validTarget}
                                          onPointerDown={(event) => event.stopPropagation()}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            placeCardToSlot(slot.id);
                                          }}
                                          className={`relative flex h-full w-full flex-col items-center justify-center px-2 text-[11px] font-semibold transition ${
                                            validTarget
                                              ? "pointer-events-auto cursor-pointer rounded-full border-0 bg-transparent drop-shadow-[0_0_18px_rgba(110,231,183,.9)]"
                                              : emptyPlacementMode
                                                ? "pointer-events-none rounded-full border-0 bg-transparent"
                                                : "pointer-events-none rounded-full border-0 bg-transparent"
                                          }`}
                                        >
                                          <img src={getSlotIconPath(slot)} alt={slot.type} className={`pointer-events-none max-w-none select-none object-contain ${validTarget ? "h-44 w-44" : emptyPlacementMode ? "h-28 w-28 opacity-60" : "h-32 w-32 opacity-90"}`} />
                                          <span className="sr-only">{slot.type}</span>
                                        </button>
                                      )}
                                      {(slot.hostedCardIds ?? []).some(Boolean) ? <div className="absolute -right-12 top-2 z-30 flex flex-col gap-1 rounded-xl border border-fuchsia-300 bg-fuchsia-50/95 p-1 shadow-lg">{slot.hostedCardIds.map((hostedCardId, hostedIndex) => { if (!hostedCardId) return null; const hostedCard = cardsById[hostedCardId]; return <button key={`${hostedCardId}-${hostedIndex}`} type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setInspectedCard({ owner: "player", cardId: hostedCardId, coralId: coral.id, slotId: `${slot.id}:hosted:${hostedIndex}`, hostedBySlotId: slot.id }); }} className="seapals-in-play-card relative rounded-lg ring-fuchsia-400 hover:ring-2" title={`Hosted by ${slotCard?.name}`}><InPlayHoverLabel card={hostedCard} zoom={ecosystemZoom} /><img src={hostedCard?.image} alt={hostedCard?.name} className="h-20 w-14 rounded-lg bg-white object-contain" /></button>; })}</div> : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {bubbleBursts.length ? (
                    <div className="pointer-events-none absolute inset-0 z-[60] overflow-hidden" aria-hidden="true">
                      {bubbleBursts.map((burst) => <BubbleBurst key={burst.id} x={burst.x} y={burst.y} />)}
                    </div>
                  ) : null}
                  {isPlacingCoral && (
                    <button
                      type="button"
                      aria-label={`Click to place your ${isCreatureSchool(playingCard) ? "Creature School" : "Coral"}`}
                      onClick={handleEcosystemClick}
                      className="absolute inset-0 z-50 cursor-crosshair bg-transparent"
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-0 border-4 border-emerald-400 transition-opacity duration-100 ${
                          actionBlinkOn ? "opacity-100" : "opacity-0"
                        }`}
                      />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          {mobileHudPanel ? (
            <div className="absolute inset-x-3 bottom-[4.75rem] z-[60] max-h-[45dvh] overflow-y-auto rounded-2xl border border-cyan-300/25 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-xl xl:hidden">
              <div className="mb-3 flex items-center justify-between"><h2 className="font-black text-white">{mobileHudPanel === "zones" ? "Game Zones" : "Mission Feed"}</h2><button type="button" onClick={() => setMobileHudPanel(null)} className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-slate-200">Close</button></div>
              {mobileHudPanel === "zones" ? (
                <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { setMobileHudPanel(null); setModal("discard"); }} className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-4 font-bold text-cyan-100">Discard Pile<span className="mt-1 block text-2xl font-black">{discardPile.length}</span></button><button type="button" onClick={() => { setMobileHudPanel(null); setModal("lost"); }} className="rounded-xl border border-violet-300/20 bg-violet-400/10 p-4 font-bold text-violet-100">Lost Zone<span className="mt-1 block text-2xl font-black">{lostZone.length}</span></button></div>
              ) : (
                <div><div className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-3 text-sm font-semibold text-cyan-50">{isSetup ? "Setup: play a base Coral or Creature School, then begin round 1." : isStartOfTurn ? "Choose cards from your personal decks for this turn." : "Play cards, use abilities, and attack in any legal order."}</div><div className="mt-2 rounded-xl border border-violet-300/20 bg-violet-400/10 p-3 text-sm text-violet-100"><strong>{activeCondition?.name ?? "No active condition"}</strong>{activeCondition?.text ? <span className="mt-1 block text-xs text-violet-100/70">{activeCondition.text}</span> : null}</div><ol className="mt-2 space-y-2 rounded-xl bg-slate-900 p-3 text-xs">{log.slice(0, 8).map((entry, index) => <li key={`${entry}-${index}`} className={index === 0 ? "font-bold text-cyan-300" : "text-slate-300"}>{entry}</li>)}</ol></div>
              )}
            </div>
          ) : null}
          <div className="mt-2 grid h-14 shrink-0 grid-cols-[64px_64px_minmax(0,1fr)_92px] gap-1.5 xl:hidden" aria-label="Mobile game command dock">
            <button type="button" onClick={() => setMobileHudPanel((current) => current === "zones" ? null : "zones")} className="rounded-xl border border-white/10 bg-white/5 px-1 text-[10px] font-bold text-slate-200">Zones<br /><span className="text-cyan-300">{discardPile.length + lostZone.length}</span></button>
            <button type="button" onClick={() => setMobileHudPanel((current) => current === "feed" ? null : "feed")} className="rounded-xl border border-white/10 bg-white/5 px-1 text-[10px] font-bold text-slate-200">Guide<br /><span className="text-violet-300">Feed</span></button>
            <button type="button" onClick={() => setModal("hand")} className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 text-sm font-black text-cyan-50 shadow-lg">Open Hand <span className="text-cyan-300">({hand.length})</span><span className="block text-[10px] font-semibold text-emerald-300">{rp} RP ready</span></button>
            <button type="button" onClick={endTurn} disabled={Boolean(gameResult) || opponentThinking || (isSetup && !hasCoralInPlay) || isStartOfTurn} className="seapals-turn-button rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-2 text-xs font-black text-slate-950 disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40">{opponentThinking ? "Thinking…" : isSetup ? "Round 1" : "End Turn"}</button>
          </div>
        </div>

        <div className="seapals-hud-panel hidden min-h-0 overflow-y-auto rounded-2xl border border-cyan-400/20 p-3 shadow-xl xl:col-start-2 xl:row-start-1 xl:flex xl:flex-col">
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-slate-950/45">
            <div className="border-r border-white/10 p-3 text-center"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">Your Reef</div><div className="mt-0.5 text-2xl font-black tabular-nums text-white">{playerVp}<span className="text-sm text-emerald-300">/{victoryTarget} VP</span></div><div className="text-xs text-cyan-200/65">{playerSchoolDensity} school density</div></div>
            <div className="p-3 text-center"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-rose-300">Rival Reef · {opponentDifficultyProfile.label}</div><div className="mt-0.5 text-2xl font-black tabular-nums text-white">{opponentVp}<span className="text-sm text-rose-300">/{victoryTarget} VP</span></div><div className="text-xs text-rose-200/65">{opponent.rp}/{opponentRpCap} RP · {opponentSchoolDensity} school density</div></div>
          </div>

          <button type="button" disabled={!activeCondition} onClick={() => activeCondition && setEventOverlay({ type: "condition-detail", sourceCardId: activeCondition.id, title: activeCondition.name, message: activeCondition.text, success: true })} className="mt-2 w-full rounded-xl border border-violet-300/20 bg-violet-400/10 p-3 text-left transition hover:border-violet-300/40 disabled:cursor-default">
            <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Active condition</span><strong className="mt-0.5 block text-base text-violet-50">{activeCondition?.name ?? "Reveals when Round 1 begins"}</strong>{activeCondition?.text ? <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-violet-100/70">{activeCondition.text}</span> : null}
          </button>
          {persistentConditions.length ? <div className="mt-2 flex flex-wrap gap-1">{persistentConditions.map((condition) => <button key={condition.id} type="button" onClick={() => setEventOverlay({ type: "condition-detail", sourceCardId: condition.id, title: condition.name, message: `${condition.text} Your reduction is ${conditionDensityUses[condition.id] ? "used" : "available"}; the opponent's reduction is ${opponent.conditionDensityUses?.[condition.id] ? "used" : "available"}.`, success: true })} className="rounded-full border border-violet-300/20 bg-violet-400/10 px-2 py-1 text-[9px] font-bold text-violet-200">{condition.name} · {conditionDensityUses[condition.id] ? "Used" : "Ready"}</button>)}</div> : null}

          <div className="mt-2 flex items-center justify-between rounded-xl border border-emerald-300/25 bg-emerald-400/10 px-3 py-2"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-300/40 bg-slate-950/40 text-xl font-black text-emerald-200">{rp}</div><div><div className="text-[10px] font-black uppercase tracking-wider text-emerald-300">RP Bank</div><div className="text-sm font-bold text-white">{rp}/{playerRpCap} available</div></div></div><div className="text-right text-xs leading-tight text-emerald-100/60">Next collection<br />+1{startTurnRp > 0 ? ` + ${startTurnRp}` : ""} RP</div></div>
          <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setModal("discard")} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-bold text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/10"><span><span className="mr-2 text-cyan-300">↺</span>Discard</span><strong className="rounded-full bg-slate-950/60 px-2 py-0.5 text-cyan-200">{discardPile.length}</strong></button><button type="button" onClick={() => setModal("lost")} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-bold text-slate-200 transition hover:border-violet-300/35 hover:bg-violet-300/10"><span><span className="mr-2 text-violet-300">◇</span>Lost</span><strong className="rounded-full bg-slate-950/60 px-2 py-0.5 text-violet-200">{lostZone.length}</strong></button></div>
          {poisonImmunityNextPredatorAttack || rovLightsActive || nextOnPlayAttackBonus || (round > 0 && round <= supportBlockedUntilRound) ? <div className="mt-2 flex flex-wrap gap-1">{poisonImmunityNextPredatorAttack ? <span className="rounded-full bg-emerald-400/15 px-2 py-1 text-[9px] font-bold text-emerald-200">Poison immune</span> : null}{rovLightsActive ? <span className="rounded-full bg-cyan-400/15 px-2 py-1 text-[9px] font-bold text-cyan-200">ROV lights</span> : null}{nextOnPlayAttackBonus ? <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[9px] font-bold text-amber-200">+{nextOnPlayAttackBonus.amount} next attack</span> : null}{round > 0 && round <= supportBlockedUntilRound ? <span className="rounded-full bg-rose-400/15 px-2 py-1 text-[9px] font-bold text-rose-200">Support locked</span> : null}</div> : null}

          <section className="mt-3 flex min-h-48 flex-1 flex-col overflow-hidden rounded-xl border border-cyan-300/20 bg-slate-950/35 p-2" aria-label="Your hand card list">
            <div className="flex items-center justify-between px-1 pb-2"><div><h3 className="text-sm font-black uppercase tracking-[0.16em] text-cyan-200">Your hand</h3><p className="text-xs text-slate-400">Click a card for details</p></div><span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-cyan-400/10 px-2 text-sm font-black text-cyan-200" aria-label={`${hand.length} cards in hand`}>{hand.length}</span></div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {hand.length ? hand.map((cardId, cardIndex) => { const card = cardsById[cardId]; const error = getPlayError(card); return (
                <button key={`${cardId}-${cardIndex}`} type="button" onClick={() => { setSelectedHandCard(cardId); setHandPopoverCardId(cardId); setPlayError(""); }} className={`group grid w-full grid-cols-[3.6rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border p-1.5 text-left transition hover:border-cyan-300/45 hover:bg-cyan-300/10 ${isSetup && !error ? "seapals-setup-playable-card border-emerald-300/60 bg-emerald-400/15" : "border-white/10 bg-white/5"}`}>
                  <span className="seapals-card-art-well relative h-20 overflow-hidden rounded-md shadow"><img src={card?.image} alt={card?.name} className="h-full w-full object-contain" /></span>
                  <span className="min-w-0"><strong className="block truncate text-sm text-white">{card?.name}</strong><span className="mt-1 block truncate text-xs font-semibold text-slate-300">{getCardClassLabel(card)}</span><span className={`mt-1 block text-xs font-bold ${error ? "text-rose-300" : "text-emerald-300"}`}>{error ? "Unavailable" : "Ready to play"}</span></span>
                  <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-black text-emerald-200">{getPlayerCardPlayCost(card)} RP</span>
                </button>
              ); }) : <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-slate-500">Your hand is empty.</div>}
            </div>
          </section>
        </div>

        {handPopoverCard ? (
          <>
            <button type="button" aria-label="Close hand card details" onClick={() => setHandPopoverCardId(null)} className="fixed inset-0 z-40 hidden bg-slate-950/25 xl:block" />
            <aside className="seapals-hud-panel fixed right-[21.5rem] top-1/2 z-50 hidden w-[24rem] max-w-[calc(100vw-23rem)] -translate-y-1/2 rounded-2xl border border-cyan-300/30 p-4 shadow-[0_28px_90px_rgba(0,0,0,.65)] xl:block" aria-label={`${handPopoverCard.name} details`}>
              <div className="mb-3 flex items-start justify-between gap-3"><div><div className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">Card details</div><h3 className="text-lg font-black text-white">{handPopoverCard.name}</h3></div><button type="button" onClick={() => setHandPopoverCardId(null)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10">Close</button></div>
              <div className="seapals-card-art-well rounded-xl border border-cyan-200/15 p-3 shadow-inner"><img src={handPopoverCard.image} alt={handPopoverCard.name} className="h-[46dvh] max-h-[420px] min-h-[250px] w-full object-contain" /></div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-bold"><span className="rounded-full bg-cyan-400/15 px-2 py-1 text-cyan-200">{getCardClassLabel(handPopoverCard)}</span><span className="rounded-full bg-emerald-400/15 px-2 py-1 text-emerald-200">{getPlayerCardPlayCost(handPopoverCard)} RP</span>{Number(handPopoverCard.victoryPoints ?? 0) > 0 ? <span className="rounded-full bg-amber-400/15 px-2 py-1 text-amber-200">{handPopoverCard.victoryPoints} VP</span> : null}</div>
              {handPopoverCard.text ? <p className="mt-3 max-h-20 overflow-y-auto rounded-xl bg-slate-950/45 p-3 text-[11px] leading-relaxed text-slate-300">{handPopoverCard.text}</p> : null}
              {handPopoverPlayError ? <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs leading-relaxed text-rose-200">{handPopoverPlayError}</div> : null}
              <button type="button" disabled={Boolean(handPopoverPlayError)} onClick={() => { const cardId = handPopoverCardId; setHandPopoverCardId(null); playCardFromHand(cardId); }} className="mt-3 w-full rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-950 shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-slate-600 disabled:to-slate-600 disabled:text-slate-300">Play card</button>
            </aside>
          </>
        ) : null}

        <div className="seapals-hud-panel hidden rounded-2xl border border-cyan-400/20 p-3 shadow-xl xl:col-start-2 xl:row-start-2 xl:flex xl:min-h-0 xl:flex-col">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-white">Recent events</h2>
              <p className="text-xs text-cyan-100/55">Latest game resolutions</p>
            </div>
            <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-cyan-200">Live</span>
          </div>
          <ol className="space-y-2 overflow-y-auto rounded-xl border border-white/5 bg-slate-950/65 p-3 text-xs leading-relaxed text-slate-100 xl:min-h-0 xl:flex-1" aria-live="polite">
            {log.slice(0, 4).map((entry, index) => (
              <li key={`${entry}-${index}`} className={index === 0 ? "font-semibold text-cyan-300" : "text-slate-300"}>
                {entry}
              </li>
            ))}
          </ol>
        </div>

        <div className="hidden xl:col-start-2 xl:row-start-3 xl:block">
          <button type="button" onClick={endTurn} disabled={Boolean(gameResult) || opponentThinking || (isSetup && !hasCoralInPlay) || isStartOfTurn} className="seapals-turn-button w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-4 py-4 text-base font-black text-slate-950 shadow-xl transition hover:brightness-110 disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40">{opponentThinking ? "Opponent Thinking…" : isSetup ? "Begin Round 1" : "End Turn"}</button>
        </div>
      </section>

      {inspectedCardData ? (
        <>
          <button type="button" aria-label="Close card inspector" onClick={() => setInspectedCard(null)} className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm" />
          <aside className="seapals-card-drawer seapals-hud-panel fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-cyan-300/30 p-6 text-slate-100 shadow-2xl" aria-label={`${inspectedCardData.name} card inspector`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">{inspectedCard.foundation ? inspectedCard.owner === "player" ? "Your Foundation" : "Opponent Foundation" : inspectedCard.owner === "player" ? "Your Creature" : "Opponent Creature"}</div>
                <h2 className="mt-1 text-2xl font-black text-white">{inspectedCardData.name}</h2>
              </div>
              <button type="button" onClick={() => setInspectedCard(null)} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">Close</button>
            </div>
            <img src={inspectedCardData.image} alt={inspectedCardData.name} className="mt-5 h-96 w-full rounded-3xl border border-white/10 bg-slate-950/45 object-contain" />
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-cyan-400/15 px-3 py-1 text-cyan-200">{inspectedCardData.category}</span>
              {inspectedCardData.defense ? <span className="rounded-full bg-indigo-400/15 px-3 py-1 text-indigo-200">Defense {inspectedCardData.defense?.dice ?? inspectedCardData.defense}</span> : null}
              {Number(inspectedCardData.victoryPoints ?? 0) > 0 ? <span className="rounded-full bg-amber-400/15 px-3 py-1 text-amber-200">{inspectedCardData.victoryPoints} VP</span> : null}
            </div>
            {inspectedCard.owner === "player" && (creatureStatuses[inspectedActionKey] ?? []).length ? (
              <div className="mt-4 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">
                <strong className="block">Active protection</strong>
                {(creatureStatuses[inspectedActionKey] ?? []).map((status, index) => (
                  <div key={`${status.sourceCardId}-${status.type}-${index}`}>
                    {cardsById[status.sourceCardId]?.name ?? "An ally"}: {status.type === "defenseAdvantage" ? "roll defense with advantage" : `add ${status.dice} to defense`} until your next turn
                  </div>
                ))}
              </div>
            ) : null}
            {inspectedCardData.text ? <p className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-slate-300">{inspectedCardData.text}</p> : null}
            {(inspectedCardData.passives ?? []).length ? (
              <section className="mt-5">
                <h3 className="font-black text-white">Passive abilities</h3>
                <div className="mt-2 space-y-2">
                  {inspectedCardData.passives.map((passive, index) => {
                    const passiveText = typeof passive === "string" ? passive : passive.text;
                    const passiveName = typeof passive === "object" ? passive.name : passiveText.split(":")[0];
                    const heal = getPassiveCoralHeal(passive);
                    const damageCounterMove = getDamageCounterMove(passive);
                    const jointedStructureMove = getJointedStructureMove(passive);
                    const damageCounterAvailability = damageCounterMove && inspectedCard.owner === "player"
                      ? getDamageCounterMoveAvailability(passive, inspectedCard.coralId)
                      : null;
                    const isActionPhasePassive = Boolean(heal || damageCounterMove || /once per turn|as often as you like on your turn/i.test(passiveText ?? ""));
                    const actionKey = `${inspectedActionKey}:${typeof passive === "object" ? passive.id ?? passiveName : passiveName}`;
                    const alreadyUsed = usedCreatureActions.includes(actionKey);
                    return (
                      <div key={passive.id ?? index} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                        <strong>{passiveName ? `${passiveName}: ` : ""}</strong>
                        {typeof passive === "string" && passiveText.includes(":") ? passiveText.slice(passiveText.indexOf(":") + 1).trim() : passiveText}
                        {inspectedCard.owner === "player" && heal ? (
                          <button type="button" disabled={gamePhase !== "main" || alreadyUsed} onClick={() => beginPassiveCoralHeal(passive)} className="mt-3 w-full rounded-full bg-emerald-600 px-4 py-2 font-bold text-white disabled:bg-slate-400">
                            {alreadyUsed ? "Used This Turn" : `Use ${heal.actionName}`}
                          </button>
                        ) : null}
                        {inspectedCard.owner === "player" && damageCounterMove ? (
                          <>
                            <button type="button" disabled={Boolean(damageCounterAvailability?.reason)} onClick={() => beginDamageCounterMove(passive)} className="mt-3 w-full rounded-full bg-violet-600 px-4 py-2 font-bold text-white disabled:bg-slate-400">
                              Use {damageCounterMove.actionName}
                            </button>
                            {damageCounterAvailability?.reason ? <div className="mt-2 rounded-xl bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200">{damageCounterAvailability.reason}</div> : null}
                          </>
                        ) : null}
                        {inspectedCard.owner === "player" && jointedStructureMove ? (
                          <button type="button" disabled={gamePhase !== "main" || alreadyUsed} onClick={() => beginJointedStructureMove(passive)} className="mt-3 w-full rounded-full bg-cyan-600 px-4 py-2 font-bold text-white disabled:bg-slate-400">
                            {alreadyUsed ? "Used This Turn" : `Use ${jointedStructureMove.actionName}`}
                          </button>
                        ) : null}
                        {isActionPhasePassive && !heal && !damageCounterMove && !jointedStructureMove ? <div className="mt-2 rounded-xl bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200">This action-phase passive is visible for teaching, but its interactive resolution is not implemented yet.</div> : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {(inspectedCardData.onPlay ?? []).length ? (
              <section className="mt-5">
                <h3 className="font-black text-white">On play</h3>
                <div className="mt-2 space-y-2">{inspectedCardData.onPlay.map((action, index) => { const actionName = typeof action === "string" ? action.split(":")[0] : action.name; const actionText = typeof action === "string" ? action.slice(action.indexOf(":") + 1).trim() : action.text; return <div key={action.id ?? index} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300"><strong className="text-white">{actionName ? `${actionName}: ` : ""}</strong>{actionText}</div>; })}</div>
              </section>
            ) : null}
            {(inspectedCardData.actions ?? []).length ? (
              <section className="mt-5">
                <h3 className="font-black text-white">Actions</h3>
                <div className="mt-2 space-y-2">{inspectedCardData.actions.map((action, index) => {
                  const utilityEffect = getSupportedUtilityEffect(action);
                  const actionName = typeof action === "string" ? action.split(":")[0] : action.name;
                  const actionText = typeof action === "string" ? action.slice(action.indexOf(":") + 1).trim() : action.text ?? "Action ability";
                  const actionKey = `${inspectedActionKey}:${action.id ?? actionName}`;
                  const cost = Number(action.cost?.rp ?? actionText.match(/cost:\s*(\d+)\s*rp/i)?.[1] ?? 0);
                  const alreadyUsed = actionIsOncePerTurn(action) && usedCreatureActions.includes(actionKey);
                  return (
                    <div key={action.id ?? index} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                      <strong>{actionName}: </strong>{actionText}
                      {inspectedCard.owner === "player" && utilityEffect ? (
                        <button type="button" disabled={gamePhase !== "main" || rp < cost || alreadyUsed} onClick={() => beginCreatureUtilityAction(action)} className="mt-3 w-full rounded-full bg-cyan-600 px-4 py-2 font-bold text-white disabled:bg-slate-400">
                          {alreadyUsed ? "Used This Turn" : `Use Action (${cost} RP)`}
                        </button>
                      ) : null}
                      {inspectedCard.owner === "player" && !utilityEffect && !parseLegacyAttackAction(action) && !getActionEffects(action).some((effect) => effect.type === EffectType.ATTACK) ? <div className="mt-2 rounded-xl bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200">This action is not implemented yet.</div> : null}
                    </div>
                  );
                })}</div>
              </section>
            ) : null}
            {inspectedCard.owner === "player" && getBasicAttackEffect(inspectedCardData) ? (
              <button
                type="button"
                disabled={gamePhase !== "main" || usedAttackers.includes(inspectedActionKey) || turn < Number(actionCooldowns[inspectedActionKey] ?? 0) || rp < getBasicAttackEffect(inspectedCardData).actionCost}
                onClick={() => {
                  attackWithCreature(inspectedCard.coralId, inspectedCard.slotId);
                  setInspectedCard(null);
                }}
                className="mt-6 w-full rounded-full bg-rose-600 px-6 py-3 font-black text-white disabled:bg-slate-400"
              >
                {turn < Number(actionCooldowns[inspectedActionKey] ?? 0) ? "Unavailable This Turn" : usedAttackers.includes(inspectedActionKey) ? "Action Already Used" : `Use ${getBasicAttackEffect(inspectedCardData).actionName} (${getBasicAttackEffect(inspectedCardData).actionCost} RP)`}
              </button>
            ) : null}
          </aside>
        </>
      ) : null}

      {opponentThinking ? (
        <div className="pointer-events-none fixed left-1/2 top-5 z-[85] -translate-x-1/2 rounded-full border border-cyan-300/60 bg-slate-950/95 px-6 py-3 text-white shadow-[0_12px_40px_rgba(15,23,42,0.55)] backdrop-blur" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">{[0, 1, 2].map((index) => <span key={index} className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-400" style={{ animationDelay: `${index * 180}ms` }} />)}</div>
            <span className="font-black">Opponent is thinking…</span>
            <span className="hidden text-xs text-slate-300 sm:inline">Reviewing RP, cards, targets, and VP</span>
          </div>
        </div>
      ) : null}

      {eventOverlay ? (
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/80 p-3 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={eventOverlay.title}>
          <div className="seapals-event-card my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl overflow-y-auto rounded-[1.5rem] border border-cyan-300/50 bg-slate-900 p-4 text-white shadow-2xl sm:max-h-[calc(100dvh-2.5rem)] sm:rounded-[2rem] sm:p-6">
            <div className={eventOverlay.sourceCardId ? "grid gap-6 md:grid-cols-[260px_1fr]" : "mx-auto max-w-3xl text-center"}>
              {eventOverlay.sourceCardId ? <div className={`rounded-3xl bg-white/10 p-4 ${eventOverlay.defenderCardId ? "grid grid-cols-2 gap-2 md:grid-cols-1" : ""}`}>
                {eventOverlay.sourceCardId ? <img src={cardsById[eventOverlay.sourceCardId]?.image} alt={cardsById[eventOverlay.sourceCardId]?.name} className="h-80 w-full rounded-2xl bg-white object-contain" /> : null}
                {eventOverlay.defenderCardId ? <img src={cardsById[eventOverlay.defenderCardId]?.image} alt={cardsById[eventOverlay.defenderCardId]?.name} className="h-80 w-full rounded-2xl bg-white object-contain" /> : null}
              </div> : null}
              <div className="flex flex-col justify-center">
                <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Game Event</div>
                <h2 className="mt-2 text-3xl font-black md:text-4xl">{eventOverlay.title}</h2>
                {!["condition-reveal", "opponent-status"].includes(eventOverlay.type) && eventOverlay.message ? <p className="mt-4 text-lg text-slate-200">{eventOverlay.message}</p> : null}
                {eventOverlay.type === "condition-reveal" ? (
                  <div className="mt-6 text-left">
                    <section className="rounded-2xl border border-violet-300/30 bg-violet-400/10 p-4">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-300">Round condition</div>
                      <h3 className="mt-1 text-xl font-black text-white">{eventOverlay.conditionName}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-violet-100/85">{eventOverlay.conditionText}</p>
                    </section>
                    <section className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">Start of your turn</div>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <div className="rounded-xl bg-slate-950/45 px-3 py-3 text-center"><strong className="block text-3xl font-black tabular-nums text-emerald-200">+{eventOverlay.turnCollection?.collected ?? 0}</strong><span className="text-[10px] font-black uppercase tracking-wider text-emerald-100/60">RP</span></div>
                        <div className="rounded-xl bg-slate-950/45 px-3 py-3 text-center"><strong className="block text-3xl font-black tabular-nums text-cyan-100">{eventOverlay.turnCollection?.bank ?? 0}/{eventOverlay.turnCollection?.cap ?? playerRpCap}</strong><span className="text-[10px] font-black uppercase tracking-wider text-cyan-100/60">Bank</span></div>
                        <div className={`col-span-2 rounded-xl px-3 py-3 text-center sm:col-span-1 ${eventOverlay.turnCollection?.capped ? "bg-amber-400/15" : "bg-slate-950/45"}`}><strong className={`block text-3xl font-black tabular-nums ${eventOverlay.turnCollection?.capped ? "text-amber-200" : "text-slate-300"}`}>{eventOverlay.turnCollection?.capped ?? 0}</strong><span className="text-[10px] font-black uppercase tracking-wider text-slate-300/60">Capped</span></div>
                      </div>
                    </section>
                    {eventOverlay.roundNotes?.length ? <ul className="mt-4 space-y-1 text-xs leading-relaxed text-slate-400">{eventOverlay.roundNotes.map((note) => <li key={note}>• {note}</li>)}</ul> : null}
                    <button type="button" onClick={closeEventOverlay} className="mt-5 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 px-7 py-3 font-black text-slate-950 shadow-lg">Continue</button>
                  </div>
                ) : eventOverlay.type === "opponent-status" ? (
                  <div className="mt-6 text-left">
                    <section className="rounded-2xl border border-rose-300/25 bg-rose-400/10 p-4">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-rose-300">Start of opponent&apos;s turn</div>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-xl bg-slate-950/45 px-3 py-3 text-center">
                          <strong className="block text-3xl font-black tabular-nums text-emerald-200">+{eventOverlay.turnCollection?.collected ?? 0}</strong>
                          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-100/60">RP</span>
                          <span className="mt-1 block text-[10px] text-slate-400">{eventOverlay.turnCollection?.available ?? 0} available</span>
                        </div>
                        <div className="rounded-xl bg-slate-950/45 px-3 py-3 text-center">
                          <strong className="block text-3xl font-black tabular-nums text-cyan-100">{eventOverlay.turnCollection?.bank ?? 0}/{eventOverlay.turnCollection?.cap ?? 0}</strong>
                          <span className="text-[10px] font-black uppercase tracking-wider text-cyan-100/60">Bank</span>
                        </div>
                        <div className={`rounded-xl px-3 py-3 text-center ${eventOverlay.turnCollection?.capped ? "bg-amber-400/15" : "bg-slate-950/45"}`}>
                          <strong className={`block text-3xl font-black tabular-nums ${eventOverlay.turnCollection?.capped ? "text-amber-200" : "text-slate-300"}`}>{eventOverlay.turnCollection?.capped ?? 0}</strong>
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-300/60">Capped</span>
                        </div>
                        <div className={`rounded-xl px-3 py-3 text-center ${eventOverlay.turnCollection?.drawShortfall ? "bg-rose-400/15" : "bg-slate-950/45"}`}>
                          <strong className={`block text-3xl font-black tabular-nums ${eventOverlay.turnCollection?.drawShortfall ? "text-rose-200" : "text-violet-200"}`}>{eventOverlay.turnCollection?.drawn ?? 0}</strong>
                          <span className="text-[10px] font-black uppercase tracking-wider text-violet-100/60">Drawn</span>
                          <span className="mt-1 block text-[10px] text-slate-400">F {eventOverlay.turnCollection?.foundationDrawn ?? 0} · P {eventOverlay.turnCollection?.palsDrawn ?? 0}{Number(eventOverlay.turnCollection?.requestedDraws ?? 0) > 0 ? ` · ${eventOverlay.turnCollection.requestedDraws} due` : ""}</span>
                        </div>
                      </div>
                    </section>
                    {activeCondition ? (
                      <section className="mt-4 rounded-2xl border border-violet-300/25 bg-violet-400/10 p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Condition this round</div>
                        <strong className="mt-1 block text-sm text-violet-100">{activeCondition.name}</strong>
                        {activeCondition.text ? <p className="mt-1 text-xs leading-relaxed text-violet-100/70">{activeCondition.text}</p> : null}
                      </section>
                    ) : null}
                    {eventOverlay.turnCollection?.drawShortfall ? <div className="mt-3 rounded-xl bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-200">Missing {eventOverlay.turnCollection.drawShortfall} required draw{eventOverlay.turnCollection.drawShortfall === 1 ? "" : "s"}.</div> : null}
                    {eventOverlay.turnCollection?.handLimitDiscarded ? <div className="mt-3 rounded-xl bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200">{eventOverlay.turnCollection.handLimitDiscarded} excess card{eventOverlay.turnCollection.handLimitDiscarded === 1 ? " was" : "s were"} discarded at the hand limit.</div> : null}
                    <button type="button" onClick={closeEventOverlay} className="mt-5 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 px-7 py-3 font-black text-slate-950 shadow-lg">Continue</button>
                  </div>
                ) : eventOverlay.type === "new-game-setup" ? (
                  <div className="mt-6 text-left">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="rounded-2xl border-2 border-emerald-400 bg-emerald-400/10 p-4"><span className="block text-xs font-black uppercase tracking-wider text-emerald-300">Your Deck</span><select value={selectedDeckId} onChange={(event) => setSelectedDeckId(event.target.value)} className="mt-2 w-full rounded-xl bg-slate-950 px-3 py-3 font-bold text-white">{prebuiltDecks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label>
                      <label className="rounded-2xl border-2 border-rose-400 bg-rose-400/10 p-4"><span className="block text-xs font-black uppercase tracking-wider text-rose-300">Opponent Deck</span><select value={selectedOpponentDeckId} onChange={(event) => setSelectedOpponentDeckId(event.target.value)} className="mt-2 w-full rounded-xl bg-slate-950 px-3 py-3 font-bold text-white">{prebuiltDecks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label>
                    </div>
                    <fieldset className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4">
                      <legend className="px-1 text-xs font-black uppercase tracking-wider text-amber-200">Opponent Difficulty</legend>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {OPPONENT_DIFFICULTY_OPTIONS.map((option) => {
                          const selected = pendingOpponentDifficulty === option.id;
                          return (
                            <button key={option.id} type="button" aria-pressed={selected} onClick={() => setPendingOpponentDifficulty(option.id)} className={`rounded-xl border-2 p-3 text-left transition ${selected ? "border-amber-300 bg-amber-300/20 shadow-[0_0_22px_rgba(252,211,77,0.2)]" : "border-white/10 bg-slate-950/35 hover:border-amber-300/45 hover:bg-amber-300/10"}`}>
                              <strong className={`block text-base ${selected ? "text-amber-100" : "text-white"}`}>{option.label}</strong>
                              <span className="mt-1 block text-xs leading-relaxed text-slate-300">{option.description}</span>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                    <label className="mt-4 block rounded-2xl border border-cyan-400 bg-cyan-400/10 p-4"><span className="text-xs font-black uppercase tracking-wider text-cyan-300">Victory Target</span><select value={pendingVictoryTarget} onChange={(event) => setPendingVictoryTarget(Number(event.target.value))} className="ml-4 rounded-xl bg-slate-950 px-3 py-2 font-bold text-white"><option value={10}>10 VP — Teaching Game</option><option value={30}>30 VP — Full Game</option></select></label>
                    <div className="mt-4 rounded-2xl bg-white/5 p-4 text-sm text-slate-300"><strong className="text-white">How a turn works:</strong> reveal the round condition, collect and cap RP, choose your draw(s), play legal cards and actions, then end your turn. Every illegal play explains what is missing before you commit.</div>
                    <div className="mt-5 flex flex-wrap justify-end gap-3">{!eventOverlay.initial ? <button type="button" onClick={closeEventOverlay} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Keep Current Game</button> : null}<button type="button" onClick={() => restartGame(selectedDeckId, selectedOpponentDeckId, pendingVictoryTarget, pendingOpponentDifficulty)} className="rounded-full bg-emerald-500 px-7 py-3 font-black text-slate-950">{eventOverlay.initial ? "Let's Begin!" : "Start New Game"}</button></div>
                  </div>
                ) : eventOverlay.type === "opponent-thinking" ? (
                  <div className="mt-8 flex flex-col items-center">
                    <div className="flex items-center gap-2" aria-label="Opponent is thinking">
                      {[0, 1, 2].map((index) => <span key={index} className="h-4 w-4 animate-pulse rounded-full bg-cyan-400" style={{ animationDelay: `${index * 180}ms` }} />)}
                    </div>
                    <div className="mt-5 w-full max-w-md overflow-hidden rounded-full bg-white/10"><div className="h-2 w-2/3 animate-pulse rounded-full bg-gradient-to-r from-cyan-500 via-emerald-400 to-cyan-500" /></div>
                    <p className="mt-4 text-sm text-slate-400">{opponentDifficultyProfile.label} opponent is evaluating cards, available RP, targets, and victory points…</p>
                  </div>
                ) : eventOverlay.type === "turn-transition" ? (
                  <div className="mt-6">
                    <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-cyan-300/30 bg-slate-950/60 p-3 text-left shadow-inner">
                      {(eventOverlay.actions?.length ? eventOverlay.actions : ["No actions were recorded."]).map((action, index) => (
                        <div key={`${index}-${action}`} className="grid grid-cols-[2rem_1fr] gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm leading-6 text-slate-200">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/20 text-xs font-black text-cyan-200">{index + 1}</span>
                          <span>{action}</span>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={closeEventOverlay} className="mt-5 rounded-full bg-cyan-600 px-7 py-3 font-black text-white">Continue</button>
                  </div>
                ) : eventOverlay.type === "choose-regenerate" ? (
                  <div className="mt-6">
                    <div className="rounded-2xl border border-emerald-400/50 bg-emerald-400/10 p-4 text-left text-sm text-emerald-100">Regenerate is optional. Spending is applied only after you choose it; declining will discard the defeated creature and resolve any Toxic effect.</div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button type="button" disabled={rp < Number(eventOverlay.regenerate?.decision?.cost ?? 1)} onClick={() => resolvePlayerRegenerateChoice("regenerate")} className="rounded-full bg-emerald-500 px-6 py-3 font-black text-slate-950 disabled:opacity-40">Spend 1 RP &amp; Keep</button>
                      <button type="button" onClick={() => resolvePlayerRegenerateChoice("discard")} className="rounded-full border border-rose-400 px-6 py-3 font-black text-rose-100">Decline &amp; Discard</button>
                    </div>
                  </div>
                ) : eventOverlay.type === "choose-oceanic-sacrifice" ? (
                  <div className="mt-6">
                    <div className="grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
                      {(searchContext?.choices ?? []).map((choice) => (
                        <button key={choice.id} type="button" onClick={() => completePlayerOceanicPlay(searchContext.cardId, choice.id)} className="rounded-2xl border-2 border-rose-400 bg-rose-400/10 p-4 text-left transition hover:bg-rose-400/25">
                          <span className="mb-3 block text-xs font-black uppercase tracking-widest text-rose-200">{choice.kind === "predator" ? "Sacrifice one Predator" : "Sacrifice two Fish"}</span>
                          <span className="flex gap-3">{choice.candidates.map((candidate) => <span key={candidate.instanceId} className="min-w-0 flex-1"><img src={candidate.card?.image} alt={candidate.card?.name} className="h-32 w-full rounded-xl bg-white object-contain" /><strong className="mt-2 block truncate text-sm">{candidate.card?.name}</strong></span>)}</span>
                        </button>
                      ))}
                    </div>
                    <button type="button" onClick={() => { setSearchContext(null); setEventOverlay(null); setPlayError("Oceanic sacrifice canceled. No card or RP was spent."); }} className="mt-4 rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel — Spend Nothing</button>
                  </div>
                ) : eventOverlay.type === "choose-invasive-placement" ? (
                  <div className="mt-6">
                    <div className="grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
                      {(searchContext?.candidates ?? []).map((candidate) => {
                        const coral = opponentCorals.find((entry) => entry.id === candidate.coralId);
                        const coralCard = cardsById[coral?.cardId];
                        const slot = coral?.slots.find((entry) => entry.id === candidate.slotId);
                        if (!coral || !slot || slot.cardId) return null;
                        return (
                          <button key={`${candidate.coralId}-${candidate.slotId}`} type="button" onClick={() => completeInvasivePlacement(candidate.coralId, candidate.slotId)} className="flex items-center gap-4 rounded-2xl border-2 border-emerald-400 bg-emerald-400/10 p-3 text-left transition hover:bg-emerald-400/25">
                            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-emerald-300/60 bg-slate-950/70"><img src={getSlotIconPath(slot)} alt={`${slot.type} slot`} className="h-12 w-12 object-contain" /></span>
                            <span><strong className="block text-base text-white">{coralCard?.name}</strong><span className="mt-1 block text-sm capitalize text-emerald-200">Empty {slot.type} slot</span></span>
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" onClick={() => { setSearchContext(null); setEventOverlay(null); setPlayError("Invasive placement canceled. No card or RP was spent."); }} className="mt-4 rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel &mdash; Spend Nothing</button>
                  </div>
                ) : eventOverlay.type === "choose-scientist-jes" ? (
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <button type="button" onClick={() => chooseScientistJes("search")} className="rounded-2xl border-2 border-amber-400 bg-amber-400/10 p-5 text-left hover:bg-amber-400/25"><strong className="block text-lg">Search for a Habitat</strong><span className="mt-1 block text-sm text-amber-100">Reveal one Habitat from either personal deck and add it to your hand.</span></button>
                    <button type="button" onClick={() => chooseScientistJes("draw")} className="rounded-2xl border-2 border-cyan-400 bg-cyan-400/10 p-5 text-left hover:bg-cyan-400/25"><strong className="block text-lg">Draw Two Cards</strong><span className="mt-1 block text-sm text-cyan-100">Allocate both draws between Foundation and Pals.</span></button>
                    <button type="button" onClick={() => chooseScientistJes("cancel")} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold sm:col-span-2">Cancel — Spend Nothing</button>
                  </div>
                ) : eventOverlay.type === "choose-impact-target" ? (
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {opponentCorals.filter((coral) => eventOverlay.targetCoralIds.includes(coral.id)).map((coral) => {
                      const card = cardsById[coral.cardId];
                      return (
                        <button key={coral.id} type="button" onClick={() => damageOpponentFoundation(coral.id, eventOverlay.amount, cardsById[eventOverlay.sourceCardId])} className="flex items-center gap-3 rounded-2xl border-2 border-emerald-400 bg-emerald-400/10 p-3 text-left transition hover:bg-emerald-400/25">
                          <img src={card?.image} alt={card?.name} className="h-28 w-20 rounded-xl bg-white object-contain" />
                          <span><strong className="block">{card?.name}</strong><span className="text-sm text-emerald-200">{coral.health}/{coral.maxHealth} HP</span></span>
                        </button>
                      );
                    })}
                  </div>
                ) : eventOverlay.type === "choose-territorial-target" ? (
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {playerCorals.filter((foundation) => searchContext?.candidates.includes(foundation.id)).map((foundation) => {
                      const card = cardsById[foundation.cardId];
                      return <button key={foundation.id} type="button" onClick={() => completeTerritorialTarget(foundation.id)} className="flex items-center gap-3 rounded-2xl border-2 border-amber-400 bg-amber-400/10 p-3 text-left transition hover:bg-amber-400/25"><img src={card?.image} alt={card?.name} className="h-28 w-20 rounded-xl bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-sm text-amber-200">{foundation.health}/{foundation.maxHealth} HP before Territorial</span></span></button>;
                    })}
                  </div>
                ) : eventOverlay.type === "choose-neural-network-source" ? (
                  <div className="mt-6 grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
                    {playerCoralCards.filter((coral) => searchContext?.candidates.includes(coral.id)).map((coral) => {
                      const card = cardsById[coral.cardId];
                      const counterHp = Number(searchContext?.counterHp ?? DAMAGE_COUNTER_HP);
                      return (
                        <button key={coral.id} type="button" onClick={() => chooseDamageCounterSource(coral.id)} className="flex items-center gap-3 rounded-2xl border-2 border-violet-400 bg-violet-400/10 p-3 text-left transition hover:bg-violet-400/25">
                          <img src={card?.image} alt={card?.name} className="h-28 w-20 rounded-xl bg-white object-contain" />
                          <span><strong className="block">{card?.name}</strong><span className="text-sm text-violet-200">{coral.health}/{coral.maxHealth} HP → {Number(coral.health) + counterHp}/{coral.maxHealth} HP</span></span>
                        </button>
                      );
                    })}
                    <button type="button" onClick={() => { setSearchContext(null); setEventOverlay(null); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold sm:col-span-2">Cancel — Move Nothing</button>
                  </div>
                ) : eventOverlay.type === "choose-neural-network-destination" ? (
                  <div className="mt-6 grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
                    {playerCoralCards.filter((coral) => searchContext?.candidates.includes(coral.id)).map((coral) => {
                      const card = cardsById[coral.cardId];
                      const counterHp = Number(searchContext?.counterHp ?? DAMAGE_COUNTER_HP);
                      return (
                        <button key={coral.id} type="button" onClick={() => completeDamageCounterMove(coral.id)} className="flex items-center gap-3 rounded-2xl border-2 border-violet-400 bg-violet-400/10 p-3 text-left transition hover:bg-violet-400/25">
                          <img src={card?.image} alt={card?.name} className="h-28 w-20 rounded-xl bg-white object-contain" />
                          <span><strong className="block">{card?.name}</strong><span className="text-sm text-violet-200">{coral.health}/{coral.maxHealth} HP → {Number(coral.health) - counterHp}/{coral.maxHealth} HP</span></span>
                        </button>
                      );
                    })}
                    <button type="button" onClick={() => { setSearchContext(null); setEventOverlay(null); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold sm:col-span-2">Cancel — Move Nothing</button>
                  </div>
                ) : eventOverlay.type === "choose-symbiosis-card" ? (
                  <div className="mt-6 grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
                    {(searchContext?.candidates ?? []).map((cardId, index) => { const card = cardsById[cardId]; return <button key={`${cardId}-${index}`} type="button" onClick={() => completeSymbiosis(cardId)} className="flex items-center gap-3 rounded-2xl border-2 border-fuchsia-400 bg-fuchsia-400/10 p-3 text-left hover:bg-fuchsia-400/25"><img src={card?.image} alt={card?.name} className="h-24 w-16 rounded-lg bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-sm text-fuchsia-200">Host inside Anemone</span></span></button>; })}
                  </div>
                ) : eventOverlay.type === "choose-onplay-multi-search" ? (
                  <div className="mt-6">
                    <div className="grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">{(searchContext?.candidates ?? []).map((cardId) => { const card = cardsById[cardId]; const selectedCopies = searchContext.selected.filter((selectedId) => selectedId === cardId).length; const availableCopies = [...foundationDeck, ...palsDeck].filter((candidateId) => candidateId === cardId).length; return <button key={cardId} type="button" onClick={() => toggleOnPlaySearchCard(cardId)} className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left ${selectedCopies ? "border-emerald-400 bg-emerald-400/25" : "border-slate-500 bg-white/5"}`}><img src={card?.image} alt={card?.name} className="h-24 w-16 rounded-lg bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-sm text-cyan-200">{selectedCopies ? `Selected ${selectedCopies}/${Math.min(availableCopies, searchContext.max)}` : availableCopies > 1 ? `${availableCopies} copies available` : "Select"}</span></span></button>; })}</div>
                    <div className="mt-4 flex gap-3"><button type="button" onClick={() => completeOnPlayMultiSearch()} className="rounded-full bg-emerald-500 px-6 py-3 font-black">Confirm {searchContext?.selected.length ?? 0}/{searchContext?.max ?? 0}</button><button type="button" onClick={() => completeOnPlayMultiSearch([])} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Choose No Cards</button></div>
                  </div>
                ) : eventOverlay.type === "choose-school-momentum" ? (
                  <div className="mt-6 grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
                    {(searchContext?.candidates ?? []).map((cardId) => { const card = cardsById[cardId]; return <button key={cardId} type="button" onClick={() => completeSchoolMomentum(cardId)} className="flex items-center gap-3 rounded-2xl border-2 border-amber-400 bg-amber-400/10 p-3 text-left hover:bg-amber-400/25"><img src={card?.image} alt={card?.name} className="h-24 w-16 rounded-lg bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-sm text-amber-200">{card?.stageLabel}</span></span></button>; })}
                  </div>
                ) : eventOverlay.type === "choose-inspection-deck" ? (
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {[{ type: "foundation", count: foundationDeck.length }, { type: "pals", count: palsDeck.length }].map((deck) => <button key={deck.type} type="button" disabled={!deck.count} onClick={() => chooseInspectionDeck(deck.type)} className="rounded-2xl border-2 border-cyan-400 bg-cyan-400/10 p-5 text-center font-black capitalize hover:bg-cyan-400/25 disabled:opacity-35">{deck.type} Deck<span className="mt-1 block text-sm font-semibold text-cyan-200">{deck.count} cards</span></button>)}
                    <button type="button" onClick={() => { setSearchContext(null); setEventOverlay(null); setModal("hand"); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold sm:col-span-2">Cancel Inspection</button>
                  </div>
                ) : eventOverlay.type === "reorder-deck" ? (
                  <div className="mt-6">
                    <div className="grid max-h-96 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{(searchContext?.topCards ?? []).map((cardId, index) => { const card = cardsById[cardId]; return <div key={`${cardId}-${index}`} className="rounded-2xl border border-cyan-400 bg-cyan-400/10 p-3 text-center"><img src={card?.image} alt={card?.name} className="h-40 w-full rounded-xl bg-white object-contain" /><strong className="mt-2 block truncate">{index + 1}. {card?.name}</strong><div className="mt-2 flex justify-center gap-2"><button type="button" disabled={!index} onClick={() => moveInspectedDeckCard(index, -1)} className="rounded-full border border-cyan-300 px-3 py-1 disabled:opacity-30">Earlier</button><button type="button" disabled={index === searchContext.topCards.length - 1} onClick={() => moveInspectedDeckCard(index, 1)} className="rounded-full border border-cyan-300 px-3 py-1 disabled:opacity-30">Later</button></div></div>; })}</div>
                    <div className="mt-4 flex gap-3"><button type="button" onClick={() => commitDeckInspection()} className="rounded-full bg-emerald-500 px-6 py-3 font-black">Confirm Order</button><button type="button" onClick={() => { setSearchContext(null); setEventOverlay(null); setModal("hand"); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel</button></div>
                  </div>
                ) : eventOverlay.type === "choose-explorer-card" ? (
                  <div className="mt-6">
                    <div className="grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">{(searchContext?.candidates ?? []).map((cardId, index) => { const card = cardsById[cardId]; return <button key={`${cardId}-${index}`} type="button" onClick={() => commitDeckInspection(cardId)} className="flex items-center gap-3 rounded-2xl border-2 border-emerald-400 bg-emerald-400/10 p-3 text-left hover:bg-emerald-400/25"><img src={card?.image} alt={card?.name} className="h-24 w-16 rounded-lg bg-white object-contain" /><strong>{card?.name}</strong></button>; })}</div>
                    <div className="mt-4 flex gap-3"><button type="button" onClick={() => commitDeckInspection()} className="rounded-full bg-cyan-600 px-6 py-3 font-black">Choose No Card</button><button type="button" onClick={() => { setSearchContext(null); setEventOverlay(null); setModal("hand"); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel</button></div>
                  </div>
                ) : eventOverlay.type === "choose-clear-status-target" ? (
                  <div className="mt-6 grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
                    {playerCoralCards.filter((coral) => searchContext?.candidates.includes(coral.id)).map((coral) => { const card = cardsById[coral.cardId]; const effects = [...(coral.statuses ?? []).map((status) => status.type), Number(coral.rpPenaltyNextTurn ?? 0) > 0 ? "RP penalty" : null].filter(Boolean); return <button key={coral.id} type="button" onClick={() => completeCoralStatusClear(coral.id)} className="flex items-center gap-3 rounded-2xl border-2 border-cyan-400 bg-cyan-400/10 p-3 text-left hover:bg-cyan-400/25"><img src={card?.image} alt={card?.name} className="h-28 w-20 rounded-xl bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-sm text-cyan-200">Remove {effects.join(", ")}</span></span></button>; })}
                    <button type="button" onClick={() => { setSearchContext(null); setEventOverlay(null); setModal("hand"); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold sm:col-span-2">Cancel Support</button>
                  </div>
                ) : ["choose-coin-coral-target", "choose-coral-effect-target"].includes(eventOverlay.type) ? (
                  <div className="mt-6 grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
                    {opponentCorals.filter((coral) => pendingCreatureAction?.candidates.includes(coral.id)).map((coral) => { const card = cardsById[coral.cardId]; return <button key={coral.id} type="button" onClick={() => completeCoinCoralEffect(coral.id)} className="flex items-center gap-3 rounded-2xl border-2 border-emerald-400 bg-emerald-400/10 p-3 text-left hover:bg-emerald-400/25"><img src={card?.image} alt={card?.name} className="h-28 w-20 rounded-xl bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-sm text-emerald-200">{coral.health}/{coral.maxHealth} HP</span></span></button>; })}
                    <button type="button" onClick={() => { const wasCommitted = pendingCreatureAction?.costCommitted; setPendingCreatureAction(null); setEventOverlay({ type: "utility-result", sourceCardId: pendingCreatureAction?.sourceCardId, title: wasCommitted ? "Effect Skipped" : "Action Canceled", message: wasCommitted ? "The effect was ready, but no coral was chosen. The already-paid action cost remains spent." : "No coral was chosen. No RP was spent and the action remains available.", success: false }); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold sm:col-span-2">{pendingCreatureAction?.costCommitted ? "Skip Target" : "Cancel Action"}</button>
                  </div>
                ) : eventOverlay.type === "choose-onplay-heal-target" ? (
                  <div className="mt-6 grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
                    {playerCorals.filter((coral) => searchContext?.candidates.includes(coral.id)).map((coral) => { const card = cardsById[coral.cardId]; return <button key={coral.id} type="button" onClick={() => completeOnPlayCoralHeal(coral.id)} className="flex items-center gap-3 rounded-2xl border-2 border-emerald-400 bg-emerald-400/10 p-3 text-left hover:bg-emerald-400/25"><img src={card?.image} alt={card?.name} className="h-28 w-20 rounded-xl bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-sm text-emerald-200">{coral.health}/{coral.maxHealth} HP</span></span></button>; })}
                    <button type="button" onClick={() => { const sourceCardId = searchContext?.sourceCardId; setSearchContext(null); setEventOverlay({ type: "utility-result", sourceCardId, title: "Healing Skipped", message: "The creature remains in play, but its on-play healing was skipped.", success: false }); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold sm:col-span-2">Skip Healing</button>
                  </div>
                ) : eventOverlay.type === "choose-whirlpool-target" ? (
                  <div className="mt-6 grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
                    {opponentCorals.filter((coral) => searchContext?.candidates.includes(coral.id)).map((coral) => { const card = cardsById[coral.cardId]; return <button key={coral.id} type="button" onClick={() => completeWhirlpool(coral.id)} className="flex items-center gap-3 rounded-2xl border-2 border-cyan-400 bg-cyan-400/10 p-3 text-left hover:bg-cyan-400/25"><img src={card?.image} alt={card?.name} className="h-28 w-20 rounded-xl bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-sm text-cyan-200">Current penalty: {Number(coral.rpPenaltyNextTurn ?? 0)} RP</span></span></button>; })}
                    <button type="button" onClick={() => { setSearchContext(null); setEventOverlay(null); setModal("hand"); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel Effect</button>
                  </div>
                ) : eventOverlay.type === "choose-spearfishing-target" ? (
                  <div className="mt-6 max-h-80 space-y-2 overflow-y-auto">
                    {(searchContext?.candidates ?? []).map((candidate) => {
                      const card = cardsById[candidate.cardId];
                      return <button key={`${candidate.coralId}-${candidate.slotId}`} type="button" onClick={() => completeSpearfishing(candidate)} className="flex w-full items-center gap-3 rounded-2xl border-2 border-rose-400 bg-rose-400/10 p-3 text-left transition hover:bg-rose-400/25"><img src={card?.image} alt={card?.name} className="h-24 w-16 rounded-lg bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-sm text-rose-200">Discard to recover {Number(card?.cost?.rp ?? 0)} RP</span></span></button>;
                    })}
                    <button type="button" onClick={() => { setSearchContext(null); setEventOverlay(null); setModal("hand"); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel Spearfishing</button>
                  </div>
                ) : eventOverlay.type === "choose-friendly-creature" ? (
                  <div className="mt-6 max-h-80 space-y-2 overflow-y-auto">
                    {(pendingCreatureAction?.candidates ?? []).map((candidate) => {
                      const card = cardsById[candidate.cardId];
                      return (
                        <button key={candidate.slotId} type="button" onClick={() => completeDefensiveBuff(candidate.slotId)} className="flex w-full items-center gap-3 rounded-2xl border-2 border-emerald-400 bg-emerald-400/10 p-3 text-left transition hover:bg-emerald-400/25">
                          <img src={card?.image} alt={card?.name} className="h-24 w-16 rounded-lg bg-white object-contain" />
                          <span><strong className="block">{card?.name}</strong><span className="text-sm text-emerald-200">Choose this creature</span></span>
                        </button>
                      );
                    })}
                    <button type="button" onClick={() => { setPendingCreatureAction(null); setEventOverlay(null); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel Action</button>
                  </div>
                ) : eventOverlay.type === "choose-action-hand-discard" ? (
                  <div className="mt-6 max-h-[30rem] space-y-2 overflow-y-auto">
                    {(pendingCreatureAction?.handEntries ?? []).map((entry) => { const card = cardsById[entry.cardId]; const selected = pendingCreatureAction.selectedIndices.includes(entry.index); return <button key={`${entry.cardId}-${entry.index}`} type="button" onClick={() => toggleActionHandDiscard(entry.index)} className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left ${selected ? "border-rose-400 bg-rose-400/25" : "border-slate-500 bg-white/5"}`}><img src={card?.image} alt={card?.name} className="h-20 w-14 rounded-lg bg-white object-contain" /><strong className="flex-1">{card?.name}</strong><span className="text-sm">{selected ? "Selected" : "Keep"}</span></button>; })}
                    <div className="flex flex-wrap gap-3 pt-3"><button type="button" disabled={(pendingCreatureAction?.selectedIndices.length ?? 0) < (pendingCreatureAction?.minDiscard ?? Number(pendingCreatureAction?.effect.discard?.amount ?? 0)) || (pendingCreatureAction?.selectedIndices.length ?? 0) > (pendingCreatureAction?.maxDiscard ?? Number(pendingCreatureAction?.effect.discard?.amount ?? 0))} onClick={confirmActionHandDiscard} className="rounded-full bg-rose-500 px-6 py-3 font-black disabled:opacity-40">Discard & Continue</button><button type="button" onClick={() => { setPendingCreatureAction(null); setEventOverlay(null); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel Action</button></div>
                  </div>
                ) : eventOverlay.type === "choose-action-search-card" ? (
                  <div className="mt-6 grid max-h-[30rem] gap-3 overflow-y-auto sm:grid-cols-2">
                    {(pendingCreatureAction?.searchCandidates ?? []).map((cardId) => { const card = cardsById[cardId]; return <button key={cardId} type="button" onClick={() => completeActionDeckSearch(cardId)} className="flex items-center gap-3 rounded-2xl border border-cyan-400 bg-cyan-400/10 p-3 text-left hover:bg-cyan-400/25"><img src={card?.image} alt={card?.name} className="h-24 w-16 rounded-lg bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-xs text-cyan-200">{foundationDeck.includes(cardId) ? "Foundation" : "Pals"}</span></span></button>; })}
                  </div>
                ) : eventOverlay.type === "choose-creature-action-search" ? (
                  <div className="mt-6 max-h-80 space-y-2 overflow-y-auto">
                    {(pendingCreatureAction?.candidates ?? []).map((cardId) => { const card = cardsById[cardId]; return <button key={cardId} type="button" onClick={() => completeCreatureActionSearch(cardId)} className="flex w-full items-center gap-3 rounded-2xl border border-cyan-400 bg-cyan-400/10 p-3 text-left hover:bg-cyan-400/20"><img src={card?.image} alt={card?.name} className="h-24 w-16 rounded-lg bg-white object-contain" /><span><strong className="block">{card?.name}</strong><span className="text-sm text-cyan-200">Add to hand</span></span></button>; })}
                    <button type="button" onClick={() => { setPendingCreatureAction(null); setEventOverlay(null); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel Action</button>
                  </div>
                ) : eventOverlay.type === "choose-action-discard" ? (
                  <div className="mt-6 max-h-80 space-y-2 overflow-y-auto">
                    {[...new Set(discardPile)].map((cardId) => {
                      const card = cardsById[cardId];
                      return <button key={cardId} type="button" onClick={() => completeCreatureRecovery(cardId)} className="flex w-full items-center gap-3 rounded-2xl border border-cyan-400 bg-cyan-400/10 p-3 text-left hover:bg-cyan-400/20"><img src={card?.image} alt={card?.name} className="h-24 w-16 rounded-lg bg-white object-contain" /><span className="font-black">{card?.name}</span></button>;
                    })}
                    <button type="button" onClick={() => { setPendingCreatureAction(null); setEventOverlay(null); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel Action</button>
                  </div>
                ) : eventOverlay.type === "choose-action-reorder-source" ? (
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {[{ type: "foundation", count: foundationDeck.length }, { type: "pals", count: palsDeck.length }].map((deck) => <button key={deck.type} type="button" disabled={!deck.count} onClick={() => chooseCreatureActionReorderDeck(deck.type)} className="rounded-2xl border-2 border-cyan-400 bg-cyan-400/10 p-5 text-center font-black capitalize hover:bg-cyan-400/25 disabled:opacity-30">{deck.type} Deck<span className="block text-sm text-cyan-200">{deck.count} cards</span></button>)}
                    <button type="button" onClick={() => { setPendingCreatureAction(null); setEventOverlay(null); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold sm:col-span-2">{pendingCreatureAction?.committed ? "Skip Optional Reorder" : "Cancel Action"}</button>
                  </div>
                ) : eventOverlay.type === "reorder-creature-action-deck" ? (
                  <div className="mt-6"><div className="grid max-h-96 gap-3 overflow-y-auto sm:grid-cols-3">{(pendingCreatureAction?.topCards ?? []).map((cardId, index) => { const card = cardsById[cardId]; return <div key={`${cardId}-${index}`} className="rounded-2xl border border-cyan-400 bg-cyan-400/10 p-3 text-center"><img src={card?.image} alt={card?.name} className="h-40 w-full rounded-xl bg-white object-contain" /><strong className="mt-2 block truncate">{index + 1}. {card?.name}</strong><div className="mt-2 flex justify-center gap-2"><button type="button" disabled={!index} onClick={() => moveCreatureActionDeckCard(index, -1)} className="rounded-full border px-3 py-1 disabled:opacity-30">Earlier</button><button type="button" disabled={index === pendingCreatureAction.topCards.length - 1} onClick={() => moveCreatureActionDeckCard(index, 1)} className="rounded-full border px-3 py-1 disabled:opacity-30">Later</button></div></div>; })}</div><div className="mt-4 flex gap-3"><button type="button" onClick={commitCreatureActionReorder} className="rounded-full bg-emerald-500 px-6 py-3 font-black">Confirm Order</button><button type="button" onClick={() => { setPendingCreatureAction(null); setEventOverlay(null); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">{pendingCreatureAction?.committed ? "Skip Optional Reorder" : "Cancel"}</button></div></div>
                ) : eventOverlay.type === "choose-action-deck" ? (
                  <div className="mt-6">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[{ id: "foundation", count: foundationDeck.length }, { id: "pals", count: palsDeck.length }].map((deck) => <div key={deck.id} className="rounded-2xl border-2 border-cyan-400 bg-cyan-400/10 p-5 text-center"><div className="font-black capitalize">{deck.id} Deck</div><div className="text-sm text-cyan-200">{deck.count} remaining</div><div className="mt-3 flex items-center justify-center gap-3"><button type="button" disabled={!turnDrawSelection?.[deck.id]} onClick={() => adjustTurnDraw(deck.id, -1)} className="h-9 w-9 rounded-full border border-cyan-300 disabled:opacity-30">−</button><span className="text-3xl font-black">{turnDrawSelection?.[deck.id] ?? 0}</span><button type="button" disabled={(turnDrawSelection?.[deck.id] ?? 0) >= deck.count || (turnDrawSelection?.foundation ?? 0) + (turnDrawSelection?.pals ?? 0) >= (turnDrawSelection?.target ?? 0)} onClick={() => adjustTurnDraw(deck.id, 1)} className="h-9 w-9 rounded-full bg-cyan-500 font-black disabled:opacity-30">+</button></div></div>)}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button type="button" disabled={!turnDrawSelection || turnDrawSelection.foundation + turnDrawSelection.pals !== turnDrawSelection.target} onClick={completeCreatureDrawAction} className="rounded-full bg-emerald-500 px-6 py-3 font-black disabled:opacity-40">Draw Selected Cards</button>
                      {!pendingCreatureAction?.committed ? <button type="button" onClick={() => { setPendingCreatureAction(null); setTurnDrawSelection(null); setEventOverlay(null); }} className="rounded-full border border-slate-500 px-5 py-2 text-sm font-bold">Cancel Action</button> : null}
                    </div>
                  </div>
                ) : eventOverlay.type === "faceoff-ready" || eventOverlay.type === "school-attack-ready" ? (
                  <div className="mt-7">
                    <div className={`mb-5 grid max-w-md gap-4 ${eventOverlay.type === "faceoff-ready" ? "grid-cols-2" : "grid-cols-1"}`}>
                      <div className="rounded-2xl border border-rose-400 bg-rose-500/10 p-4 text-center"><div className="text-xs font-black uppercase tracking-widest text-rose-300">Attack {eventOverlay.attackDice}</div><div className={`mt-2 text-5xl font-black ${faceoffRolling ? "animate-pulse" : ""}`}>{faceoffPreview?.attack ?? "—"}</div></div>
                      {eventOverlay.type === "faceoff-ready" ? <div className="rounded-2xl border border-cyan-400 bg-cyan-500/10 p-4 text-center"><div className="text-xs font-black uppercase tracking-widest text-cyan-300">Defense {eventOverlay.defenseDice}</div><div className={`mt-2 text-5xl font-black ${faceoffRolling ? "animate-pulse" : ""}`}>{faceoffPreview?.defense ?? "—"}</div></div> : <div className="rounded-2xl border border-amber-400 bg-amber-500/10 p-4 text-center font-bold text-amber-200">Damage = stopped roll × 10</div>}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {!faceoffRolling ? (
                        <button type="button" onClick={() => setFaceoffRolling(true)} className="rounded-full bg-rose-600 px-8 py-3 text-lg font-black text-white shadow-[0_0_30px_rgba(244,63,94,0.45)]">Start Rolling</button>
                      ) : (
                        <button type="button" disabled={!faceoffPreview} onClick={() => resolvePlayerAttack(eventOverlay.targetCoralId, eventOverlay.targetSlotId, true, faceoffPreview)} className="rounded-full bg-emerald-500 px-8 py-3 text-lg font-black text-white shadow-[0_0_30px_rgba(16,185,129,0.45)]">Stop & Resolve</button>
                      )}
                      {!faceoffRolling && !attackContext?.costCommitted ? <button type="button" onClick={() => { setFaceoffPreview(null); setEventOverlay(null); setAttackContext(null); }} className="rounded-full border border-slate-500 px-5 py-3 text-sm font-bold">Cancel Faceoff</button> : null}
                    </div>
                  </div>
                ) : (
                  <div className="mt-7">
                    {eventOverlay.revealedCards?.length ? <div className="mb-5"><div className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-amber-300">Revealed to You</div><div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">{eventOverlay.revealedCards.map((cardId, index) => { const card = cardsById[cardId]; return <div key={`${cardId}-${index}`} className="rounded-xl border-2 border-amber-400 bg-amber-400/10 p-2 text-center"><img src={card?.image} alt={card?.name} className="h-40 w-full rounded-lg bg-white object-contain" /><div className="mt-1 truncate text-xs font-black text-amber-100">{card?.name}</div><div className="text-[10px] font-bold uppercase text-amber-300">Revealed by opponent</div></div>; })}</div></div> : null}
                    {eventOverlay.drawnCards?.length ? <div className="mb-5 grid max-h-64 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">{eventOverlay.drawnCards.map((entry, index) => { const card = cardsById[entry.cardId]; return <div key={`${entry.cardId}-${index}`} className={`rounded-xl border p-2 text-center ${entry.discarded ? "border-rose-400 bg-rose-500/10" : "border-cyan-400 bg-cyan-500/10"}`}><img src={card?.image} alt={card?.name} className="h-32 w-full rounded-lg bg-white object-contain" /><div className="mt-1 truncate text-xs font-bold">{card?.name}</div><div className="text-[10px] uppercase text-slate-300">{entry.source}{entry.discarded ? " • discarded" : ""}</div></div>; })}</div> : null}
                    {eventOverlay.repeatDamageCounterAbilityId ? <button type="button" onClick={() => repeatDamageCounterMove(eventOverlay.repeatDamageCounterAbilityId)} className="mr-3 rounded-full bg-violet-600 px-7 py-3 font-black text-white">Move Another Counter</button> : null}
                    <button type="button" onClick={closeEventOverlay} className={`rounded-full px-7 py-3 font-black text-white ${eventOverlay.sourceCardId ? "self-start" : "self-center"} ${eventOverlay.success ? "bg-emerald-500" : "bg-cyan-600"}`}>
                      Continue
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {roundFlash ? (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-cyan-950/45 backdrop-blur-sm animate-pulse">
          <div className="rounded-[2rem] border-4 border-cyan-300 bg-slate-950/90 px-12 py-8 text-center text-white shadow-2xl">
            <div className="text-sm font-bold uppercase tracking-[0.3em] text-cyan-300">New Round</div>
            <div className="mt-2 text-5xl font-black">Round {round}</div>
            <div className="mt-3 max-w-lg text-lg font-semibold">{activeCondition?.name ?? "No condition"}</div>
          </div>
        </div>
      ) : null}

      {modal ? (
        <div className={`fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-2 backdrop-blur-sm sm:p-4`}>
          <div className={`max-h-[calc(100dvh-1rem)] max-w-[78rem] w-full overflow-y-auto rounded-[2rem] border p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-6 ${isDarkZoneModal ? "seapals-hud-panel border-cyan-300/25 text-slate-100" : "border-transparent bg-white text-slate-900"}`}>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xl font-bold">{modalTitle}</h3>
                <p className={`text-sm ${isDarkZoneModal ? "text-cyan-100/60" : "text-slate-600"}`}>
                  {modal === "hand"
                    ? "Review the cards in your hand. Discard or lose them from here."
                    : modal === "discard"
                    ? "Cards sent to the discard pile are shown here."
                    : modal === "search"
                    ? `Choose a card for ${cardsById[searchContext?.supportCardId]?.name}. You may cancel without spending the card or RP.`
                    : modal === "recover"
                    ? "Heads! Choose one card that was in your discard pile before Recovery resolved."
                    : modal === "coral-target"
                    ? "Choose a damaged coral to heal. You may cancel without spending the Support card."
                    : modal === "restock"
                    ? "Select one to three Fish. Creature Schools return to Foundation; other Fish return to Pals."
                    : modal === "support-draw"
                    ? "Split the replacement draw between your Foundation and Pals decks. Your current hand is discarded only after you confirm."
                    : modal === "turn-draw"
                    ? `Choose where to draw ${turnDrawSelection?.target ?? 0} card(s). You may split them between both personal decks.`
                    : modal === "draw-result"
                    ? "Review every card drawn this turn before continuing to your actions."
                    : "Cards sent to the lost zone are shown here."}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {modal === "hand" && (
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2 text-sm font-bold text-emerald-700" role="status">
                    {rp} RP available
                  </div>
                )}
                {modal !== "turn-draw" ? <button
                  type="button"
                  onClick={() => {
                    if (modal === "search" || modal === "coral-target" || modal === "restock" || modal === "support-draw") cancelSupportSearch();
                    else {
                      if (modal === "recover") setSearchContext(null);
                      if (modal === "draw-result") {
                        setTurnDrawResult(null);
                        setModal(null);
                      } else setModal(null);
                    }
                  }}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${isDarkZoneModal ? "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10" : "border-slate-300 bg-slate-100 text-slate-700"}`}
                >
                  Close
                </button> : null}
              </div>
            </div>

            {modal === "turn-draw" ? (
              <div className="space-y-5">
                {turnDrawSelection?.shortfall > 0 ? <div role="alert" className="rounded-2xl border border-rose-300/40 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">Your personal decks contain only {turnDrawSelection.target} of the {turnDrawSelection.requested} required cards. Choose the remaining card{turnDrawSelection.target === 1 ? "" : "s"} to reveal it; the game will then end by deck depletion.</div> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { id: "foundation", label: "Foundation", count: foundationDeck.length, selected: turnDrawSelection?.foundation ?? 0, image: foundationDeckImg },
                    { id: "pals", label: "Pals", count: palsDeck.length, selected: turnDrawSelection?.pals ?? 0, image: palsDeckImg },
                  ].map((deck) => (
                    <div key={deck.id} className="rounded-3xl border border-cyan-300/20 bg-white/5 p-5 text-center shadow-inner">
                      <div className="mx-auto flex h-32 w-28 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/45"><Image src={deck.image} alt={`${deck.label} Deck`} width={112} height={112} className="object-contain" /></div>
                      <div className="mt-3 text-lg font-black text-white">{deck.label} Deck</div>
                      <div className="text-sm text-cyan-100/60">{deck.count} remaining</div>
                      <div className="mt-4 flex items-center justify-center gap-4">
                        <button type="button" disabled={!deck.selected} onClick={() => adjustTurnDraw(deck.id, -1)} className="h-10 w-10 rounded-full border border-white/15 bg-white/5 text-xl font-black text-white transition hover:bg-white/10 disabled:opacity-25">−</button>
                        <span className="min-w-10 text-3xl font-black text-cyan-200">{deck.selected}</span>
                        <button type="button" disabled={deck.selected >= deck.count || (turnDrawSelection?.foundation ?? 0) + (turnDrawSelection?.pals ?? 0) >= (turnDrawSelection?.target ?? 0)} onClick={() => adjustTurnDraw(deck.id, 1)} className="h-10 w-10 rounded-full bg-gradient-to-br from-cyan-400 to-emerald-400 text-xl font-black text-slate-950 disabled:opacity-30">+</button>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" disabled={!turnDrawSelection || turnDrawSelection.foundation + turnDrawSelection.pals !== turnDrawSelection.target} onClick={confirmTurnDraw} className="w-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 px-6 py-3 font-black text-slate-950 shadow-lg disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400">Draw Selected Cards</button>
              </div>
            ) : modal === "draw-result" ? (
              <div>
                <div className="grid max-h-[620px] gap-4 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                  {(turnDrawResult ?? []).map((entry, index) => {
                    const card = cardsById[entry.cardId];
                    return <div key={`${entry.cardId}-${index}`} className={`rounded-3xl border-2 p-3 text-center ${entry.discarded ? "border-rose-300/50 bg-rose-400/10" : "border-cyan-300/50 bg-cyan-400/10"}`}><img src={card?.image} alt={card?.name} className="h-72 w-full rounded-2xl bg-slate-950/45 object-contain" /><div className="mt-2 font-black text-white">{card?.name}</div><div className="text-xs font-bold uppercase tracking-wider text-cyan-100/60">{entry.source} Deck</div>{entry.discarded ? <div className="mt-1 text-xs font-bold text-rose-200">Discarded by hand limit</div> : null}</div>;
                  })}
                </div>
                <button type="button" onClick={() => { setTurnDrawResult(null); setModal(null); }} className="mt-5 w-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 px-6 py-3 font-black text-slate-950">Continue to Actions</button>
              </div>
            ) : modal === "support-draw" ? (
              <div>
                <p className="mb-4 text-sm text-cyan-100/65">Discard your current hand, then allocate {turnDrawSelection?.target ?? 0} draws between both personal decks.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { id: "foundation", label: "Foundation Deck", count: foundationDeck.length, image: foundationDeckImg },
                    { id: "pals", label: "Pals Deck", count: palsDeck.length, image: palsDeckImg },
                  ].map((deck) => (
                    <div key={deck.id} className="rounded-3xl border border-cyan-300/20 bg-white/5 p-5 text-center shadow-inner">
                      <div className="mx-auto flex h-32 w-28 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/45"><Image src={deck.image} alt={deck.label} width={112} height={112} className="object-contain" /></div>
                      <div className="mt-3 text-lg font-bold text-white">{deck.label}</div>
                      <div className="text-sm text-cyan-100/60">{deck.count} remaining</div>
                      <div className="mt-3 flex items-center justify-center gap-4"><button type="button" onClick={() => adjustTurnDraw(deck.id, -1)} className="h-9 w-9 rounded-full border border-white/15 bg-white/5 font-black text-white">−</button><strong className="text-2xl tabular-nums text-cyan-200">{turnDrawSelection?.[deck.id] ?? 0}</strong><button type="button" onClick={() => adjustTurnDraw(deck.id, 1)} className="h-9 w-9 rounded-full bg-gradient-to-br from-cyan-400 to-emerald-400 font-black text-slate-950">+</button></div>
                    </div>
                  ))}
                </div>
                <button type="button" disabled={!turnDrawSelection || turnDrawSelection.foundation + turnDrawSelection.pals !== turnDrawSelection.target} onClick={completeDrEvans} className="mt-5 w-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 px-6 py-3 font-black text-slate-950 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400">Discard Hand &amp; Draw Selected Cards</button>
              </div>
            ) : modal === "hand" ? (
              <div className="flex min-h-0 flex-col gap-3 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-4">
                <div className="order-2 overflow-x-auto overflow-y-hidden rounded-3xl border border-cyan-300/20 bg-slate-950/35 p-3 overscroll-contain lg:order-1 lg:max-h-[620px] lg:overflow-x-hidden lg:overflow-y-auto lg:p-4" style={{ minWidth: 180 }}>
                  {modalCards.length ? (
                    <div className="flex w-max gap-2 lg:block lg:w-auto lg:space-y-3">
                      {modalCards.map((cardId, cardIndex) => {
                        const card = cardsById[cardId] || { name: cardId };
                        const selected = cardId === selectedHandCard;
                        return (
                          <button
                            key={`${cardId}-${cardIndex}`}
                            type="button"
                            data-card-id={cardId}
                            onClick={() => {
                              setSelectedHandCard(cardId);
                              setPlayError("");
                            }}
                            className={`w-24 shrink-0 rounded-2xl border p-1.5 text-left transition lg:w-full lg:rounded-3xl lg:p-2 ${
                              isSetup && !getPlayError(card) ? "seapals-setup-playable-card border-emerald-300/60 bg-emerald-400/15" : selected ? "border-cyan-400 bg-cyan-400/15" : "border-white/10 bg-white/5 hover:border-cyan-300/40"
                            }`}
                          >
                            <img
                              src={card.image}
                              alt={card.name}
                              className="h-24 w-full rounded-xl object-contain lg:h-36 lg:rounded-2xl"
                            />
                            <span className="mt-1 block truncate px-1 text-center text-[10px] font-bold text-white lg:hidden">{card.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-sm text-slate-400">
                      No cards yet.
                    </div>
                  )}
                </div>

                <div className="order-1 rounded-3xl border border-cyan-300/20 bg-slate-950/35 p-3 shadow-inner lg:order-2 lg:p-4">
                  {selectedHandCard ? (
                    <div className="space-y-3 lg:space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-2 shadow-sm lg:rounded-3xl lg:p-4">
                        <img
                          src={cardsById[selectedHandCard]?.image}
                          alt={cardsById[selectedHandCard]?.name}
                          className="h-[30dvh] min-h-[190px] max-h-[280px] w-full rounded-2xl object-contain lg:h-[640px] lg:max-h-none lg:rounded-[1.5rem]"
                        />
                      </div>
                      <div className="space-y-2 text-center">
                        <p className="text-lg font-semibold text-white">{cardsById[selectedHandCard]?.name}</p>
                        <div className="flex flex-wrap justify-center gap-2 text-xs font-bold">
                          <span className="rounded-full bg-cyan-400/15 px-3 py-1 text-cyan-200">{cardsById[selectedHandCard]?.kind}</span>
                          <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-emerald-200">{getPlayerCardPlayCost(cardsById[selectedHandCard])} RP</span>
                          {Number(cardsById[selectedHandCard]?.victoryPoints ?? 0) > 0 ? <span className="rounded-full bg-amber-400/15 px-3 py-1 text-amber-200">{cardsById[selectedHandCard]?.victoryPoints} VP</span> : null}
                        </div>
                        {cardsById[selectedHandCard]?.text ? <p className="mx-auto max-w-xl rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-300">{cardsById[selectedHandCard].text}</p> : null}
                        <button
                          type="button"
                          disabled={Boolean(selectedHandPlayError)}
                          onClick={() => playCardFromHand(selectedHandCard)}
                          className="mx-auto w-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 px-8 py-3 text-sm font-black text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 lg:w-auto"
                        >
                          Play Card
                        </button>
                        {visiblePlayError ? (
                          <div className="rounded-3xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                            {visiblePlayError}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-sm text-slate-400">
                      Select a card to preview it here.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {modalCards.length ? (
                  modalCards.map((cardId, cardIndex) => {
                    const coralTarget = modal === "coral-target" ? playerCorals.find((coral) => coral.id === cardId) : null;
                    const card = cardsById[coralTarget?.cardId ?? cardId] || { name: cardId };
                    return (
                      <div key={`${cardId}-${cardIndex}`} className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${isDarkZoneModal ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                        <div className="flex items-center gap-4">
                          {["discard", "lost", "search", "recover", "coral-target", "restock"].includes(modal) ? <img src={card.image} alt={card.name} className="h-28 w-20 rounded-xl bg-white object-contain" /> : null}
                          <div>
                          <p className="font-semibold">{card.name}</p>
                          <p className={`text-sm ${isDarkZoneModal ? "text-slate-400" : "text-slate-600"}`}>{getCardClassLabel(card)}</p>
                          {coralTarget ? <p className="text-sm font-bold text-emerald-300">{coralTarget.health}/{coralTarget.maxHealth} HP</p> : null}
                          </div>
                        </div>
                        {modal === "search" || modal === "recover" || modal === "coral-target" || modal === "restock" ? (
                          <button type="button" onClick={() => modal === "recover" ? completeRecovery(cardId) : modal === "coral-target" ? completeCoralHeal(cardId) : modal === "restock" ? toggleRestockCard(cardIndex) : searchContext?.maxSelect > 1 ? toggleSupportSearchCard(cardId) : completeSupportSearch(cardId)} className={`rounded-full px-5 py-2 text-sm font-bold text-white ${(modal === "restock" ? searchContext?.selectedIndices?.includes(cardIndex) : modal === "search" && searchContext?.maxSelect > 1 && searchContext?.selected.includes(cardId)) ? "bg-emerald-600" : "bg-cyan-600 hover:bg-cyan-500"}`}>
                            {modal === "recover" ? "Recover Card" : modal === "coral-target" ? "Heal 20 HP" : modal === "restock" ? (searchContext?.selectedIndices?.includes(cardIndex) ? "Selected" : "Select") : modal === "search" && searchContext?.maxSelect > 1 ? (searchContext?.selected.includes(cardId) ? `Selected ×${searchContext.selected.filter((selectedId) => selectedId === cardId).length}` : "Select") : "Add to Hand"}
                          </button>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className={`rounded-3xl border border-dashed p-8 text-center text-sm ${isDarkZoneModal ? "border-white/15 bg-white/5 text-slate-400" : "border-slate-300 bg-slate-50 text-slate-500"}`}>
                    No cards yet.
                  </div>
                )}
                {modal === "restock" ? (
                  <div className="sticky bottom-0 flex items-center justify-between rounded-2xl border border-emerald-300/30 bg-slate-950/95 p-3 shadow-lg">
                    <span className="text-sm font-bold text-emerald-200">{searchContext?.selectedIndices?.length ?? 0} of 3 selected</span>
                    <button type="button" disabled={!searchContext?.selectedIndices?.length} onClick={completeRestocking} className="rounded-full bg-emerald-600 px-6 py-2 text-sm font-bold text-white disabled:opacity-40">
                      Confirm Restocking
                    </button>
                  </div>
                ) : null}
                {modal === "search" && searchContext?.maxSelect > 1 ? (
                  <div className="sticky bottom-0 flex items-center justify-between rounded-2xl border border-cyan-300/30 bg-slate-950/95 p-3 shadow-lg">
                    <span className="text-sm font-bold text-cyan-200">{searchContext.selected.length} of {searchContext.maxSelect} selected</span>
                    <button type="button" disabled={!searchContext.selected.length} onClick={completeMultipleSupportSearch} className="rounded-full bg-cyan-600 px-6 py-2 text-sm font-bold text-white disabled:opacity-40">Add Selected Cards</button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
