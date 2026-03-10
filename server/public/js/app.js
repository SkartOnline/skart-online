/**
 * Skart 2 Online — Main Application Logic
 */
(function () {
  'use strict';

  const API_BASE = '';
  const TOKEN_KEY = 'skart-token';

  function readAuthToken() {
    const sessionToken = sessionStorage.getItem(TOKEN_KEY);
    if (sessionToken) return sessionToken;

    const legacyLocalToken = localStorage.getItem(TOKEN_KEY);
    if (legacyLocalToken) {
      sessionStorage.setItem(TOKEN_KEY, legacyLocalToken);
      return legacyLocalToken;
    }
    return null;
  }

  let authToken = readAuthToken();
  let currentUser = null;
  let isRegisterMode = false;

  let allCards = [];
  let userCards = [];
  let userDecks = [];
  let activeClassFilter = 'all';
  let tabsInitialized = false;
  let selectedDeckId = null;
  let editingDeckMainCards = [];
  let editingDeckCharIds = [];
  let editingDeckSidedeckIds = [];
  let deckAddMode = 'main'; // 'main' | 'sidedeck'

  let currentLobby = null;
  let currentLobbyPoll = null;

  const views = {
    auth: document.getElementById('view-auth'),
    lobby: document.getElementById('view-lobby'),
    collection: document.getElementById('view-collection'),
    lobbies: document.getElementById('view-lobbies'),
    lobbyRoom: document.getElementById('view-lobby-room'),
    game: document.getElementById('view-game')
  };

  const authForm = document.getElementById('auth-form');
  const authTitle = document.getElementById('auth-title');
  const authSubmit = document.getElementById('auth-submit');
  const authToggleText = document.getElementById('auth-toggle-text');
  const authToggleLink = document.getElementById('auth-toggle-link');
  const authError = document.getElementById('auth-error');
  const authSuccess = document.getElementById('auth-success');
  const authUsername = document.getElementById('auth-username');
  const authPassword = document.getElementById('auth-password');

  const lobbyUsername = document.getElementById('lobby-username');
  const lobbyGreetingName = document.getElementById('lobby-greeting-name');
  const btnLogout = document.getElementById('btn-logout');
  const btnCollection = document.getElementById('btn-collection');
  const btnLobbies = document.getElementById('btn-lobbies');
  const btnTestGame = document.getElementById('btn-test-game');

  const btnBackLobby = document.getElementById('btn-back-lobby');
  const collectionUsername = document.getElementById('collection-username');
  const btnCreateDeck = document.getElementById('btn-create-deck');
  const deckList = document.getElementById('deck-list');
  const deckEditor = document.getElementById('deck-editor');
  const deckEditorTitle = document.getElementById('deck-editor-title');
  const deckName = document.getElementById('deck-name');
  const deckCharCount = document.getElementById('deck-char-count');
  const deckCharList = document.getElementById('deck-char-list');
  const deckCardCount = document.getElementById('deck-card-count');
  const deckCardList = document.getElementById('deck-card-list');
  const btnSaveDeck = document.getElementById('btn-save-deck');
  const btnDeleteDeck = document.getElementById('btn-delete-deck');
  const deckEditorMsg = document.getElementById('deck-editor-msg');
  const deckEditorError = document.getElementById('deck-editor-error');
  const deckSidedeckWrap = document.getElementById('deck-sidedeck-wrap');
  const deckSidedeckCount = document.getElementById('deck-sidedeck-count');
  const deckSidedeckList = document.getElementById('deck-sidedeck-list');
  const btnSidedeckMode = document.getElementById('btn-sidedeck-mode');

  const btnBackFromLobbies = document.getElementById('btn-back-from-lobbies');
  const lobbiesUsername = document.getElementById('lobbies-username');
  const createLobbyName = document.getElementById('create-lobby-name');
  const createLobbyPassword = document.getElementById('create-lobby-password');
  const createLobbyDevmode = document.getElementById('create-lobby-devmode');
  const btnCreateLobby = document.getElementById('btn-create-lobby');
  const lobbiesError = document.getElementById('lobbies-error');
  const lobbiesList = document.getElementById('lobbies-list');

  const btnLeaveLobbyRoom = document.getElementById('btn-leave-lobby-room');
  const roomTitle = document.getElementById('room-title');
  const roomUsername = document.getElementById('room-username');
  const roomPlayers = document.getElementById('room-players');
  const roomDeckSelect = document.getElementById('room-deck-select');
  const btnRoomReady = document.getElementById('btn-room-ready');
  const roomStatus = document.getElementById('room-status');

  const btnExitGame = document.getElementById('btn-exit-game');

  function clearTimers() {
    if (currentLobbyPoll) {
      clearInterval(currentLobbyPoll);
      currentLobbyPoll = null;
    }
  }

  function showView(name) {
    clearTimers();
    Object.keys(views).forEach(k => {
      if (views[k]) views[k].classList.toggle('active', k === name);
    });
  }

  function clearAuthMessages() {
    authError.classList.add('hidden');
    authSuccess.classList.add('hidden');
    authError.textContent = '';
    authSuccess.textContent = '';
  }

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
    authSuccess.classList.add('hidden');
  }

  function showAuthSuccess(msg) {
    authSuccess.textContent = msg;
    authSuccess.classList.remove('hidden');
    authError.classList.add('hidden');
  }

  function updateAuthForm() {
    const i18n = window.SkartI18n;
    if (isRegisterMode) {
      authTitle.textContent = i18n.t('auth.register_title');
      authSubmit.textContent = i18n.t('auth.register_btn');
      authToggleText.textContent = i18n.t('auth.has_account');
      authToggleLink.textContent = i18n.t('auth.login_link');
    } else {
      authTitle.textContent = i18n.t('auth.login_title');
      authSubmit.textContent = i18n.t('auth.login_btn');
      authToggleText.textContent = i18n.t('auth.no_account');
      authToggleLink.textContent = i18n.t('auth.register_link');
    }
  }

  async function apiFetch(endpoint, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const resp = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });

    let data = null;
    try {
      data = await resp.json();
    } catch {
      data = {};
    }
    return { status: resp.status, ok: resp.ok, data };
  }

  async function apiGet(endpoint) {
    return apiFetch(endpoint, { method: 'GET' });
  }

  async function apiPost(endpoint, body) {
    return apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
  }

  async function apiPut(endpoint, body) {
    return apiFetch(endpoint, { method: 'PUT', body: JSON.stringify(body) });
  }

  async function apiDelete(endpoint) {
    return apiFetch(endpoint, { method: 'DELETE' });
  }

  async function handleAuth(e) {
    e.preventDefault();
    clearAuthMessages();

    const username = authUsername.value.trim();
    const password = authPassword.value;

    if (!username || !password) {
      return;
    }

    const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
    try {
      const { status, data } = await apiPost(endpoint, { username, password });
      if (status >= 400) {
        showAuthError(data.error || 'Hiba / Error');
        return;
      }

      authToken = data.token;
      currentUser = data.user;
      sessionStorage.setItem(TOKEN_KEY, authToken);

      if (isRegisterMode) {
        showAuthSuccess(window.SkartI18n.t('auth.success_register'));
        setTimeout(() => enterLobby(), 600);
      } else {
        enterLobby();
      }
    } catch (err) {
      console.error(err);
      showAuthError(window.SkartI18n.t('common.error'));
    }
  }

  function enterLobby() {
    if (!currentUser && authToken) {
      try {
        const payload = JSON.parse(atob(authToken.split('.')[1]));
        currentUser = { id: payload.id, username: payload.username };
      } catch {
        logout();
        return;
      }
    }

    if (!currentUser) {
      logout();
      return;
    }

    lobbyUsername.textContent = currentUser.username;
    lobbyGreetingName.textContent = currentUser.username;
    collectionUsername.textContent = currentUser.username;
    lobbiesUsername.textContent = currentUser.username;
    roomUsername.textContent = currentUser.username;

    showView('lobby');
  }

  function logout() {
    authToken = null;
    currentUser = null;
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    showView('auth');
  }

  function showDeckEditorMsg(msg) {
    deckEditorError.classList.add('hidden');
    deckEditorMsg.classList.remove('hidden');
    deckEditorMsg.textContent = msg;
  }

  function showDeckEditorError(msg) {
    deckEditorMsg.classList.add('hidden');
    deckEditorError.classList.remove('hidden');
    deckEditorError.textContent = msg;
  }

  function clearDeckEditorMessages() {
    deckEditorMsg.classList.add('hidden');
    deckEditorError.classList.add('hidden');
    deckEditorMsg.textContent = '';
    deckEditorError.textContent = '';
  }

  function getCardName(cardId) {
    const card = allCards.find(c => c.card_id === cardId);
    return card ? card.card_name : `#${cardId}`;
  }

  function isDeckEditorOpen() {
    return deckEditor && !deckEditor.classList.contains('hidden');
  }

  function renderDeckList() {
    deckList.innerHTML = '';
    if (!userDecks.length) {
      const empty = document.createElement('div');
      empty.className = 'deck-list-item-meta';
      empty.textContent = 'Még nincs mentett paklid.';
      deckList.appendChild(empty);
      return;
    }

    userDecks.forEach(deck => {
      const item = document.createElement('div');
      item.className = `deck-list-item ${selectedDeckId === deck.id ? 'active' : ''}`;
      const charNames = (deck.characterIds || []).map(id => getCardName(id)).join(', ');
      const cardCount = deck.mainCardIds?.length || 0;
      item.innerHTML = `
        <div class="deck-list-item-name">${deck.name}</div>
        <div class="deck-list-item-meta">${charNames || 'Nincs karakter'} • ${cardCount}/30 lap</div>
      `;
      item.addEventListener('click', () => editDeck(deck.id));
      deckList.appendChild(item);
    });
  }

  function renderDeckCardList() {
    deckCardList.innerHTML = '';
    deckCardCount.textContent = `${editingDeckMainCards.length}/30 fő lap`;

    if (editingDeckMainCards.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'deck-card-list-empty';
      empty.textContent = 'Kattints egy kártyára a gyűjteményben a hozzáadáshoz.';
      deckCardList.appendChild(empty);
      return;
    }

    const groups = {};
    editingDeckMainCards.forEach(id => { groups[id] = (groups[id] || 0) + 1; });

    Object.entries(groups).forEach(([cardIdStr, count]) => {
      const cardId = Number(cardIdStr);
      const entry = document.createElement('div');
      entry.className = 'deck-card-entry';
      entry.innerHTML = `
        <span class="deck-card-entry-name">${getCardName(cardId)}</span>
        <span class="deck-card-entry-count">×${count}</span>
      `;
      entry.title = 'Kattints az eltávolításhoz';
      entry.addEventListener('click', () => removeDeckCard(cardId));
      deckCardList.appendChild(entry);
    });
  }

  function getSidedeckRule() {
    for (const id of editingDeckCharIds) {
      const card = allCards.find(c => c.card_id === id);
      if (card && card.deckbuilding_rules && card.deckbuilding_rules.sidedeck) {
        return card.deckbuilding_rules.sidedeck;
      }
    }
    return null;
  }

  function matchesSidedeckFilter(card, filterStr) {
    if (!filterStr) return true;
    for (const clause of (filterStr || '').split(',')) {
      const c = clause.trim();
      if (c.startsWith('type:')) {
        if (card.card_type !== c.slice(5).toLowerCase()) return false;
      } else if (c.startsWith('!class:')) {
        const forbidden = c.slice(7);
        if (card.card_class === forbidden || card.card_class2 === forbidden) return false;
      }
    }
    return true;
  }

  function renderDeckSidedeckSection() {
    const rule = getSidedeckRule();
    if (!rule) {
      deckSidedeckWrap.classList.add('hidden');
      if (deckAddMode === 'sidedeck') {
        deckAddMode = 'main';
        btnSidedeckMode.classList.remove('btn-mode-active');
        btnSidedeckMode.textContent = '\uff0b Hozzáadás';
      }
      return;
    }
    deckSidedeckWrap.classList.remove('hidden');
    deckSidedeckCount.textContent = `${editingDeckSidedeckIds.length}/${rule.max} segédpakli lap`;
    deckSidedeckList.innerHTML = '';
    if (editingDeckSidedeckIds.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'deck-card-list-empty';
      empty.textContent = 'Kattints az egységekre a hozzáadáshoz.';
      deckSidedeckList.appendChild(empty);
      return;
    }
    const groups = {};
    editingDeckSidedeckIds.forEach(id => { groups[id] = (groups[id] || 0) + 1; });
    Object.entries(groups).forEach(([cardIdStr, count]) => {
      const cardId = Number(cardIdStr);
      const entry = document.createElement('div');
      entry.className = 'deck-card-entry';
      entry.innerHTML = `<span class="deck-card-entry-name">${getCardName(cardId)}</span><span class="deck-card-entry-count">×${count}</span>`;
      entry.title = 'Kattints az eltávolításhoz';
      entry.addEventListener('click', () => removeSidedeckCard(cardId));
      deckSidedeckList.appendChild(entry);
    });
  }

  function addSidedeckCard(cardId) {
    const rule = getSidedeckRule();
    if (!rule) return;
    if (editingDeckSidedeckIds.length >= rule.max) return;
    editingDeckSidedeckIds.push(cardId);
    renderDeckSidedeckSection();
  }

  function removeSidedeckCard(cardId) {
    const idx = editingDeckSidedeckIds.indexOf(cardId);
    if (idx !== -1) {
      editingDeckSidedeckIds.splice(idx, 1);
      renderDeckSidedeckSection();
    }
  }

  function addDeckCard(cardId) {
    if (editingDeckMainCards.length >= 30) return;
    editingDeckMainCards.push(cardId);
    renderDeckCardList();
  }

  function removeDeckCard(cardId) {
    const idx = editingDeckMainCards.indexOf(cardId);
    if (idx !== -1) {
      editingDeckMainCards.splice(idx, 1);
      renderDeckCardList();
    }
  }

  function renderDeckCharList() {
    deckCharList.innerHTML = '';
    deckCharCount.textContent = `${editingDeckCharIds.length}/2 karakter`;
    if (editingDeckCharIds.length === 0) {
      deckCharList.innerHTML = '<div class="deck-card-list-empty">Kattints a karakter kártyákra a hozzáadáshoz</div>';
      return;
    }
    editingDeckCharIds.forEach((id, idx) => {
      const name = getCardName(id);
      const entry = document.createElement('div');
      entry.className = 'deck-card-entry';
      entry.innerHTML = `<span class="deck-card-entry-name">${name}</span><span class="deck-card-entry-count">${idx + 1}.</span>`;
      entry.addEventListener('click', () => removeDeckChar(id));
      deckCharList.appendChild(entry);
    });
  }

  function addDeckChar(cardId) {
    if (editingDeckCharIds.length >= 2) return;
    if (editingDeckCharIds.includes(cardId)) return;
    editingDeckCharIds.push(cardId);
    renderDeckCharList();
    renderDeckSidedeckSection();
    refreshCollectionView();
  }

  function removeDeckChar(cardId) {
    const idx = editingDeckCharIds.indexOf(cardId);
    if (idx !== -1) {
      editingDeckCharIds.splice(idx, 1);
      if (!getSidedeckRule()) {
        editingDeckSidedeckIds = [];
        deckAddMode = 'main';
      }
      renderDeckCharList();
      renderDeckSidedeckSection();
      refreshCollectionView();
    }
  }

  function setDeckEditorFromDeck(deck) {
    selectedDeckId = deck?.id || null;
    deckEditor.classList.remove('hidden');
    deckEditorTitle.textContent = deck ? 'Pakli szerkesztése' : 'Új pakli';
    deckName.value = deck?.name || '';
    editingDeckCharIds = deck?.characterIds ? [...deck.characterIds] : [];
    editingDeckMainCards = deck?.mainCardIds ? [...deck.mainCardIds] : [];
    editingDeckSidedeckIds = deck?.sidedeckIds ? [...deck.sidedeckIds] : [];
    deckAddMode = 'main';
    btnDeleteDeck.classList.toggle('hidden', !deck);
    clearDeckEditorMessages();
    renderDeckList();
    renderDeckCharList();
    renderDeckCardList();
    renderDeckSidedeckSection();
    refreshCollectionView();
  }

  function closeDeckEditor() {
    selectedDeckId = null;
    editingDeckMainCards = [];
    editingDeckCharIds = [];
    editingDeckSidedeckIds = [];
    deckAddMode = 'main';
    deckEditor.classList.add('hidden');
    renderDeckList();
    refreshCollectionView();
  }

  function editDeck(deckId) {
    const deck = userDecks.find(d => d.id === deckId);
    if (!deck) {
      return;
    }
    setDeckEditorFromDeck(deck);
  }

  async function saveDeck() {
    clearDeckEditorMessages();
    const name = deckName.value.trim();
    const characterIds = [...editingDeckCharIds];
    const mainCardIds = [...editingDeckMainCards];

    if (name.length < 3) {
      showDeckEditorError('A pakli neve minimum 3 karakter legyen.');
      return;
    }

    const sidedeckIds = [...editingDeckSidedeckIds];
    const body = { name, characterIds, mainCardIds, sidedeckIds };
    const resp = selectedDeckId
      ? await apiPut(`/api/collection/decks/${selectedDeckId}`, body)
      : await apiPost('/api/collection/decks', body);

    if (!resp.ok) {
      showDeckEditorError(resp.data.error || 'Pakli mentési hiba.');
      return;
    }

    userDecks = resp.data.decks || userDecks;
    const created = resp.data.deck;
    selectedDeckId = created?.id || selectedDeckId;
    renderDeckList();
    showDeckEditorMsg('Pakli elmentve.');
  }

  async function deleteDeck() {
    if (!selectedDeckId) return;
    const resp = await apiDelete(`/api/collection/decks/${selectedDeckId}`);
    if (!resp.ok) {
      showDeckEditorError(resp.data.error || 'Pakli törlési hiba.');
      return;
    }
    userDecks = resp.data.decks || [];
    closeDeckEditor();
    showDeckEditorMsg('Pakli törölve.');
  }

  const CLASS_COLORS = {
    'Harcos':       { border: '#8d0909', bg: '#2a0505', art: '#661010', bar: '#d27a7a', text: '#f9dada' },
    'Mágus':        { border: '#1e6fb8', bg: '#051a33', art: '#1a4d8c', bar: '#7ec6f5', text: '#d9f0ff' },
    'Vaják':        { border: '#38761d', bg: '#0a1f05', art: '#265910', bar: '#9bcc8a', text: '#dff3d2' },
    'Zsivány':      { border: '#565656', bg: '#111111', art: '#404040', bar: '#b8b8b8', text: '#e6e6e6' },
    'Bölcs':        { border: '#a65e7e', bg: '#200f18', art: '#734059', bar: '#eab5c8', text: '#f9e6ef' },
    'Garabonciás':  { border: '#4c2a85', bg: '#0f0720', art: '#381f66', bar: '#b59de7', text: '#e3d8ff' },
    'Csodatevő':    { border: '#d98019', bg: '#1f1005', art: '#995a0d', bar: '#f2b866', text: '#ffebcc' },
  };
  const DEFAULT_COLORS = { border: '#666', bg: '#161b22', art: '#404050', bar: '#8888', text: '#d0d0d5' };

  function renderCollectionCards(cards) {
    const collectionGrid = document.getElementById('collection-grid');
    const collectionEmpty = document.getElementById('collection-empty');
    collectionGrid.innerHTML = '';

    const sorted = [...cards].sort((a, b) => {
      const typeOrder = { character: 0, unit: 1, spell: 2 };
      const ta = typeOrder[a.card_type] ?? 3;
      const tb = typeOrder[b.card_type] ?? 3;
      if (ta !== tb) return ta - tb;
      if ((a.cost ?? 0) !== (b.cost ?? 0)) return (a.cost ?? 0) - (b.cost ?? 0);
      return (a.card_name || '').localeCompare(b.card_name || '');
    });

    if (sorted.length === 0) {
      collectionEmpty.classList.remove('hidden');
      collectionGrid.classList.add('hidden');
      return;
    }

    collectionEmpty.classList.add('hidden');
    collectionGrid.classList.remove('hidden');

    const editorOpen = isDeckEditorOpen();

    sorted.forEach(card => {
      const colors = CLASS_COLORS[card.card_class] || DEFAULT_COLORS;
      const el = document.createElement('div');
      el.className = 'game-card';
      if (editorOpen) {
        el.classList.add('deck-clickable');
        // Dim already-selected characters
        if (card.card_type === 'character' && editingDeckCharIds.includes(card.card_id)) {
          el.classList.add('deck-selected');
        }
      }
      el.style.borderColor = colors.border;
      el.style.background = colors.bg;
      el.dataset.cardId = String(card.card_id);

      const costBadge = card.card_type === 'character' ? '-' : (card.cost ?? 0);
      let typeLabel = card.card_type === 'character' ? 'KARAKTER' : card.card_type === 'unit' ? 'EGYSÉG' : 'VARÁZSLAT';
      if (card.spell_type) typeLabel = card.spell_type.toUpperCase();

      let statsHtml = '';
      if (card.card_type === 'unit') {
        statsHtml = `<div class="game-card-stats"><span class="stat-atk">⚔ ${card.attack}</span><span class="stat-hp">♥ ${card.hp}</span></div>`;
      } else if (card.card_type === 'spell' && card.spell_range) {
        statsHtml = `<div class="game-card-stats"><span class="stat-range">Hatótáv: ${card.spell_range}</span></div>`;
      }

      el.innerHTML = `
        <div class="game-card-top" style="background:${colors.bar}">
          <span class="game-card-type">${typeLabel}</span>
          <span class="game-card-cost">${costBadge}</span>
        </div>
        <div class="game-card-name">${card.card_name}</div>
        <div class="game-card-class" style="color:${colors.bar}">${card.card_class || ''}${card.card_class2 ? ` / ${card.card_class2}` : ''}</div>
        <div class="game-card-art" style="background:${colors.art}"></div>
        ${statsHtml}
        <div class="game-card-text" style="background:${colors.text};color:#111">${card.description || ''}</div>
      `;

      // Click-to-add when deck editor is open
      if (editorOpen) {
        if (card.card_type === 'character') {
          el.addEventListener('click', () => addDeckChar(card.card_id));
        } else if (deckAddMode === 'sidedeck') {
          const rule = getSidedeckRule();
          if (rule && matchesSidedeckFilter(card, rule.filter)) {
            el.classList.add('sidedeck-eligible');
            el.addEventListener('click', () => addSidedeckCard(card.card_id));
          } else {
            el.classList.add('sidedeck-ineligible');
            el.addEventListener('click', () => addDeckCard(card.card_id));
          }
        } else {
          el.addEventListener('click', () => addDeckCard(card.card_id));
        }
      }

      collectionGrid.appendChild(el);
    });
  }

  function refreshCollectionView() {
    const filtered = activeClassFilter === 'all'
      ? allCards
      : allCards.filter(c => c.card_class === activeClassFilter || c.card_class2 === activeClassFilter);
    renderCollectionCards(filtered);
  }

  function setupCollectionTabs() {
    const tabs = document.getElementById('collection-tabs');
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      tabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeClassFilter = btn.dataset.class;
      refreshCollectionView();
    });
  }

  async function openCollection() {
    showView('collection');
    const [{ data: cardsResp }, { data: collectionResp }] = await Promise.all([
      apiGet('/api/cards'),
      apiGet('/api/collection')
    ]);

    allCards = cardsResp.cards || [];
    userCards = collectionResp.cards || [];
    userDecks = collectionResp.decks || [];

    if (!tabsInitialized) {
      setupCollectionTabs();
      tabsInitialized = true;
    }

    activeClassFilter = 'all';
    const tabs = document.getElementById('collection-tabs');
    tabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    tabs.querySelector('[data-class="all"]').classList.add('active');

    renderCollectionCards(allCards);
    renderDeckList();
    deckEditor.classList.add('hidden');
  }

  async function openLobbies() {
    showView('lobbies');
    lobbiesError.classList.add('hidden');
    await refreshLobbies();
  }

  function showLobbiesError(msg) {
    lobbiesError.classList.remove('hidden');
    lobbiesError.textContent = msg;
  }

  async function refreshLobbies() {
    const { ok, data } = await apiGet('/api/lobbies');
    if (!ok) {
      showLobbiesError(data.error || 'Nem sikerült a lobbyk lekérése.');
      return;
    }

    const lobbies = data.lobbies || [];
    lobbiesList.innerHTML = '';
    if (!lobbies.length) {
      const empty = document.createElement('div');
      empty.className = 'lobby-row-meta';
      empty.textContent = 'Nincs aktív lobby.';
      lobbiesList.appendChild(empty);
      return;
    }

    lobbies.forEach(lobby => {
      const row = document.createElement('div');
      row.className = 'lobby-row';
      row.innerHTML = `
        <div>
          <div><strong>${lobby.name}</strong></div>
          <div class="lobby-row-meta">Játékosok: ${lobby.players.length}/2 ${lobby.password ? '• Jelszavas' : ''}</div>
        </div>
        <button class="btn btn-primary btn-small">Csatlakozás</button>
      `;
      row.querySelector('button').addEventListener('click', async () => {
        const password = lobby.password ? window.prompt('Jelszó:') || '' : '';
        const joinResp = await apiPost(`/api/lobbies/${lobby.id}/join`, { password });
        if (!joinResp.ok) {
          showLobbiesError(joinResp.data.error || 'Csatlakozási hiba.');
          return;
        }
        await enterLobbyRoom(lobby.id);
      });
      lobbiesList.appendChild(row);
    });
  }

  async function createLobby() {
    const name = createLobbyName.value.trim();
    const password = createLobbyPassword.value.trim();
    const devMode = createLobbyDevmode.checked;
    const resp = await apiPost('/api/lobbies', { name, password, devMode });
    if (!resp.ok) {
      showLobbiesError(resp.data.error || 'Lobby létrehozási hiba.');
      return;
    }
    createLobbyName.value = '';
    createLobbyPassword.value = '';
    createLobbyDevmode.checked = false;
    await enterLobbyRoom(resp.data.lobby.id);
  }

  async function enterLobbyRoom(lobbyId) {
    showView('lobbyRoom');

    if (!userDecks.length) {
      const { data: collResp } = await apiGet('/api/collection');
      userDecks = collResp.decks || [];
    }

    const update = async () => {
      const resp = await apiGet(`/api/lobbies/${lobbyId}`);
      if (!resp.ok) {
        roomStatus.textContent = resp.data.error || 'Lobby hiba.';
        return;
      }

      currentLobby = resp.data.lobby;
      roomTitle.textContent = currentLobby.name + (currentLobby.devMode ? ' [DEV]' : '');
      roomPlayers.innerHTML = '';
      currentLobby.players.forEach(player => {
        const row = document.createElement('div');
        row.className = 'room-player';
        const myMark = player.userId === currentUser.id ? ' (te)' : '';
        row.innerHTML = `<span>${player.username}${myMark}</span><span>${player.deckId ? 'Pakli OK' : 'Nincs pakli'} • ${player.ready ? 'Kész' : 'Vár'}</span>`;
        roomPlayers.appendChild(row);
      });

      roomDeckSelect.innerHTML = '';
      userDecks.forEach(deck => {
        const opt = document.createElement('option');
        opt.value = deck.id;
        opt.textContent = `${deck.name} (${deck.mainCardIds.length} lap)`;
        roomDeckSelect.appendChild(opt);
      });

      const me = currentLobby.players.find(p => p.userId === currentUser.id);
      if (me?.deckId) {
        roomDeckSelect.value = me.deckId;
      }

      roomStatus.textContent = currentLobby.status === 'started'
        ? 'A játék elindult!'
        : 'Válassz paklit és jelöld magad késznek.';

      if (currentLobby.status === 'started' && currentLobby.gameId) {
        openMultiplayerGame(lobbyId);
      }
    };

    await update();
    currentLobbyPoll = setInterval(update, 1500);
  }

  async function leaveLobbyRoom() {
    if (currentLobby) {
      await apiPost(`/api/lobbies/${currentLobby.id}/leave`, {});
    }
    currentLobby = null;
    showView('lobbies');
    await refreshLobbies();
  }

  async function roomSelectDeck() {
    if (!currentLobby) return;
    const deckId = roomDeckSelect.value;
    const resp = await apiPost(`/api/lobbies/${currentLobby.id}/deck`, { deckId });
    if (!resp.ok) {
      roomStatus.textContent = resp.data.error || 'Pakliválasztási hiba.';
      return;
    }
    roomStatus.textContent = 'Pakli kiválasztva.';
  }

  async function roomToggleReady() {
    if (!currentLobby) return;
    const me = currentLobby.players.find(p => p.userId === currentUser.id);
    const nextReady = !me?.ready;

    const selectedDeckId = roomDeckSelect.value;
    if (!selectedDeckId) {
      roomStatus.textContent = 'Válassz paklit, mielőtt késznek jelölöd magad.';
      return;
    }

    if (!me?.deckId || me.deckId !== selectedDeckId) {
      const deckResp = await apiPost(`/api/lobbies/${currentLobby.id}/deck`, { deckId: selectedDeckId });
      if (!deckResp.ok) {
        roomStatus.textContent = deckResp.data.error || 'Pakliválasztási hiba.';
        return;
      }
      if (deckResp.data?.lobby) {
        currentLobby = deckResp.data.lobby;
      }
    }

    const resp = await apiPost(`/api/lobbies/${currentLobby.id}/ready`, { ready: nextReady });
    if (!resp.ok) {
      roomStatus.textContent = resp.data.error || 'Ready hiba.';
      return;
    }
    roomStatus.textContent = resp.data.gameStarted ? 'Játék indul...' : (nextReady ? 'Késznek jelölve.' : 'Kész állapot visszavonva.');
  }

  function openMultiplayerGame(lobbyId) {
    clearTimers();
    window.skartMultiplayerData = {
      lobbyId: lobbyId,
      token: authToken,
      userId: currentUser ? currentUser.id : 0,
      devMode: currentLobby ? currentLobby.devMode : false
    };
    startGodotArena();
  }

  function startGodotArena() {
    showView('game');

    const arenaWrapper = document.getElementById('arena-wrapper');
    const version = `v=${Date.now()}`;
    const candidatePaths = [`/godot/index.html?${version}`, `/godot/web_build/index.html?${version}`];

    const tryPath = (idx) => {
      if (idx >= candidatePaths.length) {
        showGodotMissing(arenaWrapper);
        return;
      }
      const godotPath = candidatePaths[idx];
      fetch(godotPath, { method: 'HEAD', cache: 'no-store' })
        .then(res => {
          if (res.ok) {
            arenaWrapper.innerHTML = '';
            arenaWrapper.classList.add('godot-active');
            const iframe = document.createElement('iframe');
            iframe.src = godotPath;
            iframe.id = 'godot-iframe';
            iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
            iframe.setAttribute('allowfullscreen', '');
            arenaWrapper.appendChild(iframe);
          } else {
            tryPath(idx + 1);
          }
        })
        .catch(() => tryPath(idx + 1));
    };

    tryPath(0);
  }

  function showGodotMissing(container) {
    container.innerHTML = `
      <div class="godot-missing">
        <div class="godot-missing-icon">⚔️</div>
        <h2>Godot motor nem elérhető</h2>
        <p>A játék futtatásához exportáld a Godot projektet HTML5-be.</p>
      </div>
    `;
  }

  function exitGame() {
    window.skartMultiplayerData = null;
    currentLobby = null;
    showView('lobby');
  }

  authForm.addEventListener('submit', handleAuth);

  authToggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isRegisterMode = !isRegisterMode;
    clearAuthMessages();
    updateAuthForm();
  });

  btnLogout.addEventListener('click', logout);
  btnCollection.addEventListener('click', openCollection);
  btnLobbies.addEventListener('click', async () => {
    const [{ data: cardsResp }, { data: collectionResp }] = await Promise.all([
      apiGet('/api/cards'),
      apiGet('/api/collection')
    ]);
    allCards = cardsResp.cards || [];
    userDecks = collectionResp.decks || [];
    await openLobbies();
  });
  btnTestGame.addEventListener('click', () => {
    window.skartMultiplayerData = null;
    startGodotArena();
  });
  btnBackLobby.addEventListener('click', () => showView('lobby'));
  btnExitGame.addEventListener('click', exitGame);

  btnCreateDeck.addEventListener('click', () => setDeckEditorFromDeck(null));
  btnSaveDeck.addEventListener('click', saveDeck);
  btnDeleteDeck.addEventListener('click', deleteDeck);
  btnSidedeckMode.addEventListener('click', () => {
    deckAddMode = deckAddMode === 'sidedeck' ? 'main' : 'sidedeck';
    btnSidedeckMode.classList.toggle('btn-mode-active', deckAddMode === 'sidedeck');
    btnSidedeckMode.textContent = deckAddMode === 'sidedeck' ? '\u2715 Kész' : '\uff0b Hozzáadás';
    refreshCollectionView();
  });

  btnBackFromLobbies.addEventListener('click', () => showView('lobby'));
  btnCreateLobby.addEventListener('click', createLobby);

  btnLeaveLobbyRoom.addEventListener('click', leaveLobbyRoom);
  roomDeckSelect.addEventListener('change', roomSelectDeck);
  btnRoomReady.addEventListener('click', roomToggleReady);

  async function init() {
    await window.SkartI18n.init();

    if (authToken) {
      try {
        const { status } = await apiGet('/api/collection');
        if (status === 401) {
          logout();
          return;
        }
        enterLobby();
      } catch {
        enterLobby();
      }
    } else {
      showView('auth');
    }
  }

  init();
})();
