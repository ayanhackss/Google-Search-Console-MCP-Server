import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function main() {
  console.log("Connecting to Vercel MCP Server (SSE)...");
  
  // Connect to your live Vercel endpoint
  const transport = new SSEClientTransport(new URL("https://gscmcp.vercel.app/api/mcp"));
  
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    console.log("✅ Connected successfully!\n");

    console.log("Fetching available tools...");
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tools:`);
    tools.tools.forEach(t => console.log(` - ${t.name}: ${t.description}`));

    console.log("\nTesting 'list_sites' tool...");
    const result = await client.callTool({
      name: "list_sites",
      arguments: {}
    });

    console.log("\n✅ Tool result:");
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error("❌ Connection failed:", error);
  } finally {
    process.exit(0); // Force exit as SSE might keep the process alive
  }
}

main();
