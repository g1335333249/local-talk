# Local Talk

Local Talk 是一个面向可信内网环境的网页版聊天工具。用户按访问 IP 自动识别，无需注册登录，支持私聊、群聊、文件、截图、图片预览、引用回复、转发、浏览器通知和 SQLite 持久化。

## 功能特性

- 按客户端 IP 自动创建用户
- 用户可设置昵称
- 在线用户列表
- 点对点私聊
- 默认内网群聊
- 选择指定在线用户创建自定义群聊
- 文字、文件、截图/图片发送
- 粘贴剪贴板图片直接发送
- 图片弹窗预览、缩放、保存
- 消息引用回复
- 消息转发到用户或群聊
- 文件消息下载按钮
- 浏览器通知、标签页标题闪烁和 favicon 红点
- SQLite 保存用户昵称、群聊、群成员和消息记录
- 消息默认保留 7 天并自动清理
- Docker / Docker Compose 部署

## 技术栈

- Node.js 24
- Express
- Socket.IO
- Multer
- SQLite via `node:sqlite`
- 原生 HTML/CSS/JavaScript

> `node:sqlite` 在 Node.js 24 中仍会显示 ExperimentalWarning，但当前项目已使用它避免引入额外原生 SQLite 依赖。

## 快速开始

### 本地运行

```bash
npm install
npm run dev
```

访问：

```text
http://localhost:3000
```

### 生产方式运行

```bash
npm install --omit=dev
npm start
```

默认监听：

```text
0.0.0.0:3000
```

## Docker

### 构建镜像

```bash
docker build -t local-talk:latest .
```

### 直接运行容器

```bash
docker run -d \
  --name local-talk \
  -p 3000:3000 \
  -e TRUST_PROXY=true \
  -e MESSAGE_RETENTION_DAYS=7 \
  -v "$PWD/uploads:/app/uploads" \
  -v "$PWD/data:/app/data" \
  local-talk:latest
```

访问：

```text
http://服务器内网IP:3000
```

### 使用 Docker Compose

```bash
docker compose up -d --build
```

停止：

```bash
docker compose down
```

查看日志：

```bash
docker compose logs -f
```

## 数据目录

运行时会使用两个本地目录：

```text
uploads/                  # 文件和截图本体
data/local-talk.sqlite    # SQLite 数据库
```

SQLite 保存：

- 用户昵称
- 自定义群聊
- 群成员
- 私聊消息
- 默认内网群消息
- 自定义群消息
- 文件/截图消息元数据

文件和截图本体保存在 `uploads/`。消息记录过期后不会再显示，但文件本体不会自动删除。

## 消息保留策略

默认消息保留 7 天。

可通过环境变量调整：

```bash
MESSAGE_RETENTION_DAYS=14 npm start
```

Docker Compose 中默认设置为：

```yaml
MESSAGE_RETENTION_DAYS=7
```

服务启动时会清理一次过期消息，运行期间每小时自动清理一次。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务监听端口 |
| `TRUST_PROXY` | `false` | 是否信任 `X-Forwarded-For` 读取真实客户端 IP |
| `MAX_UPLOAD_MB` | `200` | 单文件上传大小上限 |
| `MESSAGE_RETENTION_DAYS` | `7` | 消息保留天数 |

## 真实 IP 与反向代理

Local Talk 通过客户端 IP 区分用户。生产部署时建议使用 Linux 服务器或宿主机 Nginx 反向代理，并传递真实客户端 IP。

Nginx 示例：

```nginx
server {
    listen 80;
    server_name _;

    client_max_body_size 200m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

应用侧需要开启：

```bash
TRUST_PROXY=true
```

如果直接通过 Docker Desktop 的 `-p 3000:3000` 访问，容器内可能只能看到 Docker 网关 IP，无法区分真实用户。建议正式部署在 Linux 主机或通过宿主机 Nginx 反代。

## 注意事项

- 适合可信内网环境，不包含账号密码和访问控制。
- 在线状态仍在内存中，服务重启后会按重新连接情况计算。
- 自定义群聊、群成员和消息已持久化到 SQLite。
- 截图功能依赖浏览器 Screen Capture API，需要用户授权选择窗口或屏幕。
- 浏览器关闭页签的快捷键拦截受浏览器安全策略限制，项目已提供站内提示和 `beforeunload` 兜底确认。

## 开发

```bash
npm install
npm run dev
```

语法检查：

```bash
node --check src/server.js
node --check public/app.js
```

## License

Apache-2.0
