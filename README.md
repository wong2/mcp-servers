# mcp-servers

Cloudflare Workers Remote MCP servers:

```text
https://gateway.mcpservers.org/weread/mcp
https://gateway.mcpservers.org/caiyun/mcp
https://gateway.mcpservers.org/twelvedata/mcp
https://gateway.mcpservers.org/yahoo-finance/mcp
```

- `/weread/mcp` forwards the bearer token to the WeRead Agent Gateway.
- `/caiyun/mcp` injects the bearer token into Caiyun's URL path token parameter.
- `/twelvedata/mcp` injects the bearer token into Twelve Data's `apikey` query parameter.
- `/yahoo-finance/mcp` wraps [yahoo-finance2](https://github.com/gadicc/yahoo-finance2); no auth required.

All endpoints except `/yahoo-finance/mcp` use MCP `Authorization: Bearer <token>`.
