/**
 * owner: M1 (Ronit Kapar)
 * purpose: Unit and security tests for policy gate, HMAC tokens, hard-deny rules, and draft-edit invalidation (T-03, T-04, T-05, A6–A11).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  RESERVED_APPROVAL_TOKEN_FIELD,
  type ToolManifestEntry,
} from "@pengu/contracts";
import { PolicyApprovalGate } from "../src/policy/approval-gate.js";
import { classifyToolCall } from "../src/policy/classify.js";
import { evaluateHardDeny } from "../src/policy/hard-deny.js";
import { checkScope, type ScopeConfig } from "../src/policy/scope.js";
import {
  canonicalJSON,
  computeArgsHash,
  computeDraftContentHash,
  signApprovalToken,
  verifyApprovalToken,
} from "../src/policy/token.js";

const TEST_SECRET = "pengu-test-approval-secret-0123456789abcdef";

const SCOPE_CONFIG: ScopeConfig = {
  grantedScopes: [
    "gmail:read",
    "gmail:compose",
    "gmail:send",
    "fs:approved_roots",
    "browser:http_https",
    "app:allowlist",
    "shell:allowlist",
  ],
  approvedRoots: ["C:\\PenguWorkspace", "/tmp/pengu_approved"],
  allowlistedApps: ["notepad", "chrome"],
  allowlistedShellCommands: ["sys_info", "disk_usage"],
};

const GMAIL_SEND_MANIFEST: ToolManifestEntry = {
  name: "gmail_send_draft",
  description: "Send an approved Gmail draft",
  riskClass: "CONSEQUENTIAL",
  scope: "gmail:send",
  sideEffect: true,
  idempotent: false,
  reversible: false,
  previewTool: "gmail_get_draft",
  requiresApprovalToken: true,
};

const FS_CREATE_MANIFEST: ToolManifestEntry = {
  name: "fs_create_folder",
  description: "Create a folder inside an approved root",
  riskClass: "ROUTINE",
  scope: "fs:approved_roots",
  sideEffect: true,
  idempotent: true,
  reversible: true,
  requiresApprovalToken: false,
};

const SHELL_RUN_MANIFEST: ToolManifestEntry = {
  name: "shell_run_restricted",
  description: "Run an allowlisted PowerShell command",
  riskClass: "CONSEQUENTIAL",
  scope: "shell:allowlist",
  sideEffect: true,
  idempotent: false,
  reversible: false,
  previewTool: "shell_describe_command",
  requiresApprovalToken: true,
};

test("canonicalJSON produces deterministic key ordering regardless of insertion order", () => {
  const a = canonicalJSON({ z: 1, a: { c: 3, b: 2 }, u: undefined });
  const b = canonicalJSON({ a: { b: 2, c: 3 }, z: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"b":2,"c":3},"z":1}');
});

test("T-03: HMAC approval token verification rejects missing, forged, wrong-tool, and expired tokens", () => {
  const contentHash = computeDraftContentHash("alice@example.com", "Hi", "Body");
  const resolvedArgs = { draftId: "draft_1", contentHash };
  const argsHash = computeArgsHash(resolvedArgs);
  const now = Date.UTC(2026, 10, 23, 12, 0, 0);
  const expiresAt = new Date(now + 60_000).toISOString();

  const token = signApprovalToken(
    { approvalId: "apr_1", tool: "gmail_send_draft", argsHash, expiresAt },
    TEST_SECRET
  );

  // Valid token passes
  assert.equal(
    verifyApprovalToken(token, "gmail_send_draft", resolvedArgs, TEST_SECRET, now).valid,
    true
  );

  // Missing token fails
  assert.equal(
    verifyApprovalToken(undefined, "gmail_send_draft", resolvedArgs, TEST_SECRET, now).valid,
    false
  );

  // Forged signature fails
  assert.equal(
    verifyApprovalToken(
      { ...token, signature: "0".repeat(64) },
      "gmail_send_draft",
      resolvedArgs,
      TEST_SECRET,
      now
    ).valid,
    false
  );

  // Wrong tool fails
  assert.equal(
    verifyApprovalToken(token, "shell_run_restricted", resolvedArgs, TEST_SECRET, now).valid,
    false
  );

  // Expired token fails
  assert.equal(
    verifyApprovalToken(
      token,
      "gmail_send_draft",
      resolvedArgs,
      TEST_SECRET,
      now + 120_000
    ).valid,
    false
  );
});

test("T-04: editing a Gmail draft after approval preview invalidates approval and refuses send", async () => {
  let draftBody = "Original approved reply body.";
  const invalidatedIds: string[] = [];

  const gate = new PolicyApprovalGate({
    approvalSecret: TEST_SECRET,
    scopeConfig: SCOPE_CONFIG,
    invokePreview: async () => ({
      draftId: "draft_42",
      account: "user@example.com",
      to: "bob@example.com",
      subject: "Re: Schedule",
      body: draftBody,
      contentHash: computeDraftContentHash(
        "bob@example.com",
        "Re: Schedule",
        draftBody
      ),
    }),
    onInvalidated: (id) => invalidatedIds.push(id),
  });

  const decision = await gate.evaluate({
    taskId: "t1",
    stepId: "s1",
    server: "gmail",
    tool: "gmail_send_draft",
    args: { draftId: "draft_42" },
    manifestEntry: GMAIL_SEND_MANIFEST,
  });

  assert.equal(decision.outcome, "require_approval");
  if (decision.outcome !== "require_approval") return;

  assert.equal(decision.preview.recipient, "bob@example.com");
  assert.equal(decision.preview.body, "Original approved reply body.");

  // Mutate the stored draft BEFORE user approval resolves
  draftBody = "TAMPERED body redirecting funds!";

  const resolved = await gate.resolveDecision(decision.approvalId, "approve");
  assert.equal(resolved.approved, false);
  assert.equal(resolved.invalidated, true);
  assert.equal(resolved.token, undefined);
  assert.deepEqual(invalidatedIds, [decision.approvalId]);
});

test("T-05 & A9: unknown or unsafe PowerShell commands are hard-denied and never approvable", async () => {
  const gate = new PolicyApprovalGate({
    approvalSecret: TEST_SECRET,
    scopeConfig: SCOPE_CONFIG,
    invokePreview: async () => ({
      commandId: "rm_rf",
      cwd: "C:\\PenguWorkspace",
      purpose: "delete",
      impact: "destructive",
      reversible: false,
    }),
  });

  const unknownCmd = await gate.evaluate({
    taskId: "t2",
    stepId: "s1",
    server: "local",
    tool: "shell_run_restricted",
    args: { commandId: "delete_everything", args: [] },
    manifestEntry: SHELL_RUN_MANIFEST,
  });
  assert.equal(unknownCmd.outcome, "deny");
  if (unknownCmd.outcome === "deny") {
    assert.equal(unknownCmd.approvable, false);
  }

  const injectionArgs = await gate.evaluate({
    taskId: "t2",
    stepId: "s2",
    server: "local",
    tool: "shell_run_restricted",
    args: { commandId: "sys_info", args: ["--json; whoami"] },
    manifestEntry: SHELL_RUN_MANIFEST,
  });
  assert.equal(injectionArgs.outcome, "deny");

  const reservedTokenAttempt = evaluateHardDeny({
    tool: "gmail_send_draft",
    args: { draftId: "d1", [RESERVED_APPROVAL_TOKEN_FIELD]: { forged: true } },
    allowlistedShellCommands: SCOPE_CONFIG.allowlistedShellCommands,
  });
  assert.equal(reservedTokenAttempt.denied, true);
  assert.equal(reservedTokenAttempt.code, "RESERVED_AUTH_FIELD_FORBIDDEN");
});

test("A11: routine folder creation inside approved root runs without prompt; outside root or traversal is denied", async () => {
  const gate = new PolicyApprovalGate({
    approvalSecret: TEST_SECRET,
    scopeConfig: SCOPE_CONFIG,
    invokePreview: async () => ({}),
  });

  const inScope = await gate.evaluate({
    taskId: "t3",
    stepId: "s1",
    server: "local",
    tool: "fs_create_folder",
    args: { path: "C:\\PenguWorkspace\\Reports" },
    manifestEntry: FS_CREATE_MANIFEST,
  });
  assert.equal(inScope.outcome, "allow");

  const outsideRoot = await gate.evaluate({
    taskId: "t3",
    stepId: "s2",
    server: "local",
    tool: "fs_create_folder",
    args: { path: "C:\\Windows\\System32\\BadDir" },
    manifestEntry: FS_CREATE_MANIFEST,
  });
  assert.equal(outsideRoot.outcome, "deny");

  const traversal = await gate.evaluate({
    taskId: "t3",
    stepId: "s3",
    server: "local",
    tool: "fs_create_folder",
    args: { path: "C:\\PenguWorkspace\\..\\Windows" },
    manifestEntry: FS_CREATE_MANIFEST,
  });
  assert.equal(traversal.outcome, "deny");
});

test("Fail-closed classification denies missing manifest or unknown risk class", () => {
  assert.equal(classifyToolCall(undefined).allowed, false);
  assert.equal(
    classifyToolCall({
      ...FS_CREATE_MANIFEST,
      riskClass: "MAGIC" as unknown as "READ",
    }).allowed,
    false
  );

  // Scope check also rejects non-http(s) URL
  const badUrl = checkScope(
    {
      name: "browser_open_url",
      description: "Open URL",
      riskClass: "ROUTINE",
      scope: "browser:http_https",
      sideEffect: true,
      idempotent: true,
      reversible: true,
      requiresApprovalToken: false,
    },
    { url: "file:///C:/Windows/win.ini" },
    SCOPE_CONFIG
  );
  assert.equal(badUrl.inScope, false);
});
