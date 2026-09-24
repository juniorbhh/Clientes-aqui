module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
  return res.status(200).json({
    googleMapsKey: process.env.GOOGLE_MAPS_BROWSER_KEY || "",
    supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabasePublishableKey:
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "",
  });
};
