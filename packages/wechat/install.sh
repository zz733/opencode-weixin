#!/usr/bin/env bash
# OpenCode 微信机器人本地安装脚本
set -e

echo "==================================="
echo "OpenCode 微信机器人安装"
echo "==================================="
echo

# 检查是否有 bun
if ! command -v bun &> /dev/null; then
    echo "错误：未找到 bun"
    echo "请先安装 bun：https://bun.sh/install"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 复制到 ~/.opencode-wechat
TARGET_DIR="$HOME/.opencode-wechat"
echo "正在复制到 $TARGET_DIR..."
mkdir -p "$TARGET_DIR"
cp -r "$SCRIPT_DIR/standalone/"* "$TARGET_DIR/"

# 安装依赖
cd "$TARGET_DIR"
echo "正在安装依赖..."
bun install

# 创建链接
echo "正在创建全局命令..."
if [ -d "$HOME/.local/bin" ]; then
    ln -sf "$TARGET_DIR/cli.mjs" "$HOME/.local/bin/opencode-wechat"
    echo "安装完成！您现在可以运行：opencode-wechat"
else
    echo "安装完成！您可以直接运行："
    echo "  cd $TARGET_DIR"
    echo "  ./cli.mjs"
    echo "或手动将 $TARGET_DIR 添加到 PATH"
fi

echo
echo "==================================="
echo "安装完成！"
echo "==================================="
