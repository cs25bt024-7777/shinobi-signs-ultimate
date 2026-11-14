// Shinobi Signs — integrated two-player webcam combat.
// Phase 7 adds guard/counter sequences. Phase 8 adds room-code WebRTC multiplayer.
import { CONFIG } from './config.js';
import { PlayerState } from './game/playerState.js';
import { Arena } from './render/arena.js';
import { Character } from './render/character.js';
import { Hud } from './ui/hud.js';
import { Webcam, CameraState } from './input/webcam.js';
import { HandTracker } from './input/handTracker.js';
import { MediaPipeHandBackend } from './input/mediapipeBackend.js';
import { WebcamPanel } from './ui/webcamPanel.js';
import { SignPipeline } from './input/signPipeline.js';
import { GESTURE_CONFIG } from './input/gestureConfig.js';
import { SignDebugOverlay } from './ui/debugOverlay.js';
import { createSequenceRecognizer } from './game/sequenceRecognizer.js';
import { createJutsuBridge } from './game/jutsuBridge.js';
import { CombatEngine } from './game/combatEngine.js';
import { JUTSUS, createJutsuSystem, findJutsu } from './game/jutsuSystem.js';
import { CombatActionRouter, COMBAT_ACTIONS } from './game/combatActionRouter.js';
import { DefenseSystem } from './game/defenseSystem.js';
import { MultiplayerClient } from './network/multiplayer.js';
import { Effects } from './render/effects.js';
import { loadGameAssets } from './render/assets.js';
import { SoundFX } from './game/soundFx.js';

const canvas = document.getElementById('game');
canvas.width = CONFIG.width;
canvas.height = CONFIG.height;
const ctx = canvas.getContext('2d');
const arena = new Arena(CONFIG.width, CONFIG.height, CONFIG.horizonY);
const hud = new Hud();
const players = CONFIG.players.map(() => new PlayerState(CONFIG.maxHp));
const gameAssets = loadGameAssets();
arena.setBackground(gameAssets.arena);
const soundFx = new SoundFX();
const fighterDefs = {
  shadow: { name: 'BLUE SHADOW', image: gameAssets.shadowFighter, accent: '#59dcff', palette: { suit: '#101b35', suitLight: '#203e67', accent: '#59dcff', skin: '#dcecff' } },
  crimson: { name: 'CRIMSON KNIGHT', image: gameAssets.crimsonFighter, accent: '#ff5b70', palette: { suit: '#35131f', suitLight: '#702536', accent: '#ff5b70', skin: '#f2c9a0' } },
};
let selectedFighters = ['shadow', 'crimson'];
let selectedStage = 'valley';
let chakra = [0, 0];
let specialSerial = 0;
const characters = CONFIG.players.map((p, i) => new Character({ ...p, feetY: CONFIG.feetY, sprite: i === 0 ? gameAssets.shadowFighter : gameAssets.crimsonFighter }));
const effects = new Effects();
effects.setAssets(gameAssets);

let localPlayerIndex = 0;
let matchOver = false;
let roundNumber = 1;
let roundWins = [0, 0];
let roundTransition = false;
let roundTransitionTimer = null;
let networkRole = 'offline';
let networkStatus = 'idle';
let lastActionAt = [0, 0];
let screenShake = 0;
let introTimer = null;

function isAuthority() {
  return networkRole !== 'guest';
}
function refreshHud() {
  players.forEach((p, i) => hud.setHp(i, p.hp, p.maxHp));
}
function updateRoundHud() { hud.setRound(roundNumber, 3, roundWins); }
function refreshChakra() { chakra.forEach((value, i) => hud.setMeter(i, value)); }
function setFighter(playerIndex, fighterId) {
  const def = fighterDefs[fighterId]; if (!def) return;
  selectedFighters[playerIndex] = fighterId;
  const character = characters[playerIndex];
  character.sprite = def.image; character.palette = { ...character.palette, ...def.palette };
  character.spriteWidth = fighterId === 'shadow' ? 310 : 340;
  character.spriteHeight = fighterId === 'shadow' ? 310 : 340;
  const avatar = document.querySelector(`#hp-${playerIndex} .hp-avatar`);
  if (avatar) avatar.src = fighterId === 'crimson' ? 'assets/fighter-crimson-cutout.png' : 'assets/fighter-shadow.png';
  const name = document.querySelector(`#hp-${playerIndex} .hp-name`);
  if (name) { name.dataset.fighter = def.name; name.textContent = fighterLabel(playerIndex); }
}
function fighterLabel(index, role = null) {
  const prefix = role || (index === localPlayerIndex ? 'YOU' : 'OPPONENT');
  return `${prefix} · ${fighterDefs[selectedFighters[index]].name}`;
}
function playIntro(withSound = true) {
  const banner = document.getElementById('intro-banner'); if (!banner) return;
  banner.classList.remove('play'); void banner.offsetWidth; banner.classList.add('play');
  if (introTimer) clearTimeout(introTimer); introTimer = setTimeout(() => banner.classList.remove('play'), 2300);
  if (withSound) soundFx.round();
}
function resetRoundState() {
  players.forEach((player) => player.reset());
  characters.forEach((character) => { character.defeated = false; character.attackTimer = 0; character.hitTimer = 0; character.pose = 'idle'; character.defenseTimer = 0; });
  effects.clear(); defense.reset(); chakra = [0, 0]; refreshChakra(); refreshHud();
}
function finishRound(winner) {
  if (roundTransition || matchOver) return;
  roundTransition = true;
  roundWins[winner] += 1;
  characters[1 - winner].defeat();
  if (roundWins[winner] >= 2 || roundNumber >= 3) {
    matchOver = true; roundTransition = false;
    const matchWinner = roundWins[0] === roundWins[1] ? null : (roundWins[0] > roundWins[1] ? 0 : 1);
    hud.setStatus(matchWinner === null ? 'MATCH DRAW' : `PLAYER ${matchWinner + 1} WINS THE MATCH!`);
    updateRoundHud(); hud.showMatchResult(matchWinner, roundWins);
    soundFx.round();
    return;
  }
  hud.setStatus(`PLAYER ${winner + 1} TAKES ROUND ${roundNumber}`);
  roundNumber += 1; updateRoundHud();
  roundTransitionTimer = setTimeout(() => {
    resetRoundState(); roundTransition = false; hud.setStatus(`ROUND ${roundNumber} — FIGHT!`); playIntro();
    if (networkRole === 'host' && networkStatus === 'connected') sendState();
  }, 2200);
}

const combat = new CombatEngine({
  players,
  onEvent(event) {
    refreshHud();
    if (event.type === 'damage' && event.amount > 0) {
      characters[event.index].flashHit();
      soundFx.impact();
      screenShake = Math.max(screenShake, 0.22);
      effects.addDamageNumber(characters[event.index].x, characters[event.index].feetY - 245, event.amount, event.index === 0 ? '#ff7180' : '#72eaff');
    }
    if (event.type === 'defeated') {
      characters[event.index].defeat();
      finishRound(event.winner);
    }
    if (event.type === 'reset') {
      matchOver = false; roundNumber = 1; roundWins = [0, 0]; roundTransition = false; updateRoundHud();
      characters.forEach((c) => { c.defeated = false; c.pose = 'idle'; c.defenseTimer = 0; });
    }
    if (networkRole === 'host' && networkStatus === 'connected') sendState();
  },
});

const defense = new DefenseSystem({
  onEvent(event) {
    if (event.type === 'defense-start') {
      characters[event.playerIndex].setDefense(event.defenseType, event.durationMs / 1000);
      hud.setStatus(event.defenseType === 'guard' ? 'GUARD STANCE!' : 'COUNTER READY!');
    }
  },
});

const webcam = new Webcam();
const handTracker = new HandTracker({
  video: webcam.video,
  backend: new MediaPipeHandBackend(CONFIG.handTracking),
  ...CONFIG.handTracking,
});
const webcamPanel = new WebcamPanel(webcam, document.getElementById('webcam-panel'), handTracker);
const signPipeline = new SignPipeline({
  config: { ...GESTURE_CONFIG, stabilizer: { ...GESTURE_CONFIG.stabilizer, holdMs: 100, candidateGraceMs: 650, releaseMs: 650 } },
});
const signDebug = new SignDebugOverlay(
  document.getElementById('sign-debug'),
  { enabled: CONFIG.signs.debug || new URLSearchParams(location.search).get('debug') === 'signs' },
);

// Retain the Phase 5 recognizer and bridge. The action router expands the sequence
// vocabulary to include defensive combinations without changing the sign classifier.
const sequenceRecognizer = createSequenceRecognizer();
const bridge = createJutsuBridge();
const actionRouter = new CombatActionRouter({ onEvent: handleActionRouteEvent });
let multiplayer;

function sendState() {
  if (!multiplayer || multiplayer.role !== 'host' || multiplayer.status !== 'connected') return;
  multiplayer.send('STATE', {
    hp: combat.getState(),
    defense: defense.getSnapshot(performance.now()),
    matchOver, roundNumber, roundWins, roundTransition, chakra, selectedFighters, selectedStage,
    timestamp: Date.now(),
  });
}

function applyRemoteState(payload) {
  if (!payload || !Array.isArray(payload.hp) || payload.hp.length !== 2) return;
  payload.hp.forEach((state, i) => {
    if (!state || !Number.isFinite(state.hp)) return;
    players[i].hp = Math.max(0, Math.min(players[i].maxHp, state.hp));
    characters[i].defeated = players[i].hp <= 0;
  });
  defense.applySnapshot(payload.defense, performance.now());
  matchOver = !!payload.matchOver || players.some((p) => p.isDead);
  if (Number.isFinite(payload.roundNumber)) roundNumber = payload.roundNumber;
  if (Array.isArray(payload.roundWins) && payload.roundWins.length === 2) roundWins = payload.roundWins.map((n) => Math.max(0, Number(n) || 0));
  roundTransition = !!payload.roundTransition;
  if (matchOver) { const deadIndex = players.findIndex((p) => p.isDead); hud.showMatchResult(deadIndex < 0 ? null : 1 - deadIndex, roundWins); } else hud.hideMatchResult();
  if (Array.isArray(payload.selectedFighters) && payload.selectedFighters.length === 2) {
    payload.selectedFighters.forEach((fighter, i) => { if (fighterDefs[fighter] && selectedFighters[i] !== fighter) setFighter(i, fighter); });
  }
  if (payload.selectedStage && ['valley', 'forest'].includes(payload.selectedStage)) {
    selectedStage = payload.selectedStage; arena.setBackground(selectedStage === 'valley' ? gameAssets.arena : null);
    document.querySelectorAll('.stage-option').forEach((item) => item.classList.toggle('selected', item.dataset.stage === selectedStage));
  }
  if (Array.isArray(payload.chakra) && payload.chakra.length === 2) chakra = payload.chakra.map((n) => Math.max(0, Math.min(100, Number(n) || 0)));
  hud.setPlayerLabel?.(0, fighterLabel(0, networkRole === 'guest' ? 'OPPONENT' : 'YOU'));
  hud.setPlayerLabel?.(1, fighterLabel(1, networkRole === 'guest' ? 'YOU' : 'OPPONENT'));
  refreshChakra(); updateRoundHud();
  refreshHud();
  const dead = players.findIndex((p) => p.isDead);
  if (dead >= 0) {
    characters[dead].defeat();
    hud.setStatus(`PLAYER ${1 - dead + 1} WINS!`);
  }
}

function renderActionStart(attacker, actionId, eventId) {
  const jutsu = JUTSUS.find((item) => item.id === actionId);
  if (!jutsu || matchOver || roundTransition) return { type: 'ignored', reason: 'unknown-or-finished' };
  const ready = {
    type: 'JUTSU_READY',
    eventId,
    sequence: [...jutsu.sequence],
    timestamp: performance.now(),
  };
  return jutsuSystem.execute(ready, attacker);
}

function executeAuthoritativeJutsu(attacker, jutsu, eventId) {
  if (!isAuthority() || matchOver || roundTransition || !combat.isAlive(attacker) || !combat.isAlive(1 - attacker)) return false;
  const now = performance.now();
  if (now - lastActionAt[attacker] < 650) {
    if (attacker === localPlayerIndex) hud.setStatus('RECOVERING — WAIT A MOMENT');
    return false;
  }
  const result = jutsuSystem.execute({
    type: 'JUTSU_READY', eventId, sequence: [...jutsu.sequence], timestamp: now,
  }, attacker);
  if (result.type !== 'executed') return false;
  lastActionAt[attacker] = now;
  if (networkRole === 'host' && networkStatus === 'connected') {
    multiplayer.send('ACTION_START', { attacker, actionId: jutsu.id, eventId });
  }
  return true;
}

function requestJutsu(attacker, ready) {
  const jutsu = findJutsu(ready.sequence);
  if (!jutsu) return;
  const eventId = `${attacker}-${ready.eventId ?? Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (networkRole === 'guest' && networkStatus === 'connected') {
    multiplayer.send('ACTION_REQUEST', { actionId: jutsu.id, eventId });
    hud.setStatus(`JUTSU SENT: ${jutsu.name}`);
    return;
  }
  executeAuthoritativeJutsu(attacker, jutsu, eventId);
}

function activateDefenseAuthoritative(playerIndex, action) {
  if (!isAuthority() || matchOver || roundTransition || !combat.isAlive(playerIndex)) return false;
  const now = performance.now();
  if (now - lastActionAt[playerIndex] < 350) return false;
  lastActionAt[playerIndex] = now;
  const event = defense.activate(playerIndex, action.defenseType, now, action.durationMs);
  if (networkRole === 'host' && networkStatus === 'connected') {
    multiplayer.send('DEFENSE_START', {
      playerIndex,
      defenseType: action.defenseType,
      durationMs: action.durationMs,
    });
  }
  if (networkRole === 'host' && networkStatus === 'connected') sendState();
  return event.type === 'defense-start';
}

function requestDefense(playerIndex, action) {
  if (networkRole === 'guest' && networkStatus === 'connected') {
    multiplayer.send('DEFENSE_REQUEST', { actionId: action.id });
    hud.setStatus(`${action.name} SENT`);
    return;
  }
  activateDefenseAuthoritative(playerIndex, action);
}

function handleActionRouteEvent(event) {
  if (event.type === 'progress') {
    const allDone = event.buffer.map((sign) => ({ label: sign, done: true }));
    const expected = event.expected || [];
    hud.setSequence([...allDone, ...expected.slice(0, 1).map((label) => ({ label, done: false }))]);
    hud.setStatus(`SEAL INPUT: ${event.buffer.join(' → ')}`);
    return;
  }
  if (event.type === 'invalid') {
    hud.setSequence([]);
    hud.setStatus('UNKNOWN COMBO — TRY AGAIN');
    return;
  }
  if (event.type === 'reset') {
    hud.setSequence([]);
    return;
  }
  if (event.type !== 'complete') return;
  const action = event.action;
  hud.setSequence(action.sequence.map((label) => ({ label, done: true })));
  if (action.kind === 'attack') {
    // Preserve the Phase 5C contract: completed sequence -> JUTSU_READY -> game action.
    bridge.handleSequenceEvent({
      type: 'complete',
      timestamp: event.timestamp,
      state: { isComplete: true, requiredSequence: [...action.sequence] },
    });
  } else if (action.kind === 'defense') {
    requestDefense(localPlayerIndex, action);
  }
}

bridge.subscribe((ready) => requestJutsu(localPlayerIndex, ready));

const jutsuSystem = createJutsuSystem({
  combat,
  effects,
  characters,
  onStatus: (message) => hud.setStatus(message),
});

function playSpecialVisual(attacker, ultimate = false) {
  const target = 1 - attacker;
  const type = ultimate ? (attacker === 0 ? 'ultimate-blue' : 'ultimate-red') : (attacker === 0 ? 'lightning' : 'fire');
  const duration = ultimate ? 1.65 : .92;
  const damage = ultimate ? 48 : 22;
  characters[attacker]?.attack(characters[target]?.x, ultimate ? 1.5 : 1.08);
  effects.launch({ id: `special-${++specialSerial}`, type, from: characters[attacker].x, to: characters[target].x, y: characters[attacker].feetY - (ultimate ? 175 : 145), duration, attacker, target, damage });
  hud.setStatus(ultimate ? (attacker === 0 ? 'AZURE STORM — ULTIMATE!' : 'CRIMSON INFERNO — ULTIMATE!') : (attacker === 0 ? 'SHADOW LIGHTNING STRIKE!' : 'CRIMSON FLAME SLASH!'));
  if (ultimate) soundFx.ultimate(); else soundFx.attack();
}
function executeSpecial(attacker, ultimate = false) {
  if (!isAuthority() || matchOver || roundTransition || !combat.isAlive(attacker) || !combat.isAlive(1 - attacker)) return false;
  if (performance.now() - lastActionAt[attacker] < 600) return false;
  if (ultimate && chakra[attacker] < 100) {
    if (attacker === localPlayerIndex) hud.setStatus('ULTIMATE NOT READY — CHARGE CHAKRA');
    return false;
  }
  if (ultimate) { chakra[attacker] = 0; refreshChakra(); }
  lastActionAt[attacker] = performance.now();
  playSpecialVisual(attacker, ultimate);
  if (networkRole === 'host' && networkStatus === 'connected') {
    multiplayer.send('SPECIAL_START', { attacker, ultimate }); sendState();
  }
  return true;
}

// Network callbacks are attached after the authoritative combat systems exist.
multiplayer = new MultiplayerClient({
  onStatus: renderMultiplayerStatus,
  onMessage: handleMultiplayerMessage,
  onRemoteStream: renderOpponentVideo,
});
renderMultiplayerStatus({ status: 'idle', role: 'offline', roomCode: null });

function renderOpponentVideo(stream) {
  const panel = document.getElementById('opponent-webcam-panel');
  const video = document.getElementById('opponent-video');
  const status = document.getElementById('opponent-cam-status');
  if (!panel || !video) return;
  if (stream) {
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = true; // autoplay-safe; video is still visible to the player
    video.play?.().then(() => {
      panel.dataset.live = 'true';
      if (status) status.textContent = 'VIDEO: LIVE';
    }).catch(() => {
      panel.dataset.live = 'false';
      if (status) status.textContent = 'VIDEO: TAP TO PLAY';
    });
    video.onloadedmetadata = () => video.play?.().catch(() => {});
  } else {
    video.srcObject = null;
    panel.dataset.live = 'false';
    if (status) status.textContent = 'VIDEO: WAITING FOR OPPONENT';
  }
}

function renderMultiplayerStatus({ status, detail = '', role = 'offline', roomCode = null }) {
  networkStatus = status;
  networkRole = role;
  // Guest is Player 2 (right side), so on the guest's screen the local camera
  // goes under "YOU" (right) and the opponent camera under "OPPONENT" (left).
  document.documentElement.dataset.mpRole = (role === 'guest' && ['connected', 'degraded'].includes(status)) ? 'guest' : 'host';
  if (status === 'connected') localPlayerIndex = role === 'guest' ? 1 : 0;
  else if (status === 'idle' || status === 'error' || status === 'disconnected') localPlayerIndex = role === 'guest' ? 1 : 0;

  hud.setPlayerLabel?.(0, fighterLabel(0, role === 'guest' ? 'OPPONENT' : 'YOU'));
  hud.setPlayerLabel?.(1, fighterLabel(1, role === 'guest' ? 'YOU' : 'OPPONENT'));

  const opponentPanel = document.getElementById('opponent-webcam-panel');
  if (opponentPanel) opponentPanel.hidden = !['connected', 'degraded'].includes(status);
  if (!['connected', 'degraded'].includes(status)) renderOpponentVideo(null);
  const statusEl = document.getElementById('network-status');
  const codeArea = document.getElementById('room-code-area');
  const codeValue = document.getElementById('room-code-value');
  const actions = document.getElementById('mp-actions');
  const leaveButton = document.getElementById('leave-room');
  if (statusEl) {
    const messages = {
      idle: 'Offline training mode · Create a room to invite a second player',
      creating: 'Creating a private room…',
      waiting: 'Room is ready. Waiting for Player 2…',
      connecting: 'Connecting to your opponent…',
      connected: role === 'host' ? 'CONNECTED · YOU ARE PLAYER 1' : 'CONNECTED · YOU ARE PLAYER 2',
      degraded: 'Direct player connection is active, but signalling was interrupted.',
      disconnected: 'Opponent disconnected. Leave the room or return to training.',
      error: detail || 'Connection error. Check internet and try again.',
    };
    statusEl.textContent = detail || messages[status] || status.toUpperCase();
    if (status === 'connected') statusEl.textContent = messages.connected;
  }
  if (codeArea) codeArea.hidden = !roomCode;
  if (codeValue && roomCode) codeValue.textContent = roomCode;
  if (actions) actions.hidden = ['creating', 'waiting', 'connecting', 'connected', 'degraded'].includes(status);
  if (leaveButton) leaveButton.hidden = !['waiting', 'connecting', 'connected', 'degraded', 'disconnected'].includes(status);
  document.querySelectorAll('.fighter-option').forEach((button) => { button.disabled = status === 'connected' && Number(button.dataset.player) !== localPlayerIndex; });
  document.querySelectorAll('.stage-option').forEach((button) => { button.disabled = status === 'connected' && role === 'guest'; });
  const createButton = document.getElementById('create-room');
  const joinButton = document.getElementById('join-room');
  if (createButton) createButton.disabled = ['creating', 'waiting', 'connecting', 'connected', 'degraded'].includes(status);
  if (joinButton) joinButton.disabled = ['creating', 'waiting', 'connecting', 'connected', 'degraded'].includes(status);
}

function handleMultiplayerMessage(message) {
  const payload = message.payload || {};
  if (message.type === 'PLAYER_JOINED') {
    sendState();
    hud.setStatus('OPPONENT CONNECTED — FIGHT!');
    return;
  }
  if (message.type === 'WELCOME') {
    // Host sends the authoritative health/defense snapshot immediately after this handshake.
    hud.setStatus('ROOM JOINED — READY!');
    return;
  }
  if (message.type === 'STATE' && networkRole === 'guest') {
    applyRemoteState(payload);
    return;
  }
  if (message.type === 'SIGN' && networkRole === 'host') {
    hud.setSign(1, payload.sign || '—');
    multiplayer.send('SIGN_UPDATE', { playerIndex: 1, sign: payload.sign });
    return;
  }
  if (message.type === 'SIGN_UPDATE') {
    hud.setSign(payload.playerIndex ?? 0, payload.sign || '—');
    return;
  }
  if (message.type === 'ACTION_REQUEST' && networkRole === 'host') {
    const jutsu = JUTSUS.find((item) => item.id === payload.actionId);
    if (jutsu) executeAuthoritativeJutsu(1, jutsu, `1-${payload.eventId || Date.now()}`);
    return;
  }
  if (message.type === 'ACTION_START' && networkRole === 'guest') {
    const jutsu = JUTSUS.find((item) => item.id === payload.actionId);
    if (jutsu) renderActionStart(payload.attacker, jutsu.id, payload.eventId);
    return;
  }
  if (message.type === 'DEFENSE_REQUEST' && networkRole === 'host') {
    const action = COMBAT_ACTIONS.find((item) => item.id === payload.actionId && item.kind === 'defense');
    if (action) activateDefenseAuthoritative(1, action);
    return;
  }
  if (message.type === 'DEFENSE_START' && networkRole === 'guest') {
    const action = COMBAT_ACTIONS.find((item) => item.kind === 'defense' && item.defenseType === payload.defenseType);
    if (action) defense.activate(payload.playerIndex, payload.defenseType, performance.now(), payload.durationMs);
    return;
  }
  if (message.type === 'RESET_REQUEST' && networkRole === 'host') resetMatch();
  if (message.type === 'SPECIAL_REQUEST' && networkRole === 'host') executeSpecial(1, !!payload.ultimate);
  if (message.type === 'FIGHTER_SELECT_REQUEST' && networkRole === 'host' && fighterDefs[payload.fighter]) { setFighter(1, payload.fighter); sendState(); }
  if (message.type === 'SPECIAL_START' && networkRole === 'guest') playSpecialVisual(payload.attacker, !!payload.ultimate);
}

function resetMatch() {
  if (networkRole === 'guest' && networkStatus === 'connected') {
    multiplayer.send('RESET_REQUEST', {});
    hud.setStatus('REMATCH REQUEST SENT');
    return;
  }
  if (roundTransitionTimer) clearTimeout(roundTransitionTimer);
  roundTransitionTimer = null; roundNumber = 1; roundWins = [0, 0]; roundTransition = false; chakra = [0, 0]; refreshChakra(); updateRoundHud(); hud.hideMatchResult();
  combat.reset();
  defense.reset();
  characters.forEach((c) => { c.defeated = false; c.attackTimer = 0; c.hitTimer = 0; c.pose = 'idle'; c.defenseTimer = 0; });
  effects.clear();
  jutsuSystem.reset();
  actionRouter.reset('match-reset');
  lastActionAt = [0, 0];
  matchOver = false;
  hud.setStatus('ROUND 1 — FIGHT!');
  if (networkRole === 'host' && networkStatus === 'connected') sendState();
}

// Character select, stage select, match result and local keyboard practice controls.
const fighterSelect = document.getElementById('fighter-select');
document.getElementById('open-select')?.addEventListener('click', () => { fighterSelect.hidden = false; });
document.querySelectorAll('.fighter-option').forEach((button) => button.addEventListener('click', () => {
  const player = Number(button.dataset.player), fighter = button.dataset.fighter;
  setFighter(player, fighter);
  document.querySelectorAll(`.fighter-option[data-player="${player}"]`).forEach((item) => item.classList.toggle('selected', item === button));
  hud.setPlayerLabel?.(player, fighterLabel(player));
  if (networkStatus === 'connected' && networkRole === 'guest' && player === 1) multiplayer.send('FIGHTER_SELECT_REQUEST', { fighter });
  else if (networkRole === 'host' && networkStatus === 'connected') sendState();
}));
document.querySelectorAll('.stage-option').forEach((button) => button.addEventListener('click', () => {
  selectedStage = button.dataset.stage;
  document.querySelectorAll('.stage-option').forEach((item) => item.classList.toggle('selected', item === button));
  arena.setBackground(selectedStage === 'valley' ? gameAssets.arena : null);
  if (networkRole === 'host' && networkStatus === 'connected') sendState();
}));
document.getElementById('start-battle')?.addEventListener('click', () => {
  fighterSelect.hidden = true; resetMatch(); playIntro(); hud.setStatus('ROUND 1 — FIGHT!');
});
document.getElementById('rematch')?.addEventListener('click', () => { resetMatch(); playIntro(); });
document.getElementById('result-select')?.addEventListener('click', () => { hud.hideMatchResult(); fighterSelect.hidden = false; });

// Multiplayer room controls.
document.getElementById('create-room')?.addEventListener('click', async () => {
  try { await multiplayer.createRoom(); }
  catch (error) { renderMultiplayerStatus({ status: 'error', detail: error.message, role: 'offline' }); }
});
document.getElementById('join-room')?.addEventListener('click', async () => {
  const code = document.getElementById('join-code')?.value || '';
  try { await multiplayer.joinRoom(code); }
  catch (error) { renderMultiplayerStatus({ status: 'error', detail: error.message, role: 'offline' }); }
});
document.getElementById('join-code')?.addEventListener('input', (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});
document.getElementById('copy-room-code')?.addEventListener('click', async () => {
  const code = multiplayer.roomCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    document.getElementById('copy-room-code').textContent = 'COPIED';
  } catch {
    document.getElementById('network-status').textContent = `Copy this code: ${code}`;
  }
});
document.getElementById('leave-room')?.addEventListener('click', () => {
  multiplayer.leave();
  localPlayerIndex = 0;
  resetMatch();
});

// One local webcam per browser. The room creator is P1; the joiner is P2.
webcam.onStateChange(({ state }) => {
  if (state === CameraState.CONNECTED) {
    handTracker.start();
    multiplayer?.setLocalStream(webcam.stream);
  } else {
    handTracker.stop();
    multiplayer?.setLocalStream(null);
  }
});
handTracker.onResult((frame) => signPipeline.process(frame));
signPipeline.onUpdate((state) => {
  webcamPanel.renderSign(state);
  hud.setSign(localPlayerIndex, state.hasHand ? (state.currentSign || 'UNKNOWN') : '—');
  signDebug.update(state);
});
signPipeline.onSign((state) => {
  if (matchOver || roundTransition) return;
  const sign = state.newSign;
  actionRouter.handleSignEvent({ sign, confidence: state.confidence, timestamp: state.timestamp });
  if (networkStatus === 'connected') {
    if (networkRole === 'host') multiplayer.send('SIGN_UPDATE', { playerIndex: 0, sign });
    else multiplayer.send('SIGN', { sign });
  }
});
webcam.start();

setFighter(0, 'shadow'); setFighter(1, 'crimson');
hud.setPlayerLabel?.(0, fighterLabel(0, 'YOU')); hud.setPlayerLabel?.(1, fighterLabel(1, 'OPPONENT'));
hud.setStatus('ROUND 1 — FIGHT!');
updateRoundHud(); refreshChakra();
hud.setSequence([]);
refreshHud();
playIntro(false);
window.__shinobi = {
  webcam, handTracker, signPipeline, signDebug, sequenceRecognizer, bridge,
  combat, jutsuSystem, effects, actionRouter, defense, multiplayer, soundFx, chakra,
};

// Keyboard input is intentionally not mapped to combat or match resets.
// Attacks and defenses can only be triggered by recognized hand-sign sequences.
// Keep D as a developer-only sign-debug toggle; it never changes gameplay state.
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'd') signDebug.toggle();
});

// Render / projectile hit loop.
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  arena.update(dt);
  screenShake = Math.max(0, screenShake - dt);
  actionRouter.tick(now);
  characters.forEach((character) => character.update(dt));
  effects.update(dt, (effect) => {
    if (!isAuthority() || matchOver || roundTransition) return;
    const resolution = defense.resolveIncomingAttack(effect.target, effect.attacker, effect.damage, performance.now());
    if (resolution.counterDamage > 0) { combat.damagePlayer(effect.attacker, resolution.counterDamage, 'counter'); chakra[effect.target] = Math.min(100, chakra[effect.target] + 20); }
    if (resolution.applied > 0) { combat.damagePlayer(effect.target, resolution.applied, effect.type); chakra[effect.attacker] = Math.min(100, chakra[effect.attacker] + (effect.type.startsWith('ultimate-') ? 10 : 32)); }
    else if (resolution.countered) hud.setStatus('COUNTER! ATTACK REFLECTED');
    else if (resolution.blocked) hud.setStatus('GUARD BLOCKED 75%');
    refreshChakra();
    sendState();
  });
  ctx.save();
  if (screenShake > 0) {
    const magnitude = screenShake * 22;
    ctx.translate((Math.random() - 0.5) * magnitude, (Math.random() - 0.5) * magnitude);
  }
  arena.draw(ctx);
  characters.forEach((character) => character.draw(ctx));
  effects.draw(ctx);
  ctx.restore();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
