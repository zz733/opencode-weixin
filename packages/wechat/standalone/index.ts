#!/usr/bin/env node
import { runBot } from './src/index.js';
runBot().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
