import type { Env } from '../types';
import { EtcdStorageProvider } from '../storage/etcd-kv';
import { NatsJetStreamQueueProvider } from '../queue/nats-jetstream';

/**
 * Self-hosted environment bindings interface
 * This represents configuration for alternative deployment scenarios
 */
export interface SelfHostedBindings {
  API_SECRET: string;
  ED25519_PRIVATE_KEY: string;

  // JWT configuration for user authentication (optional)
  JWT_PUBLIC_KEY?: string; // PEM format public key
  JWT_JWKS_URL?: string; // JWKS endpoint URL for remote key fetching
  JWT_ISSUER?: string; // Expected issuer claim (iss)
  JWT_AUDIENCE?: string; // Expected audience claim (aud)

  // etcd configuration
  ETCD_ENDPOINT: string;
  ETCD_USERNAME?: string;
  ETCD_PASSWORD?: string;
  ETCD_PREFIX?: string;

  // NATS JetStream configuration
  NATS_ENDPOINT: string;
  NATS_USERNAME?: string;
  NATS_PASSWORD?: string;
  NATS_TOKEN?: string;
  NATS_STREAM_NAME: string;
  NATS_SUBJECT_NAME: string;

  // Optional environment variables
  ENVIRONMENT?: string;
  SELF_HOSTED_DOMAINS?: string;
}

/**
 * Initialize environment from self-hosted bindings
 * Creates providers based on configuration for alternative deployment scenarios
 */
export async function initializeSelfHostedEnv(bindings: SelfHostedBindings): Promise<Env> {
  // Validate required bindings
  if (!bindings.ETCD_ENDPOINT) {
    throw new Error('Missing required etcd endpoint: ETCD_ENDPOINT');
  }

  if (!bindings.NATS_ENDPOINT || !bindings.NATS_STREAM_NAME || !bindings.NATS_SUBJECT_NAME) {
    throw new Error(
      'Missing required NATS configuration: NATS_ENDPOINT, NATS_STREAM_NAME, NATS_SUBJECT_NAME'
    );
  }

  // Create etcd storage provider
  const etcdConfig = {
    endpoint: bindings.ETCD_ENDPOINT,
    username: bindings.ETCD_USERNAME,
    password: bindings.ETCD_PASSWORD,
    prefix: bindings.ETCD_PREFIX || 'dp1',
  };
  const storageProvider = new EtcdStorageProvider(etcdConfig);

  // Create NATS JetStream queue provider
  const natsConfig = {
    endpoint: bindings.NATS_ENDPOINT,
    username: bindings.NATS_USERNAME,
    password: bindings.NATS_PASSWORD,
    token: bindings.NATS_TOKEN,
    stream: bindings.NATS_STREAM_NAME,
    subject: bindings.NATS_SUBJECT_NAME,
  };
  const queueProvider = new NatsJetStreamQueueProvider(natsConfig);

  // Initialize the queue provider to create the stream
  await queueProvider.initialize();

  return {
    API_SECRET: bindings.API_SECRET,
    ED25519_PRIVATE_KEY: bindings.ED25519_PRIVATE_KEY,
    JWT_PUBLIC_KEY: bindings.JWT_PUBLIC_KEY,
    JWT_JWKS_URL: bindings.JWT_JWKS_URL,
    JWT_ISSUER: bindings.JWT_ISSUER,
    JWT_AUDIENCE: bindings.JWT_AUDIENCE,
    storageProvider,
    queueProvider,
    ENVIRONMENT: bindings.ENVIRONMENT,
    SELF_HOSTED_DOMAINS: bindings.SELF_HOSTED_DOMAINS,
  };
}
