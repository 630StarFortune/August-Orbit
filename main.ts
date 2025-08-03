import { Application, Router, Status } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.2/mod.ts";

// --- 安全核心：从环境变量读取机密信息 ---
const SECRET_PASSWORD = Deno.env.get("SECRET_PASSWORD");
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN");

if (!SECRET_PASSWORD || !ALLOWED_ORIGIN) {
    console.error("错误：请确保在Deno Deploy的项目设置中，正确配置了 SECRET_PASSWORD 和 ALLOWED_ORIGIN 环境变量。");
}

const app = new Application();
const router = new Router();
const tasksFilePath = "./tasks.json";

// --- 中间件配置 ---
app.use(oakCors({ origin: ALLOWED_ORIGIN || "*" }));

// 密码验证中间件
app.use(async (ctx, next) => {
    if (['POST', 'PUT', 'DELETE'].includes(ctx.request.method)) {
        if (!SECRET_PASSWORD) {
            ctx.response.status = Status.InternalServerError;
            ctx.response.body = { message: "服务器端密码未配置" };
            return;
        }
        const authHeader = ctx.request.headers.get('Authorization');
        if (authHeader !== SECRET_PASSWORD) {
            ctx.response.status = Status.Unauthorized;
            ctx.response.body = { message: '星语口令错误' };
            return;
        }
    }
    await next();
});

// --- API 路由 ---
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

// 【【【 根本性修复：将健康检查直接加入路由器 】】】
router
    .get("/", (ctx) => {
        ctx.response.status = 200;
        ctx.response.body = "August Orbit Backend is alive and well.";
    })
    .get("/api/tasks", async (ctx) => {
        ctx.response.body = await readTasks();
    })
    .post("/api/tasks", async (ctx) => {
        const tasks = await readTasks();
        const newTask = await ctx.request.body({ type: "json" }).value;
        newTask.id = Date.now().toString();
        tasks.push(newTask);
        await writeTasks(tasks);
        ctx.response.status = 201;
        ctx.response.body = newTask;
    })
    .put("/api/tasks/:id", async (ctx) => {
        const tasks = await readTasks();
        const updatedTaskData = await ctx.request.body({ type: "json" }).value;
        const index = tasks.findIndex(t => t.id === ctx.params.id);
        if (index > -1) {
            tasks[index] = { ...tasks[index], ...updatedTaskData };
            await writeTasks(tasks);
            ctx.response.body = tasks[index];
        } else {
            ctx.response.status = 404;
        }
    })
    .delete("/api/tasks/:id", async (ctx) => {
        let tasks = await readTasks();
        const initialLength = tasks.length;
        tasks = tasks.filter(t => t.id !== ctx.params.id);
        if (tasks.length < initialLength) {
            await writeTasks(tasks);
            ctx.response.status = 204;
        } else {
            ctx.response.status = 404;
        }
    });

app.use(router.routes());
app.use(router.allowedMethods());

// --- 明确的启动监听 ---
const port = 8000;
app.addEventListener("listen", ({ hostname, port, secure }) => {
    console.log(
        `Backend server successfully launched. Listening on: ${secure ? "https://" : "http://"}${hostname ?? "localhost"}:${port}`,
    );
});

await app.listen({ port });
