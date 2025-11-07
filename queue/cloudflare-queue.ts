import type { Queue, QueueProvider, QueueSendOptions } from './interfaces';

/**
 * CloudFlare Queue implementation of the Queue interface
 */
export class CloudFlareQueue implements Queue {
  constructor(
    private queue: any, // CloudFlare Queue type
    private name: string
  ) {}

  async send(message: any, options?: QueueSendOptions): Promise<void> {
    await this.queue.send(message, options);
  }

  getName(): string {
    return this.name;
  }
}

/**
 * CloudFlare queue provider that provides access to CloudFlare queues
 */
export class CloudFlareQueueProvider implements QueueProvider {
  private writeQueue: CloudFlareQueue;
  private factsQueue: CloudFlareQueue;

  constructor(
    writeQueue: any,
    factsQueue: any,
    writeQueueName: string = 'DP1_WRITE_QUEUE',
    factsQueueName: string = 'FACTS_INGEST_QUEUE'
  ) {
    this.writeQueue = new CloudFlareQueue(writeQueue, writeQueueName);
    this.factsQueue = new CloudFlareQueue(factsQueue, factsQueueName);
  }

  getWriteQueue(): Queue {
    return this.writeQueue;
  }

  getFactsQueue(): Queue {
    return this.factsQueue;
  }
}
