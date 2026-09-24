const VALID_CATEGORIES = new Set(["padaria", "supermercado", "emporio"]);
const VALID_RADII_KM = new Set([1, 5, 10]);
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const GEOCODE_TIMEOUT_MS = 7000;
const OVERPASS_TIMEOUT_MS = 18000;

const LARGE_CHAIN_PATTERNS = [
  /\bepa\b/, /\b(?:supermercados?|supermecados?|mercado)\s+bh\b/, /\bbh\s+supermercados?\b/, /^bh$/,
  /\bcarrefour\b/, /\batacadao\b/, /\bassai\b/, /\bmart\s+minas\b/,
  /\bapoio\s+mineiro\b/, /\bvillefort\b/, /\bmineirao\s+atacarejo\b/,
  /\bsuper\s*nosso\b/, /\bverdemar\b/, /\bpao\s+de\s+acucar\b/,
  /\bextra(?:\s+supermercado)?\b/, /\bbretas\b/, /\bbahamas\b/,
  /\btenda\s+atacado\b/, /\bsavegnago\b/, /\bfort\s+atacadista\b/,
  /\bspani\b/, /\bkomprao\b/, /\bangeloni\b/, /\bzaffari\b/,
  /\bmuffato\b/, /\bguanabara\b/, /\bprezunic\b/, /\broldao\b/,
  /\bmax(?:xi)?\s+atacadista?\b/, /\bgiassi\b/, /\bcondor\b/,
  /\bgrupo\s+mateus\b/, /^dia(?:\s|$)/,
];

const EMPORIO_REFERENCE_NAMES = new Set(["biscoito e cia", "bh coisas da roca"]);
const EMPORIO_SHOPS = new Set(["organic", "deli", "spices", "health_food", "greengrocer"]);

function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isLargeChain(tags, name) {
  const identity = normalize([name, tags.brand, tags.operator, tags.network].filter(Boolean).join(" ")).trim();
  return LARGE_CHAIN_PATTERNS.some((pattern) => pattern.test(identity));
}

function distanceInKm(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const earthRadius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatAddress(tags) {
  const street = tags["addr:street"] || tags["addr:place"];
  const number = tags["addr:housenumber"];
  const district = tags["addr:suburb"] || tags["addr:district"];
  const parts = [street && number ? `${street}, ${number}` : street, district].filter(Boolean);
  return parts.join(" · ") || "Endereço não informado no mapa";
}

function shortLocation(place, fallback) {
  const address = place.address || {};
  const parts = [
    address.road || address.pedestrian || address.neighbourhood,
    address.suburb || address.city_district,
    address.city || address.town || address.municipality,
  ].filter((value, index, array) => value && array.indexOf(value) === index);
  return parts.join(", ") || place.display_name || fallback;
}

function classify(tags, name) {
  if (EMPORIO_REFERENCE_NAMES.has(normalize(name).trim()) || EMPORIO_SHOPS.has(tags.shop)) return "emporio";
  if (tags.shop === "bakery") return "padaria";
  if (tags.shop === "supermarket" || tags.shop === "convenience") return "supermercado";
  return "emporio";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const osmHeaders = {
  "User-Agent": "ClientesAqui/1.1 (https://clientes-aqui-cliente-aqui.vercel.app)",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

async function geocodeAddress(address) {
  const params = new URLSearchParams({
    q: address,
    format: "jsonv2",
    limit: "1",
    countrycodes: "br",
    addressdetails: "1",
    "accept-language": "pt-BR",
  });
  const response = await fetchWithTimeout(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { headers: osmHeaders },
    GEOCODE_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error("Não foi possível consultar esse endereço agora.");
  const [place] = await response.json();
  if (!place) {
    const error = new Error("Não encontrei esse endereço. Tente incluir a cidade e o estado.");
    error.statusCode = 404;
    throw error;
  }
  return {
    lat: Number(place.lat),
    lon: Number(place.lon),
    label: shortLocation(place, address),
  };
}

async function reverseGeocode(lat, lon) {
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: "jsonv2",
      zoom: "16",
      addressdetails: "1",
      "accept-language": "pt-BR",
    });
    const response = await fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?${params}`, { headers: osmHeaders }, 5000);
    if (!response.ok) return "sua localização atual";
    return shortLocation(await response.json(), "sua localização atual");
  } catch {
    return "sua localização atual";
  }
}

function buildOverpassQuery(lat, lon, categories, radiusKm) {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const bbox = [lat - latDelta, lon - lonDelta, lat + latDelta, lon + lonDelta]
    .map((value) => value.toFixed(6)).join(",");
  const clauses = [];
  if (categories.includes("padaria")) clauses.push(`nwr(${bbox})["shop"="bakery"];`);
  if (categories.includes("supermercado")) clauses.push(`nwr(${bbox})["shop"~"^(supermarket|convenience)$"];`);
  if (categories.includes("emporio")) {
    clauses.push(`nwr(${bbox})["shop"~"^(organic|deli|spices|health_food|greengrocer)$"];`);
    clauses.push(`nwr(${bbox})["name"="Biscoito e Cia"];`);
    clauses.push(`nwr(${bbox})["name"="BH Coisas da Roça"];`);
  }
  return `[out:json][timeout:16];(${clauses.join("")});out center tags;`;
}

async function queryOverpass(query) {
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());
  const startedAt = Date.now();
  const attempts = OVERPASS_ENDPOINTS.map(async (endpoint, index) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controllers[index].abort();
    }, OVERPASS_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { ...osmHeaders, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: query }),
        signal: controllers[index].signal,
      });
      if (!response.ok) throw new Error(`Serviço de busca indisponível (${response.status}).`);
      const data = await response.json();
      console.log("[search] fonte de estabelecimentos respondeu", {
        source: index + 1,
        durationMs: Date.now() - startedAt,
        elements: data.elements?.length || 0,
      });
      return data;
    } catch (error) {
      const details = {
        source: index + 1,
        durationMs: Date.now() - startedAt,
        error: error?.name || "Error",
        message: error?.message || String(error),
      };
      if (error?.name === "AbortError" && !timedOut) {
        console.log("[search] fonte alternativa cancelada", details);
      } else {
        console.warn("[search] fonte de estabelecimentos falhou", details);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });

  try {
    const data = await Promise.any(attempts);
    controllers.forEach((controller) => controller.abort());
    return data;
  } catch (error) {
    controllers.forEach((controller) => controller.abort());
    const unavailable = new Error("A busca está ocupada no momento. Aguarde alguns segundos e tente novamente.");
    unavailable.cause = error;
    unavailable.statusCode = 502;
    throw unavailable;
  }
}

function parseResults(data, lat, lon, categories, radiusKm) {
  const unique = new Map();
  for (const element of data.elements || []) {
    const itemLat = element.lat ?? element.center?.lat;
    const itemLon = element.lon ?? element.center?.lon;
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLon)) continue;
    const tags = element.tags || {};
    const name = tags.name || tags.brand;
    if (!name) continue;
    const category = classify(tags, name);
    if (!categories.includes(category)) continue;
    const distance = distanceInKm(lat, lon, itemLat, itemLon);
    if (distance > radiusKm) continue;
    const key = `${normalize(name)}-${itemLat.toFixed(4)}-${itemLon.toFixed(4)}`;
    if (unique.has(key)) continue;
    unique.set(key, {
      id: `${element.type}-${element.id}`,
      name,
      category,
      address: formatAddress(tags),
      phone: tags.phone || tags["contact:phone"] || "",
      website: tags.website || tags["contact:website"] || "",
      lat: itemLat,
      lon: itemLon,
      distance,
      isLargeChain: category === "supermercado" && isLargeChain(tags, name),
    });
  }
  return [...unique.values()].sort((a, b) => a.distance - b.distance);
}

function parseBody(req) {
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body || {};
}

module.exports = async function handler(req, res) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use o botão de busca para consultar os clientes." });
  }

  try {
    const body = parseBody(req);
    const categories = Array.isArray(body.categories) ? [...new Set(body.categories)] : [];
    const radiusKm = Number(body.radiusKm ?? 5);
    console.log("[search] consulta recebida", {
      requestId,
      categories: categories.length,
      locationMode: typeof body.address === "string" && body.address.trim() ? "address" : "coordinates",
    });
    if (!categories.length || categories.some((category) => !VALID_CATEGORIES.has(category))) {
      return res.status(400).json({ error: "Escolha pelo menos uma categoria válida." });
    }
    if (!VALID_RADII_KM.has(radiusKm)) {
      return res.status(400).json({ error: "Escolha um raio de 1 km, 5 km ou 10 km." });
    }

    let center;
    let locationLabel;
    if (typeof body.address === "string" && body.address.trim()) {
      if (body.address.trim().length > 240) return res.status(400).json({ error: "O endereço informado é muito longo." });
      const place = await geocodeAddress(body.address.trim());
      center = { lat: place.lat, lon: place.lon };
      locationLabel = place.label;
    } else {
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return res.status(400).json({ error: "Informe um endereço ou compartilhe sua localização." });
      }
      center = { lat, lon };
      locationLabel = await reverseGeocode(lat, lon);
    }

    console.log("[search] local resolvido", {
      requestId,
      durationMs: Date.now() - startedAt,
    });
    const data = await queryOverpass(buildOverpassQuery(center.lat, center.lon, categories, radiusKm));
    const results = parseResults(data, center.lat, center.lon, categories, radiusKm);
    console.log("[search] consulta concluída", {
      requestId,
      durationMs: Date.now() - startedAt,
      results: results.length,
    });
    return res.status(200).json({
      center,
      locationLabel,
      results,
      provider: "openstreetmap",
      radiusKm,
    });
  } catch (error) {
    console.error("[search] consulta falhou", {
      requestId,
      durationMs: Date.now() - startedAt,
      error: error?.name || "Error",
      message: error?.message || String(error),
      cause: error?.cause?.message || "",
    });
    const status = error.statusCode || 500;
    const message = status >= 500
      ? "Não foi possível consultar os estabelecimentos agora. Tente novamente em alguns instantes."
      : error.message;
    return res.status(status).json({ error: message });
  }
};
