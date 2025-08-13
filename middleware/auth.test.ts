import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  authMiddleware,
  corsMiddleware,
  errorMiddleware,
  loggingMiddleware,
  validateJsonMiddleware,
} from './auth';
import { createTestEnv } from '../test-helpers';

describe('authMiddleware', () => {
  let mockContext: any;
  let mockNext: any;
  let testEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    testEnv = createTestEnv();

    mockContext = {
      req: {
        method: 'GET',
        header: vi.fn(),
      },
      var: {
        env: testEnv.env,
      },
      res: undefined,
    };

    mockNext = vi.fn().mockResolvedValue(undefined);
  });

  describe('read operations (GET, HEAD, OPTIONS)', () => {
    it('should allow GET requests without authentication', async () => {
      // Arrange
      mockContext.req.method = 'GET';

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.res).toBeUndefined();
    });

    it('should allow HEAD requests without authentication', async () => {
      // Arrange
      mockContext.req.method = 'HEAD';

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.res).toBeUndefined();
    });

    it('should allow OPTIONS requests without authentication', async () => {
      // Arrange
      mockContext.req.method = 'OPTIONS';

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.res).toBeUndefined();
    });
  });

  describe('write operations (POST, PUT, PATCH, DELETE)', () => {
    it('should require Authorization header for POST requests', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue(undefined);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);

      const response = mockContext.res as Response;
      expect(response.status).toBe(401);

      const responseBody = await response.json();
      expect(responseBody).toEqual({
        error: 'unauthorized',
        message: 'Authorization header is required for write operations',
      });
    });

    it('should require Authorization header for PUT requests', async () => {
      // Arrange
      mockContext.req.method = 'PUT';
      mockContext.req.header.mockReturnValue(undefined);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);
    });

    it('should require Authorization header for PATCH requests', async () => {
      // Arrange
      mockContext.req.method = 'PATCH';
      mockContext.req.header.mockReturnValue(undefined);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);
    });

    it('should require Authorization header for DELETE requests', async () => {
      // Arrange
      mockContext.req.method = 'DELETE';
      mockContext.req.header.mockReturnValue(undefined);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);
    });

    it('should return 500 when API_SECRET is not configured', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue('Bearer valid-token');
      mockContext.var.env.API_SECRET = undefined;

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);

      const response = mockContext.res as Response;
      expect(response.status).toBe(500);

      const responseBody = await response.json();
      expect(responseBody).toEqual({
        error: 'server_error',
        message: 'Server configuration error',
      });
    });

    it('should reject invalid Bearer token', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue('Bearer invalid-token');

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);

      const response = mockContext.res as Response;
      expect(response.status).toBe(401);

      const responseBody = await response.json();
      expect(responseBody).toEqual({
        error: 'unauthorized',
        message: 'Invalid API key',
      });
    });

    it('should accept valid Bearer token', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue('Bearer test-secret-key');

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.res).toBeUndefined();
    });

    it('should handle Bearer token with extra whitespace', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue('Bearer   test-secret-key  ');

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);
    });

    it('should reject non-Bearer authorization header', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue('Basic dGVzdDp0ZXN0');

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);
    });
  });
});

describe('corsMiddleware', () => {
  let mockContext: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      req: {
        method: 'GET',
      },
      header: vi.fn(),
      res: undefined,
    };

    mockNext = vi.fn().mockResolvedValue(undefined);
  });

  it('should handle preflight OPTIONS requests', async () => {
    // Arrange
    mockContext.req.method = 'OPTIONS';

    // Act
    await corsMiddleware(mockContext, mockNext);

    // Assert
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.res).toBeInstanceOf(Response);
    expect((mockContext.res as Response).status).toBe(204);

    expect(mockContext.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(mockContext.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type'
    );
    expect(mockContext.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    expect(mockContext.header).toHaveBeenCalledWith('Access-Control-Max-Age', '86400');
  });

  it('should add CORS headers to regular requests', async () => {
    // Arrange
    mockContext.req.method = 'GET';

    // Act
    await corsMiddleware(mockContext, mockNext);

    // Assert
    expect(mockNext).toHaveBeenCalledOnce();

    expect(mockContext.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(mockContext.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type'
    );
    expect(mockContext.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
  });
});

describe('errorMiddleware', () => {
  let mockContext: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      finalized: false,
      json: vi.fn(),
    };

    mockNext = vi.fn();
  });

  it('should call next middleware when no error occurs', async () => {
    // Arrange
    mockNext.mockResolvedValue(undefined);

    // Act
    await errorMiddleware(mockContext, mockNext);

    // Assert
    expect(mockNext).toHaveBeenCalledOnce();
    expect(mockContext.json).not.toHaveBeenCalled();
  });

  it('should handle errors and return 500 response', async () => {
    // Arrange
    const testError = new Error('Test error');
    mockNext.mockRejectedValue(testError);

    // Act
    await errorMiddleware(mockContext, mockNext);

    // Assert
    expect(mockNext).toHaveBeenCalledOnce();
    expect(mockContext.json).toHaveBeenCalledWith(
      {
        error: 'internal_error',
        message: 'An unexpected error occurred',
      },
      500
    );
  });

  it('should not send response if already finalized', async () => {
    // Arrange
    const testError = new Error('Test error');
    mockNext.mockRejectedValue(testError);
    mockContext.finalized = true;

    // Act
    await errorMiddleware(mockContext, mockNext);

    // Assert
    expect(mockNext).toHaveBeenCalledOnce();
    expect(mockContext.json).not.toHaveBeenCalled();
  });
});

describe('loggingMiddleware', () => {
  let mockContext: any;
  let mockNext: any;
  let consoleSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mockContext = {
      req: {
        method: 'GET',
        path: '/test',
        header: vi.fn(),
      },
      set: vi.fn(),
      header: vi.fn(),
      res: {
        status: 200,
        headers: {
          get: vi.fn().mockReturnValue('100'),
        },
      },
    };

    mockNext = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should log request start and completion', async () => {
    // Arrange
    mockContext.req.header
      .mockReturnValueOnce('test-user-agent') // User-Agent
      .mockReturnValueOnce('192.168.1.1'); // CF-Connecting-IP

    // Act
    await loggingMiddleware(mockContext, mockNext);

    // Assert
    expect(mockNext).toHaveBeenCalledOnce();
    expect(mockContext.set).toHaveBeenCalledWith('requestId', expect.any(String));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"type":"request_start"'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"type":"request_complete"'));
  });

  it('should handle request errors', async () => {
    // Arrange
    const testError = new Error('Test error');
    mockNext.mockRejectedValue(testError);
    mockContext.req.header
      .mockReturnValueOnce('test-user-agent')
      .mockReturnValueOnce('192.168.1.1');

    // Act & Assert
    await expect(loggingMiddleware(mockContext, mockNext)).rejects.toThrow('Test error');

    expect(mockContext.set).toHaveBeenCalledWith('requestId', expect.any(String));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"type":"request_start"'));
  });

  it('should add performance headers', async () => {
    // Arrange
    mockContext.req.header
      .mockReturnValueOnce('test-user-agent')
      .mockReturnValueOnce('192.168.1.1');

    // Act
    await loggingMiddleware(mockContext, mockNext);

    // Assert
    expect(mockContext.header).toHaveBeenCalledWith(
      'X-Response-Time',
      expect.stringMatching(/^\d+\.\d+ms$/)
    );
    expect(mockContext.header).toHaveBeenCalledWith('X-Request-ID', expect.any(String));
  });

  it('should log error level for 4xx and 5xx responses', async () => {
    // Arrange
    mockContext.req.header
      .mockReturnValueOnce('test-user-agent')
      .mockReturnValueOnce('192.168.1.1');
    mockContext.res.status = 404;

    const consoleErrorSpy = vi.spyOn(console, 'error');

    // Act
    await loggingMiddleware(mockContext, mockNext);

    // Assert
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"error"'));
  });
});

describe('validateJsonMiddleware', () => {
  let mockContext: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      req: {
        method: 'GET',
        header: vi.fn(),
      },
      json: vi.fn(),
    };

    mockNext = vi.fn().mockResolvedValue(undefined);
  });

  describe('read operations', () => {
    it('should allow GET requests without content-type validation', async () => {
      // Arrange
      mockContext.req.method = 'GET';

      // Act
      await validateJsonMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.json).not.toHaveBeenCalled();
    });

    it('should allow HEAD requests without content-type validation', async () => {
      // Arrange
      mockContext.req.method = 'HEAD';

      // Act
      await validateJsonMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.json).not.toHaveBeenCalled();
    });
  });

  describe('write operations', () => {
    it('should require application/json content-type for POST requests', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue('text/plain');

      // Act
      await validateJsonMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.json).toHaveBeenCalledWith(
        {
          error: 'invalid_content_type',
          message: 'Content-Type must be application/json',
        },
        400
      );
    });

    it('should require application/json content-type for PUT requests', async () => {
      // Arrange
      mockContext.req.method = 'PUT';
      mockContext.req.header.mockReturnValue('text/plain');

      // Act
      await validateJsonMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.json).toHaveBeenCalledWith(
        {
          error: 'invalid_content_type',
          message: 'Content-Type must be application/json',
        },
        400
      );
    });

    it('should require application/json content-type for PATCH requests', async () => {
      // Arrange
      mockContext.req.method = 'PATCH';
      mockContext.req.header.mockReturnValue('text/plain');

      // Act
      await validateJsonMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.json).toHaveBeenCalledWith(
        {
          error: 'invalid_content_type',
          message: 'Content-Type must be application/json',
        },
        400
      );
    });

    it('should accept application/json content-type', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue('application/json');

      // Act
      await validateJsonMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.json).not.toHaveBeenCalled();
    });

    it('should accept application/json with charset', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue('application/json; charset=utf-8');

      // Act
      await validateJsonMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.json).not.toHaveBeenCalled();
    });

    it('should reject missing content-type header', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue(undefined);

      // Act
      await validateJsonMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.json).toHaveBeenCalledWith(
        {
          error: 'invalid_content_type',
          message: 'Content-Type must be application/json',
        },
        400
      );
    });
  });
});
