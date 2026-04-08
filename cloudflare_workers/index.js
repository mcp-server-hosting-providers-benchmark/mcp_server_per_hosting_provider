import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

function createMcpServer(clientIp) {
  const server = new McpServer({
    name: "remote_mcp_server_cloudflare_workers",
    version: "1.0.0",
  });

  server.registerTool(
    "get_mcp_client_ip",
    {
      description:
        "Returns the IP address of the MCP client initiating the request to this remote MCP server hosted on Cloudflare Workers.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            mcp_client_ip: clientIp,
            hosting_provider: "cloudflare_workers",
          }),
        },
      ],
    })
  );

  return server;
}

function withServerTiming(response, startMs) {
  const endMs = performance.now();
  const headers = new Headers(response.headers);
  headers.set("X-Mcp-Server-Start-Ms", String(Math.round(startMs)));
  headers.set("X-Mcp-Server-End-Ms", String(Math.round(endMs)));
  headers.set("X-Mcp-Server-Processing-Ms", String(Math.round(endMs - startMs)));
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const serverStartMs = performance.now();

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    const clientIp =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "unknown";

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    const server = createMcpServer(clientIp);
    await server.connect(transport);

    if (request.method === "POST") {
      const body = await request.json();
      const response = await transport.handleRequest(request, { parsedBody: body });
      return withServerTiming(response, serverStartMs);
    }

    if (request.method === "GET") {
      const response = await transport.handleRequest(request);
      return withServerTiming(response, serverStartMs);
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
};
