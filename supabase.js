const SUPABASE_URL = "https://lepisrerivhkgklnltci.supabase.co";

/*
  Incolla qui la Publishable Key del progetto Supabase.
  La trovi in: Supabase > Project Settings > API Keys > Publishable key.
  NON usare service_role o Secret key.
*/
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0oMGxUyoHVqM7pQ2D7EkTQ_DnBON2jT";

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  throw new Error(
    "Libreria Supabase non caricata. Controlla la connessione internet e l'ordine degli script."
  );
}

if (
  !SUPABASE_PUBLISHABLE_KEY ||
  SUPABASE_PUBLISHABLE_KEY === "sb_publishable_0oMGxUyoHVqM7pQ2D7EkTQ_DnBON2jT"
) {
  console.error(
    "Publishable Key mancante: apri supabase.js e incolla la chiave pubblicabile del progetto."
  );
}

window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
