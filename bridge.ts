import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const MCP_URL = process.env.MCP_URL || "https://gscmcp.ayanhacks.in/api/mcp";

async function connect(retryCount = 0): Promise<void> {
  const delay = Math.min(1000 * 2 ** retryCount, 30000);

  try {
    const sseTransport = new SSEClientTransport(new URL(MCP_URL));
    const stdioTransport = new StdioServerTransport();

    // Start both transports
    await sseTransport.start();
    await stdioTransport.start();

    console.error(`[bridge] Connected to ${MCP_URL}`);

    // Forward messages from VPS SSE → local Stdio
    sseTransport.onmessage = async (message) => {
      await stdioTransport.send(message);
    };

    // Forward messages from local Stdio → VPS SSE
    stdioTransport.onmessage = async (message) => {
      await sseTransport.send(message);
    };

    // Forward errors
    sseTransport.onerror = (err) => console.error("[bridge] SSE Error:", err);
    stdioTransport.onerror = (err) => console.error("[bridge] Stdio Error:", err);

    // Reconnect on SSE close with exponential backoff
    sseTransport.onclose = () => {
      console.error(`[bridge] SSE closed. Reconnecting in ${delay}ms...`);
      setTimeout(() => connect(retryCount + 1), delay);
    };

    stdioTransport.onclose = () => {
      sseTransport.close();
      process.exit(0);
    };

  } catch (err) {
    console.error(`[bridge] Connection failed. Retrying in ${delay}ms...`, err);
    setTimeout(() => connect(retryCount + 1), delay);
  }
}

connect().catch(console.error);
