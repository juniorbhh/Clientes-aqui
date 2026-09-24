const state = {
  coordinates: null, locationLabel: "", locationSource: null, searching: false,
  results: [], selectedCategories: [], radiusKm: 5, mapCenter: null,
  map: null, markerLayer: null, googleMap: null, googleInfoWindow: null,
  googleMarkers: [], markersById: new Map(), googleReady: false,
  googleLoading: null, autocompleteTimer: null, autocompleteSessionToken: null,
  suggestions: [],
};

const els = {
  form: document.querySelector("#search-form"), address: document.querySelector("#address"),
  suggestions: document.querySelector("#address-suggestions"), locationButton: document.querySelector("#location-button"),
  locationNote: document.querySelector("#location-note"), selectAll: document.querySelector("#select-all"),
  marketFilter: document.querySelector("#market-filter"), hideLargeChains: document.querySelector("#hide-large-chains"),
  searchButton: document.querySelector("#search-button"), formError: document.querySelector("#form-error"),
  empty: document.querySelector("#empty-state"), loading: document.querySelector("#loading-state"),
  loadingMessage: document.querySelector("#loading-message"), content: document.querySelector("#results-content"),
  count: document.querySelector("#result-count"), resultLocation: document.querySelector("#result-location"),
  radiusPill: document.querySelector("#radius-pill"), dataNote: document.querySelector("#data-note"),
  chips: document.querySelector("#result-chips"), list: document.querySelector("#result-list"),
  panel: document.querySelector("#results-panel"), mapElement: document.querySelector("#results-map"),
  categories: [...document.querySelectorAll('input[name="category"]')],
  radii: [...document.querySelectorAll('input[name="radius"]')],
};

const categoryMeta = {
  padaria: { label: "Padaria", plural: "Padarias", letter: "P", color: "#b8650a" },
  supermercado: { label: "Supermercado", plural: "Supermercados", letter: "S", color: "#1238d1" },
  emporio: { label: "Empório a granel", plural: "Empórios a granel", letter: "E", color: "#087866" },
};

const largeChainPatterns = [
  /\bepa\b/, /\b(?:supermercados?|supermecados?|mercado)\s+bh\b/, /\bbh\s+supermercados?\b/, /^bh$/,
  /\bcarrefour\b/, /\batacadao\b/, /\bassai\b/, /\bmart\s+minas\b/,
  /\bapoio\s+mineiro\b/, /\bvillefort\b/, /\bmineirao\s+atacarejo\b/,
  /\bsuper\s*nosso\b/, /\bverdemar\b/, /\bpao\s+de\s+acucar\b/,
  /\bextra(?:\s+supermercado)?\b/, /\bbretas\b/, /\bbahamas\b/,
  /\btenda\s+atacado\b/, /\bsavegnago\b/, /\bfort\s+atacadista\b/,
  /\bspani\b/, /\bkomprao\b/, /\bangeloni\b/, /\bzaffari\b/,
  /\bmuffato\b/, /\bguanabara\b/, /\bprezunic\b/, /\broldao\b/,
  /\bmax(?:xi)?\s+(?:atacado|atacadista)\b/, /\bgiassi\b/, /\bcondor\b/,
  /\bgrupo\s+mateus\b/, /^dia(?:\s|$)/,
];

function normalize(value = "") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function isKnownLargeChain(name) { const value = normalize(name).trim(); return largeChainPatterns.some((pattern) => pattern.test(value)); }
function getSelectedCategories() { return els.categories.filter((input) => input.checked).map((input) => input.value); }
function getRadiusKm() { return Number(els.radii.find((input) => input.checked)?.value || 5); }
function setError(message = "") { els.formError.textContent = message; els.formError.hidden = !message; }
function setView(view) {
  els.empty.hidden = view !== "empty"; els.loading.hidden = view !== "loading";
  els.content.hidden = view !== "results"; els.searchButton.disabled = view === "loading";
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}
function formatDistance(km) {
  if (km < 1) return `${Math.max(50, Math.round(km * 1000 / 50) * 50)} m`;
  return `${km.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}
function distanceInKm(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const earthRadius = 6371; const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function safeWebsite(value) {
  if (!value) return "";
  try { const url = new URL(value.startsWith("http") ? value : `https://${value}`); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
}
function businessIcon() { return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 21h16M6 21V9l6-5 6 5v12M9 13h2m2 0h2m-6 4h2m2 0h2"/></svg>'; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function initializeGoogleProvider() {
  if (state.googleLoading) return state.googleLoading;
  state.googleLoading = (async () => {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const config = response.ok ? await response.json() : {};
      if (!config.googleMapsKey) return false;
      await new Promise((resolve, reject) => {
        const callbackName = `clientesAquiGoogleReady${Date.now()}`;
        const script = document.createElement("script");
        const timer = setTimeout(() => reject(new Error("Google Maps demorou para carregar.")), 15000);
        window[callbackName] = () => { clearTimeout(timer); delete window[callbackName]; resolve(); };
        script.async = true;
        script.onerror = () => { clearTimeout(timer); delete window[callbackName]; reject(new Error("Google Maps não carregou.")); };
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsKey)}&loading=async&libraries=places&v=weekly&language=pt-BR&region=BR&callback=${callbackName}`;
        document.head.appendChild(script);
      });
      await Promise.all([window.google.maps.importLibrary("maps"), window.google.maps.importLibrary("places")]);
      state.googleReady = true;
      return true;
    } catch (error) {
      console.warn("Google Maps indisponível; usando a busca pública alternativa.", error);
      return false;
    }
  })();
  return state.googleLoading;
}

function closeSuggestions() {
  state.suggestions = []; els.suggestions.hidden = true; els.suggestions.innerHTML = "";
  els.address.setAttribute("aria-expanded", "false");
}

function renderSuggestions(suggestions) {
  state.suggestions = suggestions;
  if (!suggestions.length) { closeSuggestions(); return; }
  els.suggestions.innerHTML = suggestions.map((suggestion, index) => `
    <button class="address-suggestion" type="button" role="option" data-suggestion-index="${index}">
      <strong>${escapeHtml(suggestion.main || suggestion.label)}</strong>
      ${suggestion.secondary ? `<span>${escapeHtml(suggestion.secondary)}</span>` : ""}
    </button>`).join("");
  els.suggestions.hidden = false; els.address.setAttribute("aria-expanded", "true");
  els.suggestions.querySelectorAll("[data-suggestion-index]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => { void selectSuggestion(Number(button.dataset.suggestionIndex)); });
  });
}

async function fetchFallbackSuggestions(input) {
  try { const response = await fetch(`/api/autocomplete?q=${encodeURIComponent(input)}`); if (!response.ok) return []; return (await response.json()).suggestions || []; } catch { return []; }
}

async function fetchGoogleSuggestions(input) {
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await window.google.maps.importLibrary("places");
  if (!state.autocompleteSessionToken) state.autocompleteSessionToken = new AutocompleteSessionToken();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken: state.autocompleteSessionToken, includedRegionCodes: ["br"], language: "pt-BR", region: "br" });
  return suggestions.filter((item) => item.placePrediction).map((item) => {
    const prediction = item.placePrediction;
    return { id: prediction.placeId, label: prediction.text?.toString() || "", main: prediction.mainText?.toString() || prediction.text?.toString() || "", secondary: prediction.secondaryText?.toString() || "", prediction };
  });
}

async function updateAddressSuggestions(input) {
  if (input.length < 3) { closeSuggestions(); return; }
  els.suggestions.innerHTML = '<div class="address-loading">Procurando endereços...</div>';
  els.suggestions.hidden = false; els.address.setAttribute("aria-expanded", "true");
  let suggestions = [];
  if (state.googleReady) {
    try { suggestions = await fetchGoogleSuggestions(input); } catch (error) { console.warn("Autocomplete do Google indisponível; usando alternativa.", error); }
  }
  if (!suggestions.length) suggestions = await fetchFallbackSuggestions(input);
  if (els.address.value.trim() !== input) return;
  renderSuggestions(suggestions);
}

async function selectSuggestion(index) {
  const suggestion = state.suggestions[index]; if (!suggestion) return;
  try {
    if (suggestion.prediction) {
      const place = suggestion.prediction.toPlace();
      await place.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
      state.coordinates = { lat: place.location.lat(), lon: place.location.lng() };
      state.locationLabel = place.formattedAddress || suggestion.label; state.autocompleteSessionToken = null;
    } else {
      state.coordinates = { lat: suggestion.lat, lon: suggestion.lon }; state.locationLabel = suggestion.label;
    }
    state.locationSource = "suggestion"; els.address.value = state.locationLabel;
    els.locationNote.textContent = "Endereço selecionado para a busca."; closeSuggestions(); setError();
  } catch { setError("Não foi possível selecionar esse endereço. Escolha outra sugestão."); }
}

async function requestSearch(payload) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 50000); let response;
  try {
    response = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
  } catch (cause) {
    const error = new Error("A fonte de estabelecimentos ainda não respondeu."); error.retryable = true; error.cause = cause; throw error;
  } finally { clearTimeout(timer); }
  let data = {};
  try { data = await response.json(); } catch {
    const error = new Error("A fonte de estabelecimentos enviou uma resposta incompleta."); error.retryable = response.status >= 500; throw error;
  }
  if (!response.ok) { const error = new Error(data.error || "Não foi possível concluir a busca agora."); error.retryable = response.status === 429 || response.status >= 500; throw error; }
  return data;
}

function createClientMarker(item) {
  return window.L.divIcon({ className: "map-marker-shell", html: `<span class="map-client-pin ${item.category}"><span>${categoryMeta[item.category].letter}</span></span>`, iconSize: [29, 36], iconAnchor: [14, 32], popupAnchor: [0, -30] });
}

function renderLeafletMap(center, results) {
  if (!window.L) { els.mapElement.innerHTML = '<div class="map-unavailable">O mapa não carregou. Atualize a página para tentar novamente.</div>'; return; }
  if (!state.map) {
    state.map = window.L.map(els.mapElement, { scrollWheelZoom: false, zoomControl: true, preferCanvas: true });
    window.L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 18, subdomains: "abcd", detectRetina: false, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO' }).addTo(state.map);
    state.markerLayer = window.L.layerGroup().addTo(state.map);
  }
  state.markerLayer.clearLayers(); state.markersById.clear(); const points = [[center.lat, center.lon]];
  const originIcon = window.L.divIcon({ className: "map-marker-shell", html: '<span class="map-origin-marker"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
  window.L.marker([center.lat, center.lon], { icon: originIcon, zIndexOffset: 1000 }).bindPopup("<strong>Seu local de busca</strong>").addTo(state.markerLayer);
  for (const item of results) {
    const marker = window.L.marker([item.lat, item.lon], { icon: createClientMarker(item) }).bindPopup(`<div class="map-popup"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(categoryMeta[item.category].label)} · ${formatDistance(item.distance)}</span></div>`).addTo(state.markerLayer);
    state.markersById.set(item.id, { provider: "leaflet", marker }); points.push([item.lat, item.lon]);
  }
  setTimeout(() => { state.map.invalidateSize(); if (points.length === 1) state.map.setView(points[0], 15); else state.map.fitBounds(points, { padding: [28, 28], maxZoom: 15 }); }, 0);
}

function googleMapStyles() {
  return [
    { featureType: "poi", stylers: [{ visibility: "off" }] }, { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ visibility: "simplified" }, { color: "#dbe2ec" }] },
    { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { featureType: "landscape", stylers: [{ color: "#f6f8fb" }] }, { featureType: "water", stylers: [{ color: "#dfeaf6" }] },
  ];
}

function openGoogleMarker(entry) {
  state.googleInfoWindow.setContent(`<div class="map-popup"><strong>${escapeHtml(entry.item.name)}</strong><span>${escapeHtml(categoryMeta[entry.item.category].label)} · ${formatDistance(entry.item.distance)}</span></div>`);
  state.googleInfoWindow.open({ map: state.googleMap, anchor: entry.marker, shouldFocus: false });
}

function renderGoogleMap(center, results) {
  if (!state.googleMap) {
    state.googleMap = new window.google.maps.Map(els.mapElement, { center: { lat: center.lat, lng: center.lon }, zoom: 13, mapTypeId: "roadmap", disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: "cooperative", styles: googleMapStyles() });
    state.googleInfoWindow = new window.google.maps.InfoWindow();
  }
  state.googleMarkers.forEach((marker) => marker.setMap(null)); state.googleMarkers = []; state.markersById.clear();
  const bounds = new window.google.maps.LatLngBounds();
  const origin = new window.google.maps.Marker({ map: state.googleMap, position: { lat: center.lat, lng: center.lon }, title: "Seu local de busca", zIndex: 1000, icon: { path: window.google.maps.SymbolPath.CIRCLE, fillColor: "#1238d1", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 4, scale: 9 } });
  state.googleMarkers.push(origin); bounds.extend(origin.getPosition());
  for (const item of results) {
    const marker = new window.google.maps.Marker({ map: state.googleMap, position: { lat: item.lat, lng: item.lon }, title: item.name, label: { text: categoryMeta[item.category].letter, color: "#ffffff", fontWeight: "800", fontSize: "11px" }, icon: { path: window.google.maps.SymbolPath.CIRCLE, fillColor: categoryMeta[item.category].color, fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3, scale: 12 } });
    const entry = { provider: "google", marker, item }; marker.addListener("click", () => openGoogleMarker(entry));
    state.googleMarkers.push(marker); state.markersById.set(item.id, entry); bounds.extend(marker.getPosition());
  }
  state.googleMap.fitBounds(bounds, 35);
  window.google.maps.event.addListenerOnce(state.googleMap, "idle", () => { if (state.googleMap.getZoom() > 15) state.googleMap.setZoom(15); });
}

function renderMap(center, results) { if (!center) return; if (state.googleReady) renderGoogleMap(center, results); else renderLeafletMap(center, results); }
function focusResultOnMap(id) {
  const entry = state.markersById.get(id); if (!entry) return;
  if (entry.provider === "google") { state.googleMap.panTo(entry.marker.getPosition()); state.googleMap.setZoom(17); openGoogleMarker(entry); }
  else { state.map.setView(entry.marker.getLatLng(), 17, { animate: true }); entry.marker.openPopup(); }
  if (window.innerWidth < 901) els.mapElement.scrollIntoView({ behavior: "smooth", block: "center" });
}

function visibleResults() { if (!els.hideLargeChains.checked) return state.results; return state.results.filter((item) => !(item.category === "supermercado" && item.isLargeChain)); }

function renderResults() {
  const results = visibleResults(); const hiddenChains = state.results.length - results.length;
  els.count.textContent = String(results.length); els.resultLocation.textContent = `A partir de ${state.locationLabel}`;
  els.radiusPill.textContent = `até ${state.radiusKm} km`;
  els.dataNote.textContent = state.googleReady ? "Resultados e mapa fornecidos pelo Google Maps." : "Resultados baseados nas informações públicas disponíveis no mapa.";
  const counts = Object.fromEntries(state.selectedCategories.map((category) => [category, 0]));
  results.forEach((result) => { counts[result.category] = (counts[result.category] || 0) + 1; });
  els.chips.innerHTML = state.selectedCategories.map((category) => `<span class="result-chip">${escapeHtml(categoryMeta[category].plural)} · ${counts[category] || 0}</span>`).join("") + (hiddenChains ? `<span class="result-chip result-chip-muted">${hiddenChains} ${hiddenChains === 1 ? "rede grande oculta" : "redes grandes ocultas"}</span>` : "");
  if (!results.length) {
    const message = hiddenChains ? "Só foram encontradas grandes redes nesta região. Desative o filtro para visualizá-las." : `Nenhum estabelecimento dessas categorias foi encontrado em até ${state.radiusKm} km.`;
    els.list.innerHTML = `<div class="form-error results-message">${message}</div>`;
  } else {
    els.list.innerHTML = results.map((item) => {
      const website = safeWebsite(item.website); const mapUrl = item.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.lat},${item.lon}`)}`; const phoneDigits = (item.phone || "").replace(/[^+\d]/g, "");
      return `<article class="result-card" data-result-id="${escapeHtml(item.id)}"><div class="result-top"><span class="result-icon">${businessIcon()}</span><div class="result-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(categoryMeta[item.category].label)}${item.isLargeChain ? " · Grande rede" : ""}</span></div><span class="distance">${formatDistance(item.distance)}</span></div><p class="result-address"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s7-5.4 7-12a7 7 0 1 0-14 0c0 6.6 7 12 7 12Zm0-9a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/></svg><span>${escapeHtml(item.address)}</span></p><div class="result-actions"><button type="button" data-focus-marker="${escapeHtml(item.id)}">Ver no mapa</button><a href="${mapUrl}" target="_blank" rel="noopener noreferrer">Abrir no Google Maps ↗</a>${phoneDigits ? `<a href="tel:${escapeHtml(phoneDigits)}">Ligar</a>` : ""}${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Site ↗</a>` : ""}</div></article>`;
    }).join("");
  }
  setView("results"); renderMap(state.mapCenter, results);
  els.list.querySelectorAll("[data-focus-marker]").forEach((button) => button.addEventListener("click", () => focusResultOnMap(button.dataset.focusMarker)));
}

function boundsForRadius(center, radiusKm) {
  const latDelta = radiusKm / 111.32; const lonDelta = radiusKm / (111.32 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)));
  return { south: center.lat - latDelta, west: center.lon - lonDelta, north: center.lat + latDelta, east: center.lon + lonDelta };
}

async function resolveGoogleAddress(address) {
  const { Place } = await window.google.maps.importLibrary("places");
  const { places } = await Place.searchByText({ textQuery: address, fields: ["displayName", "formattedAddress", "location"], language: "pt-BR", region: "br", maxResultCount: 1 });
  const place = places?.[0];
  if (!place?.location) { const error = new Error("Não encontrei esse endereço. Escolha uma das sugestões exibidas."); error.retryable = false; throw error; }
  return { center: { lat: place.location.lat(), lon: place.location.lng() }, label: place.formattedAddress || place.displayName || address };
}

function googleSearchPlan(categories) {
  const plans = [];
  if (categories.includes("padaria")) plans.push({ category: "padaria", textQuery: "padaria", includedType: "bakery" });
  if (categories.includes("supermercado")) { plans.push({ category: "supermercado", textQuery: "supermercado", includedType: "supermarket" }); plans.push({ category: "supermercado", textQuery: "mercado de bairro" }); }
  if (categories.includes("emporio")) {
    plans.push({ category: "emporio", textQuery: "empório a granel" }, { category: "emporio", textQuery: "loja de produtos naturais e a granel" }, { category: "emporio", textQuery: "Biscoito e Cia" }, { category: "emporio", textQuery: "BH Coisas da Roça" });
  }
  return plans;
}

async function searchWithGoogle(center, categories, radiusKm) {
  const { Place } = await window.google.maps.importLibrary("places"); const bounds = boundsForRadius(center, radiusKm);
  const attempts = await Promise.allSettled(googleSearchPlan(categories).map(async (plan) => {
    const request = { textQuery: plan.textQuery, fields: ["id", "displayName", "formattedAddress", "location", "businessStatus", "primaryType", "types"], locationRestriction: bounds, language: "pt-BR", region: "br", maxResultCount: 20 };
    if (plan.includedType) request.includedType = plan.includedType;
    const { places } = await Place.searchByText(request); return { category: plan.category, places: places || [] };
  }));
  const successful = attempts.filter((attempt) => attempt.status === "fulfilled");
  if (!successful.length) { const error = new Error("O Google Maps ainda não respondeu."); error.retryable = true; throw error; }
  const unique = new Map();
  for (const attempt of successful) {
    for (const place of attempt.value.places) {
      if (!place.id || !place.location || !place.displayName) continue;
      const lat = place.location.lat(); const lon = place.location.lng(); const distance = distanceInKm(center.lat, center.lon, lat, lon);
      if (distance > radiusKm || unique.has(place.id)) continue;
      unique.set(place.id, { id: `google-${place.id}`, name: place.displayName, category: attempt.value.category, address: place.formattedAddress || "Endereço não informado", phone: "", website: "", lat, lon, distance, isLargeChain: attempt.value.category === "supermercado" && isKnownLargeChain(place.displayName) });
    }
  }
  return [...unique.values()].sort((a, b) => a.distance - b.distance);
}

async function executeSearch(typedAddress, selected, radiusKm) {
  if (state.googleReady) {
    let center = state.coordinates; let label = state.locationLabel;
    if (!center) { const resolved = await resolveGoogleAddress(typedAddress); center = resolved.center; label = resolved.label; }
    const results = await searchWithGoogle(center, selected, radiusKm);
    return { center, locationLabel: label || typedAddress || "sua localização atual", results, provider: "google", radiusKm };
  }
  const payload = { categories: selected, radiusKm };
  if (state.coordinates) { payload.lat = state.coordinates.lat; payload.lon = state.coordinates.lon; } else payload.address = typedAddress;
  return requestSearch(payload);
}

async function runSearch({ address, categories, radiusKm } = {}) {
  if (state.searching) return { ok: false, message: "Já existe uma busca em andamento." };
  const selected = categories?.length ? categories : getSelectedCategories(); const selectedRadius = Number(radiusKm || getRadiusKm());
  if (!selected.length) { setError("Escolha pelo menos uma categoria de cliente."); return { ok: false, message: "Nenhuma categoria selecionada." }; }
  const typedAddress = typeof address === "string" ? address.trim() : els.address.value.trim();
  if (!state.coordinates && !typedAddress) { setError("Digite um endereço ou use sua localização atual."); els.address.focus(); return { ok: false, message: "Local não informado." }; }
  state.searching = true; setError(); closeSuggestions(); els.loadingMessage.textContent = "Consultando os estabelecimentos próximos..."; setView("loading");
  try {
    let data; let retry = 0;
    while (!data) {
      try { data = await executeSearch(typedAddress, selected, selectedRadius); }
      catch (error) {
        if (!error?.retryable) throw error;
        retry += 1; const waitMs = Math.min(3000 * (2 ** Math.min(retry - 1, 3)), 15000);
        els.loadingMessage.textContent = `A fonte está ocupada. Tentativa automática ${retry + 1} em instantes...`; await delay(waitMs);
      }
    }
    state.results = data.results || []; state.selectedCategories = selected; state.radiusKm = selectedRadius;
    state.mapCenter = data.center; state.locationLabel = data.locationLabel || state.locationLabel || (state.locationSource === "device" ? "sua localização atual" : typedAddress);
    state.coordinates = data.center; if (state.locationSource === "device") els.locationNote.textContent = state.locationLabel; else state.locationSource = state.locationSource || "address";
    renderResults(); if (window.innerWidth < 901) els.panel.scrollIntoView({ behavior: "smooth", block: "start" });
    return { ok: true, count: visibleResults().length, location: state.locationLabel };
  } catch (error) {
    setView("empty"); setError(error?.message || "Confira o endereço informado e tente novamente."); return { ok: false, message: error?.message || "Falha na busca." };
  } finally { state.searching = false; els.searchButton.disabled = false; els.loadingMessage.textContent = "Isso pode levar alguns segundos."; }
}

function updateMarketFilterVisibility() { const selected = els.categories.some((item) => item.value === "supermercado" && item.checked); els.marketFilter.hidden = !selected; }
els.form.addEventListener("submit", (event) => { event.preventDefault(); void runSearch(); });
els.address.addEventListener("input", () => {
  state.coordinates = null; state.locationLabel = ""; state.locationSource = "address";
  els.locationButton.classList.remove("is-active"); els.locationButton.querySelector("span").textContent = "Usar minha localização";
  els.locationNote.textContent = "Escolha uma sugestão para confirmar rua, bairro e cidade."; setError(); clearTimeout(state.autocompleteTimer);
  const input = els.address.value.trim(); state.autocompleteTimer = setTimeout(() => { void updateAddressSuggestions(input); }, 350);
});
els.address.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSuggestions(); });
document.addEventListener("click", (event) => { if (!event.target.closest(".autocomplete-wrap")) closeSuggestions(); });
els.locationButton.addEventListener("click", () => {
  if (!navigator.geolocation) { setError("Este navegador não permite compartilhar a localização. Digite o endereço manualmente."); return; }
  setError(); closeSuggestions(); els.locationButton.disabled = true; els.locationButton.querySelector("span").textContent = "Localizando...";
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    state.coordinates = { lat: coords.latitude, lon: coords.longitude }; state.locationSource = "device"; state.locationLabel = "sua localização atual";
    els.address.value = ""; els.address.placeholder = "Localização atual selecionada"; els.locationButton.disabled = false; els.locationButton.classList.add("is-active");
    els.locationButton.querySelector("span").textContent = "Localização selecionada"; els.locationNote.textContent = "Localização pronta para a busca.";
  }, (error) => {
    els.locationButton.disabled = false; els.locationButton.querySelector("span").textContent = "Usar minha localização";
    setError(error.code === error.PERMISSION_DENIED ? "A localização foi bloqueada. Autorize o acesso no navegador ou digite o endereço." : "Não foi possível obter sua localização. Digite o endereço manualmente.");
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
});
els.selectAll.addEventListener("click", () => {
  const shouldSelect = !els.categories.every((input) => input.checked); els.categories.forEach((input) => { input.checked = shouldSelect; });
  els.selectAll.textContent = shouldSelect ? "Limpar seleção" : "Selecionar os 3"; updateMarketFilterVisibility(); setError();
});
els.categories.forEach((input) => input.addEventListener("change", () => {
  const allSelected = els.categories.every((item) => item.checked); const noneSelected = els.categories.every((item) => !item.checked);
  els.selectAll.textContent = allSelected ? "Limpar seleção" : "Selecionar os 3"; updateMarketFilterVisibility(); if (!noneSelected) setError();
}));
els.hideLargeChains.addEventListener("change", () => { if (state.results.length) renderResults(); });

function registerWebMcp() {
  const context = document.modelContext; if (!context?.registerTool) return; const validCategories = Object.keys(categoryMeta);
  try {
    void Promise.resolve(context.registerTool({
      name: "buscar_clientes_proximos", title: "Buscar clientes próximos",
      description: "Busca estabelecimentos próximos de um endereço brasileiro nas categorias padaria, supermercado e/ou emporio.",
      inputSchema: { type: "object", properties: { address: { type: "string", description: "Endereço com cidade e estado." }, categories: { type: "array", items: { type: "string", enum: validCategories }, minItems: 1, uniqueItems: true }, radiusKm: { type: "number", enum: [1, 5, 10], description: "Raio da busca em quilômetros." }, hideLargeChains: { type: "boolean", description: "Oculta grandes redes de supermercados." } }, required: ["address", "categories"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        if (!input || typeof input.address !== "string" || !input.address.trim()) throw new Error("Informe um endereço.");
        if (!Array.isArray(input.categories) || !input.categories.length || input.categories.some((item) => !validCategories.includes(item))) throw new Error("Informe ao menos uma categoria válida.");
        state.coordinates = null; state.locationSource = "address"; els.address.value = input.address.trim();
        els.categories.forEach((item) => { item.checked = input.categories.includes(item.value); });
        els.radii.forEach((item) => { item.checked = Number(item.value) === Number(input.radiusKm || 5); });
        els.hideLargeChains.checked = input.hideLargeChains !== false; updateMarketFilterVisibility();
        return runSearch({ address: input.address, categories: input.categories, radiusKm: input.radiusKm || 5 });
      },
    })).catch(() => {});
  } catch {}
}

updateMarketFilterVisibility(); registerWebMcp(); void initializeGoogleProvider();
