/**
 * Utility script to list, inspect, and submit WhatsApp Message Templates to Meta Graph API.
 * Reads credentials from environment variables (WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_TOKEN).
 */
const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "2667221577035024";
const TOKEN = process.env.WHATSAPP_TOKEN;
if (!TOKEN && process.argv[1]?.endsWith("manage_meta_templates.mjs")) {
  console.error("Error: WHATSAPP_TOKEN environment variable is required.");
  process.exit(1);
}
const GRAPH_URL = `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`;

export async function listTemplates() {
  const res = await fetch(`${GRAPH_URL}?access_token=${TOKEN}`);
  const json = await res.json();
  if (json.error) {
    console.error("Meta Graph API error:", json.error);
    return [];
  }
  return json.data || [];
}

export async function postTemplate(templateObj) {
  const res = await fetch(GRAPH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(templateObj)
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  const templates = await listTemplates();
  console.log(`\n=== WhatsApp Templates on WABA ${WABA_ID} (${templates.length} total) ===`);
  for (const t of templates) {
    console.log(`- [${t.status}] ${t.name} (${t.category}) [${t.language}] - ID: ${t.id}`);
  }
}

if (process.argv[1]?.endsWith("manage_meta_templates.mjs")) {
  main().catch(console.error);
}
