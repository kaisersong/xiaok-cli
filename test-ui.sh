#!/bin/bash

echo "=== 测试 xiaok UI ==="
echo ""

echo "1. 测试欢迎界面和空输入"
printf "\n\n\n" | timeout 2 xiaok 2>&1 | head -30

echo ""
echo "2. 测试正常输入和用户输入背景色"
printf "你好\n/exit\n" | timeout 3 xiaok 2>&1 | grep -A5 "你好"

echo ""
echo "3. 测试分隔线"
printf "test\n/exit\n" | timeout 3 xiaok 2>&1 | grep "─" | head -5

echo ""
echo "=== 测试完成 ==="
