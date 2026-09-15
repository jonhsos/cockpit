#!/usr/bin/env node

/**
 * Cockpit Inter-Agent CLI
 * Implements the 5 verbs: list, connect, ask, reply, handoff, inbox
 */

const port = process.env.COCKPIT_PORT || "3000";
const defaultMission = process.env.COCKPIT_MISSION || "default";
const defaultPane = process.env.COCKPIT_PANE || "user";
const baseUrl = `http://127.0.0.1:${port}`;

const args = process.argv.slice(2);
const verb = args[0];

if (!verb || verb === "help" || verb === "--help" || verb === "-h") {
  console.log(`Cockpit Inter-Agent CLI
Usage:
  cockpit list [--format=json] [--mission=<id>]
  cockpit connect <A> <B> [--mission=<id>]
  cockpit ask <PANE> <tarefa> [--task-id=<id>] [--mission=<id>]
  cockpit reply <PANE> <resultado> [--correlation-id=<id>] [--mission=<id>]
  cockpit handoff <A> <B> <taskId> [context] [--force] [--mission=<id>]
  cockpit inbox [--unread] [--pane=<id>] [--mission=<id>]
  cockpit resultado <PANE> [--mission=<id>]
`);
  process.exit(0);
}

function getFlag(name) {
  for (const a of args) {
    if (a.startsWith(`--${name}=`)) {
      return a.slice(name.length + 3);
    }
  }
  return undefined;
}

function hasFlag(name) {
  return args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

const missionId = getFlag("mission") || defaultMission;
const positional = args.slice(1).filter((a) => !a.startsWith("--"));

async function main() {
  switch (verb) {
    case "list": {
      const url = `${baseUrl}/api/missions/${missionId}/cockpit/list`;
      const res = await fetch(url);
      const data = await res.json();
      if (hasFlag("format") && getFlag("format") === "json") {
        console.log(JSON.stringify(data.panes || [], null, 2));
      } else {
        console.table(data.panes || []);
      }
      break;
    }

    case "connect": {
      const [src, dst] = positional;
      if (!src || !dst) {
        console.error("Error: cockpit connect requires two pane IDs: cockpit connect <A> <B>");
        process.exit(1);
      }
      const url = `${baseUrl}/api/missions/${missionId}/cockpit/connect`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourcePaneId: src, targetPaneId: dst }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Connection failed:", data.error || data);
        process.exit(1);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }

    case "ask": {
      const targetPane = positional[0];
      const taskText = positional.slice(1).join(" ");
      const taskId = getFlag("task-id");
      const from = getFlag("from") || defaultPane;

      if (!targetPane || !taskText) {
        console.error("Error: cockpit ask requires target pane and task: cockpit ask <PANE> <tarefa>");
        process.exit(1);
      }

      const url = `${baseUrl}/api/missions/${missionId}/cockpit/ask`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to: targetPane, task: taskText, taskId }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Ask failed:", data.error || data);
        process.exit(1);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }

    case "reply": {
      const targetPane = positional[0];
      const resultText = positional.slice(1).join(" ");
      const correlationId = getFlag("correlation-id") || "";
      const from = getFlag("from") || defaultPane;

      if (!targetPane) {
        console.error("Error: cockpit reply requires target pane: cockpit reply <PANE> <resultado>");
        process.exit(1);
      }

      const url = `${baseUrl}/api/missions/${missionId}/cockpit/reply`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to: targetPane, correlationId, result: resultText }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Reply failed:", data.error || data);
        process.exit(1);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }

    case "handoff": {
      const [src, dst, taskId, ...rest] = positional;
      const context = rest.join(" ");
      const force = hasFlag("force");

      if (!src || !dst || !taskId) {
        console.error("Error: cockpit handoff requires <A> <B> <taskId>: cockpit handoff <A> <B> <taskId> [context] [--force]");
        process.exit(1);
      }

      const url = `${baseUrl}/api/missions/${missionId}/cockpit/handoff`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourcePaneId: src, targetPaneId: dst, taskId, context, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Handoff failed:", data.error || data);
        process.exit(1);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }

    case "inbox": {
      const pane = getFlag("pane") || defaultPane;
      const unreadOnly = hasFlag("unread");
      const url = `${baseUrl}/api/missions/${missionId}/panes/${pane}/inbox${unreadOnly ? "?unread=1" : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "resultado":
    case "result": {
      const targetPane = positional[0];
      if (!targetPane) {
        console.error("Error: cockpit resultado requires target pane: cockpit resultado <PANE>");
        process.exit(1);
      }
      const url = `${baseUrl}/api/missions/${missionId}/resultado/${encodeURIComponent(targetPane)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        console.error("Failed to get result:", data.error || data);
        process.exit(1);
      } else {
        console.log(data.saida || "(sem saída registrada)");
      }
      break;
    }

    default:
      console.error(`Unknown verb "${verb}". Run "cockpit --help" for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Cockpit CLI error:", err);
  process.exit(1);
});
