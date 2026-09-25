(() => {
  const BH_CENTER = { lat: -19.9167, lon: -43.9345 };
  const STORAGE_KEY = "clientes-aqui-supabase-session";
  const categoryLabels = {
    padaria: "Padaria",
    supermercado: "Supermercado",
    emporio: "Empório a granel",
    outro: "Outro",
  };

  const state = {
    config: null,
    session: null,
    clients: [],
    map: null,
    markers: null,
    markersByClientId: new Map(),
    draftMarker: null,
    locationMarker: null,
    locationAccuracyCircle: null,
    selectedPoint: null,
    editingId: null,
    statusFilter: "all",
    mapSearchSuggestions: [],
    mapSearchTimer: null,
    mapSearchRequestId: 0,
  };

  const els = {
    navButtons: [...document.querySelectorAll("[data-view-target]")],
    views: [...document.querySelectorAll("[data-view]")],
    authCard: document.querySelector("#auth-card"),
    authForm: document.querySelector("#auth-form"),
    authEmail: document.querySelector("#auth-email"),
    authPassword: document.querySelector("#auth-password"),
    authMessage: document.querySelector("#auth-message"),
    signin: document.querySelector("#signin-button"),
    signup: document.querySelector("#signup-button"),
    account: document.querySelector("#clients-account"),
    accountEmail: document.querySelector("#account-email"),
    signout: document.querySelector("#signout-button"),
    workspace: document.querySelector("#clients-workspace"),
    count: document.querySelector("#saved-client-count"),
    listStatus: document.querySelector("#clients-list-status"),
    list: document.querySelector("#saved-client-list"),
    newClient: document.querySelector("#new-client-button"),
    centerLocation: document.querySelector("#center-location-button"),
    statusFilters: [...document.querySelectorAll('input[name="client-status-filter"]')],
    form: document.querySelector("#client-form"),
    formTitle: document.querySelector("#client-form-title"),
    formMessage: document.querySelector("#client-form-message"),
    cancelForm: document.querySelector("#cancel-client-button"),
    saveClient: document.querySelector("#save-client-button"),
    name: document.querySelector("#client-name"),
    category: document.querySelector("#client-category"),
    statuses: [...document.querySelectorAll('input[name="client-status"]')],
    address: document.querySelector("#client-address"),
    phone: document.querySelector("#client-phone"),
    contact: document.querySelector("#client-contact"),
    notes: document.querySelector("#client-notes"),
    selectedPoint: document.querySelector("#selected-point"),
    mapInstruction: document.querySelector("#map-instruction"),
    mapElement: document.querySelector("#clients-map"),
    mapSearchInput: document.querySelector("#client-map-address"),
    mapSearchButton: document.querySelector("#client-map-search-button"),
    mapSearchSuggestions: document.querySelector("#client-map-suggestions"),
  };

  const statusLabels = { ativo: "Ativo", espera: "Em espera" };

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function setMessage(element, message = "", type = "info") {
    element.textContent = message;
    element.dataset.type = type;
    element.hidden = !message;
  }

  function currentClientStatus() {
    return els.statuses.find((input) => input.checked)?.value || "ativo";
  }

  function visibleClients() {
    if (state.statusFilter === "all") return state.clients;
    return state.clients.filter((client) => (client.client_status || "ativo") === state.statusFilter);
  }

  function saveSession(session) {
    state.session = session || null;
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
  }

  async function api(path, { method = "GET", body, accessToken, headers = {} } = {}) {
    if (!state.config) throw new Error("O Supabase ainda não está configurado neste projeto.");
    const response = await fetch(`${state.config.supabaseUrl}${path}`, {
      method,
      headers: {
        apikey: state.config.supabasePublishableKey,
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const error = new Error(data?.msg || data?.message || data?.error_description || data?.error || "Não foi possível concluir a operação.");
      error.status = response.status;
      error.code = data?.code;
      throw error;
    }
    return data;
  }

  async function refreshSession() {
    const current = state.session;
    if (!current?.refresh_token) return false;
    try {
      const refreshed = await api("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: current.refresh_token } });
      saveSession(refreshed);
      return true;
    } catch {
      saveSession(null);
      return false;
    }
  }

  async function validSession() {
    if (!state.session?.access_token) return false;
    const expiresAt = Number(state.session.expires_at || 0);
    if (expiresAt && expiresAt * 1000 < Date.now() + 60000) return refreshSession();
    return true;
  }

  function showView(name, updateHash = true) {
    els.views.forEach((view) => { view.hidden = view.dataset.view !== name; });
    els.navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.viewTarget === name));
    if (updateHash) history.replaceState(null, "", name === "clients" ? "#clientes" : location.pathname + location.search);
    if (name === "clients" && state.map) setTimeout(() => state.map.invalidateSize(), 0);
  }

  function renderAuthState() {
    const signedIn = Boolean(state.session?.access_token && state.session?.user);
    els.authCard.hidden = signedIn;
    els.workspace.hidden = !signedIn;
    els.account.hidden = !signedIn;
    els.accountEmail.textContent = signedIn ? state.session.user.email || "Conta conectada" : "";
    if (signedIn) {
      initializeMap();
      void loadClients();
    }
  }

  function initializeMap() {
    if (state.map || !window.L) return;
    state.map = window.L.map(els.mapElement, { zoomControl: true, scrollWheelZoom: true, preferCanvas: true }).setView([BH_CENTER.lat, BH_CENTER.lon], 12);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      detectRetina: false,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(state.map);
    state.markers = window.L.layerGroup().addTo(state.map);
    state.map.on("click", (event) => {
      if (els.form.hidden) return;
      selectPoint(event.latlng.lat, event.latlng.lng, true);
    });
  }

  function markerIcon(category = "outro", clientStatus = "ativo") {
    const letter = categoryLabels[category]?.charAt(0) || "C";
    return window.L.divIcon({
      className: "map-marker-shell",
      html: `<span class="map-client-pin ${escapeHtml(category)} status-${escapeHtml(clientStatus)}"><span>${escapeHtml(letter)}</span></span>`,
      iconSize: [29, 36],
      iconAnchor: [14, 32],
      popupAnchor: [0, -30],
    });
  }

  function renderMarkers() {
    if (!state.map || !state.markers) return;
    state.markers.clearLayers();
    state.markersByClientId.clear();
    visibleClients().forEach((client) => {
      const clientStatus = client.client_status || "ativo";
      const marker = window.L.marker([client.latitude, client.longitude], { icon: markerIcon(client.category, clientStatus) });
      marker.bindPopup(`<div class="map-popup"><strong>${escapeHtml(client.name)}</strong><span>${escapeHtml(categoryLabels[client.category] || "Cliente")}</span><span class="popup-status status-${escapeHtml(clientStatus)}">${escapeHtml(statusLabels[clientStatus] || "Ativo")}</span>${client.address ? `<small>${escapeHtml(client.address)}</small>` : ""}<div class="popup-notes"><strong>Observações</strong>${escapeHtml(client.notes || "Nenhuma observação cadastrada.")}</div></div>`);
      marker.on("click", () => highlightClient(client.id));
      marker.addTo(state.markers);
      state.markersByClientId.set(client.id, marker);
    });
  }

  function renderList() {
    const clients = visibleClients();
    els.count.textContent = String(state.clients.length);
    if (!state.clients.length) els.listStatus.textContent = "Nenhum cliente cadastrado";
    else if (state.statusFilter === "all") els.listStatus.textContent = "Mais recentes primeiro";
    else els.listStatus.textContent = `${clients.length} ${statusLabels[state.statusFilter].toLowerCase()}`;
    if (!clients.length) {
      const emptyMessage = state.clients.length ? "Nenhum cliente encontrado neste filtro." : "Adicione o primeiro cliente e marque o local exato no mapa.";
      els.list.innerHTML = `<div class="clients-empty"><strong>${state.clients.length ? "Filtro sem resultados" : "Seu mapa está pronto"}</strong><p>${emptyMessage}</p></div>`;
      return;
    }
    els.list.innerHTML = clients.map((client) => {
      const clientStatus = client.client_status || "ativo";
      return `
      <article class="saved-client-card status-${escapeHtml(clientStatus)}" data-client-id="${escapeHtml(client.id)}">
        <button class="client-card-main" type="button" data-focus-client="${escapeHtml(client.id)}">
          <span class="client-dot status-${escapeHtml(clientStatus)}"></span>
          <span><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(categoryLabels[client.category] || "Cliente")}${client.address ? ` · ${escapeHtml(client.address)}` : ""}</small><span class="client-status-badge status-${escapeHtml(clientStatus)}">${escapeHtml(statusLabels[clientStatus] || "Ativo")}</span></span>
        </button>
        <div class="client-card-actions">
          <button type="button" data-edit-client="${escapeHtml(client.id)}">Editar</button>
          <button class="danger-link" type="button" data-delete-client="${escapeHtml(client.id)}">Excluir</button>
        </div>
      </article>`;
    }).join("");
    els.list.querySelectorAll("[data-focus-client]").forEach((button) => button.addEventListener("click", () => focusClient(button.dataset.focusClient)));
    els.list.querySelectorAll("[data-edit-client]").forEach((button) => button.addEventListener("click", () => editClient(button.dataset.editClient)));
    els.list.querySelectorAll("[data-delete-client]").forEach((button) => button.addEventListener("click", () => void deleteClient(button.dataset.deleteClient)));
  }

  function highlightClient(id) {
    els.list.querySelectorAll("[data-client-id]").forEach((card) => card.classList.toggle("is-active", card.dataset.clientId === id));
  }

  function focusClient(id) {
    const client = state.clients.find((item) => item.id === id);
    if (!client || !state.map) return;
    state.map.setView([client.latitude, client.longitude], 16, { animate: true });
    state.markersByClientId.get(id)?.openPopup();
    highlightClient(id);
  }

  async function loadClients() {
    if (!(await validSession())) { renderAuthState(); return; }
    els.listStatus.textContent = "Carregando...";
    try {
      const data = await api("/rest/v1/clients?select=*&order=created_at.desc", { accessToken: state.session.access_token });
      state.clients = Array.isArray(data) ? data.map((client) => ({ ...client, client_status: client.client_status || "ativo" })) : [];
      renderList();
      renderMarkers();
    } catch (error) {
      state.clients = [];
      renderList();
      els.listStatus.textContent = error.code === "PGRST205" || /schema cache|relation/i.test(error.message)
        ? "Banco ainda não preparado"
        : "Não foi possível carregar";
      setMessage(els.formMessage, error.message, "error");
    }
  }

  function selectPoint(lat, lon, moveMap = false) {
    state.selectedPoint = { lat: Number(lat), lon: Number(lon) };
    els.selectedPoint.textContent = `Ponto marcado: ${state.selectedPoint.lat.toFixed(5)}, ${state.selectedPoint.lon.toFixed(5)}`;
    els.selectedPoint.classList.add("is-selected");
    if (state.draftMarker) state.draftMarker.remove();
    state.draftMarker = window.L.marker([lat, lon], { icon: markerIcon(els.category.value, currentClientStatus()), zIndexOffset: 1200 }).addTo(state.map);
    if (moveMap) state.map.panTo([lat, lon]);
  }

  function openForm(client = null) {
    state.editingId = client?.id || null;
    els.form.hidden = false;
    els.formTitle.textContent = client ? "Editar cliente" : "Adicionar cliente";
    els.name.value = client?.name || "";
    els.category.value = client?.category || "padaria";
    const clientStatus = client?.client_status || "ativo";
    els.statuses.forEach((input) => { input.checked = input.value === clientStatus; });
    els.address.value = client?.address || "";
    els.phone.value = client?.phone || "";
    els.contact.value = client?.contact_name || "";
    els.notes.value = client?.notes || "";
    setMessage(els.formMessage);
    els.mapInstruction.textContent = "Clique no mapa para marcar o ponto do cliente";
    els.mapInstruction.classList.add("is-placing");
    if (client) selectPoint(client.latitude, client.longitude, true);
    else {
      state.selectedPoint = null;
      els.selectedPoint.textContent = "Nenhum ponto marcado";
      els.selectedPoint.classList.remove("is-selected");
      if (state.draftMarker) { state.draftMarker.remove(); state.draftMarker = null; }
    }
    setTimeout(() => els.name.focus(), 0);
  }

  function closeForm() {
    els.form.hidden = true;
    state.editingId = null;
    state.selectedPoint = null;
    els.mapInstruction.textContent = "Mapa de Belo Horizonte";
    els.mapInstruction.classList.remove("is-placing");
    if (state.draftMarker) { state.draftMarker.remove(); state.draftMarker = null; }
  }

  function editClient(id) {
    const client = state.clients.find((item) => item.id === id);
    if (client) openForm(client);
  }

  async function saveClient(event) {
    event.preventDefault();
    if (!els.name.value.trim()) { setMessage(els.formMessage, "Informe o nome do cliente.", "error"); return; }
    if (!state.selectedPoint) { setMessage(els.formMessage, "Clique no mapa para marcar o local do cliente.", "error"); return; }
    if (!(await validSession())) { renderAuthState(); return; }
    const payload = {
      user_id: state.session.user.id,
      name: els.name.value.trim(),
      category: els.category.value,
      client_status: currentClientStatus(),
      address: els.address.value.trim() || null,
      phone: els.phone.value.trim() || null,
      contact_name: els.contact.value.trim() || null,
      notes: els.notes.value.trim() || null,
      latitude: state.selectedPoint.lat,
      longitude: state.selectedPoint.lon,
      updated_at: new Date().toISOString(),
    };
    els.saveClient.disabled = true;
    els.saveClient.textContent = "Salvando...";
    setMessage(els.formMessage);
    try {
      const path = state.editingId ? `/rest/v1/clients?id=eq.${encodeURIComponent(state.editingId)}` : "/rest/v1/clients";
      await api(path, {
        method: state.editingId ? "PATCH" : "POST",
        body: payload,
        accessToken: state.session.access_token,
        headers: { Prefer: "return=representation" },
      });
      closeForm();
      await loadClients();
    } catch (error) {
      setMessage(els.formMessage, error.message, "error");
    } finally {
      els.saveClient.disabled = false;
      els.saveClient.textContent = "Salvar cliente";
    }
  }

  async function deleteClient(id) {
    const client = state.clients.find((item) => item.id === id);
    if (!client || !confirm(`Excluir ${client.name}?`)) return;
    if (!(await validSession())) { renderAuthState(); return; }
    try {
      await api(`/rest/v1/clients?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", accessToken: state.session.access_token });
      await loadClients();
    } catch (error) {
      els.listStatus.textContent = error.message;
    }
  }

  async function signIn(event) {
    event.preventDefault();
    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    if (!email || password.length < 6) { setMessage(els.authMessage, "Informe um e-mail válido e uma senha com pelo menos 6 caracteres.", "error"); return; }
    els.signin.disabled = true;
    setMessage(els.authMessage, "Entrando...");
    try {
      const session = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
      saveSession(session);
      setMessage(els.authMessage);
      renderAuthState();
    } catch (error) {
      setMessage(els.authMessage, error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message, "error");
    } finally { els.signin.disabled = false; }
  }

  async function signUp() {
    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    if (!email || password.length < 6) { setMessage(els.authMessage, "Informe um e-mail válido e uma senha com pelo menos 6 caracteres.", "error"); return; }
    els.signup.disabled = true;
    setMessage(els.authMessage, "Criando sua conta...");
    try {
      const result = await api("/auth/v1/signup", { method: "POST", body: { email, password } });
      if (result.access_token) {
        saveSession(result);
        renderAuthState();
      } else {
        setMessage(els.authMessage, "Conta criada. Confira seu e-mail para confirmar o acesso.", "success");
      }
    } catch (error) {
      setMessage(els.authMessage, error.message, "error");
    } finally { els.signup.disabled = false; }
  }

  async function signOut() {
    if (state.session?.access_token) {
      try { await api("/auth/v1/logout", { method: "POST", accessToken: state.session.access_token }); } catch {}
    }
    saveSession(null);
    state.clients = [];
    if (state.markers) state.markers.clearLayers();
    renderAuthState();
  }

  function closeMapSearchSuggestions() {
    state.mapSearchSuggestions = [];
    els.mapSearchSuggestions.innerHTML = "";
    els.mapSearchSuggestions.hidden = true;
    els.mapSearchInput.setAttribute("aria-expanded", "false");
  }

  function renderMapSearchSuggestions(suggestions) {
    state.mapSearchSuggestions = suggestions;
    if (!suggestions.length) {
      els.mapSearchSuggestions.innerHTML = '<div class="address-loading">Nenhum endereço encontrado.</div>';
      els.mapSearchSuggestions.hidden = false;
      els.mapSearchInput.setAttribute("aria-expanded", "true");
      return;
    }
    els.mapSearchSuggestions.innerHTML = suggestions.map((suggestion, index) => `
      <button class="address-suggestion" type="button" role="option" data-map-suggestion-index="${index}">
        <strong>${escapeHtml(suggestion.main || suggestion.label)}</strong>
        ${suggestion.secondary ? `<span>${escapeHtml(suggestion.secondary)}</span>` : ""}
      </button>`).join("");
    els.mapSearchSuggestions.hidden = false;
    els.mapSearchInput.setAttribute("aria-expanded", "true");
    els.mapSearchSuggestions.querySelectorAll("[data-map-suggestion-index]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => selectMapSearchSuggestion(Number(button.dataset.mapSuggestionIndex)));
    });
  }

  async function searchMapAddress(autoSelect = false) {
    const input = els.mapSearchInput.value.trim();
    if (input.length < 3) {
      closeMapSearchSuggestions();
      return;
    }
    const requestId = ++state.mapSearchRequestId;
    els.mapSearchSuggestions.innerHTML = '<div class="address-loading">Procurando endereço...</div>';
    els.mapSearchSuggestions.hidden = false;
    els.mapSearchInput.setAttribute("aria-expanded", "true");
    try {
      const response = await fetch(`/api/autocomplete?q=${encodeURIComponent(input)}`);
      const suggestions = response.ok ? (await response.json()).suggestions || [] : [];
      if (requestId !== state.mapSearchRequestId || els.mapSearchInput.value.trim() !== input) return;
      renderMapSearchSuggestions(suggestions);
      if (autoSelect && suggestions[0]) selectMapSearchSuggestion(0);
    } catch {
      if (requestId === state.mapSearchRequestId) renderMapSearchSuggestions([]);
    }
  }

  function selectMapSearchSuggestion(index) {
    const suggestion = state.mapSearchSuggestions[index];
    if (!suggestion || !Number.isFinite(suggestion.lat) || !Number.isFinite(suggestion.lon)) return;
    els.mapSearchInput.value = suggestion.label;
    closeMapSearchSuggestions();
    if (els.form.hidden) openForm();
    els.address.value = suggestion.label;
    selectPoint(suggestion.lat, suggestion.lon);
    state.map.setView([suggestion.lat, suggestion.lon], 17, { animate: true });
    els.mapInstruction.textContent = "Endereço encontrado — confirme o ponto e salve o cliente";
  }

  function centerOnDevice() {
    if (!navigator.geolocation) { els.listStatus.textContent = "Localização indisponível neste navegador"; return; }
    els.centerLocation.disabled = true;
    els.centerLocation.textContent = "Localizando...";
    els.listStatus.textContent = "Buscando a localização mais precisa...";
    let bestPosition = null;
    let finished = false;
    let watchId = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      els.centerLocation.disabled = false;
      els.centerLocation.textContent = "Minha localização";
      if (!bestPosition) {
        els.listStatus.textContent = "Não foi possível acessar sua localização";
        return;
      }
      const { latitude, longitude, accuracy } = bestPosition.coords;
      const latlng = [latitude, longitude];
      const zoom = accuracy <= 50 ? 18 : accuracy <= 150 ? 17 : 16;
      state.map.setView(latlng, zoom);
      if (state.locationMarker) state.locationMarker.remove();
      if (state.locationAccuracyCircle) state.locationAccuracyCircle.remove();
      state.locationAccuracyCircle = window.L.circle(latlng, { radius: Math.max(accuracy, 8), color: "#1238d1", weight: 1, fillColor: "#1238d1", fillOpacity: 0.08 }).addTo(state.map);
      state.locationMarker = window.L.circleMarker(latlng, { radius: 8, color: "#fff", weight: 4, fillColor: "#1238d1", fillOpacity: 1 })
        .bindPopup(`Sua localização<br><small>Precisão aproximada: ${Math.round(accuracy)} m</small>`).addTo(state.map).openPopup();
      els.listStatus.textContent = `Localização encontrada com precisão aproximada de ${Math.round(accuracy)} m`;
    };
    const timer = setTimeout(finish, 15000);
    watchId = navigator.geolocation.watchPosition((position) => {
      if (!bestPosition || position.coords.accuracy < bestPosition.coords.accuracy) bestPosition = position;
      if (position.coords.accuracy <= 30) { clearTimeout(timer); finish(); }
    }, () => {
      clearTimeout(timer);
      finish();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  async function initialize() {
    els.navButtons.forEach((button) => button.addEventListener("click", () => showView(button.dataset.viewTarget)));
    document.querySelector(".brand")?.addEventListener("click", (event) => { event.preventDefault(); showView("search"); });
    els.authForm.addEventListener("submit", signIn);
    els.signup.addEventListener("click", () => void signUp());
    els.signout.addEventListener("click", () => void signOut());
    els.newClient.addEventListener("click", () => openForm());
    els.cancelForm.addEventListener("click", closeForm);
    els.form.addEventListener("submit", saveClient);
    els.centerLocation.addEventListener("click", centerOnDevice);
    els.statusFilters.forEach((input) => input.addEventListener("change", () => {
      state.statusFilter = input.value;
      renderList();
      renderMarkers();
    }));
    els.category.addEventListener("change", () => {
      if (state.selectedPoint) selectPoint(state.selectedPoint.lat, state.selectedPoint.lon);
    });
    els.statuses.forEach((input) => input.addEventListener("change", () => {
      if (state.selectedPoint) selectPoint(state.selectedPoint.lat, state.selectedPoint.lon);
    }));
    els.mapSearchInput.addEventListener("input", () => {
      clearTimeout(state.mapSearchTimer);
      state.mapSearchTimer = setTimeout(() => void searchMapAddress(false), 350);
    });
    els.mapSearchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void searchMapAddress(true);
    });
    els.mapSearchInput.addEventListener("blur", () => setTimeout(closeMapSearchSuggestions, 150));
    els.mapSearchButton.addEventListener("click", () => void searchMapAddress(true));

    showView(location.hash === "#clientes" ? "clients" : "search", false);
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const config = response.ok ? await response.json() : {};
      if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error("A integração do Supabase ainda não forneceu as variáveis públicas ao site.");
      state.config = { supabaseUrl: config.supabaseUrl.replace(/\/$/, ""), supabasePublishableKey: config.supabasePublishableKey };
      saveSession(readSession());
      if (state.session && !(await validSession())) saveSession(null);
      renderAuthState();
    } catch (error) {
      setMessage(els.authMessage, error.message, "error");
      els.authForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
    }
  }

  void initialize();
})();
