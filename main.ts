// Project: 八月星尘 · August Stardust
// Backend Main File - Scout & Diagnostic Version
// Purpose: To identify the exact Origin header sent by the Websim editor.

const SECRET_PASSWORD = Deno.env.get("SECRET_PASSWORD");
// We are temporarily ignoring ALLOWED_ORIGIN for diagnostics.
const tasksFilePath = "./tasks.json";

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
    // 【【【 侦察兵核心：摄像头已安装 】】】
    const origin = req.headers.get("Origin");
    console.log(`Incoming request from Origin: ${origin}`); // 这会把来访者身份打印在日志里

    // 【【【 侦察兵核心：临时打开所有门禁 】】】
    const corsHeaders = new Headers({
        "Access-Control-Allow-Origin": "*", // Temporarily allow all
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

    // For protected routes
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
