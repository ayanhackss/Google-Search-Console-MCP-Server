# Google Search Console MCP Server

Welcome! This is a **Model Context Protocol (MCP)** server that connects your AI assistants (like Claude, Cursor, Windsurf, or Antigravity) directly to your **Google Search Console** data. 

By connecting your AI to this server, you can simply ask your AI to analyze your SEO performance, check your indexation status, or submit sitemaps—and it will fetch the live data straight from Google.

---

## ✨ What can it do?
Once connected, your AI assistant will gain the following super-powers:
- **List Sites:** See all the websites you have verified in Google Search Console.
- **Search Analytics:** Ask your AI for clicks, impressions, CTR, and average position for any of your domains, filtered by date.
- **URL Inspection:** Ask your AI to check if a specific URL is indexed by Google and see any crawling errors.
- **Sitemaps:** Submit new sitemaps or list existing ones.
- **AI SEO Analysis:** The AI can automatically map your keywords to pages and find low-hanging SEO opportunities.

---

## 🚀 How to Use It

### Step 1: Authorize your Google Account
Before your AI can read your data, you need to securely grant it access:
1. Open your browser and go to: **[https://gscmcp.vercel.app/api/auth/login](https://gscmcp.vercel.app/api/auth/login)**
2. Log in with the Google Account that has access to your Search Console properties.
3. You will see a success message. You're ready to go!

*(Note: Your access tokens are stored securely in a private cloud database and are never exposed).*

---

### Step 2: Connect your AI Assistant

Depending on which AI tool you use, follow the instructions below:

#### Option A: Cursor IDE / Windsurf (Easiest)
Modern AI IDEs support remote SSE endpoints natively.
1. Open **Cursor Settings** (gear icon) -> **Features** -> **MCP**.
2. Click **+ Add New MCP Server**.
3. Set the Type to **SSE**.
4. Set the Name to `Google-Search-Console`.
5. Set the URL exactly to: `https://gscmcp.vercel.app/api/mcp`
6. Click **Save**. 

You can now open Cursor's chat and say: *"Analyze the SEO opportunities for my website."*

#### Option B: Claude Desktop (Local Bridge)
Claude Desktop currently only supports local processes. To connect it to this cloud server, you need to run a small "bridge" script locally.

1. Clone this repository to your computer:
   ```bash
   git clone https://github.com/ayanhackss/Google-Search-Console-MCP-Server.git
   cd Google-Search-Console-MCP-Server
   npm install
   ```
2. Open your `claude_desktop_config.json` file.
3. Add the following configuration, making sure to replace the path with the actual absolute path to the `bridge.ts` file on your computer:
   ```json
   {
     "mcpServers": {
       "google-search-console": {
         "command": "npx",
         "args": [
           "ts-node",
           "/absolute/path/to/Google-Search-Console-MCP-Server/bridge.ts"
         ],
         "env": {}
       }
     }
   }
   ```
4. Restart Claude Desktop.

---

## 🛠️ Troubleshooting

- **Connection Drops:** This server is hosted on a serverless platform. If your AI complains that the `stream is not readable` or the connection was lost, **simply retry your prompt**. The AI will automatically reconnect.
- **"No properties found":** Make sure you logged in (Step 1) with the exact Google Account that owns the properties in Google Search Console.

---
*Built with [Model Context Protocol](https://modelcontextprotocol.io)*
