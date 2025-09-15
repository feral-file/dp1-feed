#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

// Configuration
const DEFAULT_BASE_URL = 'https://dp1-feed-operator-api-dev.autonomy-system.workers.dev';
const RESULTS_DIR = 'k6-results';

class K6BenchmarkRunner {
  constructor(baseUrl = DEFAULT_BASE_URL, testType = 'light', asyncResponse = false) {
    this.baseUrl = baseUrl;
    this.testType = testType;
    this.asyncResponse = asyncResponse;
    this.timestamp = new Date().toISOString();
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(RESULTS_DIR, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  async runK6Test() {
    console.log(chalk.bold.green(`\n🚀 Starting K6 Performance Tests`));
    console.log(chalk.gray(`Target URL: ${this.baseUrl}`));
    console.log(chalk.gray(`Test Type: ${this.testType}`));
    console.log(chalk.gray(`Async response: ${this.asyncResponse}`));
    console.log(chalk.gray(`Timestamp: ${this.timestamp}`));

    await this.ensureDirectories();

    const outputFile = path.join(RESULTS_DIR, `results-${Date.now()}.json`);
    const htmlReport = path.join(RESULTS_DIR, `report-${Date.now()}.html`);

    try {
      // Check if K6 is installed
      try {
        execSync('k6 version', { stdio: 'pipe' });
      } catch (error) {
        console.log(chalk.red('\n❌ K6 is not installed!'));
        console.log(chalk.yellow('\nInstall K6:'));
        console.log(chalk.blue('  macOS: brew install k6'));
        console.log(
          chalk.blue(
            '  Linux: sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69'
          )
        );
        console.log(
          chalk.blue(
            '         echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list'
          )
        );
        console.log(chalk.blue('         sudo apt-get update && sudo apt-get install k6'));
        console.log(chalk.blue('  Windows: choco install k6'));
        console.log(
          chalk.blue('\nOr download from: https://k6.io/docs/getting-started/installation/')
        );
        process.exit(1);
      }

      // Prepare K6 command
      const k6Command = [
        'k6 run',
        `--out json=${outputFile}`,
        `--summary-export=${path.join(RESULTS_DIR, 'summary.json')}`,
        '--summary-trend-stats="min,avg,med,max,p(90),p(95),p(99)"',
        this.getConfigOption(),
        `k6/api-benchmark.js`,
      ].join(' ');

      // Set environment variables
      const env = {
        ...process.env,
        BASE_URL: this.baseUrl,
        K6_WEB_DASHBOARD: 'true',
        K6_WEB_DASHBOARD_EXPORT: htmlReport,
        ASYNC_RESPONSE: this.asyncResponse,
      };

      console.log(chalk.blue('\n🔄 Running K6 tests...'));
      console.log(chalk.gray(`Command: ${k6Command}`));

      // Run K6 test
      const result = execSync(k6Command, {
        stdio: 'inherit',
        env,
        cwd: process.cwd(),
      });

      console.log(chalk.green('\n✅ K6 tests completed successfully!'));

      // Process results
      await this.processResults(outputFile);

      return true;
    } catch (error) {
      console.error(chalk.red('\n❌ K6 tests failed!'));
      console.error(chalk.red(`Error: ${error.message}`));

      // Try to process partial results
      if (await this.fileExists(outputFile)) {
        console.log(chalk.yellow('\n⚠️  Processing partial results...'));
        await this.processResults(outputFile);
      }

      return false;
    }
  }

  getConfigOption() {
    const configMap = {
      light: '--env TEST_TYPE=light',
      normal: '--env TEST_TYPE=normal',
      stress: '--env TEST_TYPE=stress',
      spike: '--env TEST_TYPE=spike',
      soak: '--env TEST_TYPE=soak',
    };

    return configMap[this.testType] || configMap['light'];
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async processResults(outputFile) {
    try {
      console.log(chalk.blue('\n📊 Processing K6 results...'));

      const summaryFile = path.join(RESULTS_DIR, 'summary.json');
      let summary = null;

      if (await this.fileExists(summaryFile)) {
        const summaryData = await fs.readFile(summaryFile, 'utf-8');
        summary = JSON.parse(summaryData);
      }

      const report = await this.generateMarkdownReport(summary);
      await fs.writeFile('benchmark-report.md', report);
    } catch (error) {
      console.error(chalk.red(`Error processing results: ${error.message}`));
    }
  }

  async generateMarkdownReport(summary) {
    const timestamp = new Date(this.timestamp).toLocaleString();

    let report = `# API Performance Benchmark Report (K6)\n\n`;
    report += `**Generated:** ${timestamp}  \n`;
    report += `**Tool:** K6 Performance Testing  \n`;
    report += `**Target URL:** \`${this.baseUrl}\`  \n`;
    report += `**Test Type:** ${this.testType}  \n`;
    report += `**Performance Thresholds:** GET ≤ 200ms, POST/PUT ≤ 800ms (P95), Success Rate ≥ 95%  \n\n`;

    if (!summary) {
      report += `## Summary\n\n`;
      report += `⚠️ **Test results summary not available**\n\n`;
      report += `The K6 test may have encountered issues. Check the console output for details.\n\n`;
      return report;
    }

    // Extract key metrics
    const metrics = summary.metrics || {};
    const httpReqDuration = metrics.http_req_duration || {};
    const httpReqFailed = metrics.http_req_failed || {};
    const checks = metrics.checks || {};

    const p95Duration = httpReqDuration.values?.['p(95)'] || 0;
    const avgDuration = httpReqDuration.values?.avg || 0;
    const failureRate = httpReqFailed.values?.rate || 0;
    const checksRate = checks.values?.rate || 0;

    // Determine overall pass/fail
    const p95Threshold = this.testType === 'stress' ? 300 : this.testType === 'spike' ? 300 : 200;
    const failureThreshold =
      this.testType === 'stress' ? 0.1 : this.testType === 'spike' ? 0.15 : 0.05;

    const p95Pass = p95Duration <= p95Threshold;
    const successRatePass = failureRate <= failureThreshold;
    const checksPass = checksRate >= 0.95;
    const overallPass = p95Pass && successRatePass && checksPass;

    // Generate badges
    const overallBadge = overallPass
      ? '![K6 Benchmark](https://img.shields.io/badge/K6%20benchmark-passing-brightgreen)'
      : '![K6 Benchmark](https://img.shields.io/badge/K6%20benchmark-failing-red)';

    const p95Badge =
      p95Duration <= 200
        ? `![P95 Response Time](https://img.shields.io/badge/P95-${Math.round(p95Duration)}ms-brightgreen)`
        : p95Duration <= 300
          ? `![P95 Response Time](https://img.shields.io/badge/P95-${Math.round(p95Duration)}ms-yellow)`
          : `![P95 Response Time](https://img.shields.io/badge/P95-${Math.round(p95Duration)}ms-red)`;

    report += `## Summary\n\n`;
    report += `${overallBadge} ${p95Badge}\n\n`;
    report += `- **Overall Status:** ${overallPass ? '✅ PASS' : '❌ FAIL'}\n`;
    report += `- **P95 Response Time:** ${Math.round(p95Duration)}ms (threshold: ≤${p95Threshold}ms)\n`;
    report += `- **Average Response Time:** ${Math.round(avgDuration)}ms\n`;
    report += `- **Success Rate:** ${Math.round((1 - failureRate) * 100)}% (threshold: ≥${Math.round((1 - failureThreshold) * 100)}%)\n`;
    report += `- **Checks Passed:** ${Math.round(checksRate * 100)}%\n\n`;

    // Detailed metrics table
    report += `## Detailed Metrics\n\n`;
    report += `| Metric | Value | Status |\n`;
    report += `|--------|-------|--------|\n`;

    if (httpReqDuration.values) {
      const values = httpReqDuration.values;
      report += `| Min Response Time | ${Math.round(values.min || 0)}ms | ℹ️ |\n`;
      report += `| Avg Response Time | ${Math.round(values.avg || 0)}ms | ℹ️ |\n`;
      report += `| P90 Response Time | ${Math.round(values['p(90)'] || 0)}ms | ℹ️ |\n`;
      report += `| P95 Response Time | ${Math.round(values['p(95)'] || 0)}ms | ${p95Pass ? '✅' : '❌'} |\n`;
      report += `| P99 Response Time | ${Math.round(values['p(99)'] || 0)}ms | ℹ️ |\n`;
      report += `| Max Response Time | ${Math.round(values.max || 0)}ms | ℹ️ |\n`;
    }

    report += `| HTTP Request Failed Rate | ${Math.round(failureRate * 100)}% | ${successRatePass ? '✅' : '❌'} |\n`;
    report += `| Checks Passed Rate | ${Math.round(checksRate * 100)}% | ${checksPass ? '✅' : '❌'} |\n`;

    // HTTP method breakdown if available
    const getReqs = metrics['http_req_duration{method:GET}'];
    const postReqs = metrics['http_req_duration{method:POST}'];
    const patchReqs = metrics['http_req_duration{method:PATCH}'];

    if (getReqs || postReqs || patchReqs) {
      report += `\n## HTTP Method Breakdown\n\n`;
      report += `| Method | P95 (ms) | Avg (ms) | Count | Status |\n`;
      report += `|--------|----------|----------|-------|--------|\n`;

      if (getReqs?.values) {
        const p95 = Math.round(getReqs.values['p(95)'] || 0);
        const avg = Math.round(getReqs.values.avg || 0);
        const count = getReqs.values.count || 0;
        const pass = p95 <= 200;
        report += `| GET | ${p95}ms | ${avg}ms | ${count} | ${pass ? '✅' : '❌'} |\n`;
      }

      if (postReqs?.values) {
        const p95 = Math.round(postReqs.values['p(95)'] || 0);
        const avg = Math.round(postReqs.values.avg || 0);
        const count = postReqs.values.count || 0;
        const pass = p95 <= 800;
        report += `| POST | ${p95}ms | ${avg}ms | ${count} | ${pass ? '✅' : '❌'} |\n`;
      }

      if (patchReqs?.values) {
        const p95 = Math.round(patchReqs.values['p(95)'] || 0);
        const avg = Math.round(patchReqs.values.avg || 0);
        const count = patchReqs.values.count || 0;
        const pass = p95 <= 800;
        report += `| PATCH | ${p95}ms | ${avg}ms | ${count} | ${pass ? '✅' : '❌'} |\n`;
      }
    }

    report += `\n## Test Configuration\n\n`;
    report += `- **Test Type:** ${this.testType}\n`;
    report += `- **Tool:** K6 Performance Testing\n`;
    report += `- **Target URL:** ${this.baseUrl}\n`;
    report += `- **Timestamp:** ${timestamp}\n\n`;

    report += `## Performance Criteria\n\n`;
    report += `- **GET requests:** P95 ≤ 200ms\n`;
    report += `- **POST/PUT/PATCH/DELETE requests:** P95 ≤ 800ms\n`;
    report += `- **Success rate:** ≥ 95%\n`;
    report += `- **Check success rate:** ≥ 95%\n\n`;

    report += `---\n*Report generated by K6 Performance Testing Tool*\n`;

    return report;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const baseUrl = args.find(arg => arg.startsWith('http')) || DEFAULT_BASE_URL;
  const testType =
    args.find(arg => ['light', 'normal', 'stress', 'spike', 'soak'].includes(arg)) || 'light';
  const reportOnly = args.includes('--report');
  const asyncResponse = args.includes('--async');

  const runner = new K6BenchmarkRunner(baseUrl, testType, asyncResponse);

  try {
    if (reportOnly) {
      console.log(chalk.yellow('📄 Report-only mode: Generating report from existing results...'));
      const summaryFile = path.join(RESULTS_DIR, 'summary.json');
      if (await runner.fileExists(summaryFile)) {
        const summaryData = await fs.readFile(summaryFile, 'utf-8');
        const summary = JSON.parse(summaryData);
        await runner.processResults(null);
      } else {
        console.log(chalk.red('❌ No existing results found. Run tests first.'));
        process.exit(1);
      }
    } else {
      const success = await runner.runK6Test();
      if (!success) {
        process.exit(1);
      }
    }

    console.log(chalk.bold.green('\n🎉 K6 Benchmark complete!'));
  } catch (error) {
    console.error(chalk.red(`\n❌ K6 Benchmark failed: ${error.message}`));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
