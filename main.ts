// Project: 八月星尘 · August Stardust
// Backend Main File - Final Battle Version with Smart CORS
// This version intelligently handles Websim's dynamic sandbox origins.

const SECRET_PASSWORD = Deno.env.get("SECRET_PASSWORD");
const tasksFilePath = "./tasks.json";

// 【【【 智能门卫核心 】】】
// 这是我们允许进入的两个“家族”
const allowedOrigins = [
    'https://august-stardust--disstella.on.websim.com', // 你的“美术馆” (生产环境)
    '.c.websim.com'                                     // 你的“工作室” (开发环境的家族标记)
];

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

function createResponse(body: any, status: number = 200, headers: Headers): Response {
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get("Origin");
    let allowedOrigin = null;

    // 智能门卫的判断逻辑
    if (requestOrigin) {
        if (allowedOrigins.includes(requestOrigin)) {
            allowedOrigin = requestOrigin; // 精确匹配“美术馆”
        } else if (requestOrigin.endsWith(allowedOrigins[1])) {
            allowedOrigin = requestOrigin; // 模糊匹配所有“工作室”
        }
    }
    
    const corsHeaders = new Headers({
        "Access-Control-Allow-Origin": allowedOrigin || allowedOrigins[0], // 如果没有匹配，默认允许“美术馆”
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });

    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/" && req.method === "GET") {
        return new Response("August Stardust Backend is alive and well.", { status: 200, headers: corsHeaders });
    }

    if (path === "/api/tasks" && req.method === "GET") {
        const tasks = await readTasks();
        return createResponse(tasks, 200, corsHeaders);
    }

    if (req.headers.get("Authorization") !== SECRET_PASSWORD) {
        return createResponse({ message: "星语口令错误" }, 401, corsHeaders);
    }

    if (path === "/api/tasks" && req.method === "POST") {
        const tasks = await readTasks();
        const newTask = await req.json();
        newTask.id = Date.now().toString();
        tasks.push(newTask);
        await writeTasks(tasks);
        return createResponse(newTask, 201, corsHeaders);
    }
    
    const taskPattern = new URLPattern({ pathname: "/api/tasks/:id" });
    const match = taskPattern.exec(url);

    if (match) {
        const id = match.pathname.groups.id;
        if (req.method === "PUT") {
            const tasks = await readTasks();
            const updatedTaskData = await req.json();
            const index = tasks.findIndex(t => t.id === id);
            if (index > -1) {
                tasks[index] = { ...tasks[index], ...updatedTaskData };
                await writeTasks(tasks);
                return createResponse(tasks[index], 200, corsHeaders);
            }
        }
        if (req.method === "DELETE") {
            let tasks = await readTasks();
            tasks = tasks.filter(t => t.id !== id);
            await writeTasks(tasks);
            return new Response(null, { status: 204, headers: corsHeaders });
        }
    }

    return createResponse({ message: "Not Found" }, 404, corsHeaders);
});

console.log(`Backend server setup complete with smart CORS. Listening for requests...`);
