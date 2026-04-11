#!/usr/bin/env node
/**
 * Executes all checks defined in component_verification_contract.json
 * and produces a structured pass/fail report.
 *
 * Usage: node verify.js
 * Output: prints report to stdout + pushes verify_report_TIMESTAMP.json to data branch
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONTRACT = JSON.parse(
  fs.readFileSync(path.join(__dirname, "component_verification_contract.json"), "utf8")
);

const MCP_SERVERS_URL = "https://raw.githubusercontent.com/NK5NK5/remote_mcp_hosting_provider_benchmark_pipeline_registry/main/mcp_servers_under_test.json";
const WORKTREE_DIR = path.join(__dirname, ".verify_tmp");

// --- helpers ----------------------------------------------------------------

function pass(id) { return { id, status: "pass" }; }
function fail(id, reason) { return { id, status: "fail", reason }; }

function exec(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", ...opts });
}

function fetchJson(url) {
  const raw = exec(`curl -sf "${url}"`);
  return JSON.parse(raw);
}

function httpOk(url) {
  try {
    exec(`curl -sf "${url}" -o /dev/null`);
    return true;
  } catch { return false; }
}

function mcpPost(url, body, timeoutMs) {
  try {
    const raw = exec(
      `curl -sf --max-time ${Math.floor(timeoutMs / 1000)} ` +
      `-X POST ` +
      `-H "Content-Type: application/json" ` +
      `-H "Accept: application/json, text/event-stream" ` +
      `-d '${JSON.stringify(body)}' ` +
      `"${url}"`
    );
    return { ok: true, body: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function mcpToolsList(url, timeoutMs) {
  return mcpPost(url, { jsonrpc: "2.0", id: 1, method: "tools/list" }, timeoutMs);
}

function mcpToolsCall(url, toolName, timeoutMs) {
  return mcpPost(url, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: {} } }, timeoutMs);
}

// --- level 1 — discoverability ----------------------------------------------

function checkDiscoverability() {
  const results = [];
  let registry = null;
  let entry = null;

  // registry_accessible
  try {
    registry = fetchJson(CONTRACT.levels[0].checks[0].url);
    results.push(pass("registry_accessible"));
  } catch {
    results.push(fail("registry_accessible", "HTTP request failed or invalid JSON"));
    results.push(fail("registry_has_component_entry", "skipped — registry not accessible"));
    results.push(fail("registry_has_data_url", "skipped — registry not accessible"));
    results.push(fail("endpoints_json_accessible", "skipped — registry not accessible"));
    return results;
  }

  // registry_has_component_entry
  entry = registry.find((c) => c.name === CONTRACT.component);
  if (entry) {
    results.push(pass("registry_has_component_entry"));
  } else {
    results.push(fail("registry_has_component_entry", "no entry found with matching name"));
  }

  // registry_has_data_url
  if (entry?.data_url) {
    results.push(pass("registry_has_data_url"));
  } else {
    results.push(fail("registry_has_data_url", "data_url field missing or empty"));
  }

  // mcp_servers_under_test_accessible
  const ok = httpOk(CONTRACT.levels[0].checks[3].url);
  results.push(ok
    ? pass("mcp_servers_under_test_accessible")
    : fail("mcp_servers_under_test_accessible", "mcp_servers_under_test.json not accessible in registry"));

  return results;
}

// --- level 2 — completeness -------------------------------------------------

function checkCompleteness() {
  const results = [];
  let endpoints = null;

  // mcp_servers_under_test_valid
  try {
    endpoints = fetchJson(MCP_SERVERS_URL);
    results.push(pass("mcp_servers_under_test_valid"));
  } catch {
    results.push(fail("mcp_servers_under_test_valid", "not valid JSON or not accessible"));
    results.push(fail("mcp_servers_count_expected", "skipped — mcp_servers_under_test.json not readable"));
    results.push(fail("verify_script_present", "skipped"));
    return { results, endpoints: null };
  }

  // mcp_servers_count_expected
  const expected = CONTRACT.levels[1].checks[1].expected_count;
  const entries = Object.keys(endpoints).filter((k) => !k.startsWith("_"));
  if (entries.length === expected) {
    results.push(pass("mcp_servers_count_expected"));
  } else {
    results.push(fail("mcp_servers_count_expected", `expected ${expected}, got ${entries.length}`));
  }

  // verify_script_present
  const verifyOk = httpOk(CONTRACT.levels[1].checks[2].url);
  results.push(verifyOk
    ? pass("verify_script_present")
    : fail("verify_script_present", "verify.js not accessible on GitHub"));

  return { results, endpoints };
}

// --- levels 3 & 4 — availability + integrity (single call per endpoint) -----

function checkEndpoints(endpoints) {
  if (!endpoints) return [];
  const timeoutMs = CONTRACT.levels[2].timeout_ms;
  const availability = [];
  const integrity = [];

  for (const [name, url] of Object.entries(endpoints)) {
    if (name.startsWith("_")) continue;
    const result = mcpToolsList(url, timeoutMs);

    // level 3 — responds
    if (result.ok) {
      availability.push(pass(`endpoint_responds_${name}`));
    } else {
      availability.push(fail(`endpoint_responds_${name}`, `no HTTP 200 response — ${result.error ?? "timeout or error"}`));
      integrity.push(fail(`endpoint_tools_valid_${name}`, "skipped — endpoint did not respond"));
      continue;
    }

    // level 4 — quanti + quali
    const tools = result.body?.result?.tools;
    const expectedCount = CONTRACT.levels[3].expected_tool_count;
    const expectedName = CONTRACT.levels[3].expected_tool_name;

    if (!Array.isArray(tools)) {
      integrity.push(fail(`endpoint_tools_count_${name}`, "result.tools is missing or not an array"));
      integrity.push(fail(`endpoint_tools_name_${name}`, "skipped — tools array not available"));
      continue;
    }

    integrity.push(tools.length === expectedCount
      ? pass(`endpoint_tools_count_${name}`)
      : fail(`endpoint_tools_count_${name}`, `expected ${expectedCount} tool(s), got ${tools.length}`));

    integrity.push(tools[0]?.name === expectedName
      ? pass(`endpoint_tools_name_${name}`)
      : fail(`endpoint_tools_name_${name}`, `expected "${expectedName}", got "${tools[0]?.name ?? "undefined"}"`));
  }

  return [...availability, ...integrity];
}

// --- level 5 — execution -----------------------------------------------------

function checkExecution(endpoints) {
  if (!endpoints) return [];
  const timeoutMs = CONTRACT.levels[2].timeout_ms;
  const toolName = CONTRACT.levels[3].expected_tool_name;
  const expectedFields = CONTRACT.levels[4].expected_fields;
  const results = [];

  for (const [name, url] of Object.entries(endpoints)) {
    if (name.startsWith("_")) continue;

    const result = mcpToolsCall(url, toolName, timeoutMs);

    if (!result.ok) {
      results.push(fail(`endpoint_call_responds_${name}`, `tools/call failed — ${result.error ?? "timeout or error"}`));
      results.push(fail(`endpoint_call_fields_${name}`, "skipped — call did not respond"));
      continue;
    }

    results.push(pass(`endpoint_call_responds_${name}`));

    // parse content[0].text
    let payload = null;
    try {
      const text = result.body?.result?.content?.[0]?.text;
      payload = JSON.parse(text);
    } catch {
      results.push(fail(`endpoint_call_fields_${name}`, "could not parse content[0].text as JSON"));
      continue;
    }

    const missingOrNull = expectedFields.filter((f) => payload[f] == null);
    if (missingOrNull.length > 0) {
      results.push(fail(`endpoint_call_fields_${name}`, `missing or null fields: ${missingOrNull.join(", ")}`));
      continue;
    }

    if (payload.hosting_provider !== name) {
      results.push(fail(`endpoint_call_fields_${name}`, `hosting_provider: expected "${name}", got "${payload.hosting_provider}"`));
      continue;
    }

    results.push(pass(`endpoint_call_fields_${name}`));
  }

  return results;
}

// --- push report to data branch ---------------------------------------------

function pushReport(report) {
  try { exec("git fetch origin data:data", { stdio: "pipe" }); } catch {}

  const dataExists = exec("git branch --list data").trim() !== "";
  if (fs.existsSync(WORKTREE_DIR)) exec(`git worktree remove --force ${WORKTREE_DIR}`);

  if (dataExists) {
    exec(`git worktree add ${WORKTREE_DIR} data`);
  } else {
    const emptyTree = exec("git hash-object -t tree /dev/null").trim();
    const emptyCommit = exec(`git commit-tree ${emptyTree} -m "init: data branch"`).trim();
    exec(`git branch data ${emptyCommit}`);
    exec(`git worktree add ${WORKTREE_DIR} data`);
  }

  const filename = `verify_report_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(path.join(WORKTREE_DIR, filename), JSON.stringify(report, null, 2));
  exec(`git -C ${WORKTREE_DIR} add '*.json'`);
  exec(`git -C ${WORKTREE_DIR} commit -m "verify: ${report.summary.pass}/${report.summary.total} checks passed"`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      exec(`git -C ${WORKTREE_DIR} push origin data`);
      break;
    } catch {
      if (attempt < 3) exec(`git -C ${WORKTREE_DIR} pull --rebase origin data`);
    }
  }

  exec(`git worktree remove --force ${WORKTREE_DIR}`);
  return filename;
}

// --- main -------------------------------------------------------------------

const discoverability = checkDiscoverability();
const { results: completeness, endpoints } = checkCompleteness();
const endpointChecks = checkEndpoints(endpoints);
const execution = checkExecution(endpoints);

const allChecks = [...discoverability, ...completeness, ...endpointChecks, ...execution];

const summary = {
  pass: allChecks.filter((c) => c.status === "pass").length,
  fail: allChecks.filter((c) => c.status === "fail").length,
  total: allChecks.length,
};

const report = {
  component: CONTRACT.component,
  verified_at: new Date().toISOString(),
  summary,
  checks: allChecks,
};

console.log(`\n[verify] ${CONTRACT.component}`);
console.log(`[verify] ${summary.pass}/${summary.total} passed, ${summary.fail} failed\n`);
for (const c of allChecks) {
  const icon = c.status === "pass" ? "✓" : "✗";
  const detail = c.reason ? ` — ${c.reason}` : "";
  console.log(`  ${icon} ${c.id}${detail}`);
}

const filename = pushReport(report);
console.log(`\n[verify] report pushed → data/${filename}`);

process.exit(summary.fail > 0 ? 1 : 0);
