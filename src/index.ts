import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler, WorkerTransport } from "agents/mcp";
import { z } from "zod";

const SKILL_VERSION = "1.0.3";
const WEREAD_GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";
const CAIYUN_API_BASE_URL = "https://api.caiyunapp.com";

type Env = Record<string, never>;

type WeReadParams = Record<string, unknown>;
type WeReadApiName =
  | "/store/search"
  | "/book/info"
  | "/book/chapterinfo"
  | "/book/getprogress"
  | "/shelf/sync"
  | "/user/notebooks"
  | "/book/bookmarklist"
  | "/review/list/mine"
  | "/book/underlines"
  | "/book/bestbookmarks"
  | "/book/readreviews"
  | "/review/single"
  | "/review/list"
  | "/readdata/detail"
  | "/book/recommend"
  | "/book/similar";

type CaiyunEndpoint = "realtime" | "minutely" | "hourly" | "daily";
type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

const bookId = z.string().min(1).describe("微信读书 bookId。用户只给书名时，先调用 weread_search 获取 bookId。");
const count = z.number().int().min(1).optional().describe("每页数量；未传时由微信读书服务端使用默认值。");
const maxIdx = z.number().int().min(0).optional().describe("翻页偏移；通常传上一页最后一条结果的 idx/searchIdx。");
const synckey = z.number().int().min(0).optional().describe("翻页或增量同步游标；未传时默认为 0。");
const chapterUid = z.number().int().describe("章节 UID，可从 weread_book_chapterinfo 获取。");
const range = z.string().regex(/^\d+-\d+$/).describe("划线位置范围，格式为 起始-结束，例如 900-2004。");
const location = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/)
  .describe("经纬度，格式为 longitude,latitude，例如上海为 121.4737,31.2304。");
const caiyunLang = z.enum(["zh_CN", "zh_TW", "en_US", "en_GB", "ja"]).optional().describe("返回语言，默认 zh_CN。");
const caiyunUnit = z.enum(["metric", "imperial", "si"]).optional().describe("单位制，默认 metric。");

function jsonText(value: unknown): McpToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function getBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-session-id",
    "Access-Control-Expose-Headers": "mcp-session-id",
  };
}

function unauthorized(serviceName: string): Response {
  return new Response(JSON.stringify({ error: "Missing bearer token." }), {
    status: 401,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "WWW-Authenticate": `Bearer realm="${serviceName}"`,
      ...corsHeaders(),
    },
  });
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: corsHeaders() });
}

async function callWeRead(apiKey: string, apiName: WeReadApiName, params: WeReadParams = {}): Promise<unknown> {
  const response = await fetch(WEREAD_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...params,
      api_name: apiName,
      skill_version: SKILL_VERSION,
    }),
  });

  const bodyText = await response.text();
  let body: unknown = bodyText;

  try {
    body = JSON.parse(bodyText);
  } catch {
    // Keep raw text for non-JSON upstream failures.
  }

  if (!response.ok) {
    throw new Error(`WeRead gateway returned HTTP ${response.status}: ${bodyText}`);
  }

  return body;
}

function createWeReadServer(apiKey: string): McpServer {
  const server = new McpServer({
    name: "weread-mcp",
    version: "1.0.0",
  });

  const call = (apiName: WeReadApiName, params?: WeReadParams) => callWeRead(apiKey, apiName, params);

  server.tool(
    "weread_search",
    "搜索微信读书内容。支持全部、电子书、网文小说、有声书/专辑、作者、全文、书单、公众号和文章。",
    {
      keyword: z.string().min(1).describe("搜索关键词。"),
      scope: z
        .enum(["0", "2", "4", "6", "10", "12", "13", "14", "16"])
        .optional()
        .describe("搜索类型：0=全部，10=电子书，16=网文小说，14=听书/有声书/专辑，6=作者，12=全文，13=书单，2=公众号，4=文章。"),
      maxIdx,
      count,
    },
    async ({ keyword, scope, maxIdx, count }) =>
      jsonText(
        await call("/store/search", {
          keyword,
          scope: scope === undefined ? undefined : Number(scope),
          maxIdx,
          count,
        }),
      ),
  );

  server.tool(
    "weread_book_info",
    "获取书籍基本信息，包括书名、作者、封面、简介、分类、出版社、ISBN、字数和评分信息。",
    { bookId },
    async ({ bookId }) => jsonText(await call("/book/info", { bookId })),
  );

  server.tool(
    "weread_book_chapterinfo",
    "获取书籍章节目录，返回章节 UID、序号、标题、层级、字数、价格和购买状态等。",
    { bookId },
    async ({ bookId }) => jsonText(await call("/book/chapterinfo", { bookId })),
  );

  server.tool(
    "weread_book_getprogress",
    "获取指定书籍的当前阅读进度。progress 是 0-100 的百分比整数，只有 100 表示已读完。",
    { bookId },
    async ({ bookId }) => jsonText(await call("/book/getprogress", { bookId })),
  );

  server.tool(
    "weread_shelf_sync",
    "获取当前用户书架。书架总数应按 books.length + albums.length + (mp 非空 ? 1 : 0) 计算。",
    {},
    async () => jsonText(await call("/shelf/sync")),
  );

  server.tool(
    "weread_user_notebooks",
    "获取所有有笔记的书的概览。单本书总笔记数按 reviewCount + noteCount + bookmarkCount 计算。",
    {
      count,
      lastSort: z.number().int().optional().describe("翻页游标；下一页传上一页 books 最后一项的 sort 值。"),
    },
    async ({ count, lastSort }) => jsonText(await call("/user/notebooks", { count, lastSort })),
  );

  server.tool(
    "weread_book_bookmarklist",
    "获取单本书划线内容列表。该接口已过滤书签，只返回划线内容和章节信息。",
    { bookId },
    async ({ bookId }) => jsonText(await call("/book/bookmarklist", { bookId })),
  );

  server.tool(
    "weread_review_list_mine",
    "获取当前用户在单本书上的个人想法与点评，包括划线想法、章节点评和整本书评。",
    {
      bookid: bookId.describe("书籍 ID。注意该接口参数名是小写 bookid。"),
      synckey,
      count,
    },
    async ({ bookid, synckey, count }) => jsonText(await call("/review/list/mine", { bookid, synckey, count })),
  );

  server.tool(
    "weread_book_underlines",
    "获取某章节划线热度统计，返回范围、划线人数、热度分数和类型，不包含划线文本。",
    {
      bookId,
      chapterUid,
      synckey,
    },
    async ({ bookId, chapterUid, synckey }) => jsonText(await call("/book/underlines", { bookId, chapterUid, synckey })),
  );

  server.tool(
    "weread_book_bestbookmarks",
    "获取全书或某章节热门划线，包含划线原文和划线人数。服务端固定返回前 20 条，不支持分页。",
    {
      bookId,
      chapterUid: z.number().int().min(0).optional().describe("章节 UID；0 或未传表示全部章节。"),
      synckey,
    },
    async ({ bookId, chapterUid, synckey }) =>
      jsonText(await call("/book/bestbookmarks", { bookId, chapterUid, synckey })),
  );

  server.tool(
    "weread_book_readreviews",
    "查询指定划线范围下的想法/评论。range 通常来自 weread_book_bestbookmarks 返回值。",
    {
      bookId,
      chapterUid,
      reviews: z
        .array(
          z.object({
            range,
            maxIdx: z.number().int().min(0).optional().describe("该 range 下的翻页偏移，默认 0。"),
            count: z.number().int().min(1).max(20).optional().describe("每页数量，服务端上限 20。"),
            synckey: z.number().int().min(0).optional().describe("该 range 下的翻页游标，默认 0。"),
          }),
        )
        .min(1)
        .describe("要查询的划线范围数组。"),
    },
    async ({ bookId, chapterUid, reviews }) => jsonText(await call("/book/readreviews", { bookId, chapterUid, reviews })),
  );

  server.tool(
    "weread_review_single",
    "获取单条想法详情，可拉取评论和点赞分页上下文。",
    {
      reviewId: z.string().min(1).describe("想法/评论 ID。"),
      commentsCount: z.number().int().min(0).optional().describe("拉取评论数量，默认 10。"),
      commentsDirection: z.enum(["0", "1"]).optional().describe("评论排序方向：0=倒序，1=正序。"),
      likesCount: z.number().int().min(0).optional().describe("拉取点赞数量，默认 10。"),
      likesDirection: z.enum(["0"]).optional().describe("点赞排序方向：0=倒序。"),
      synckey,
    },
    async ({ reviewId, commentsCount, commentsDirection, likesCount, likesDirection, synckey }) =>
      jsonText(
        await call("/review/single", {
          reviewId,
          commentsCount,
          commentsDirection: commentsDirection === undefined ? undefined : Number(commentsDirection),
          likesCount,
          likesDirection: likesDirection === undefined ? undefined : Number(likesDirection),
          synckey,
        }),
      ),
  );

  server.tool(
    "weread_review_list",
    "获取书籍公开点评。可按全部、推荐、不行、最新、一般筛选。",
    {
      bookId,
      reviewListType: z
        .enum(["0", "1", "2", "3", "4"])
        .optional()
        .describe("筛选类型：0=全部，1=推荐，2=不行，3=最新，4=一般。"),
      count,
      maxIdx,
      synckey,
    },
    async ({ bookId, reviewListType, count, maxIdx, synckey }) =>
      jsonText(
        await call("/review/list", {
          bookId,
          reviewListType: reviewListType === undefined ? undefined : Number(reviewListType),
          count,
          maxIdx,
          synckey,
        }),
      ),
  );

  server.tool(
    "weread_readdata_detail",
    "获取阅读统计详情。所有阅读时长字段除特别说明外均为秒。",
    {
      mode: z.enum(["weekly", "monthly", "annually", "overall"]).optional().describe("统计维度：weekly=本周，monthly=本月，annually=本年，overall=总计。"),
      baseTime: z.number().int().min(0).optional().describe("基准时间戳；0 表示当前周期，服务端会归一化到周期起点。"),
    },
    async ({ mode, baseTime }) => jsonText(await call("/readdata/detail", { mode, baseTime })),
  );

  server.tool(
    "weread_book_recommend",
    "获取基于当前用户阅读记录的个性化推荐，与微信读书首页“为你推荐”一致。",
    {
      count,
      maxIdx,
    },
    async ({ count, maxIdx }) => jsonText(await call("/book/recommend", { count, maxIdx })),
  );

  server.tool(
    "weread_book_similar",
    "基于某本书推荐相似书籍。翻页时传上一页返回的 sessionId 和最后一条 idx。",
    {
      bookId,
      count,
      maxIdx,
      sessionId: z.string().optional().describe("翻页会话 ID；首次不传，后续传回包中的 booksimilar.sessionId。"),
    },
    async ({ bookId, count, maxIdx, sessionId }) =>
      jsonText(await call("/book/similar", { bookId, count, maxIdx, sessionId })),
  );

  return server;
}

async function callCaiyun(
  token: string,
  endpoint: CaiyunEndpoint,
  location: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const url = new URL(`${CAIYUN_API_BASE_URL}/v2.6/${encodeURIComponent(token)}/${location}/${endpoint}.json`);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url);
  const bodyText = await response.text();
  let body: unknown = bodyText;

  try {
    body = JSON.parse(bodyText);
  } catch {
    // Keep raw text for non-JSON upstream failures.
  }

  if (!response.ok) {
    throw new Error(`Caiyun returned HTTP ${response.status}: ${bodyText}`);
  }

  return body;
}

function createCaiyunServer(token: string): McpServer {
  const server = new McpServer({
    name: "caiyun-weather-mcp",
    version: "1.0.0",
  });

  server.tool(
    "caiyun_realtime",
    "获取指定经纬度的彩云天气实时天气数据。Authorization Bearer 会作为彩云 token 注入 URL path，工具参数里不需要 token。",
    {
      location,
      lang: caiyunLang,
      unit: caiyunUnit,
      alert: z.boolean().optional().describe("是否返回预警信息，默认 false。"),
    },
    async ({ location, lang, unit, alert }) =>
      jsonText(await callCaiyun(token, "realtime", location, { lang, unit, alert })),
  );

  server.tool(
    "caiyun_minutely",
    "获取指定经纬度未来 2 小时的分钟级别降水预报。",
    {
      location,
      lang: caiyunLang,
      unit: caiyunUnit,
    },
    async ({ location, lang, unit }) => jsonText(await callCaiyun(token, "minutely", location, { lang, unit })),
  );

  server.tool(
    "caiyun_hourly",
    "获取指定经纬度的小时级别天气预报。",
    {
      location,
      lang: caiyunLang,
      unit: caiyunUnit,
      hourlysteps: z.number().int().min(1).max(360).optional().describe("预报小时数，取值 1-360，默认 48。"),
    },
    async ({ location, lang, unit, hourlysteps }) =>
      jsonText(await callCaiyun(token, "hourly", location, { lang, unit, hourlysteps })),
  );

  server.tool(
    "caiyun_daily",
    "获取指定经纬度的天级别天气预报。",
    {
      location,
      lang: caiyunLang,
      unit: caiyunUnit,
      dailysteps: z.number().int().min(1).max(15).optional().describe("预报天数，取值 1-15，默认 5。"),
    },
    async ({ location, lang, unit, dailysteps }) =>
      jsonText(await callCaiyun(token, "daily", location, { lang, unit, dailysteps })),
  );

  return server;
}

function createHandler(server: McpServer, route: string) {
  const transport = new WorkerTransport({
    corsOptions: {
      origin: "*",
      methods: "GET, POST, OPTIONS",
      headers: "Authorization, Content-Type, mcp-session-id",
      exposeHeaders: "mcp-session-id",
      maxAge: 86400,
    },
  });

  return createMcpHandler(server, { route, transport });
}

function healthResponse(): Response {
  return new Response(
    JSON.stringify({
      name: "mcp-servers",
      status: "ok",
      services: {
        weread: {
          mcp: "/weread/mcp",
          auth: "Authorization: Bearer <weread-api-token>",
        },
        caiyun: {
          mcp: "/caiyun/mcp",
          auth: "Authorization: Bearer <caiyun-api-token>",
        },
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(),
      },
    },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return healthResponse();
    }

    const bearerToken = getBearerToken(request);

    if (url.pathname === "/weread/mcp") {
      if (!bearerToken) {
        return unauthorized("weread-mcp");
      }

      return createHandler(createWeReadServer(bearerToken), "/weread/mcp")(request, env, ctx);
    }

    if (url.pathname === "/caiyun/mcp") {
      if (!bearerToken) {
        return unauthorized("caiyun-weather-mcp");
      }

      return createHandler(createCaiyunServer(bearerToken), "/caiyun/mcp")(request, env, ctx);
    }

    return notFound();
  },
} satisfies ExportedHandler<Env>;

export { createCaiyunServer, createWeReadServer };
