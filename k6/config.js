// K6 Configuration for different test scenarios

// Light load test - for CI/CD
export const lightLoad = {
  stages: [
    { duration: '5s', target: 2 }, // Ramp up to 2 users
    { duration: '15s', target: 2 }, // Stay at 2 users for 15s
    { duration: '5s', target: 0 }, // Ramp down to 0 users
  ],

  thresholds: {
    'http_req_duration{method:GET}': ['p(95)<300'],
    'http_req_duration{method:POST}': ['p(95)<450'],
    'http_req_duration{method:PATCH}': ['p(95)<450'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
};

// Normal load test - for regular benchmarking
export const normalLoad = {
  stages: [
    { duration: '10s', target: 5 }, // Ramp up to 5 users
    { duration: '30s', target: 5 }, // Stay at 5 users for 30s
    { duration: '10s', target: 10 }, // Ramp up to 10 users
    { duration: '30s', target: 10 }, // Stay at 10 users for 30s
    { duration: '10s', target: 0 }, // Ramp down to 0 users
  ],

  thresholds: {
    'http_req_duration{method:GET}': ['p(95)<300'],
    'http_req_duration{method:POST}': ['p(95)<450'],
    'http_req_duration{method:PATCH}': ['p(95)<450'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
};

// Stress test - for performance validation
export const stressTest = {
  stages: [
    { duration: '10s', target: 10 }, // Ramp up to 10 users
    { duration: '30s', target: 10 }, // Stay at 10 users for 30s
    { duration: '10s', target: 20 }, // Ramp up to 20 users
    { duration: '30s', target: 20 }, // Stay at 20 users for 30s
    { duration: '10s', target: 30 }, // Ramp up to 30 users
    { duration: '30s', target: 30 }, // Stay at 30 users for 30s
    { duration: '20s', target: 0 }, // Ramp down to 0 users
  ],

  thresholds: {
    'http_req_duration{method:GET}': ['p(95)<400'], // Slightly relaxed for stress test
    'http_req_duration{method:POST}': ['p(95)<600'],
    'http_req_duration{method:PATCH}': ['p(95)<600'],
    http_req_failed: ['rate<0.02'], // Allow up to 2% failure under stress
    errors: ['rate<0.02'],
  },
};

// Spike test - for sudden load testing
export const spikeTest = {
  stages: [
    { duration: '5s', target: 5 }, // Normal load
    { duration: '10s', target: 50 }, // Spike to 50 users
    { duration: '30s', target: 5 }, // Back to normal
    { duration: '5s', target: 0 }, // Ramp down
  ],

  thresholds: {
    'http_req_duration{method:GET}': ['p(95)<500'], // More relaxed for spike test
    'http_req_duration{method:POST}': ['p(95)<750'],
    'http_req_duration{method:PATCH}': ['p(95)<750'],
    http_req_failed: ['rate<0.05'], // Allow up to 5% failure during spike
    errors: ['rate<0.05'],
  },
};

// Soak test - for long-running stability
export const soakTest = {
  stages: [
    { duration: '10s', target: 5 }, // Ramp up
    { duration: '5m', target: 5 }, // Stay at 5 users for 5 minutes
    { duration: '10s', target: 0 }, // Ramp down
  ],

  thresholds: {
    'http_req_duration{method:GET}': ['p(95)<300'],
    'http_req_duration{method:POST}': ['p(95)<450'],
    'http_req_duration{method:PATCH}': ['p(95)<450'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
};
