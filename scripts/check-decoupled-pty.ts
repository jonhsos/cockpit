import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import {
  RingBuffer,
  PtyHost,
  DEFAULT_RING_BUFFER_CAPACITY,
} from "../servidor/sessions/pty-host.ts";
import { PtyClient } from "../servidor/sessions/pty-client.ts";
import { BASH_PATH } from "../servidor/sessions/clean-shell.ts";

console.log("Running check-decoupled-pty.ts (Decoupled PTY Host, 256KB RingBuffer & Survival Verification)...");

async function runTests(): Promise<void> {
  // =========================================================================
  // 1. RingBuffer Boundary & Circular Wrapping
  // =========================================================================
  console.log("  1. Verifying RingBuffer capacity, boundaries, and circular wrap-around...");
  assert.equal(DEFAULT_RING_BUFFER_CAPACITY, 256 * 1024, "DEFAULT_RING_BUFFER_CAPACITY must be 256KB");

  const smallCapacity = 1024;
  const rb = new RingBuffer(smallCapacity);
  assert.equal(rb.capacity, smallCapacity);
  assert.equal(rb.size, 0);
  assert.equal(rb.totalWritten, 0);

  // Write 500 bytes of 'A'
  const firstChunk = "A".repeat(500);
  rb.write(firstChunk);
  assert.equal(rb.size, 500);
  assert.equal(rb.totalWritten, 500);
  assert.equal(rb.getSnapshotString(), firstChunk);

  // Write 600 bytes of 'B' (total: 1100 bytes > 1024)
  const secondChunk = "B".repeat(600);
  rb.write(secondChunk);
  assert.equal(rb.size, smallCapacity, "Buffer size must not exceed capacity");
  assert.equal(rb.totalWritten, 1100, "totalWritten must track total bytes processed");

  // Oldest 76 bytes of 'A' dropped: exactly 424 'A's + 600 'B's = 1024 bytes
  const expectedSnapshot = "A".repeat(424) + "B".repeat(600);
  const actualSnapshot = rb.getSnapshotString();
  assert.equal(actualSnapshot.length, smallCapacity);
  assert.equal(actualSnapshot, expectedSnapshot, "Circular wrap-around must retain latest bytes in FIFO order");

  // Test full 256KB RingBuffer instantiation
  const largeRb = new RingBuffer(DEFAULT_RING_BUFFER_CAPACITY);
  assert.equal(largeRb.capacity, 256 * 1024);
  const largeChunk = "X".repeat(100 * 1024);
  largeRb.write(largeChunk);
  assert.equal(largeRb.size, 100 * 1024);
  assert.equal(largeRb.getSnapshotString().length, 100 * 1024);
  largeRb.clear();
  assert.equal(largeRb.size, 0);
  console.log("  ✓ RingBuffer circular wrap-around and 256KB capacity validated");

  // =========================================================================
  // 2. Decoupled PTY Host & Client IPC
  // =========================================================================
  console.log("  2. Verifying decoupled PTY Host & Client IPC over isolated Unix socket...");
  const testSocket = join(tmpdir(), `cockpit-test-m2-${Date.now()}-${process.pid}.sock`);
  if (process.platform !== "win32" && existsSync(testSocket)) {
    try { unlinkSync(testSocket); } catch {}
  }

  const host = new PtyHost(testSocket);
  await host.start();

  const client = new PtyClient(testSocket);
  await client.connect();

  // Test ping
  const pingRes = await client.ping();
  assert.equal(pingRes, "pong", "IPC ping must return pong");

  // Spawn sovereign clean bash shell
  const paneId = "test-pane-decoupled-1";
  let outputReceived = "";

  client.on("output", (pId, data) => {
    if (pId === paneId) {
      outputReceived += data;
    }
  });

  const spawnRes = await client.spawn({
    paneId,
    file: BASH_PATH,
    args: ["-i", "-l"],
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
    initialState: {
      agent: "shell",
      label: "Shell",
      cor: "#4ade80",
      cli: "bash",
      role: "shell",
      runner: "bash",
      model: null,
      effort: null,
      tipo: null,
      projectId: null,
      missionId: null,
      sessionId: null,
      maestro: false,
    },
  });

  assert.equal(spawnRes.paneId, paneId);
  assert.ok(spawnRes.pid > 0, "Spawned process must have valid PID");

  // Send test command into bash
  await client.input(paneId, "echo 'COCKPIT_M2_ALIVE'\n");

  // Wait for output roundtrip
  const startWait = Date.now();
  while (!outputReceived.includes("COCKPIT_M2_ALIVE") && Date.now() - startWait < 4000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(outputReceived.includes("COCKPIT_M2_ALIVE"), "PTY output stream must contain echo response");

  // Verify scrollback replay via ring buffer
  const initialReplay = await client.replay(paneId);
  assert.ok(
    initialReplay.includes("COCKPIT_M2_ALIVE"),
    "RingBuffer replay must return terminal scrollback containing sent echo",
  );
  console.log("  ✓ Sovereign clean bash spawned and IPC output roundtrip verified");

  // =========================================================================
  // 3. Simulated Server Restart & Surviving Pane Recovery (Feature 37 & Acceptance Criteria)
  // =========================================================================
  console.log("  3. Simulating Express server restart: disconnect client, reconnect, verify survival & replay...");

  // Simulate web server shutting down by disconnecting the IPC client
  client.disconnect();

  // Give socket event loop time to handle disconnect
  await new Promise((r) => setTimeout(r, 200));

  // Simulate new web server starting up and attaching to existing daemon socket
  const client2 = new PtyClient(testSocket);
  await client2.connect();

  // Verify surviving pane is present in daemon pane list
  const survivingPanes = await client2.list();
  const surviving = survivingPanes.find((p) => p.paneId === paneId);
  assert.ok(surviving, "Surviving pane must exist in daemon list after simulated server restart");
  assert.notEqual(surviving.status, "dead", "Surviving pane must not be marked dead");
  assert.equal(surviving.cli, "bash");
  assert.equal(surviving.runner, "bash");

  // Verify terminal scrollback was preserved in the 256KB ring buffer and can be replayed
  const replayAfterRestart = await client2.replay(paneId);
  assert.ok(
    replayAfterRestart.includes("COCKPIT_M2_ALIVE"),
    "Scrollback must be preserved across server restart in 256KB ring buffer",
  );

  // Send new command to surviving pane to confirm stdin/stdout still work interactively
  let resumptionOutput = "";
  client2.on("output", (pId, data) => {
    if (pId === paneId) {
      resumptionOutput += data;
    }
  });

  await client2.input(paneId, "echo 'RESUMPTION_OK'\n");

  const startWait2 = Date.now();
  while (!resumptionOutput.includes("RESUMPTION_OK") && Date.now() - startWait2 < 4000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(
    resumptionOutput.includes("RESUMPTION_OK"),
    "Surviving pane must continue receiving input and streaming output after reconnection",
  );
  console.log("  ✓ Simulated web server restart successfully reattached to surviving pane and replayed scrollback");

  // Clean up
  await client2.kill(paneId);
  await new Promise((r) => setTimeout(r, 200));
  client2.disconnect();
  await host.stop();

  if (process.platform !== "win32" && existsSync(testSocket)) {
    try { unlinkSync(testSocket); } catch {}
  }

  console.log("All check-decoupled-pty.ts checks PASSED successfully!");
}

runTests().then(
  () => process.exit(0),
  (err) => {
    console.error("check-decoupled-pty.ts FAILED:", err);
    process.exit(1);
  },
);
