#!/usr/bin/env node

/**
 * Generate RSA key pair for JWT testing using Web Crypto API
 * This script generates a public/private key pair compatible with Cloudflare Workers
 */

async function generateKeys() {
  try {
    console.log('🔐 Generating RSA key pair for JWT testing using Web Crypto API...');

    // Use Web Crypto API directly to ensure compatibility with Cloudflare Workers
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true, // extractable
      ['sign', 'verify']
    );

    // Export keys to PEM format using Web Crypto API
    const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);

    // Convert to PEM format
    const privateKeyPEM = arrayBufferToPem(privateKeyBuffer, 'PRIVATE KEY');
    const publicKeyPEM = arrayBufferToPem(publicKeyBuffer, 'PUBLIC KEY');

    console.log('\n📄 Private Key (PKCS#8 PEM format):');
    console.log(privateKeyPEM);

    console.log('\n📄 Public Key (SPKI PEM format):');
    console.log(publicKeyPEM);

    console.log('\n🔧 Environment Variables for Testing:');
    console.log('# For integration tests:');
    console.log(`export JWT_TEST_PRIVATE_KEY='${privateKeyPEM.replace(/\n/g, '\\n')}'`);
    console.log('export JWT_TEST_ISSUER="test-issuer"');
    console.log('export JWT_TEST_AUDIENCE="test-audience"');

    console.log('\n# For server configuration:');
    console.log(`export JWT_PUBLIC_KEY='${publicKeyPEM.replace(/\n/g, '\\n')}'`);
    console.log('export JWT_ISSUER="test-issuer"');
    console.log('export JWT_AUDIENCE="test-audience"');

    console.log('\n✅ Key pair generated successfully!');
    console.log('💡 Copy the environment variables above to test JWT authentication');
  } catch (error) {
    console.error('❌ Error generating keys:', error.message);
    process.exit(1);
  }
}

// Helper function to convert ArrayBuffer to PEM format
function arrayBufferToPem(buffer, label) {
  const base64 = Buffer.from(buffer).toString('base64');
  const formatted = base64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${formatted}\n-----END ${label}-----`;
}

generateKeys();
