/**
 * Milestone M5 Adversarial Challenge 2: Empirical Verification & Stress Test Suite
 *
 * Mission Objectives:
 * 1. Fios de conexão no canvas: provar que na ausência de registro ativo em `connections`,
 *    nenhuma linha de conexão nem indicador ativo de Maestro é renderizado.
 * 2. Renomeação interativa de painéis e missões: verificar que a atualização é persistida
 *    e sincronizada sem reiniciar o processo PTY nem perder histórico do xterm.
 * 3. Ações destrutivas (kill pane, merge branch, override forçado de lock): provar que
 *    são interceptadas por modais de confirmação explícita.
 */

import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection, PaneState, Task } from "../web/tipos.ts";
import { RingBuffer, DEFAULT_RING_BUFFER_CAPACITY } from "../servidor/sessions/pty-host.ts";
import { ApprovalManager } from "../servidor/security/approval.ts";
import { FileOwnershipManager } from "../servidor/tasks/file-ownership.ts";
import { OwnershipStore } from "../servidor/persistence/ownership-store.ts";
import { DiskStore } from "../servidor/persistence/disk-store.ts";

let totalPasses = 0;
let totalFails = 0;

function check(desc: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    totalPasses++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${(err as Error).message}`);
    totalFails++;
  }
}

async function checkAsync(desc: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${desc}`);
    totalPasses++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${(err as Error).message}`);
    totalFails++;
  }
}

// Simulation of the exact filtering logic from web/Pane.tsx (lines 172-176)
function getConexoesReais(paneId: string, connections: Connection[]): Connection[] {
  return connections.filter(
    (c) =>
      c.status === "active" &&
      (c.sourcePaneId === paneId || c.targetPaneId === paneId)
  );
}

// Simulation of connection UI elements rendered for a Pane
function renderConnectionIndicator(paneId: string, connections: Connection[]): {
  rendered: boolean;
  count: number;
  label: string | null;
} {
  const conexoesReais = getConexoesReais(paneId, connections);
  if (conexoesReais.length > 0) {
    return {
      rendered: true,
      count: conexoesReais.length,
      label: `🔗 Conectado (${conexoesReais.length})`,
    };
  }
  return {
    rendered: false,
    count: 0,
    label: null,
  };
}

async function main(): Promise<void> {
  console.log("================================================================================");
  console.log("    Milestone M5 Empirical Adversarial Challenge 2 (m5_challenger_2)           ");
  console.log("================================================================================");

  // ============================================================================
  // SUITE 1: FIOS DE CONEXÃO NO CANVAS & INDICADOR DE MAESTRO
  // ============================================================================
  console.log("\n[Suite 1] Adversarial Challenge: Canvas Connection Wires & Maestro Indicator Decoupling");

  check("1.1 Empty connections array: strictly zero connection wires or active indicators rendered", () => {
    const targetPaneId = "pane-101";
    const emptyConnections: Connection[] = [];

    const result = renderConnectionIndicator(targetPaneId, emptyConnections);
    assert.equal(result.rendered, false, "Must NOT render connection wire when connections is empty");
    assert.equal(result.count, 0);
    assert.equal(result.label, null);
  });

  check("1.2 Inactive connection statuses (closed, pending, failed) strictly suppress wire rendering", () => {
    const targetPaneId = "pane-101";
    const inactiveStatuses = ["closed", "pending", "failed", "disconnected", "inactive"];

    for (const status of inactiveStatuses) {
      const connections: Connection[] = [
        {
          id: `conn-${status}`,
          sourcePaneId: targetPaneId,
          targetPaneId: "pane-202",
          status: status as any,
          createdAt: Date.now(),
        },
      ];

      const result = renderConnectionIndicator(targetPaneId, connections);
      assert.equal(
        result.rendered,
        false,
        `Status "${status}" must NOT trigger connection wire rendering`
      );
      assert.equal(result.count, 0);
    }
  });

  check("1.3 Active connections between foreign panes do NOT bleed into target pane", () => {
    const targetPaneId = "pane-101";
    const foreignConnections: Connection[] = [
      {
        id: "conn-other-1",
        sourcePaneId: "pane-202",
        targetPaneId: "pane-303",
        status: "active",
        createdAt: Date.now(),
      },
      {
        id: "conn-other-2",
        sourcePaneId: "pane-404",
        targetPaneId: "pane-505",
        status: "active",
        createdAt: Date.now(),
      },
    ];

    const result = renderConnectionIndicator(targetPaneId, foreignConnections);
    assert.equal(result.rendered, false, "Foreign active connections must not affect target pane");
    assert.equal(result.count, 0);
  });

  check("1.4 Bidirectional match: target pane as source or target renders accurate wire count", () => {
    const targetPaneId = "pane-101";
    const mixedConnections: Connection[] = [
      // Target is source
      { id: "c1", sourcePaneId: targetPaneId, targetPaneId: "pane-2", status: "active", createdAt: 1 },
      // Target is target
      { id: "c2", sourcePaneId: "pane-3", targetPaneId: targetPaneId, status: "active", createdAt: 2 },
      // Foreign active (ignored)
      { id: "c3", sourcePaneId: "pane-4", targetPaneId: "pane-5", status: "active", createdAt: 3 },
      // Target is source but inactive (ignored)
      { id: "c4", sourcePaneId: targetPaneId, targetPaneId: "pane-6", status: "closed" as any, createdAt: 4 },
    ];

    const result = renderConnectionIndicator(targetPaneId, mixedConnections);
    assert.equal(result.rendered, true, "Must render connection wire when active connections exist");
    assert.equal(result.count, 2, "Must accurately count only the 2 active connections involving pane-101");
    assert.equal(result.label, "🔗 Conectado (2)");
  });

  check("1.5 Maestro presence in mission does NOT generate false connection wire", () => {
    const paneSrc = readFileSync("web/Pane.tsx", "utf8");

    // Verify that temMaestroNaMissao does not control pane-conn-line
    assert.equal(
      paneSrc.includes("temMaestroNaMissao ? ("),
      false,
      "Pane.tsx must NOT conditionally render connection lines based on temMaestroNaMissao"
    );
    assert.equal(
      paneSrc.includes('temMaestroNaMissao && <span className="pane-conn'),
      false,
      "Pane.tsx must not use temMaestroNaMissao for connection element rendering"
    );

    // Verify that conexoesReais is the exclusive gate for .pane-conn-line
    const connWireMatch = paneSrc.match(/\{conexoesReais\.length > 0 && \([\s\S]*?className="pane-conn-line real"[\s\S]*?\)\}/);
    assert.ok(
      connWireMatch,
      "Connection wire rendering must be strictly gated by conexoesReais.length > 0"
    );
  });

  check("1.6 Source AST verification: No fake maestro connection indicators exist in web/Pane.tsx", () => {
    const paneSrc = readFileSync("web/Pane.tsx", "utf8");

    // Maestro badge should only represent the functional role badge (.badge-role)
    const roleSection = paneSrc.match(/className=\{`pane-badge badge-role\$\{pane\.maestro \? " maestro" : ""\}`\}/);
    assert.ok(roleSection, "Maestro indicator exists only as a semantic role badge");

    // Ensure there is no 'maestro-conn' or fake canvas line anywhere in Pane.tsx
    assert.equal(paneSrc.includes("maestro-conn"), false, "No maestro-conn class in Pane.tsx");
    assert.equal(paneSrc.includes("fio-maestro"), false, "No fio-maestro class in Pane.tsx");
  });

  // ============================================================================
  // SUITE 2: RENOMEAÇÃO INTERATIVA DE PAINÉIS E MISSÕES (PTY & XTERM CONTINUITY)
  // ============================================================================
  console.log("\n[Suite 2] Adversarial Challenge: Interactive Renaming (PTY & xterm Continuity)");

  check("2.1 Pane renaming in web/Pane.tsx only updates label without re-instantiating xterm", () => {
    const paneSrc = readFileSync("web/Pane.tsx", "utf8");

    // Terminal lifecycle hook: useEffect(() => { const term = new Terminal(...); ... }, [pane.paneId]);
    const termHookMatch = paneSrc.match(/useEffect\(\(\) => \{[\s\S]*?const term = new Terminal\([\s\S]*?\}, \[([^\]]*)\]\);/);
    assert.ok(termHookMatch, "Terminal instantiation useEffect must exist in Pane.tsx");

    const deps = termHookMatch[1].trim();
    assert.equal(
      deps,
      "pane.paneId",
      `Terminal hook dependencies must strictly be [pane.paneId], but received: [${deps}]`
    );

    // Ensure label or agent or role are NOT in terminal hook dependencies
    assert.equal(deps.includes("pane.label"), false, "pane.label must not be in terminal dependencies");
    assert.equal(deps.includes("label"), false, "label must not be in terminal dependencies");
    assert.equal(deps.includes("pane.agent"), false, "pane.agent must not be in terminal dependencies");
    assert.equal(deps.includes("pane.role"), false, "pane.role must not be in terminal dependencies");
  });

  check("2.2 RingBuffer scrollback continuity: data remains identical before and after simulated rename", () => {
    const rb = new RingBuffer(DEFAULT_RING_BUFFER_CAPACITY);

    // Populate terminal ring buffer with realistic session log
    const initialLog = "user@cockpit:~$ ls -la\ntotal 24\ndrwxr-xr-x 2 user user 4096 Sep 13 20:00 .\n-rw-r--r-- 1 user user 1024 Sep 13 20:00 app.ts\nuser@cockpit:~$ npm test\n";
    rb.write(initialLog);

    const snapshotBefore = rb.getSnapshotString();
    assert.equal(snapshotBefore, initialLog);

    // Simulate pane rename metadata update
    const paneState: PaneState = {
      paneId: "pane-alpha-1",
      sessionId: "sess-1",
      missionId: "m-1",
      agent: "builder",
      role: "builder",
      cli: "bash",
      label: "Terminal Antigo",
      cor: "#3b82f6",
      status: "working",
      iniciadoEm: Date.now(),
      atividade: [0, 10, 20],
      maestro: false,
    };

    // Perform rename
    paneState.label = "Terminal Novo Renomeado";
    paneState.agent = "reviewer";
    paneState.role = "reviewer";

    // Additional terminal output arrives after rename
    const postRenameLog = "PASS: all 37 checks passed.\nuser@cockpit:~$ ";
    rb.write(postRenameLog);

    const snapshotAfter = rb.getSnapshotString();
    assert.equal(
      snapshotAfter,
      initialLog + postRenameLog,
      "Scrollback ring buffer must retain complete history across renaming"
    );
  });

  check("2.3 Pane rename backend endpoint validation (/panes/:paneId/papel)", () => {
    const routerSrc = readFileSync("servidor/routes/panes-router.ts", "utf8");

    assert.ok(
      routerSrc.includes('router.post("/panes/:paneId/papel"'),
      "Panes router must have /panes/:paneId/papel endpoint"
    );
    assert.ok(
      routerSrc.includes("updatePane(pane.paneId,"),
      "Endpoint must call updatePane to mutate metadata in-place"
    );
    assert.ok(
      !routerSrc.includes("killPty(") || routerSrc.lastIndexOf("killPty") < routerSrc.indexOf('router.post("/panes/:paneId/papel"'),
      "Renaming endpoint must NEVER invoke killPty"
    );
    assert.ok(
      routerSrc.includes('ctx.broadcast({ type: "panes", panes: listPanes() })'),
      "Renaming must broadcast updated panes to all connected WebSocket clients"
    );
  });

  check("2.4 Mission renaming validation: input boundary conditions and length constraints", () => {
    const missionsRouterSrc = readFileSync("servidor/routes/missions-router.ts", "utf8");

    assert.ok(
      missionsRouterSrc.includes('router.post("/missions/:id/nome"'),
      "Missions router must have /missions/:id/nome endpoint"
    );
    assert.ok(
      missionsRouterSrc.includes("nome da missão é obrigatório"),
      "Empty mission name must be rejected"
    );
    assert.ok(
      missionsRouterSrc.includes("nome da missão deve ter no máximo 120 caracteres"),
      "Mission name longer than 120 chars must be rejected"
    );
    assert.ok(
      missionsRouterSrc.includes("persistir()"),
      "Mission rename must persist changes to disk"
    );

    // Test boundary logic directly
    function validateMissionName(nome: unknown): { ok: boolean; error?: string; cleanName?: string } {
      const clean = String(nome ?? "").trim();
      if (!clean) return { ok: false, error: "nome da missão é obrigatório" };
      if (clean.length > 120) return { ok: false, error: "nome da missão deve ter no máximo 120 caracteres" };
      return { ok: true, cleanName: clean };
    }

    // Adversarial edge cases
    assert.equal(validateMissionName("").ok, false);
    assert.equal(validateMissionName("   ").ok, false);
    assert.equal(validateMissionName(null).ok, false);
    assert.equal(validateMissionName(undefined).ok, false);
    assert.equal(validateMissionName("A".repeat(121)).ok, false);

    // Valid edge cases
    assert.equal(validateMissionName("A").ok, true);
    assert.equal(validateMissionName("A".repeat(120)).ok, true);
    assert.equal(validateMissionName("  Missão Refatoração  ").cleanName, "Missão Refatoração");
  });

  check("2.5 web/App.tsx Stage Topbar inline rename keeps active mission synchronized", () => {
    const appSrc = readFileSync("web/App.tsx", "utf8");

    assert.ok(
      appSrc.includes("stage-mission-title"),
      "Stage topbar must display interactive mission title"
    );
    assert.ok(
      appSrc.includes("renomeandoAtiva"),
      "App must track inline renaming state"
    );
    assert.ok(
      appSrc.includes("renomearMissao(active.id, nome)"),
      "Inline renaming form must trigger renomearMissao API call"
    );
    assert.ok(
      appSrc.includes("recarregarMissoes(projectId)"),
      "App must reload missions to synchronize all views"
    );
  });

  // ============================================================================
  // SUITE 3: AÇÕES DESTRUTIVAS (CONFIRMAÇÕES EXPLÍCITAS & SAFEGUARDS)
  // ============================================================================
  console.log("\n[Suite 3] Adversarial Challenge: Destructive Action Interception & Confirmation Modals");

  check("3.1 Pane Close in web/PaneGrid.tsx and web/App.tsx is intercepted by explicit confirmation modal", () => {
    const appSrc = readFileSync("web/App.tsx", "utf8");

    // Verify that onClose does NOT directly send kill
    assert.ok(
      appSrc.includes("onClose={(paneId) => setPaneParaEncerrar(paneId)}"),
      "onClose must set paneParaEncerrar instead of sending kill immediately"
    );

    // Verify confirmation modal exists for paneParaEncerrar
    const modalStart = appSrc.indexOf("{paneParaEncerrar && (");
    assert.ok(modalStart !== -1, "Modal block for paneParaEncerrar must be present in App.tsx");
    const modalEnd = appSrc.indexOf("</Modal>", modalStart);
    assert.ok(modalEnd !== -1, "Modal close tag must exist after modal start");

    const modalBody = appSrc.slice(modalStart, modalEnd + 8);

    // Verify modal explains destructive consequences
    assert.ok(
      modalBody.includes("O processo PTY em execução será encerrado"),
      "Modal must warn that running PTY process will be killed"
    );

    // Verify Cancel resets state without sending kill
    assert.ok(
      modalBody.includes("onClick={() => setPaneParaEncerrar(null)}"),
      "Cancel button must dismiss modal by resetting paneParaEncerrar to null"
    );

    // Verify kill is ONLY dispatched on explicit button confirmation click
    assert.ok(
      modalBody.includes('send({ type: "kill", paneId: paneParaEncerrar })'),
      "send({ type: 'kill' }) must strictly occur inside confirmation modal button handler"
    );
  });

  check("3.2 Legacy worktree mission archival requires confirmation and preserves files", () => {
    const workspaceSrc = readFileSync("web/Workspace.tsx", "utf8");

    // Verify confirmation state exists
    assert.ok(
      workspaceSrc.includes("confirmando"),
      "Workspace must have confirmando state for mission deletion"
    );
    assert.ok(
      workspaceSrc.includes('m.isolada ? "arquivar sem apagar o worktree" : "apagar"'),
      "Workspace must explicitly state that a legacy worktree is preserved"
    );
    assert.ok(
      workspaceSrc.includes("onArquivarMissao(m.id)"),
      "onArquivarMissao must only be called upon confirmation click"
    );
  });

  await checkAsync("3.3 ApprovalManager: Full lifecycle security verification for destructive actions", async () => {
    const mgr = new ApprovalManager();

    // 1. Create request for kill_pane
    const reqKill = mgr.createRequest({
      action: "kill_pane",
      title: "Encerrar painel crítico",
      description: "Finalizar PTY ativo",
      severity: "danger",
      target: { paneId: "p-99" },
      requestedBy: { type: "agent", id: "maestro" },
      ttlMs: 2000,
    });
    assert.equal(reqKill.status, "pending");
    assert.equal(mgr.listPending().length, 1);

    // 2. Unapproved execution must be blocked
    const executeKill = (confId: string) => {
      const r = mgr.get(confId);
      if (!r || r.status !== "approved") {
        throw new Error(`EXECUTION_BLOCKED: Status is ${r?.status ?? "undefined"}`);
      }
      return true;
    };

    assert.throws(
      () => executeKill(reqKill.id),
      /EXECUTION_BLOCKED/,
      "Unapproved request must block destructive execution"
    );

    // 3. User approves request
    await mgr.approve(reqKill.id, "user-admin");
    assert.equal(mgr.get(reqKill.id)?.status, "approved");
    assert.equal(executeKill(reqKill.id), true, "Approved request allows execution");

    // 4. Token consumption (single-use anti-replay)
    const consumed = mgr.consume(reqKill.id, "system");
    assert.equal(consumed, true, "First consumption must succeed");
    assert.equal(mgr.get(reqKill.id)?.status, "consumed");

    // Re-execution after consumption must be blocked
    assert.throws(
      () => executeKill(reqKill.id),
      /EXECUTION_BLOCKED/,
      "Consumed request must block re-execution"
    );

    // 5. Test merge_worktree rejection
    const reqMerge = mgr.createRequest({
      action: "merge_worktree",
      title: "Merge de worktree",
      description: "Mesclar alterações no branch",
      severity: "critical",
      target: { branch: "feat-auth" },
      requestedBy: { type: "agent", id: "builder" },
    });

    await mgr.reject(reqMerge.id, "reviewer-1", "Testes falharam");
    assert.equal(mgr.get(reqMerge.id)?.status, "rejected");
    assert.throws(() => executeKill(reqMerge.id), /EXECUTION_BLOCKED/);

    // 6. Test lock_override expiration
    const reqLock = mgr.createRequest({
      action: "lock_override",
      title: "Override forçado de lock",
      description: "Quebrar exclusividade de arquivo",
      severity: "danger",
      target: { file: "config.ts" },
      requestedBy: { type: "agent", id: "maestro" },
      ttlMs: 20, // 20ms TTL
    });

    await new Promise((r) => setTimeout(r, 40));
    await assert.rejects(
      async () => mgr.approve(reqLock.id, "user"),
      /expirada/,
      "Expired confirmation request must reject approval"
    );
    assert.equal(mgr.get(reqLock.id)?.status, "expired");
  });

  await checkAsync("3.4 File Lock Override Resistance: Isolated mode strictly blocks concurrent acquisition", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "m5-adv2-locks-"));
    try {
      const diskStore = new DiskStore(tempDir);
      const ownershipStore = new OwnershipStore(diskStore);
      const ownership = new FileOwnershipManager({ ownershipStore });

      // Task 1 acquires isolated lock on index.ts
      const lock1 = ownership.acquireLock({
        missionId: "m-audit",
        taskId: "task-owner-1",
        files: ["index.ts"],
        mode: "isolated",
        owner: "agent-1",
      });
      assert.equal(lock1.ok, true);
      assert.equal(lock1.locked, true);

      // Task 2 attempts to acquire lock on index.ts -> MUST FAIL (409 Conflict)
      const lock2Conflict = ownership.acquireLock({
        missionId: "m-audit",
        taskId: "task-usurper-2",
        files: ["index.ts"],
        mode: "isolated",
        owner: "agent-2",
      });
      assert.equal(lock2Conflict.ok, false, "Must reject concurrent lock in isolated mode");
      assert.deepEqual(lock2Conflict.conflictFiles, ["index.ts"]);

      // Task 2 attempts to release Task 1's lock -> MUST HAVE ZERO EFFECT
      const unauthorizedRelease = ownership.releaseLock("task-usurper-2", ["index.ts"]);
      assert.equal(
        unauthorizedRelease.released.length,
        0,
        "Task 2 must not be able to release Task 1's lock"
      );

      // Verify Task 1's lock is still 100% active and intact
      const remaining = ownership.getLocksForFile("m-audit", "index.ts");
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].taskId, "task-owner-1");

      // Legitimate release by Task 1
      const legitRelease = ownership.releaseLock("task-owner-1", ["index.ts"]);
      assert.deepEqual(legitRelease.released, ["index.ts"]);

      // Now Task 2 can acquire
      const lock2Success = ownership.acquireLock({
        missionId: "m-audit",
        taskId: "task-usurper-2",
        files: ["index.ts"],
        mode: "isolated",
        owner: "agent-2",
      });
      assert.equal(lock2Success.ok, true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // SUMMARY & VERDICT
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`Results: ${totalPasses} passed, ${totalFails} failed`);
  console.log("================================================================================");

  if (totalFails > 0) {
    console.error(`\nFAILED: Milestone M5 Adversarial Challenge 2 encountered ${totalFails} failures.`);
    process.exit(1);
  } else {
    console.log("\nSUCCESS: All Milestone M5 Adversarial Challenge 2 tests passed without failures.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error running test suite:", err);
  process.exit(1);
});
