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
    draftMarker: null,
    locationMarker: null,
    selectedPoint: null,
    editingId: null,
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
    form: document.querySelector("#client-form"),
    formTitle: document.querySelector("#client-form-title"),
    formMessage: document.querySelector("#client-form-message"),
    cancelForm: document.querySelector("#cancel-client-button"),
    saveClient: document.querySelector("#save-client-button"),
    name: document.querySelector("#client-name"),
    category: document.querySelector("#client-category"),
    address: document.querySelector("#client-address"),
    phone: document.querySelector("#client-phone"),
    contact: document.querySelector("#client-contact"),
    notes: document.querySelector("#client-notes"),
    selectedPoint: document.querySelector("#selected-point"),
    mapInstruction: document.querySelector("#map-instruction"),
    mapElement: document.querySelector("#clients-map"),
  };

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function setMessage(element, message = "", type = "info") {
    element.textContent = message;
    element.dataset.type = type;
    element.hidden = !message;
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

  function markerIcon(category = "outro") {
    const letter = categoryLabels[category]?.charAt(0) || "C";
    return window.L.divIcon({
      className: "map-marker-shell",
      html: `<span class="map-client-pin ${escapeHtml(category)}"><span>${escapeHtml(letter)}</span></span>`,
      iconSize: [29, 36],
      iconAnchor: [14, 32],
      popupAnchor: [0, -30],
    });
  }

  function renderMarkers() {
    if (!state.map || !state.markers) return;
    state.markers.clearLayers();
    state.clients.forEach((client) => {
      const marker = window.L.marker([client.latitude, client.longitude], { icon: markerIcon(client.category) });
      marker.bindPopup(`<div class="map-popup"><strong>${escapeHtml(client.name)}</strong><span>${escapeHtml(categoryLabels[client.category] || "Cliente")}</span>${client.address ? `<small>${escapeHtml(client.address)}</small>` : ""}</div>`);
      marker.on("click", () => highlightClient(client.id));
      marker.addTo(state.markers);
    });
  }

  function renderList() {
    els.count.textContent = String(state.clients.length);
    els.listStatus.textContent = state.clients.length ? "Mais recentes primeiro" : "Nenhum cliente cadastrado";
    if (!state.clients.length) {
      els.list.innerHTML = '<div class="clients-empty"><strong>Seu mapa está pronto</strong><p>Adicione o primeiro cliente e marque o local exato no mapa.</p></div>';
      return;
    }
    els.list.innerHTML = state.clients.map((client) => `
      <article class="saved-client-card" data-client-id="${escapeHtml(client.id)}">
        <button class="client-card-main" type="button" data-focus-client="${escapeHtml(client.id)}">
          <span class="client-dot ${escapeHtml(client.category)}"></span>
          <span><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(categoryLabels[client.category] || "Cliente")}${client.address ? ` · ${escapeHtml(client.address)}` : ""}</small></span>
        </button>
        <div class="client-card-actions">
          <button type="button" data-edit-client="${escapeHtml(client.id)}">Editar</button>
          <button class="danger-link" type="button" data-delete-client="${escapeHtml(client.id)}">Excluir</button>
        </div>
      </article>`).join("");
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
    highlightClient(id);
  }

  async function loadClients() {
    if (!(await validSession())) { renderAuthState(); return; }
    els.listStatus.textContent = "Carregando...";
    try {
      const data = await api("/rest/v1/clients?select=*&order=created_at.desc", { accessToken: state.session.access_token });
      state.clients = Array.isArray(data) ? data : [];
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
    state.draftMarker = window.L.marker([lat, lon], { icon: markerIcon(els.category.value), zIndexOffset: 1200 }).addTo(state.map);
    if (moveMap) state.map.panTo([lat, lon]);
  }

  function openForm(client = null) {
    state.editingId = client?.id || null;
    els.form.hidden = false;
    els.formTitle.textContent = client ? "Editar cliente" : "Adicionar cliente";
    els.name.value = client?.name || "";
    els.category.value = client?.category || "padaria";
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

  function centerOnDevice() {
    if (!navigator.geolocation) { els.listStatus.textContent = "Localização indisponível neste navegador"; return; }
    els.centerLocation.disabled = true;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const latlng = [coords.latitude, coords.longitude];
      state.map.setView(latlng, 15);
      if (state.locationMarker) state.locationMarker.remove();
      state.locationMarker = window.L.circleMarker(latlng, { radius: 8, color: "#fff", weight: 4, fillColor: "#1238d1", fillOpacity: 1 }).bindPopup("Sua localização").addTo(state.map);
      els.centerLocation.disabled = false;
    }, () => {
      els.listStatus.textContent = "Não foi possível acessar sua localização";
      els.centerLocation.disabled = false;
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
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
    els.category.addEventListener("change", () => {
      if (state.selectedPoint) selectPoint(state.selectedPoint.lat, state.selectedPoint.lon);
    });

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
