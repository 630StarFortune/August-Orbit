import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.2/mod.ts";

const app = new Application();
const router = new Router();
const tasksFilePath = "./tasks.json";

// Helper to read tasks
async function readTasks() {
    try {
        const data = await Deno.readTextFile(tasksFilePath);
        return JSON.parse(data);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            return [];
        }
        throw error;
    }
}

// Helper to write tasks
async function writeTasks(tasks: any[]) {
    await Deno.writeTextFile(tasksFilePath, JSON.stringify(tasks, null, 2));
}

router
    .get("/api/tasks", async (ctx) => {
        const tasks = await readTasks();
        ctx.response.body = tasks;
    })
    .post("/api/tasks", async (ctx) => {
        const tasks = await readTasks();
        const newTask = await ctx.request.body({ type: "json" }).value;
        newTask.id = Date.now().toString(); // Assign a new unique ID
        tasks.push(newTask);
        await writeTasks(tasks);
        ctx.response.status = 201;
        ctx.response.body = newTask;
    })
    .put("/api/tasks/:id", async (ctx) => {
        const tasks = await readTasks();
        const updatedTaskData = await ctx.request.body({ type: "json" }).value;
        const taskId = ctx.params.id;
        
        const index = tasks.findIndex(t => t.id === taskId);
        if (index > -1) {
            tasks[index] = { ...tasks[index], ...updatedTaskData };
            await writeTasks(tasks);
            ctx.response.body = tasks[index];
        } else {
            ctx.response.status = 404;
            ctx.response.body = { message: "Task not found" };
        }
    })
    .delete("/api/tasks/:id", async (ctx) => {
        let tasks = await readTasks();
        const taskId = ctx.params.id;
        
        const initialLength = tasks.length;
        tasks = tasks.filter(t => t.id !== taskId);

        if (tasks.length < initialLength) {
            await writeTasks(tasks);
            ctx.response.status = 204; // No Content
        } else {
            ctx.response.status = 404;
            ctx.response.body = { message: "Task not found" };
        }
    });

// CORS for allowing frontend access
app.use(oakCors({ origin: "*" })); // IMPORTANT: Allows any domain to access.

app.use(router.routes());
app.use(router.allowedMethods());

// Serve static frontend files
app.use(async (ctx, next) => {
    try {
        await ctx.send({
            root: `${Deno.cwd()}/`,
            index: "index.html",
        });
    } catch {
        await next();
    }
});


console.log("Server running on http://localhost:8000");
await app.listen({ port: 8000 });
