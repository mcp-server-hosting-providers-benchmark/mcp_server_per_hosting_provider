// Alpic — MCP server for the hosting provider latency benchmark
// Framework: Skybridge (Alpic's MCP server runtime)
// Single tool: get_mcp_client_ip
// Deploy with: alpic deploy

import { createServer } from "skybridge";

const server = createServer({ name: "remote-mcp-server-alpic" });

server.tool(
  "get_mcp_client_ip",
  "Returns the IP address of the MCP client initiating the request to this remote MCP server hosted on Alpic.",
  {},
  async (_, { request }) => {
    const clientIp =
      request?.headers?.["x-forwarded-for"]?.split(",")[0].trim() ||
      request?.headers?.["x-real-ip"] ||
      "unknown";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ mcp_client_ip: clientIp, hosting_provider: "alpic" }),
        },
      ],
    };
  }
);

export type { server };
