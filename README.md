# mcp-servers

Cloudflare Workers Remote MCP servers:

```text
https://gateway.mcpservers.org/weread/mcp
https://gateway.mcpservers.org/caiyun/mcp
```

Both endpoints use MCP `Authorization: Bearer <token>`.

- `/weread/mcp` forwards the bearer token to the WeRead Agent Gateway.
- `/caiyun/mcp` injects the bearer token into Caiyun's URL path token parameter.

OpenAPI documents:

```text
openapi/weread.yaml
openapi/caiyun-weather.yaml
```
