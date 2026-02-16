# 自建 Piston 代码执行服务

在线 IDE 的「运行」功能依赖 [Piston](https://github.com/engineer-man/piston) 执行代码。若公网 `emkc.org` 访问慢或超时，可在自己的服务器上部署 Piston，把本项目的 `piston.api-url` 指到自建地址。

---

## 一、在同一台服务器上部署 Piston（与面经助手同机）

### 1. 安装 Docker

若尚未安装（以 Ubuntu 为例）：

```bash
sudo apt update
sudo apt install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker
```

### 2. 启动 Piston 容器

该镜像在启动时会执行 `chown /piston`，**必须**存在 `/piston` 目录，且**不能是空目录**（否则要么启动报错重启，要么没有管理脚本）。正确做法是：在宿主机上先克隆完整仓库，再挂载该目录。

**第一步：删除旧容器（若存在）**

```bash
sudo docker rm -f piston_api 2>/dev/null || true
```

**第二步：在宿主机克隆 Piston 仓库，并清空 `packages` 供引擎使用**

克隆的是**源码仓库**，其中的 `packages/` 是源码目录（含 `.gitignore` 等），而运行时 Piston 期望 `packages/` 为**语言运行时安装目录**（其下为 java、python 等子目录）。若直接挂载整份克隆，会报 `ENOTDIR: not a directory, scandir '/piston/packages/.gitignore'`。因此克隆后要把源码里的 `packages` 删掉，改成空目录：

```bash
sudo rm -rf /opt/piston-data
sudo git clone https://github.com/engineer-man/piston /opt/piston-data

# 关键：删掉源码里的 packages，新建空 packages 供引擎放运行时
sudo rm -rf /opt/piston-data/packages
sudo mkdir -p /opt/piston-data/packages

# （CLI 依赖稍后在容器内安装，见下面「3 前」一步）
```

**第三步：用该目录挂载并启动**

```bash
sudo docker run \
  --privileged \
  -v /opt/piston-data:/piston \
  -dit \
  -p 2000:2000 \
  --name piston_api \
  --restart unless-stopped \
  ghcr.io/engineer-man/piston
```

- 此时容器内 `/piston` 即宿主机 `/opt/piston-data`，包含 `cli/`、`api/` 等，启动脚本的 chown 能执行，管理脚本也在。
- 端口 **2000** 对外提供 API。
- `--restart unless-stopped` 表示服务器重启后自动拉起。

**第四步：在容器内安装 CLI 的 Node 依赖（宿主机无 Node 时必做）**

在宿主机执行（用容器里的 Node，无需在服务器上装 npm）：

```bash
sudo docker exec -it piston_api sh -c "cd /piston/cli && npm install"
```

若报错或容器内没有 `npm`，再在宿主机安装 Node 后执行：`cd /opt/piston-data/cli && npm install`。

### 3. 在容器内安装语言（Java、Python、Go）

我们只删除了 **`packages`** 并新建了空目录，**没有动 `cli`**。CLI 在仓库根目录下，路径是 **`/piston/cli/index.js`**（不是 `/piston/repo/packages/cli/index.js`，源码仓库里没有后者）。在宿主机执行：

建议**去掉 `-it`** 执行，避免卡在交互或无进度输出时误以为卡死。安装 Java/Python 会下载运行时，可能需 2～5 分钟，请耐心等待：

```bash
# Java（无 -it，有输出且不会卡在 TTY）
sudo docker exec piston_api node /piston/cli/index.js ppman install java

# Python
sudo docker exec piston_api node /piston/cli/index.js ppman install python

# Go（可选）
sudo docker exec piston_api node /piston/cli/index.js ppman install go
```

若报错「找不到 `/piston/cli/index.js`」，先看容器内实际路径：

```bash
sudo docker exec piston_api ls /piston
sudo docker exec piston_api find /piston -name "index.js" 2>/dev/null
```

把上面命令里的路径换成你找到的即可。

**命令在哪执行？**  
`docker exec` 在**宿主机任意目录**下执行即可（例如 `root@xxx:~#`），不需要先 `cd` 到 `/opt/piston-data/cli`。命令会进到容器里跑，和当前宿主机的当前目录无关。

**安装语言下载很慢或失败（如 /piston/packages 只有几 MB）**

服务器在国内时，从国外 Piston 包源拉 Java 等会很慢或超时。可这样优化：

1. **先装体积小的语言**（成功率高）：  
   ```bash
   sudo docker exec piston_api node /piston/cli/index.js ppman install python
   ```
2. **Java 放后台长时间跑**（避免 SSH 断开导致中断）：  
   ```bash
   nohup sudo docker exec piston_api node /piston/cli/index.js ppman install java > /tmp/piston-java.log 2>&1 &
   tail -f /tmp/piston-java.log
   ```  
   装完再 `ls /piston/packages` 或 `du -sh /piston/packages` 看是否变大。
3. **有代理时让容器走代理**（需先在本机配好 HTTP 代理）：  
   启动容器时加 `-e HTTP_PROXY=http://代理:端口 -e HTTPS_PROXY=...`，再在容器内执行 ppman install。
4. **在海外/网络好的机器装好再拷回来**：在海外机或本机用同一镜像、同一挂载方式装好 Java，把该机上的 `packages` 目录打成 tar，拷到国内服务器 `/opt/piston-data/` 下解压，重启容器即可。
5. 若一直失败，检查容器内网络：  
   `sudo docker exec piston_api sh -c "curl -sI https://github.com | head -1"`

### 3.1 若日志报 ENOTDIR: scandir '/piston/packages/.gitignore'

说明挂载的是**完整源码仓库**，引擎把源码里的 `packages/.gitignore` 当成了目录。在宿主机执行（保留克隆，只把 `packages` 换成空目录）：

```bash
sudo docker rm -f piston_api
sudo rm -rf /opt/piston-data/packages
sudo mkdir -p /opt/piston-data/packages
```

再按「2. 启动 Piston 容器」第三步重新 `docker run` 即可。

### 3.2 若出现 chown: cannot access '/piston' 或容器反复重启

说明镜像需要 `/piston` 目录且不能为空。按「2. 启动 Piston 容器」完整做一遍（克隆后记得删掉 `packages` 并新建空 `packages`）。

### 4. 本项目中配置自建地址

在**部署面经助手的环境**里修改配置（二选一）：

- **环境变量**（例如 `/opt/interview-assistant.env`）：
  ```bash
  PISTON_API_URL=http://127.0.0.1:2000/api/v2
  ```
- **或**在 `application.yml` 中写：
  ```yaml
  piston:
    api-url: http://127.0.0.1:2000/api/v2
    timeout-seconds: 30
  ```

注意：自建 Piston 的 API 路径是 **`/api/v2`**（没有 `/piston`），与公网 `emkc.org` 不同。

### 5. 重启面经助手

```bash
sudo systemctl restart interview-assistant
```

---

### 6. 修改代码后如何重新打包并让在线 IDE 正常运行

若你改动了**前端**（如 `frontend/src`）或**后端**代码，需要重新打包、上传并在服务器上重启，在线 IDE 才会用上新版本。推荐按下面顺序做。

**① 本地打包（前端会打进同一个 jar）**

在项目根目录执行：

```bash
./scripts/deploy.sh
```

该脚本会：安装前端依赖 → 构建前端（生成 `frontend/dist`）→ Maven 打包（把 `frontend/dist` 拷进 jar）。完成后会输出生成的 jar 路径，例如：`target/interview-assistant-1.0.0.jar`。

若没有 `deploy.sh` 权限，可手动执行：

```bash
cd frontend && npm ci --prefer-offline 2>/dev/null || npm install && npm run build && cd ..
mvn -q package -DskipTests
```

**② 上传到服务器**

把生成的 jar 传到服务器（替换为你自己的 IP 和 jar 名）：

```bash
scp target/interview-assistant-1.0.0.jar root@你的公网IP:/opt/
```

**③ 服务器上：保证 Piston 在跑**

```bash
ssh root@你的公网IP
docker ps | grep piston_api   # 若无输出说明未运行，需先按本文「一、在同一台服务器上部署 Piston」启动
curl -s http://127.0.0.1:2000/api/v2/runtimes  # 应返回 JSON，否则检查端口与容器
```

**④ 服务器上：确认环境变量并重启面经助手**

若用 systemd + 环境变量文件（推荐）：

```bash
# 确保有 Piston 地址
grep PISTON_API_URL /opt/interview-assistant.env
# 应为：PISTON_API_URL=http://127.0.0.1:2000/api/v2

sudo systemctl restart interview-assistant
sudo systemctl status interview-assistant   # 确认为 active (running)
```

若没用 systemd，而是用 `nohup java -jar ...`，需先停止旧进程，再在**同一会话**中导出环境变量后启动，例如：

```bash
export PISTON_API_URL=http://127.0.0.1:2000/api/v2
nohup java -jar /opt/interview-assistant-1.0.0.jar --server.port=8080 > /opt/app.log 2>&1 &
```

**⑤ 验证**

浏览器打开 `http://你的公网IP:8080`（或你的域名），进入在线 IDE，选一道题点「运行」。若仍报错，按文档末尾「常见问题」里「执行失败: Failed to fetch」一行排查（看 Piston 与后端日志）。

---

## 二、Piston 部署在另一台机器上

若 Piston 跑在另一台服务器（例如 `192.168.1.100`）：

1. 在那台机器上按上面步骤安装 Docker 并启动 Piston，保证端口 2000 已开放。
2. 在运行面经助手的机器上，将 `piston.api-url` 改为 Piston 的地址，例如：
   - `http://192.168.1.100:2000/api/v2`
3. 若跨公网，需保证面经助手所在服务器能访问 `Piston机器IP:2000`，并注意防火墙/安全组放行 2000 端口。

---

### 其他做法（可选）

**做法 A：精准清理（只删 packages 下的文件，保留子目录）**  
若你不想删掉整个 `packages` 目录，可以只删其中的**文件**（如 `.gitignore`），保留子目录。在宿主机执行：

```bash
sudo docker rm -f piston_api
sudo find /opt/piston-data/packages -maxdepth 1 -type f -delete
```

然后重新 `docker run`（同上）。安装语言时仍用 **`/piston/cli/index.js`**，不要用 `/piston/repo/packages/cli/index.js`（该路径在标准克隆里不存在）。

**做法 B：命名卷（让 Docker 自动初始化 /piston）**  
若希望不依赖宿主机克隆，可用 Docker 命名卷。部分镜像会在首次挂载时初始化卷内容，可先试：

```bash
sudo docker rm -f piston_api
sudo docker run --privileged -v piston_data:/piston -dit -p 2000:2000 --name piston_api --restart unless-stopped ghcr.io/engineer-man/piston
```

若容器能稳定运行（`docker logs piston_api` 无 chown/ENOTDIR），再在容器内找 CLI 路径并安装语言，例如：

```bash
sudo docker exec -it piston_api find /piston -name "index.js" 2>/dev/null
# 若镜像提供 piston 命令，也可试：
sudo docker exec -it piston_api piston install java
```

若命名卷下容器仍报错或找不到脚本，则继续用本文「克隆 + 清空 packages」的方式。

---

## 三、验证自建 Piston 是否可用

在面经助手所在服务器上执行：

```bash
curl -s http://127.0.0.1:2000/api/v2/runtimes | head -100
```

若返回一列 JSON（语言与版本），说明 API 正常。再在网页「在线 IDE」里运行一段简单代码（如 Python `print(1)`）确认执行正常。

---

## 四、常见问题

| 问题 | 处理 |
|------|------|
| 运行报 "runtime unknown" | 该语言未安装，用上面「3. 在容器内安装语言」里的 `docker exec ... ppman install <语言>` 安装。 |
| 安装语言时卡住、无输出 | 先按 Ctrl+C 退出。去掉 `-it` 再试：`sudo docker exec piston_api node /piston/cli/index.js ppman install java`。安装会下载运行时，可能需 2～5 分钟。 |
| /piston/packages 只有几 MB、Java 未装好 | 多半下载未完成或失败（国内访问外网包源慢/超时）。见下「安装语言下载很慢或失败」。 |
| Cannot find module 'nocamel'（安装语言时） | CLI 的 Node 依赖未安装。在宿主机执行：`sudo docker exec -it piston_api sh -c "cd /piston/cli && npm install"`（用容器里的 Node），再执行 ppman install。若宿主机有 Node，也可 `cd /opt/piston-data/cli && npm install`。 |
| ENOTDIR: scandir '/piston/packages/.gitignore' | 挂载的是完整源码，引擎误扫了源码里的 packages。见「3.1」：删掉 `packages` 并 `mkdir` 空目录后重启容器。 |
| 日志反复 chown: cannot access '/piston'、容器不断重启 | 镜像需要 /piston 存在且非空。用「2. 启动 Piston 容器」：先 `git clone`，清空 `packages` 再挂载。 |
| 安装语言时报错 /piston 为空 | 用了 `-v 空目录:/piston`。改为先 `git clone` 到该目录再挂载，见「2. 启动 Piston 容器」。 |
| 端口 EADDRINUSE (2000) | 已有容器占用了 2000 端口，先 `docker rm -f piston_api` 再重新启动，不要重复起两个容器。 |
| 连接超时 | 检查 Piston 容器是否在跑（`docker ps`）、端口 2000 是否监听、本机或防火墙是否放行。 |
| 与公网地址区别 | 公网为 `https://emkc.org/api/v2/piston`，自建为 `http://你的地址:2000/api/v2`（无 `/piston`）。 |
| 运行代码报「Host is not specified」 | 说明 Piston 地址未生效。检查 `/opt/interview-assistant.env` 是否有 `PISTON_API_URL=http://127.0.0.1:2000/api/v2`，保存后执行 `sudo systemctl restart interview-assistant`。 |
| 运行代码报「执行失败: Failed to fetch」 | 浏览器未收到后端响应（多为请求超时或网络异常）。**先确认**：① Piston 容器在运行且 2000 端口可访问：`curl -s http://127.0.0.1:2000/api/v2/runtimes`；② 面经助手已重启并加载环境变量：`sudo systemctl restart interview-assistant`。若 Piston 未启动，后端会长时间等待再报错，易导致前端超时出现 "Failed to fetch"。再查后端日志：`journalctl -u interview-assistant -n 50`，看是否有连接 Piston 失败、连接被拒绝等。若走 Nginx 反向代理，确认 `proxy_read_timeout` 足够（建议 ≥60s）。 |

---

## 五、参考

- Piston 官方仓库：<https://github.com/engineer-man/piston>
- API 说明：<https://piston.readthedocs.io/en/latest/api-v2/>
