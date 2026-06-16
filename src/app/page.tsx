import Dashboard from "@/components/Dashboard";
import { readCache } from "@/lib/cache";
import { isTeamsConfigured } from "@/lib/teams";

export const dynamic = "force-dynamic";

/**
 * Server component: read the cached bundle so alerts render instantly on open.
 * If there's no cache yet, the Dashboard fetches /api/alerts (which generates once).
 */
export default async function Page() {
  const initialBundle = await readCache();
  return <Dashboard initialBundle={initialBundle} teamsEnabled={isTeamsConfigured()} />;
}
