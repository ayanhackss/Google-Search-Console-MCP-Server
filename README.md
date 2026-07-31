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

## 🚀 How to Install (One-Click Prompts)

This MCP server supports **Native OAuth 2.1**. This means you do not need to manually configure API keys. You just add the URL to your IDE, and click "Authenticate"!

### Option A: Cursor IDE (Easiest)
Copy and paste this exact prompt into Cursor's Composer or Chat to automatically install it:

```text
Please add a new MCP Server to my Cursor configuration with the following details:
Name: Google-Search-Console
Type: SSE
URL: https://gscmcp.ayanhacks.in

Once added, tell me to go to Cursor Settings -> MCP and click the "Authenticate" button to sign in with my Google account.
```

### Option B: Antigravity IDE / Claude Desktop (Stdio Bridge)
For IDEs that use a standard `mcp_config.json` file (like Antigravity or Claude Desktop), you need to use the bridge method with an API key.

1. Go to **[https://gscmcp.ayanhacks.in](https://gscmcp.ayanhacks.in)**, click **Generate API Key**, and copy it.
2. Click **Login with Google** to authorize your account.
3. Give your AI assistant this exact prompt:

```text
Please add a new MCP Server to my `mcp_config.json` with the following details:
Name: google-search-console
Command: npx
Args: ["-y", "github:ayanhackss/Google-Search-Console-MCP-Server", "node", "bridge.js"]
Env: 
  MCP_URL: https://gscmcp.ayanhacks.in/api/mcp?apiKey=PASTE_MY_API_KEY_HERE
```
*(Remember to replace `PASTE_MY_API_KEY_HERE` with your actual API key before sending the prompt!)*

### Option C: Manual API Key (Fallback)
If your AI assistant doesn't support the fancy "Authenticate" button yet, you can still use it!
1. Go to **[https://gscmcp.ayanhacks.in](https://gscmcp.ayanhacks.in)**
2. Click "Generate API Key" and copy the key.
3. Click "Login with Google" to authorize your Google Account.
4. Add the server to your IDE using this URL: `https://gscmcp.ayanhacks.in/api/mcp?apiKey=YOUR_API_KEY`

---

## 🛠️ Troubleshooting

- **"No properties found":** Make sure you logged in with the exact Google Account that owns the properties in Google Search Console.
- **Connection Drops:** If your AI complains that the connection was lost, **simply retry your prompt**. The AI will automatically reconnect to the SSE stream.

---
*Built with [Model Context Protocol](https://modelcontextprotocol.io)*
