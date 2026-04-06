# RG CLI

这是一个基于 `Bun + Ink + React` 的终端交互式 CLI。

## 本地开发

安装依赖：

```bash
bun install
```

开发运行：

```bash
bun run dev
```

## 异常输出测试

如果你想验证 CLI 的顶层异常捕获和统一错误输出，可以执行：

```bash
bun run src/index.ts --crash-test
```

如果你想验证打包后的正式 CLI，也可以执行：

```bash
node ./dist/cli.cjs --crash-test
```

## 构建可分发 CLI

执行下面命令会生成可给 Node 运行的 CLI 文件：

```bash
bun run build
```

产物位于：

```bash
dist/cli.cjs
```

## 方案一：私有分发到你的所有设备

这个方案最稳，不需要占用公网 npm 包名。

在打包机器上执行：

```bash
npm pack
```

会生成类似下面的文件：

```bash
rg_cli-0.1.0.tgz
```

把这个 `.tgz` 文件拷到其他设备后，在每台设备上执行：

```bash
npm install -g ./rg_cli-0.1.0.tgz
```

安装完成后即可直接运行：

```bash
rg-cli
rg-cli --help
rg-cli --version
```

要求：

- 目标设备安装了 Node.js 20 或更高版本
- 目标设备不需要安装 Bun

## 方案二：发布到 npm，所有设备直接安装

如果你希望任何设备都能通过网络直接安装：

1. 把 `package.json` 里的 `private` 改成 `false`
2. 把 `name` 改成一个 npm 上可用的唯一包名
3. 登录 npm：

```bash
npm login
```

4. 发布：

```bash
npm publish
```

之后其他设备可以直接安装：

```bash
npm install -g <your-package-name>
```

或者免安装直接运行：

```bash
npx <your-package-name>
```

## 为什么推荐这样部署

因为这个项目是 CLI，不是 Web 服务，所以最适合的“部署”方式不是上服务器，而是做成一个可安装命令。

- 你自己多设备使用：优先用 `.tgz` 私有分发
- 想给别人也用：发布 npm
- 想做真正免 Node 的安装包：再额外做 Windows、macOS、Linux 三套可执行文件
