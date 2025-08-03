// Project: 八月星尘 · August Stardust
// Backend Main File - Final Battle Version with Smart CORS and Deno KV
// This version intelligently handles Websim's dynamic sandbox origins and uses Deno KV for persistence.

const SECRET_PASSWORD = Deno.env.get("SECRET_PASSWORD");
// const tasksFilePath = "./tasks.json"; // 已移除，不再需要文件存储

// 【【【 智能门卫核心 】】】
// 这是我们允许进入的两个“家族”
const allowedOrigins = [
    'https://august-stardust--disstella.on.websim.com', // 你的“美术馆” (生产环境) - 修正了空格
    '.c.websim.com'                                     // 你的“工作室” (开发环境的家族标记)
];

// --- Deno KV Availability Check (可选) ---
console.log("🔍 Checking Deno KV availability...");
try {
  const testKv = await Deno.openKv();
  console.log("✅ Deno KV is available.");
  // Simple test write/read
  const testKey = ["__kv_test__"];
  const testValue = { status: "ok", timestamp: new Date().toISOString() };
  await testKv.set(testKey, testValue);
  const result = await testKv.get(testKey);
  console.log("📝 KV Test Read Result:", result.value);
  await testKv.delete(testKey); // Clean up test data
  testKv.close();
  console.log("🏁 Deno KV check completed successfully.");
} catch (err) {
  console.error("❌ Error accessing Deno KV:", err.message);
  // Depending on your setup, you might want to exit here if KV is critical
  // Deno.exit(1); 
}
// --- End Deno KV Check ---

// --- 新的 KV 数据操作函数 ---

async function readTasks() {
    try {
        // 1. 打开 KV 连接
        const kv = await Deno.openKv();
        
        // 2. 准备一个数组来存放所有任务
        const tasks = [];
        
        // 3. 使用 list 方法遍历所有以 ["tasks"] 为前缀的键
        //    这会获取所有形如 ["tasks", "some-task-id"] 的条目
        const iter = kv.list({ prefix: ["tasks"] });
        for await (const res of iter) {
          // res.key 是完整的键数组, e.g., ["tasks", "12345"]
          // res.value 是存储的值, 即任务对象
          tasks.push(res.value);
        }
        
        // 4. 关闭 KV 连接 (重要!)
        kv.close();
        
        // 5. 返回任务数组
        return tasks;
    } catch (error) {
        // 6. 错误处理：记录错误并返回空数组
        console.error("Error reading tasks from KV:", error);
        // 如果是初始化时 KV 为空，返回空数组是合理的
        return []; 
    }
}

async function writeTasks(tasks: any[]) {
    try {
        // 1. 打开 KV 连接
        const kv = await Deno.openKv();
        
        // 2. 开始一个原子操作 (Atomic Operation)
        //    这确保了整个操作（删除旧的 + 添加新的）要么全部成功，要么全部失败
        const atomic = kv.atomic();
        
        // 3. 删除所有现有的任务
        //    首先列出所有现有的任务键
        const oldTasksIter = kv.list({ prefix: ["tasks"] });
        for await (const res of oldTasksIter) {
            // 将每个旧任务的删除操作加入原子队列
            atomic.delete(res.key); 
        }
        
        // 4. 添加所有新任务
        for (const task of tasks) {
            // 确保任务有 ID
            if (!task.id) {
                task.id = Date.now().toString(); // 或使用更健壮的 UUID
            }
            // 将每个新任务的设置操作加入原子队列
            // 键格式: ["tasks", taskId]
            atomic.set(["tasks", task.id], task); 
        }
        
        // 5. 提交原子操作
        const res = await atomic.commit();
        if (!res.ok) {
           // 如果原子操作未能提交（例如，由于并发冲突），抛出错误
           throw new Error("Atomic operation failed during writeTasks");
        }
        
        // 6. 关闭 KV 连接
        kv.close();
        
    } catch (err) {
        // 7. 错误处理：记录并向调用者抛出错误
        console.error("Error writing tasks to KV:", err);
        throw err; // 这很重要，这样调用者（如 POST 路由）可以知道操作失败并返回 500 错误
    }
}

// --- 通用响应构建函数 ---
function createResponse(body: any, status: number = 200, headers: Headers): Response {
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(body), { status, headers });
}

// --- 主服务逻辑 ---
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

    // --- GET /api/tasks (访客模式可访问) ---
    if (path === "/api/tasks" && req.method === "GET") {
        const tasks = await readTasks();
        return createResponse(tasks, 200, corsHeaders);
    }

    // --- 认证检查 (除 GET /api/tasks 外的所有路由都需要) ---
    if (req.headers.get("Authorization") !== SECRET_PASSWORD) {
        return createResponse({ message: "星语口令错误" }, 401, corsHeaders);
    }

    // --- POST /api/tasks (创建新任务) ---
    if (path === "/api/tasks" && req.method === "POST") {
        try {
            // 2. 解析请求体
            const newTask = await req.json();
            
            // 3. 生成 ID
            newTask.id = Date.now().toString(); // 考虑使用 UUID
            
            // 4. 打开 KV 连接
            const kv = await Deno.openKv();
            
            // 5. 直接将新任务存入 KV
            //    键格式: ["tasks", taskId]
            await kv.set(["tasks", newTask.id], newTask);
            
            // 6. 关闭 KV 连接
            kv.close();
            
            // 7. 返回创建成功的响应
            return createResponse(newTask, 201, corsHeaders);
        } catch (err) {
            // 8. 错误处理
            console.error("Error creating task:", err);
            return createResponse({ message: "创建星辰失败" }, 500, corsHeaders);
        }
    }
    
    // --- PUT /api/tasks/:id 和 DELETE /api/tasks/:id ---
    const taskPattern = new URLPattern({ pathname: "/api/tasks/:id" });
    const match = taskPattern.exec(url);

    if (match) {
        const id = match.pathname.groups.id;
        
        // --- PUT /api/tasks/:id (更新任务) ---
        if (req.method === "PUT") {
            try {
                // 2. 解析请求体 (获取更新数据)
                const updatedTaskData = await req.json();
                
                // 3. 打开 KV 连接
                const kv = await Deno.openKv();
                
                // 4. 尝试获取现有任务
                const existingTaskRes = await kv.get(["tasks", id]);
                
                if (existingTaskRes.value) {
                    // 5. 如果任务存在，则合并更新
                    const updatedTask = { ...existingTaskRes.value, ...updatedTaskData, id: id }; // 确保 ID 不被覆盖
                    
                    // 6. 将更新后的任务存回 KV
                    await kv.set(["tasks", id], updatedTask);
                    
                    // 7. 关闭 KV 连接
                    kv.close();
                    
                    // 8. 返回更新成功的响应
                    return createResponse(updatedTask, 200, corsHeaders);
                } else {
                    // 9. 如果任务不存在，返回 404
                    kv.close();
                    return createResponse({ message: "星辰未找到" }, 404, corsHeaders);
                }
            } catch (err) {
                // 10. 错误处理
                console.error("Error updating task:", err);
                return createResponse({ message: "编辑星辰失败" }, 500, corsHeaders);
            }
        }

        // --- DELETE /api/tasks/:id (删除任务) ---
        if (req.method === "DELETE") {
            try {
                // 2. 打开 KV 连接
                const kv = await Deno.openKv();
                
                // 3. 尝试删除指定 ID 的任务
                await kv.delete(["tasks", id]);
                
                // 4. 关闭 KV 连接
                kv.close();
                
                // 5. 返回 204 No Content 响应 (删除成功的标准响应)
                return new Response(null, { status: 204, headers: corsHeaders });
            } catch (err) {
                // 6. 错误处理
                console.error("Error deleting task:", err);
                return createResponse({ message: "遗忘星辰失败" }, 500, corsHeaders);
            }
        }
    }

    return createResponse({ message: "Not Found" }, 404, corsHeaders);
});

console.log(`Backend server setup complete with smart CORS and Deno KV. Listening for requests...`);
