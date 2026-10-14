#!/usr/bin/env node

import './src/polyfill.js';
import { runBenchmarks } from './src/benchmark/index.js';

runBenchmarks().then(() => {
  console.log('🏁 All Scrapi benchmark suites finished successfully.');
  process.exit(0);
}).catch(err => {
  console.error('❌ Benchmark execution failed:', err);
  process.exit(1);
});
