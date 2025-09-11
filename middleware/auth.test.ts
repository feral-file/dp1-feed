import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  authMiddleware,
  corsMiddleware,
  errorMiddleware,
  loggingMiddleware,
  validateJsonMiddleware,
} from './auth';
import { createTestEnv } from '../test-helpers';
import * as jose from 'jose';

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
      set: vi.fn(),
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

    it('should return 401 when API_SECRET is not configured and JWT is not configured', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.req.header.mockReturnValue('Bearer valid-token');
      mockContext.var.env.API_SECRET = undefined;
      mockContext.var.env.JWT_PUBLIC_KEY = undefined;
      mockContext.var.env.JWT_JWKS_URL = undefined;

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
        message: 'Authentication not configured',
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
        message: 'Invalid credentials',
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
      expect(mockContext.set).toHaveBeenCalledWith('authType', 'api_key');
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

  describe('JWT authentication', () => {
    let testKeyPair: { publicKey: jose.CryptoKey; privateKey: jose.CryptoKey };
    let testPublicKeyPEM: string;

    beforeEach(async () => {
      // Generate test RSA key pair for JWT testing
      testKeyPair = await jose.generateKeyPair('RS256');
      testPublicKeyPEM = await jose.exportSPKI(testKeyPair.publicKey);
    });

    it('should accept valid JWT token with public key configuration', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.var.env.API_SECRET = 'different-secret'; // Different from token
      mockContext.var.env.JWT_PUBLIC_KEY = testPublicKeyPEM;
      mockContext.var.env.JWT_ISSUER = 'test-issuer';
      mockContext.var.env.JWT_AUDIENCE = 'test-audience';

      // Create a valid JWT
      const jwt = await new jose.SignJWT({
        sub: 'user123',
        name: 'Test User',
        role: 'user',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('test-issuer')
        .setAudience('test-audience')
        .setExpirationTime('2h')
        .sign(testKeyPair.privateKey);

      mockContext.req.header.mockReturnValue(`Bearer ${jwt}`);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.res).toBeUndefined();
      expect(mockContext.set).toHaveBeenCalledWith('authType', 'jwt');
      expect(mockContext.set).toHaveBeenCalledWith(
        'jwtPayload',
        expect.objectContaining({
          sub: 'user123',
          iss: 'test-issuer',
          aud: 'test-audience',
          name: 'Test User',
          role: 'user',
        })
      );
    });

    it('should reject expired JWT token', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.var.env.API_SECRET = 'different-secret';
      mockContext.var.env.JWT_PUBLIC_KEY = testPublicKeyPEM;

      // Create an expired JWT (expired 1 hour ago)
      const jwt = await new jose.SignJWT({
        sub: 'user123',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2 hours ago
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // 1 hour ago
        .sign(testKeyPair.privateKey);

      mockContext.req.header.mockReturnValue(`Bearer ${jwt}`);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);
    });

    it('should reject JWT with wrong signature', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.var.env.API_SECRET = 'different-secret';
      mockContext.var.env.JWT_PUBLIC_KEY = testPublicKeyPEM;

      // Generate a different key pair and sign with it
      const wrongKeyPair = await jose.generateKeyPair('RS256');
      const jwt = await new jose.SignJWT({
        sub: 'user123',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(wrongKeyPair.privateKey); // Wrong private key

      mockContext.req.header.mockReturnValue(`Bearer ${jwt}`);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);
    });

    it('should reject JWT with wrong issuer', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.var.env.API_SECRET = 'different-secret';
      mockContext.var.env.JWT_PUBLIC_KEY = testPublicKeyPEM;
      mockContext.var.env.JWT_ISSUER = 'expected-issuer';

      const jwt = await new jose.SignJWT({
        sub: 'user123',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('wrong-issuer') // Wrong issuer
        .setExpirationTime('2h')
        .sign(testKeyPair.privateKey);

      mockContext.req.header.mockReturnValue(`Bearer ${jwt}`);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);
    });

    it('should reject JWT with wrong audience', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.var.env.API_SECRET = 'different-secret';
      mockContext.var.env.JWT_PUBLIC_KEY = testPublicKeyPEM;
      mockContext.var.env.JWT_AUDIENCE = 'expected-audience';

      const jwt = await new jose.SignJWT({
        sub: 'user123',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setAudience('wrong-audience') // Wrong audience
        .setExpirationTime('2h')
        .sign(testKeyPair.privateKey);

      mockContext.req.header.mockReturnValue(`Bearer ${jwt}`);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);
    });

    it('should prefer API key over JWT when both are valid', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.var.env.API_SECRET = 'test-secret-key'; // Same as token
      mockContext.var.env.JWT_PUBLIC_KEY = testPublicKeyPEM;

      // Use API key as token (should match API_SECRET)
      mockContext.req.header.mockReturnValue('Bearer test-secret-key');

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.res).toBeUndefined();
      expect(mockContext.set).toHaveBeenCalledWith('authType', 'api_key');
      expect(mockContext.set).not.toHaveBeenCalledWith('authType', 'jwt');
    });

    it('should fall back to JWT when API key does not match', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.var.env.API_SECRET = 'different-secret';
      mockContext.var.env.JWT_PUBLIC_KEY = testPublicKeyPEM;

      const jwt = await new jose.SignJWT({
        sub: 'user123',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(testKeyPair.privateKey);

      mockContext.req.header.mockReturnValue(`Bearer ${jwt}`);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.res).toBeUndefined();
      expect(mockContext.set).toHaveBeenCalledWith('authType', 'jwt');
    });

    it('should reject invalid JWT format', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.var.env.API_SECRET = 'different-secret';
      mockContext.var.env.JWT_PUBLIC_KEY = testPublicKeyPEM;

      mockContext.req.header.mockReturnValue('Bearer invalid.jwt.format');

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);
    });

    it('should handle JWT validation without issuer/audience configured', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.var.env.API_SECRET = 'different-secret';
      mockContext.var.env.JWT_PUBLIC_KEY = testPublicKeyPEM;
      // No JWT_ISSUER or JWT_AUDIENCE configured

      const jwt = await new jose.SignJWT({
        sub: 'user123',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(testKeyPair.privateKey);

      mockContext.req.header.mockReturnValue(`Bearer ${jwt}`);

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockContext.res).toBeUndefined();
      expect(mockContext.set).toHaveBeenCalledWith('authType', 'jwt');
    });

    it('should reject when neither API key nor JWT configuration is available', async () => {
      // Arrange
      mockContext.req.method = 'POST';
      mockContext.var.env.API_SECRET = undefined;
      mockContext.var.env.JWT_PUBLIC_KEY = undefined;
      mockContext.var.env.JWT_JWKS_URL = undefined;

      mockContext.req.header.mockReturnValue('Bearer some-token');

      // Act
      await authMiddleware(mockContext, mockNext);

      // Assert
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.res).toBeInstanceOf(Response);
      expect((mockContext.res as Response).status).toBe(401);

      const responseBody = await (mockContext.res as Response).json();
      expect(responseBody).toEqual({
        error: 'unauthorized',
        message: 'Authentication not configured',
      });
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
