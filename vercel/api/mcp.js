// Vercel Edge Function — MCP JSON-RPC stateless handler
// Single tool: get_mcp_client_ip

export const config = { runtime: "edge" };

const TOOL = {
  name: "get_mcp_client_ip",
  description: "Returns the IP address of the MCP client initiating the request to this remote MCP server hosted on Vercel.",
  inputSchema: { type: "object", properties: {}, required: [] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

function jsonrpc(id, result, startMs) {
  const endMs = performance.now();
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: {
      "Content-Type": "application/json",
      "X-Mcp-Server-Start-Ms": String(Math.round(startMs)),
      "X-Mcp-Server-End-Ms": String(Math.round(endMs)),
      "X-Mcp-Server-Processing-Ms": String(Math.round(endMs - startMs)),
    },
  });
}

export default async function handler(request) {
  const startMs = performance.now();
  const url = new URL(request.url);

  if (url.pathname.endsWith("/health")) {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rpc = await request.json();
  const { id, method, params } = rpc;

  if (method === "initialize") {
    return jsonrpc(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "remote_mcp_server_vercel", version: "1.0.0" },
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
      request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
      request.headers.get("X-Real-IP") ||
      "unknown";
    return jsonrpc(id, {
      content: [{ type: "text", text: JSON.stringify({ mcp_client_ip: clientIp, hosting_provider: "vercel" }) }],
    }, startMs);
  }

  return new Response(JSON.stringify({
    jsonrpc: "2.0", id,
    error: { code: -32601, message: `Method not found: ${method}` },
  }), { status: 404, headers: { "Content-Type": "application/json" } });
}
