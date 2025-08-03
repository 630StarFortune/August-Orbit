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

    // === 一次性数据恢复端点 - 仅用于恢复数据 ===
    // 【【【 警告：这是一个危险的端点，任何人都能调用它来覆盖你的 KV 数据！！！】】】
    // 【【【 部署后，立即在浏览器中访问一次 https://你的后端地址/api/restore-data 】】】
    // 【【【 然后，立刻从此代码中删除这段代码并重新部署！！！】】】
    if (path === "/api/restore-data" && req.method === "POST") {
      try {
        console.log("🚨 数据恢复端点被调用!");

        // 1. 【【【在此处粘贴你的 tasks.json 文件的完整内容】】】
        const tasksFromJson: any[] = [
          {
            "id": "1721548801001",
            "content": "完成 蔡徐坤生日曲",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801002",
            "content": "完成 八一主题文章，音乐",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801003",
            "content": "731推文宣发",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801004",
            "content": "看电影院偷拍的盗版南京照相馆",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801005",
            "content": "完成《十七岁的雨季》纯音乐创作(明明只需要我一句话 但还是不愿意为难他们)",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801006",
            "content": "完成 《明镜集》1%",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801007",
            "content": "我没想到",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801008",
            "content": "处理一下QQ信息",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801009",
            "content": "攒钱 买朵莉亚新皮肤!",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801010",
            "content": "明天要把我的苹果十一寄回我的好姐姐家 过年才能再见面啦 无限暖暖 以后不能宠爱你了",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801011",
            "content": "今天倒数第二次治牙 痛痛(这里想不到说啥了)",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801012",
            "content": "给白师傅持续投稿",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801013",
            "content": "给我的忠实小读者持续写系列文章",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801014",
            "content": "~~心跳瀑布上线~~\nhttps://linux.do/uploads/default/original/4X/0/7/6/07625e01d64cf3cd3bb9021c12b6e1e06a7ab0be.jpeg  \n会玩梗的 爱如火，恨如冰，上如线\n腾讯审核越来越快了 祝愿你永远愿意施舍哪怕1%的资本\n造福世界",
            "status": "completed",
            "notes": "这是一个已完成的示例，展示了删除线和链接的效果。"
          },
          {
            "id": "1721548801015",
            "content": "写告别帖(我不会写，到时候水一下就算了)",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801016",
            "content": "晚安 梦里 有你有我\n\n> 我不做梦 也不记梦",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "note-1",
            "type": "note",
            "content": "感谢某人的提醒，这里也更新一下"
          },
          {
            "id": "1721548801017",
            "content": "研究几个kimi提示词",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801018",
            "content": "没有2",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "note-2",
            "type": "note",
            "content": "感谢我的灵感，这里再更新一下" // 注意：前端 JS 会将 "感谢我的灵感" 替换为 "感谢某人的灵感"
          },
          {
            "id": "1721548801019",
            "content": "真正直面虚无 或者 reality",
            "status": "pending",
            "notes": ""
          },
          {
            "id": "1721548801020",
            "content": "没有2",
            "status": "pending",
            "notes": ""
          }
        ]; // <--- 粘贴你的 JSON 数组内容到这里

        if (!Array.isArray(tasksFromJson)) {
           console.error("❌ 提供的数据不是有效的 JSON 数组。");
           return createResponse({ message: "Invalid data format. Must be a JSON array." }, 400, corsHeaders);
        }

        console.log(`📥 接收到 ${tasksFromJson.length} 个任务用于恢复。`);

        // 2. 连接到 Deno KV
        const kv = await Deno.openKv();
        console.log("🔗 已连接到 Deno KV。");

        // 3. 准备原子操作 (先清空，再写入)
        const atomic = kv.atomic();
        
        // 3a. 删除所有现有任务 (清空)
        console.log("🗑️  正在清空现有的 KV 任务数据...");
        const oldTasksIter = kv.list({ prefix: ["tasks"] });
        let deleteCount = 0;
        for await (const res of oldTasksIter) {
            atomic.delete(res.key);
            deleteCount++;
        }
        console.log(`🗑️  计划删除 ${deleteCount} 个旧任务。`);

        // 3b. 添加所有从 JSON 恢复的任务
        console.log("➕ 正在准备添加恢复的任务...");
        let successCount = 0;
        let skippedCount = 0;
        for (const task of tasksFromJson) {
            if (!task.id) {
                console.warn(`⚠️ 任务缺少 ID，跳过:`, JSON.stringify(task));
                skippedCount++;
                continue;
            }
            console.log(`➕ 正在添加任务 ID: ${task.id}`);
            atomic.set(["tasks", task.id], task);
            successCount++;
        }

        // 4. 提交原子操作
        console.log(`📤 正在提交操作: 删除 ${deleteCount}, 添加 ${successCount}, 跳过 ${skippedCount}...`);
        const res = await atomic.commit();
        kv.close(); // 关闭连接

        if (res.ok) {
            console.log("✅ 数据恢复成功完成!");
            return createResponse({ 
                message: "Data restore successful!", 
                restored: successCount, 
                skipped: skippedCount,
                deleted: deleteCount
            }, 200, corsHeaders);
        } else {
            console.error("❌ 恢复过程中的原子操作失败。");
            return createResponse({ message: "Atomic commit failed during data restore." }, 500, corsHeaders);
        }

      } catch (err) {
        console.error("💥 数据恢复过程中发生错误:", err);
        return createResponse({ message: `Restore error: ${err.message}` }, 500, corsHeaders);
      }
    }
    // === 数据恢复端点结束 ===


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
