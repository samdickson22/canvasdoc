import { connector } from "./fixtures/connector.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("connector starts signed out, refuses sends, and completes Codex sign-in from the browser", { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-login-"));
  process.env.CANVASDOC_FIXTURE_SIGNED_OUT = "1";
  const fixture = await connector(root, "lifecycle");
  try {
    await fixture.start();
    const c = await fixture.connect();
    assert.equal(c.hello.type, "connected");
    assert.equal(c.hello.codexAccount.signedIn, false);
    assert.match(c.hello.version, /^\d+\.\d+\.\d+/);
    c.send({ type: "send", command: { requestId: "login-send-1", sourceThreadId: "home", title: "Home", href: "/", text: "hello" } });
    const rejected = await c.wait((m) => m.type === "send-rejected" && m.requestId === "login-send-1");
    assert.match(rejected.message, /Sign in to Codex/);
    c.send({ type: "login" });
    const started = await c.wait((m) => m.type === "login-started");
    assert.equal(started.authUrl, "https://auth.example/oauth?login=1");
    const account = await c.wait((m) => m.type === "account");
    assert.equal(account.signedIn, true);
    assert.equal(account.email, "student@example.edu");
    assert.equal(account.plan, "plus");
    assert.equal(account.usageAllowed, true);
    assert.equal(account.usage.primary.usedPercent, 12);
    assert.ok(account.models.some((m: any) => m.id === "gpt-6-astra"));
    c.send({ type: "send", command: { requestId: "login-send-2", sourceThreadId: "home", title: "Home", href: "/", text: "SCENARIO:complete" } });
    await c.wait((m) => m.type === "run" && m.run.command.requestId === "login-send-2" && m.run.status === "completed");
    c.ws.close();
    const again = await fixture.connect();
    assert.equal(again.hello.codexAccount.signedIn, true);
    assert.equal(again.hello.codexAccount.email, "student@example.edu");
  } finally {
    delete process.env.CANVASDOC_FIXTURE_SIGNED_OUT;
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
