const AUTOCOMPLETE_TIMEOUT_MS = 6500;

const osmHeaders = {
  "User-Agent": "ClientesAqui/1.2 (https://clientes-aqui-cliente-aqui.vercel.app)",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTOCOMPLETE_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: osmHeaders, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function suggestionFromPlace(place) {
  const address = place.address || {};
  const main = [
    address.road || address.pedestrian || address.neighbourhood || address.suburb,
    address.house_number,
  ].filter(Boolean).join(", ") || place.name || place.display_name;
  const secondary = [
    address.suburb || address.city_district,
    address.city || address.town || address.municipality,
    address.state,
  ].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ");
  return {
    id: String(place.place_id),
    label: place.display_name,
    main,
    secondary,
    lat: Number(place.lat),
    lon: Number(place.lon),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=120");
  if (req.method !== "GET") return res.status(405).json({ suggestions: [] });
  const input = String(req.query?.q || "").trim();
  if (input.length < 3 || input.length > 160) return res.status(200).json({ suggestions: [] });

  try {
    const params = new URLSearchParams({
      q: input,
      format: "jsonv2",
      limit: "6",
      countrycodes: "br",
      addressdetails: "1",
      dedupe: "1",
      "accept-language": "pt-BR",
    });
    const response = await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!response.ok) throw new Error(`Autocomplete indisponível (${response.status}).`);
    const places = await response.json();
    return res.status(200).json({ suggestions: places.map(suggestionFromPlace) });
  } catch (error) {
    console.warn("[autocomplete] consulta falhou", { error: error?.name, message: error?.message });
    return res.status(200).json({ suggestions: [] });
  }
};
