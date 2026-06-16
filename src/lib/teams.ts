/**
 * Post a message to Microsoft Teams via an Incoming Webhook created with the
 * "Workflows" app (Power Automate). That webhook expects a message envelope
 * wrapping an Adaptive Card.
 */

export interface TeamsMessage {
  title: string;
  text: string;
  sourceLabel?: string;
  sourceUrl?: string;
}

export function isTeamsConfigured(): boolean {
  return !!process.env.TEAMS_WEBHOOK_URL;
}

export async function sendToTeams(msg: TeamsMessage): Promise<void> {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) throw new Error("TEAMS_WEBHOOK_URL is not set.");

  const body: Record<string, unknown>[] = [
    { type: "TextBlock", size: "Large", weight: "Bolder", text: msg.title, wrap: true },
    { type: "TextBlock", text: msg.text, wrap: true, spacing: "Medium" },
  ];

  const actions: Record<string, unknown>[] = [];
  if (msg.sourceUrl) {
    actions.push({ type: "Action.OpenUrl", title: msg.sourceLabel || "Source", url: msg.sourceUrl });
  }

  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          ...(actions.length ? { actions } : {}),
        },
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Teams webhook returned HTTP ${res.status} ${detail}`.trim());
  }
}
