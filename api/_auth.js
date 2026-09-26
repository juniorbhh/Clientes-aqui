module.exports = async function requireUser(req, res) {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "")?.[1];
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !key) {
    res.status(401).json({ error: "Entre na sua conta para continuar." });
    return false;
  }
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(7000),
    });
    if (response.ok && (await response.json())?.id) return true;
  } catch {
    res.status(503).json({ error: "Não foi possível verificar sua conta agora." });
    return false;
  }
  res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
  return false;
};
