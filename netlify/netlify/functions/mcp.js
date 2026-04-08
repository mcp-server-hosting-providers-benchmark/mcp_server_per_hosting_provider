// Netlify Function (Node.js Lambda) — MCP JSON-RPC stateless handler
// Single tool: get_mcp_client_ip

const TOOL = {
  name: "get_mcp_client_ip",
  description: "Returns the IP address of the MCP client initiating the request to this remote MCP server hosted on Netlify.",
  inputSchema: { type: "object", properties: {}, required: [] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

function jsonrpc(id, result, startMs) {
  const endMs = performance.now();
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Mcp-Server-Start-Ms": String(Math.round(startMs)),
      "X-Mcp-Server-End-Ms": String(Math.round(endMs)),
      "X-Mcp-Server-Processing-Ms": String(Math.round(endMs - startMs)),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, result }),
  };
}

export async function handler(event) {
  const startMs = performance.now();

  if (event.path?.endsWith("/health")) {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "ok" }) };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const rpc = JSON.parse(event.body);
  const { id, method, params } = rpc;

  if (method === "initialize") {
    return jsonrpc(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "remote_mcp_server_netlify", version: "1.0.0" },
    }, startMs);
  }

  if (method === "notifications/initialized" || method === "ping") {
    return jsonrpc(id, {}, startMs);
  }

  if (method === "tools/list") {
    return jsonrpc(id, { tools: [TOOL] }, startMs);
  }

  if (method === "tools/call" && params?.name === "get_mcp_client_ip") {
    const clientIp =
      event.headers?.["x-forwarded-for"]?.split(",")[0].trim() ||
      event.headers?.["x-nf-client-connection-ip"] ||
      "unknown";
    return jsonrpc(id, {
      content: [{ type: "text", text: JSON.stringify({ mcp_client_ip: clientIp, hosting_provider: "netlify" }) }],
    }, startMs);
  }

  return {
    statusCode: 404,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }),
  };
}
