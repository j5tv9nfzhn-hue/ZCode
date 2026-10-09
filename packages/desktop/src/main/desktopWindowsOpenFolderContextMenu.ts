import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { Locale } from "@zcode/shared";

const MENU_KEY_NAME = "ZCode.OpenInZCode";
const DIRECTORY_MENU_KEY = `HKCU\\Software\\Classes\\Directory\\shell\\${MENU_KEY_NAME}`;
const DRIVE_MENU_KEY = `HKCU\\Software\\Classes\\Drive\\shell\\${MENU_KEY_NAME}`;
/**
 * 记录「上次写入这套右键菜单时用的 exe 路径 / 附加参数 / 语言」，
 * 用来在下一次启动时跳过内容完全相同的 8 次 reg.exe 写入。
 * 之所以能安全跳过：注册表写入会通知 Explorer 重建整个右键菜单，
 * 那才是每次冷启动都要付的固定代价，而不是 reg.exe 本身的进程创建。
 */
const MENU_SIGNATURE_VALUE_NAME = "ZCodeInstallSignature";
const MENU_LABELS: Record<Locale, string> = {
  "zh-CN": "在ZCode中打开",
  "en-US": "Open in ZCode",
};

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

interface WindowsOpenFolderRegistryOperation {
  args: string[];
}

function getWindowsOpenFolderMenuName(locale: Locale): string {
  return MENU_LABELS[locale] ?? MENU_LABELS["en-US"];
}

function quoteWindowsCommandArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildWindowsOpenFolderCommand(
  executablePath: string,
  appArgs: readonly string[] = [],
): string {
  return [
    quoteWindowsCommandArg(executablePath),
    ...appArgs.map(quoteWindowsCommandArg),
    "--open-workspace",
    '"%1"',
  ].join(" ");
}

function buildWindowsOpenFolderRegistryOperations(options: {
  executablePath: string;
  appArgs?: readonly string[];
  locale: Locale;
}): WindowsOpenFolderRegistryOperation[] {
  const command = buildWindowsOpenFolderCommand(options.executablePath, options.appArgs ?? []);
  const menuName = getWindowsOpenFolderMenuName(options.locale);
  const menuKeys = [DIRECTORY_MENU_KEY, DRIVE_MENU_KEY];

  return menuKeys.flatMap((menuKey) => [
    { args: ["add", menuKey, "/ve", "/d", menuName, "/f"] },
    { args: ["add", menuKey, "/v", "MUIVerb", "/t", "REG_SZ", "/d", menuName, "/f"] },
    { args: ["add", menuKey, "/v", "Icon", "/t", "REG_SZ", "/d", options.executablePath, "/f"] },
    { args: ["add", `${menuKey}\\command`, "/ve", "/d", command, "/f"] },
  ]);
}

function runRegAdd(args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("reg.exe", [...args], {
      stdio: "ignore",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`reg.exe exited with code ${code ?? "unknown"}`));
    });
  });
}

/**
 * 读取一个命名注册表值的内容。读不到（键/值不存在、无权限、reg.exe 缺失、被杀）一律返回 null，
 * 调用方必须把 null 视作「需要重装」，退回原有的全量写入路径 —— 即最坏情况等于当前行为，
 * 不会出现「菜单装不上」。
 */
function readRegStringValue(key: string, valueName: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = spawn("reg.exe", ["query", key, "/v", valueName], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });

    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    // 永不 reject：这一层的所有失败都等价于「读不到」。
    child.on("error", () => resolvePromise(null));
    child.on("close", () => {
      const line = stdout
        .split(/\r?\n/)
        .find((candidate) => candidate.trimStart().startsWith(valueName));
      if (!line) {
        resolvePromise(null);
        return;
      }
      // 值行形如 `<名称>    <REG_SZ>    <数据>`；REG_SZ 的类型名不随系统语言变化，
      // 而 reg.exe 的表头与警告文案才是本地化的（我们不读表头，只按值名定位）。
      // 数据是下面的 JSON 签名，正常不含 4 个以上连续空白，按 /\s{4,}/ 切分取数据段是安全的。
      const parts = line.trimStart().split(/\s{4,}/);
      resolvePromise(parts.length >= 3 ? parts.slice(2).join("    ") : null);
    });
  });
}

function buildWindowsOpenFolderInstallSignature(options: {
  executablePath: string;
  appArgs: readonly string[];
  locale: Locale;
}): string {
  return JSON.stringify({
    appArgs: options.appArgs,
    executablePath: options.executablePath,
    locale: options.locale,
  });
}

export async function installWindowsOpenFolderContextMenu(options: {
  platform: NodeJS.Platform;
  executablePath: string;
  argv: readonly string[];
  isDefaultApp: boolean;
  locale: Locale;
  logger: Logger;
}): Promise<void> {
  if (options.platform !== "win32") {
    return;
  }

  const appArgs =
    // 开发态 Windows 的 process.execPath 是 Electron 可执行文件。
    // 注册表命令必须同时带上应用入口，否则 Explorer 右键菜单只能启动空 Electron。
    options.isDefaultApp && options.argv[1] ? [resolve(options.argv[1])] : [];
  const installSignature = buildWindowsOpenFolderInstallSignature({
    executablePath: options.executablePath,
    appArgs,
    locale: options.locale,
  });

  try {
    // 内容没变就整体跳过：稳态下这 8 次写入只换来一次 Explorer 右键菜单重建。
    // 读不到签名（null）时继续往下走全量安装，所以首次运行、升级、手改注册表都能自愈。
    const installedSignature = await readRegStringValue(
      DIRECTORY_MENU_KEY,
      MENU_SIGNATURE_VALUE_NAME,
    );
    if (installedSignature === installSignature) {
      options.logger.info("[open-folder] Windows 右键菜单已是最新，跳过注册表写入", {
        executablePath: options.executablePath,
        locale: options.locale,
      });
      return;
    }
  } catch (error) {
    // readRegStringValue 本身不抛，这里只为防御未来改动；读不到就按需要重装处理。
    options.logger.warn("[open-folder] 读取右键菜单签名失败，改为全量重装", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const operations: WindowsOpenFolderRegistryOperation[] = [
    ...buildWindowsOpenFolderRegistryOperations({
      executablePath: options.executablePath,
      appArgs,
      locale: options.locale,
    }),
    // 签名跟着菜单内容一起写，才能保证「签名匹配」等价于「菜单内容匹配」。
    {
      args: [
        "add",
        DIRECTORY_MENU_KEY,
        "/v",
        MENU_SIGNATURE_VALUE_NAME,
        "/t",
        "REG_SZ",
        "/d",
        installSignature,
        "/f",
      ],
    },
  ];

  try {
    await Promise.all(operations.map((operation) => runRegAdd(operation.args)));

    options.logger.info("[open-folder] Windows Explorer 右键菜单已安装或更新", {
      executablePath: options.executablePath,
      hasDefaultAppEntry: appArgs.length > 0,
      locale: options.locale,
    });
  } catch (error) {
    options.logger.warn("[open-folder] Windows Explorer 右键菜单安装失败", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
