// Project: 八月星尘 · August Stardust
// Backend Main File - Back to Basics Final Version
// This version uses the native Deno.serve for maximum stability on Deno Deploy.

// --- 安全核心：从环境变量读取机密信息 ---
const SECRET_PASSWORD = Deno.env.get("SECRET_PASSWORD");
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN");

if (!SECRET_PASSWORD || !ALLOWED_ORIGIN) {
    console.error("错误：请确保在Deno Deploy的项目设置中，正确配置了 SECRET_PASSWORD 和 ALLOWED_ORIGIN 环境变量。");
}

const tasksFilePath = "./tasks.json";

// --- 辅助函数 (无变化) ---
async function readTasks() {
    try {
        const data = await Deno.readTextFile(tasksFilePath);
        return JSON.parse(data);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) { return []; }
        throw error;
    }
}
async function writeTasks(tasks: any[]) {
    await Deno.writeTextFile(tasksFilePath, JSON.stringify(tasks, null, 2));
}

// --- 创建响应的辅助函数 (包含CORS头) ---
function createResponse(body: any, status: number = 200): Response {
    const headers = new Headers({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN || "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return new Response(JSON.stringify(body), { status, headers });
}

// --- 【核心改造】使用原生 Deno.serve ---
Deno.serve(async (req: Request) => {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- 【重要】处理浏览器预检请求 (Preflight OPTIONS request) ---
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 204, // No Content
            headers: {
                "Access-Control-Allow-Origin": ALLOWED_ORIGIN || "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
            },
        });
    }

    // --- 手动路由 ---
    // 1. 健康检查
    if (path === "/" && req.method === "GET") {
        return new Response("August Stardust Backend is alive and well.", { status: 200 });
    }

    // 2. 获取所有任务
    if (path === "/api/tasks" && req.method === "GET") {
        const tasks = await readTasks();
        return createResponse(tasks);
    }

    // 3. 创建新任务
    if (path === "/api/tasks" && req.method === "POST") {
        if (req.headers.get("Authorization") !== SECRET_PASSWORD) {
            return createResponse({ message: "星语口令错误" }, 401);
        }
        const tasks = await readTasks();
        const newTask = await req.json();
        newTask.id = Date.now().toString();
        tasks.push(newTask);
        await writeTasks(tasks);
        return createResponse(newTask, 201);
    }
    
    // 4. 更新和删除任务 (使用URLPattern匹配带ID的路径)
    const taskPattern = new URLPattern({ pathname: "/api/tasks/:id" });
    const match = taskPattern.exec(url);

    if (match) {
        const id = match.pathname.groups.id;
        if (req.headers.get("Authorization") !== SECRET_PASSWORD) {
            return createResponse({ message: "星语口令错误" }, 401);
        }

        if (req.method === "PUT") {
            const tasks = await readTasks();
            const updatedTaskData = await req.json();
            const index = tasks.findIndex(t => t.id === id);
            if (index > -1) {
                tasks[index] = { ...tasks[index], ...updatedTaskData };
                await writeTasks(tasks);
                return createResponse(tasks[index]);
            }
        }

        if (req.method === "DELETE") {
            let tasks = await readTasks();
            const initialLength = tasks.length;
            tasks = tasks.filter(t => t.id !== id);
            if (tasks.length < initialLength) {
                await writeTasks(tasks);
                return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN || "*" } });
            }
        }
    }

    // 如果所有路由都未匹配，返回404
    return createResponse({ message: "Not Found" }, 404);
});

console.log(`Backend server setup complete. Listening for requests...`);
