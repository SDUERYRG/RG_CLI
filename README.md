# RG CLI

这是一个基于 `Bun + Ink + React` 的终端交互式 CLI。

## 环境要求

- Node.js `>= 20`
- Bun `>= 1.x`

## 本地开发

安装依赖：

```bash
bun install
```

启动开发模式：

```bash
bun run dev
```

## 测试

运行测试：

```bash
bun test
```

## 构建

构建 CLI：

```bash
bun run build
```

构建产物：

```bash
dist/cli.cjs
```

## 运行

配置文件位于（settings.json.origin为示例配置）：

```
%USERPROFILE%/.rg-cli/settings.json
```

开发环境运行：

```bash
bun run dev
```

构建后运行：

```bash
node ./dist/cli.cjs
```
