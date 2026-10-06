/**
 * `@zcode/server` 只保留桌面端所需的两条进程边界：
 * - `./remote`：SSH / WSL / Docker 远程工作区后端；
 * - `./stdio`：远程资产部署用的协议服务端（入口见 entry-stdio.ts，由 build-remote.ts 打包）。
 *
 * Web 产品的 HTTP/WS 宿主（createHttpServer）已随 Web 客户端一并移除。
 * 桌面端从不引用本包的根导出，远程后端一律走 `@zcode/server/remote` 子路径。
 */
export type { IRemoteBackend } from "./remote/index.js";
