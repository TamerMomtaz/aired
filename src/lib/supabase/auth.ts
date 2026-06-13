import { cache } from "react";

import { createClient } from "./server";

// The current signed-in user, verified against the Supabase Auth server.
// Wrapped in React `cache` so multiple Server Components in one render (the
// header and a page, say) share a single round-trip. Returns null when signed
// out. Authorization still belongs at the data layer (RLS); this is for UI.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
