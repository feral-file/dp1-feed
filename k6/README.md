# K6 Performance Tests

This directory contains K6 performance test scripts for the DP-1 Feed Operator API.

## Files

- `api-benchmark.js` - Main K6 test script with comprehensive API testing
- `config.js` - Test configuration for different scenarios (light, normal, stress, spike, soak)
- `README.md` - This documentation file

## Test Scenarios

### Light Load (`light`)

- **Duration**: 25 seconds
- **Users**: 2 concurrent users
- **Purpose**: CI/CD pipeline testing
- **Thresholds**: Standard (GET ≤300ms, POST/PUT ≤450ms, 99% success)

### Normal Load (`normal`)

- **Duration**: 90 seconds
- **Users**: 5-10 concurrent users (ramp up)
- **Purpose**: Regular performance validation
- **Thresholds**: Standard (GET ≤300ms, POST/PUT ≤450ms, 99% success)

### Stress Test (`stress`)

- **Duration**: 140 seconds
- **Users**: 10-30 concurrent users (gradual ramp up)
- **Purpose**: High load performance testing
- **Thresholds**: Relaxed (GET ≤400ms, POST/PUT ≤600ms, 98% success)

### Spike Test (`spike`)

- **Duration**: 50 seconds
- **Users**: 5 → 50 → 5 users (sudden spike)
- **Purpose**: Testing sudden load resilience
- **Thresholds**: Very relaxed (GET ≤500ms, POST/PUT ≤750ms, 95% success)

### Soak Test (`soak`)

- **Duration**: 5 minutes 20 seconds
- **Users**: 5 concurrent users (constant)
- **Purpose**: Long-running stability testing
- **Thresholds**: Standard (GET ≤300ms, POST/PUT ≤450ms, 99% success)

## Running Tests

### Prerequisites

1. Install K6:

   ```bash
   # macOS
   brew install k6

   # Linux
   sudo apt-get install k6

   # Windows
   choco install k6
   ```

2. Set environment variables (optional):
   ```bash
   export BASE_URL="https://your-api.workers.dev"
   export API_SECRET="your-api-secret"  # For write operations
   ```

### Direct K6 Execution

```bash
# Run with default (normal) configuration
k6 run k6/api-benchmark.js

# Run specific test type
k6 run --env TEST_TYPE=light k6/api-benchmark.js
k6 run --env TEST_TYPE=stress k6/api-benchmark.js

# Run with custom URL
k6 run --env BASE_URL=https://your-api.workers.dev k6/api-benchmark.js

# Output results to JSON
k6 run --out json=results.json k6/api-benchmark.js

# Generate HTML report
k6 run --out web-dashboard=report.html k6/api-benchmark.js
```

### Via NPM Scripts (Recommended)

```bash
# Run standard test
npm run benchmark

# Run specific test types
npm run benchmark:light
npm run benchmark:stress
npm run benchmark:spike
npm run benchmark:soak

# Custom URL and test type
npm run benchmark https://your-api.workers.dev stress
```

## Test Coverage

The K6 tests cover all API endpoints:

### Static Endpoints

- `GET /api/v1` - API information
- `GET /api/v1/health` - Health check
- `GET /api/v1/playlists` - List playlists
- `GET /api/v1/channels` - List channels
- `GET /api/v1/playlist-items` - List playlist items

### CRUD Operations (with Authentication)

- `POST /api/v1/playlists` - Create playlist (async processing)
- `GET /api/v1/playlists/:id` - Get playlist by ID
- `PUT /api/v1/playlists/:id` - Update playlist (async processing)

- `POST /api/v1/channels` - Create channel (async processing)
- `GET /api/v1/channels/:id` - Get channel by ID
- `PUT /api/v1/channels/:id` - Update channel (async processing)

- `GET /api/v1/playlist-items/:id` - Get playlist item by ID

### Smart Data Management

- **Setup Phase**: Fetches existing playlists and creates additional ones if needed
- **Real Data**: Uses actual playlist URLs for channel creation
- **Data Reuse**: Cycles through created resources for realistic testing
- **Authentication**: Automatically adds Bearer token for write operations
- **Async Processing**: Tests reflect the new async queue-based write operations

## Metrics and Thresholds

### Built-in K6 Metrics

- `http_req_duration` - HTTP request duration
- `http_req_failed` - HTTP request failure rate
- `http_reqs` - Total HTTP requests
- `vus` - Virtual users
- `vus_max` - Maximum virtual users

### Custom Metrics

- `errors` - Custom error rate tracking
- `setup_duration` - Time taken for test setup

### Thresholds by Test Type

Each test type has appropriate thresholds:

- **Performance**: P95 response times
- **Reliability**: Success rates
- **Method-specific**: Different limits for GET vs POST/PUT

## Output and Reporting

### Console Output

- Real-time test progress
- Pass/fail status for each check
- Summary statistics

### Files Generated

- `k6-results/results-{timestamp}.json` - Raw K6 metrics
- `k6-results/summary.json` - Test summary
- `benchmark-report.md` - Markdown report with badges
- README badge updates

### Key Metrics Reported

- P90, P95, P99 response times
- Success rates by HTTP method
- Error analysis
- Performance vs. threshold compliance
- Test configuration details

## Integration

### CI/CD

The tests integrate with GitHub Actions:

- Automatic daily runs
- PR performance validation
- Results uploaded as artifacts
- Badge updates on main branch

### Local Development

```bash
# Quick validation
npm run benchmark:light

# Full performance test
npm run benchmark

# Stress testing before deployment
npm run benchmark:stress
```

## Troubleshooting

### Common Issues

1. **K6 not found**: Install K6 using the instructions above
2. **Authentication errors**: Set `API_SECRET` environment variable
3. **Network timeouts**: Check target URL accessibility
4. **Threshold failures**: Review API performance and adjust if needed

### Debug Mode

```bash
# Verbose output
k6 run --verbose k6/api-benchmark.js

# Debug with small load
k6 run --env TEST_TYPE=light --vus 1 --duration 10s k6/api-benchmark.js
```
