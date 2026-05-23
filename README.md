# mcp-servers

Cloudflare Workers Remote MCP servers:

```text
https://gateway.mcpservers.org/weread/mcp
https://gateway.mcpservers.org/caiyun/mcp
https://gateway.mcpservers.org/twelvedata/mcp
```

All endpoints use MCP `Authorization: Bearer <token>`.

- `/weread/mcp` forwards the bearer token to the WeRead Agent Gateway.
- `/caiyun/mcp` injects the bearer token into Caiyun's URL path token parameter.
- `/twelvedata/mcp` injects the bearer token into Twelve Data's `apikey` query parameter (tools: `twelvedata_get_quote`, `twelvedata_get_latest_price`, `twelvedata_get_end_of_day_price`, `twelvedata_search_symbols`).

OpenAPI documents:

```text
openapi/weread.yaml
openapi/caiyun-weather.yaml
```
