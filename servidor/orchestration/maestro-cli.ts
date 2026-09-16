// Bridge for CLIs without a per-session MCP configuration flag.
export {};
// It uses the same tools as MCP, through the local cockpit API.
const [tool, json = "{}"] = process.argv.slice(2);
const args = JSON.parse(json) as Record<string, unknown>;
const pane = process.env.COCKPIT_PANE;
if (pane) {
  if (args.from == null && args.origem == null) args.from = pane;
  if (tool === "cockpit_inbox" && args.paneId == null && args.painel == null) args.paneId = pane;
}
const response = await fetch(`http://127.0.0.1:${process.env.COCKPIT_PORT ?? "3000"}/api/missions/${process.env.COCKPIT_MISSION}/tools`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ tool, args }),
});
const result = await response.json();
if (!response.ok) { console.error(result); process.exitCode = 1; }
else console.log(JSON.stringify(result, null, 2));
