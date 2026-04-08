// Railway — MCP JSON-RPC stateless handler
// Runtime: Node.js
// Single tool: get_mcp_client_ip

import http from "node:http";

const PORT = process.env.PORT || 8080;

const TOOL = {
  name: "get_mcp_client_ip",
  description: "Returns the IP address of the MCP client initiating the request to this remote MCP server hosted on Railway.",
  inputSchema: { type: "object", properties: {}, required: [] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

function sendJson(res, body, startMs, statusCode = 200) {
  const endMs = performance.now();
  const data = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    "X-Mcp-Server-Start-Ms": String(Math.round(startMs)),
    "X-Mcp-Server-End-Ms": String(Math.round(endMs)),
    "X-Mcp-Server-Processing-Ms": String(Math.round(endMs - startMs)),
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const startMs = performance.now();
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rpc = JSON.parse(Buffer.concat(chunks).toString());
  const { id, method, params } = rpc;

  if (method === "initialize") {
    return sendJson(res, { jsonrpc: "2.0", id, result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "remote_mcp_server_railway", version: "1.0.0" },
    }}, startMs);
  }

  if (method === "notifications/initialized" || method === "ping") {
    return sendJson(res, { jsonrpc: "2.0", id, result: {} }, startMs);
  }

  if (method === "tools/list") {
    return sendJson(res, { jsonrpc: "2.0", id, result: { tools: [TOOL] } }, startMs);
  }

  if (method === "tools/call" && params?.name === "get_mcp_client_ip") {
    const clientIp =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.socket.remoteAddress ||
      "unknown";
    return sendJson(res, { jsonrpc: "2.0", id, result: {
      content: [{ type: "text", text: JSON.stringify({ mcp_client_ip: clientIp, hosting_provider: "railway" }) }],
    }}, startMs);
  }

  sendJson(res, { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }, startMs, 404);
});

server.listen(PORT, () => {
  console.log(`remote_mcp_server_railway listening on port ${PORT}`);
});
