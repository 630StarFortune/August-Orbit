// Project: 八月星尘 · August Stardust
// Backend Main File - Post-Migration Final Version with Enhanced Robustness and Updated CORS
// This version uses Deno KV for persistence and includes improved error handling, logging, and CORRECT CORS setup.

const SECRET_PASSWORD = Deno.env.get("SECRET_PASSWORD");
// const tasksFilePath = "./tasks.json"; // 已移除，不再需要文件存储

// 【【【 更新的 CORS 配置 - 明确允许前端域名 】】】
// 明确列出所有允许访问后端 API 的前端域名
const allowedOrigins = [
    'https://august-stardust--disstella.on.websim.com', // WebSim 托管的地址 (如果还需要)
    'https://630starfortune.github.io',                 // 你的 GitHub Pages 用户域名 (关键!)
    // 如果你的 GH Pages URL 是 https://630starfortune.github.io/August-Orbit/ 也加上
    // 'https://630starfortune.github.io/August-Orbit', 
    '.c.websim.com'                                     // WebSim 开发环境 (子域匹配)
];

// --- 改进的 CORS 处理函数 ---
function handleCors(req: Request): Headers {
    const requestOrigin = req.headers.get("Origin");
    let allowedOrigin = null;

    // console.log(`[CORS] Incoming request Origin: ${requestOrigin}`); // 调试日志

    if (requestOrigin) {
        // 检查是否在明确允许的列表中 (精确匹配)
        if (allowedOrigins.includes(requestOrigin)) {
            allowedOrigin = requestOrigin;
        }
        // 检查是否匹配 GitHub Pages 用户域名
        else if (requestOrigin === 'https://630starfortune.github.io') {
             allowedOrigin = requestOrigin;
        }
        // 检查是否匹配 WebSim 开发环境 (子域)
        else if (requestOrigin.endsWith('.c.websim.com')) {
             allowedOrigin = requestOrigin;
        }
        // 如果你的 GH Pages 项目 URL 也需要支持，可以添加更宽松的检查
        // else if (requestOrigin.startsWith('https://630starfortune.github.io')) {
        //      allowedOrigin = 'https://630starfortune.github.io'; // 或 requestOrigin
        // }
    }

    // console.log(`[CORS] Allowed Origin for response: ${allowedOrigin}`); // 调试日志

    const corsHeaders = new Headers();
    // 【【【 关键修正：只有在匹配到允许的源时，才设置 ACAO 头 】】】
    if (allowedOrigin) {
        corsHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
    }
    corsHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    corsHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    // 可选：如果前端需要携带凭证 (如 Cookies)，需要设置此项，同时 ACAO 不能是 '*'
    // corsHeaders.set("Access-Control-Allow-Credentials", "true");
    return corsHeaders;
}
// --- CORS 处理函数结束 ---


// --- Deno KV 可用性检查 (启动时) ---
console.log("🔍 Checking Deno KV availability at startup...");
let isKvAvailable = false;
try {
  const testKv = await Deno.openKv();
  const testKey = ["__kv_startup_test__"];
  const testValue = { status: "available", timestamp: new Date().toISOString() };
  await testKv.set(testKey, testValue);
  const result = await testKv.get(testKey);
  await testKv.delete(testKey);
  testKv.close();
  if (result.value) {
    console.log("✅ Deno KV is available and functional.");
    isKvAvailable = true;
  } else {
    throw new Error("KV write/read test failed - value not retrieved.");
  }
} catch (err) {
  console.error("❌ Critical Error: Deno KV is NOT available or accessible:", err.message);
  // 注意：在 Deno Deploy 中，即使 KV 不可用，应用也可能继续运行。
  // 最好是在关键操作（如 readTasks, writeTasks）中处理 KV 错误。
}

// --- 核心 KV 数据操作函数 ---

async function readTasks() {
    try {
        if (!isKvAvailable) {
            console.warn("⚠️ Attempting to read from KV, but it was marked as unavailable at startup.");
            // 仍然尝试连接，以防运行时恢复
        }
        const kv = await Deno.openKv();
        const tasks = [];
        const iter = kv.list({ prefix: ["tasks"] });
        for await (const res of iter) {
            // 【【【 兼容性强化：确保 value 是对象 】】】
            if (res.value && typeof res.value === 'object' && res.value !== null) {
                 tasks.push(res.value);
            } else {
                 console.warn(`⚠️ Skipping invalid task entry with key: ${JSON.stringify(res.key)}. Value type: ${typeof res.value}`);
            }
        }
        kv.close();
        console.log(`[KV READ] Successfully read ${tasks.length} tasks.`);
        return tasks;
    } catch (error) {
        console.error("[KV READ ERROR] Failed to read tasks from KV:", error);
        // 根据策略，可以选择返回空数组或抛出错误
        // 对于 GET /api/tasks，返回空数组更友好
        return [];
    }
}

async function writeTask(task: any) {
    // 用于创建和更新单个任务，提高效率
    if (!task || !task.id) {
        const err = new Error("Invalid task object or missing ID for writeTask.");
        console.error("[KV WRITE ERROR]", err.message);
        throw err;
    }
    try {
        const kv = await Deno.openKv();
        await kv.set(["tasks", task.id], task);
        kv.close();
        console.log(`[KV WRITE] Task with ID ${task.id} written successfully.`);
    } catch (err) {
        console.error(`[KV WRITE ERROR] Failed to write task ID ${task.id}:`, err);
        throw err;
    }
}

async function deleteTaskById(id: string) {
    // 用于删除单个任务
    if (!id) {
        const err = new Error("Invalid ID provided for deleteTaskById.");
        console.error("[KV DELETE ERROR]", err.message);
        throw err;
    }
    try {
        const kv = await Deno.openKv();
        await kv.delete(["tasks", id]);
        kv.close();
        console.log(`[KV DELETE] Task with ID ${id} deleted successfully.`);
    } catch (err) {
        console.error(`[KV DELETE ERROR] Failed to delete task ID ${id}:`, err);
        throw err;
    }
}

// --- 通用响应构建函数 ---
function createResponse(body: any, status: number = 200, extraHeaders: Record<string, string> = {}): Response {
    const headers = new Headers(extraHeaders);
    headers.set("Content-Type", "application/json");
    // 【【【 功能升级：添加基本的安全和缓存头 】】】
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY"); // 如果不打算被嵌入 iframe
    // headers.set("Cache-Control", "no-store"); // API 通常不缓存，或由具体路由设置
    return new Response(JSON.stringify(body), { status, headers });
}

// --- 主服务逻辑 ---
Deno.serve(async (req: Request) => {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // 处理 CORS 预检请求
    if (method === "OPTIONS") {
        const corsHeaders = handleCors(req);
        // 预检请求通常需要较短的缓存时间
        corsHeaders.set("Access-Control-Max-Age", "86400"); // 24 hours
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 为所有响应添加 CORS 头 (除了 OPTIONS)
    const corsHeaders = handleCors(req);

    // --- 基本健康检查 ---
    if (path === "/" && method === "GET") {
        const healthInfo = {
            status: "ok",
            message: "August Stardust Backend is alive and well.",
            timestamp: new Date().toISOString(),
            kv_available_at_startup: isKvAvailable
        };
        // 健康检查可以公开，不需要 CORS 或认证
        return createResponse(healthInfo, 200);
    }

    // --- GET /api/tasks (访客模式可访问) ---
    if (path === "/api/tasks" && method === "GET") {
        console.log(`[REQUEST] ${method} ${path} from ${req.headers.get("X-Forwarded-For") || req.headers.get("CF-Connecting-IP") || "Unknown IP"}`);
        try {
            const tasks = await readTasks();
            // 【【【 功能升级：添加 Cache-Control 头 】】】
            const headersWithCache = new Headers(corsHeaders);
            headersWithCache.set("Cache-Control", "max-age=60, stale-while-revalidate=30"); // 缓存 1 分钟
            return createResponse(tasks, 200, Object.fromEntries(headersWithCache.entries()));
        } catch (err) {
            console.error(`[ERROR] GET /api/tasks failed:`, err);
            return createResponse({ message: "获取星辰失败" }, 500, Object.fromEntries(corsHeaders.entries()));
        }
    }

    // --- 认证检查 (除 GET /api/tasks 外的所有路由都需要) ---
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== SECRET_PASSWORD) {
        console.warn(`[AUTH] Unauthorized ${method} ${path} attempt.`);
        return createResponse({ message: "星语口令错误" }, 401, Object.fromEntries(corsHeaders.entries()));
    }
    console.log(`[AUTH] Authorized ${method} ${path} request.`);

    // --- POST /api/tasks (创建新任务) ---
    if (path === "/api/tasks" && method === "POST") {
        console.log(`[REQUEST] ${method} ${path}`);
        try {
            const newTaskData = await req.json();
            
            // 基本验证
            if (!newTaskData.content || typeof newTaskData.content !== 'string') {
                 return createResponse({ message: "任务内容 (content) 是必需的字符串。" }, 400, Object.fromEntries(corsHeaders.entries()));
            }

            const newTask = {
                id: Date.now().toString(), // 考虑使用 crypto.randomUUID() 获得更强的唯一性
                content: newTaskData.content,
                notes: newTaskData.notes && typeof newTaskData.notes === 'string' ? newTaskData.notes : "",
                status: newTaskData.status && (newTaskData.status === 'pending' || newTaskData.status === 'completed') ? newTaskData.status : "pending",
                tags: Array.isArray(newTaskData.tags) ? newTaskData.tags.filter((t: any) => typeof t === 'string') : [],
                type: newTaskData.type && typeof newTaskData.type === 'string' ? newTaskData.type : undefined // 允许 'note' 类型
            };

            await writeTask(newTask);
            console.log(`[TASK CREATED] ID: ${newTask.id}`);
            return createResponse(newTask, 201, Object.fromEntries(corsHeaders.entries()));
        } catch (err) {
            if (err instanceof SyntaxError) {
                console.error(`[ERROR] POST /api/tasks - Invalid JSON:`, err.message);
                return createResponse({ message: "请求体格式错误，不是有效的 JSON。" }, 400, Object.fromEntries(corsHeaders.entries()));
            }
            console.error(`[ERROR] POST /api/tasks failed:`, err);
            return createResponse({ message: "创建星辰失败" }, 500, Object.fromEntries(corsHeaders.entries()));
        }
    }
    
    // --- PUT /api/tasks/:id 和 DELETE /api/tasks/:id ---
    const taskPattern = new URLPattern({ pathname: "/api/tasks/:id" });
    const match = taskPattern.exec(url);

    if (match) {
        const id = match.pathname.groups.id;
        console.log(`[REQUEST] ${method} ${path}, Task ID: ${id}`);

        if (method === "PUT") {
            try {
                const updatedTaskData = await req.json();

                 // 基本验证 (可选，根据需要调整严格程度)
                // if (updatedTaskData.content !== undefined && typeof updatedTaskData.content !== 'string') {
                //      return createResponse({ message: "任务内容 (content) 必须是字符串。" }, 400, Object.fromEntries(corsHeaders.entries()));
                // }

                // 获取现有任务以保留未更改的字段
                const kv = await Deno.openKv();
                const existingTaskRes = await kv.get(["tasks", id]);
                kv.close();

                if (!existingTaskRes.value) {
                    console.warn(`[TASK UPDATE] Task ID ${id} not found.`);
                    return createResponse({ message: "星辰未找到" }, 404, Object.fromEntries(corsHeaders.entries()));
                }

                // 合并更新，但强制保留 ID
                const updatedTask = { 
                    ...existingTaskRes.value as any, 
                    ...updatedTaskData, 
                    id: id 
                };

                await writeTask(updatedTask);
                console.log(`[TASK UPDATED] ID: ${id}`);
                return createResponse(updatedTask, 200, Object.fromEntries(corsHeaders.entries()));
            } catch (err) {
                if (err instanceof SyntaxError) {
                    console.error(`[ERROR] PUT /api/tasks/:id - Invalid JSON:`, err.message);
                    return createResponse({ message: "请求体格式错误，不是有效的 JSON。" }, 400, Object.fromEntries(corsHeaders.entries()));
                }
                console.error(`[ERROR] PUT /api/tasks/${id} failed:`, err);
                return createResponse({ message: "编辑星辰失败" }, 500, Object.fromEntries(corsHeaders.entries()));
            }
        }

        if (method === "DELETE") {
            try {
                // 检查任务是否存在
                const kv = await Deno.openKv();
                const existingTaskRes = await kv.get(["tasks", id]);
                kv.close();

                if (!existingTaskRes.value) {
                    console.warn(`[TASK DELETE] Task ID ${id} not found.`);
                    return createResponse({ message: "星辰未找到" }, 404, Object.fromEntries(corsHeaders.entries()));
                }

                await deleteTaskById(id);
                console.log(`[TASK DELETED] ID: ${id}`);
                // DELETE 成功通常返回 204 No Content
                return new Response(null, { status: 204, headers: corsHeaders });
            } catch (err) {
                console.error(`[ERROR] DELETE /api/tasks/${id} failed:`, err);
                return createResponse({ message: "遗忘星辰失败" }, 500, Object.fromEntries(corsHeaders.entries()));
            }
        }
    }

    // --- 404 Not Found ---
    console.warn(`[REQUEST] ${method} ${path} - Not Found`);
    return createResponse({ message: "Not Found" }, 404, Object.fromEntries(corsHeaders.entries()));
});

console.log(`Backend server setup complete with enhanced robustness and Deno KV. Listening for requests...`);
