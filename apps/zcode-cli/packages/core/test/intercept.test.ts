// 拦截层测试——对齐 ARTEX guard/intercept 的核心行为。
//
// 只测**纯判定逻辑**（规则匹配 / 严格解析 / 决策流），不启动模型：
// judge 的模型调用是可注入的 JudgeRunner，测试里用桩函数。

import assert from "node:assert/strict";
import { test } from "node:test";
import { Interceptor } from "../src/intercept/interceptor.js";
import {
  DEFAULT_ENABLED_TOOLS,
  DEFAULT_INTERCEPT_RULES,
  INTERCEPT_PATTERNS,
} from "../src/intercept/rules.js";
import { parseVerdict, stripCodeFence } from "../src/intercept/judge-verdict.js";
import { effectiveJudgePrompt } from "../src/intercept/judge-prompt.js";
import { systemBlockMessage } from "../src/intercept/block-message.js";

// ---------------------------------------------------------------------------
// 规则匹配
// ---------------------------------------------------------------------------

function evaluateRule(toolName: string, toolInput: unknown) {
  const interceptor = new Interceptor({ judgeConfig: { enabled: false } });
  return interceptor.evaluate({ toolName, toolInput });
}

test("破坏性命令被 DENY（对齐 ARTEX v1/v2 规则）", async () => {
  for (const command of [
    "rm -rf /",
    "rm -rf /etc",
    "mkfs.ext4 /dev/sda1",
    "dd if=/dev/zero of=/dev/sda",
    "shutdown -h now",
    "reboot",
    "kill -9 -1",
    "iptables -F",
    "nft flush ruleset",
  ]) {
    const decision = await evaluateRule("Bash", { command });
    assert.equal(decision?.action, "deny", `should deny: ${command}`);
  }
});

test("数据库破坏被 DENY", async () => {
  for (const command of [
    "mysql -e 'DROP TABLE users'",
    "DROP DATABASE prod",
    "TRUNCATE TABLE orders",
    "db.users.dropDatabase()",
    "redis-cli FLUSHALL",
  ]) {
    const decision = await evaluateRule("Bash", { command });
    assert.equal(decision?.action, "deny", `should deny: ${command}`);
  }
});

test("HTTP 删除请求被 DENY（DELETE 方法 + 删除类路径）", async () => {
  for (const command of [
    "curl -X DELETE http://t/api/user/1",
    "curl --request DELETE http://t/api",
    "requests.delete('http://t/api/user/1')",
    "axios.delete('/api/item/1')",
    "curl 'http://t/api/user/delete?id=1'",
    "curl 'http://t/api/remove/1'",
    "curl 'http://t/api/v1/erase-all'",
  ]) {
    const decision = await evaluateRule("Bash", { command });
    assert.equal(decision?.action, "deny", `should deny: ${command}`);
  }
});

test("正常渗透动作全部放行（不误伤）", async () => {
  for (const command of [
    // A1 漏洞探测
    "sqlmap -u 'http://t/item?id=1' --dump",
    "curl 'http://t/item?id=1%27%20UNION%20SELECT%201,2,3--'",
    // A3 口令测试
    "hydra -l admin -P rockyou.txt t http-post-form '/login:u=^USER^&p=^PASS^:F=err'",
    "curl -X POST http://t/login -d 'user=admin&pass=123456'",
    // A4 信息收集
    "nmap -sV t",
    "ffuf -u http://t/FUZZ -w wordlist.txt",
    "subfinder -d t.example.com",
    // A5 读文件
    "cat /etc/passwd",
    "cat /etc/shadow",
    "curl 'http://t/download?file=../../../etc/passwd'",
    // A6 落脚侦察
    "whoami",
    "uname -a",
    "netstat -tunlp",
    // 正常写操作（测试产物）
    "echo test > /tmp/verify.txt",
  ]) {
    const decision = await evaluateRule("Bash", { command });
    assert.equal(decision, undefined, `should allow: ${command}`);
  }
});

test("工具白名单：非白名单工具不进拦截", async () => {
  const interceptor = new Interceptor({ judgeConfig: { enabled: false } });
  // add_goals 不在白名单 → 即使参数里含破坏性文本也不拦
  const decision = await interceptor.evaluate({
    toolName: "add_goals",
    toolInput: { goals: ["rm -rf /"] },
  });
  assert.equal(decision, undefined);
});

test("白名单内容与 ARTEX 一致（7 个执行类工具）", () => {
  assert.deepEqual([...DEFAULT_ENABLED_TOOLS].sort(), [
    "Bash",
    "Edit",
    "MultiEdit",
    "WebFetch",
    "Write",
    "shell_open",
    "shell_send",
    "web_search",
  ].sort());
});

test("内置规则：数据外泄管道默认关闭（对齐 ARTEX）", () => {
  const exfil = DEFAULT_INTERCEPT_RULES.find((r) => r.name.includes("数据外泄"));
  assert.ok(exfil);
  assert.equal(exfil.enabled, false);
});

test("内置规则：priority DESC 排序命中（rm -rf 优先于通用规则）", async () => {
  const decision = await evaluateRule("Bash", { command: "rm -rf /" });
  assert.equal(decision?.action, "deny");
  // priority 100 的 rm -rf 规则先命中
  assert.match(decision?.ruleName ?? "", /rm -rf/);
});

// ---------------------------------------------------------------------------
// judge verdict 严格解析
// ---------------------------------------------------------------------------

test("parseVerdict 接受完整合法 JSON", () => {
  const v = parseVerdict(
    JSON.stringify({
      decision: "deny",
      comment: "实际操作：删除生产数据库表；成功后的后果：业务数据永久丢失；命中规则：D4",
    }),
  );
  assert.equal(v.action, "deny");
});

test("parseVerdict 剥掉 markdown 栅栏", () => {
  const v = parseVerdict(
    "\`\`\`json\n" +
      JSON.stringify({
        decision: "allow",
        comment: "实际操作：读取文件；成功后的后果：返回内容；命中规则：A5",
      }) +
      "\n\`\`\`",
  );
  assert.equal(v.action, "allow");
});

test("parseVerdict 拒绝不完整/散文/错字段", () => {
  for (const bad of [
    "allow",
    "判定为 allow",
    '{"decision":"deny"}',
    '{"decision":"maybe","comment":"实际操作：x；成功后的后果：y；命中规则：z"}',
    '{"decision":"deny","comment":"缺少三段式"}',
    '{"decision":"deny","comment":"实际操作：；成功后的后果：y；命中规则：z"}',
    '{"decision":"deny","comment":"实际操作：x；成功后的后果：；命中规则：z"}',
    '{"decision":"deny","comment":"实际操作：x；成功后的后果：y；命中规则："}',
    "",
  ]) {
    assert.equal(parseVerdict(bad).action, "", `should reject: ${bad}`);
  }
});

test("stripCodeFence 只解包，不修复截断", () => {
  // 截断的栅栏（无闭合）→ 原样返回
  const truncated = "\`\`\`json\n{\"decision\":\"allow\"";
  assert.equal(stripCodeFence(truncated), truncated);
});

// ---------------------------------------------------------------------------
// judge 决策流
// ---------------------------------------------------------------------------

test("judge 未启用 → 规则未命中时放行（fail-open）", async () => {
  const interceptor = new Interceptor({ judgeConfig: { enabled: false } });
  const decision = await interceptor.evaluate({
    toolName: "Bash",
    toolInput: { command: "curl http://t/api/items" },
  });
  assert.equal(decision, undefined);
});

test("judge 未接线（enabled 但无 runner）→ 放行", async () => {
  const interceptor = new Interceptor({ judgeConfig: { enabled: true } });
  const decision = await interceptor.evaluate({
    toolName: "Bash",
    toolInput: { command: "curl http://t/api/items" },
  });
  assert.equal(decision, undefined);
});

test("judge 返回 deny → 决策为 deny", async () => {
  const interceptor = new Interceptor({
    judgeConfig: { enabled: true },
    judgeRunner: async () =>
      JSON.stringify({
        decision: "deny",
        comment: "实际操作：停服务；成功后的后果：服务中断；命中规则：D5",
      }),
  });
  const decision = await interceptor.evaluate({
    toolName: "Bash",
    toolInput: { command: "systemctl stop nginx" },
  });
  assert.equal(decision?.action, "deny");
  assert.equal(decision?.modelFallback, true);
});

test("judge 模型调用失败 → failAction（默认 allow）", async () => {
  const interceptor = new Interceptor({
    judgeConfig: { enabled: true },
    judgeRunner: async () => {
      throw new Error("模型不可用");
    },
  });
  const decision = await interceptor.evaluate({
    toolName: "Bash",
    toolInput: { command: "curl http://t/api/items" },
  });
  // failAction 默认 allow → evaluate 返回 undefined（放行）
  assert.equal(decision, undefined);
});

test("judge 输出不可解析 → failAction（默认 allow）", async () => {
  const interceptor = new Interceptor({
    judgeConfig: { enabled: true },
    judgeRunner: async () => "我觉得这个操作还行",
  });
  const decision = await interceptor.evaluate({
    toolName: "Bash",
    toolInput: { command: "curl http://t/api/items" },
  });
  assert.equal(decision, undefined);
});

test("judge 返回 ask → 带超时配置", async () => {
  const interceptor = new Interceptor({
    judgeConfig: { enabled: true, askTimeoutSeconds: 120, askTimeoutAction: "deny" },
    judgeRunner: async () =>
      JSON.stringify({
        decision: "ask",
        comment: "实际操作：删不确定归属的文件；成功后的后果：可能误删；命中规则：ASK",
      }),
  });
  // 选一个不命中任何内置规则的写操作（用 python 脚本删文件，避开 rm/dd 等规则）。
  const decision = await interceptor.evaluate({
    toolName: "Bash",
    toolInput: { command: "python -c 'import os; os.unlink(\"/srv/app/cache.db\")'" },
  });
  assert.equal(decision?.action, "ask");
  assert.equal(decision?.timeoutSeconds, 120);
  assert.equal(decision?.timeoutAction, "deny");
});

// ---------------------------------------------------------------------------
// 提示词与框定
// ---------------------------------------------------------------------------

test("effectiveJudgePrompt 强制追加边界与输出契约", () => {
  const prompt = effectiveJudgePrompt("自定义策略");
  assert.ok(prompt.startsWith("自定义策略"));
  assert.match(prompt, /审查输入边界/);
  assert.match(prompt, /裁决输出协议/);
  // 幂等：再调一次不重复追加
  const again = effectiveJudgePrompt(prompt);
  assert.equal((again.match(/审查输入边界/g) ?? []).length, 1);
});

test("systemBlockMessage 明说「平台管控·非目标防御」", () => {
  const msg = systemBlockMessage("测试原因");
  assert.match(msg, /平台管控/);
  assert.match(msg, /非目标防御/);
  assert.match(msg, /测试原因/);
});
