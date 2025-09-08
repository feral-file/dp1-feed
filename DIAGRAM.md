# DP-1 Feed API Flow Sequence Diagrams

This document describes the API flow for both Cloudflare Workers and self-hosted Node.js deployments, covering playlist and playlist group operations.

## Overview

The DP-1 Feed API follows an asynchronous pattern where:

1. API requests are validated and signed immediately
2. Operations are queued for async processing
3. A response is returned to the client before persistence
4. Message consumers process queued operations in the background

## Deployment Types

### 1. Cloudflare Workers Deployment

- **Storage**: Cloudflare KV (key-value store)
- **Queue**: Cloudflare Queue
- **Consumer**: Built-in Cloudflare Queue consumer
- **Processing**: Direct database operations

### 2. Self-Hosted Node.js Deployment

- **Storage**: etcd (key-value store)
- **Queue**: NATS JetStream
- **Consumer**: Separate Node.js consumer service
- **Processing**: HTTP API calls to main server

---

## Sequence Diagram: Playlist/Playlist Group Creation/Update Flow

### Cloudflare Workers Deployment

```mermaid
sequenceDiagram
    participant Client
    participant CF_Worker as Cloudflare Worker
    participant CF_Queue as Cloudflare Queue
    participant CF_Consumer as CF Queue Consumer
    participant CF_KV as Cloudflare KV

    Note over Client,CF_KV: Create/Update Playlist/Playlist Group Flow (Cloudflare Workers)

    Client->>CF_Worker: POST/PUT/PATCH /playlists or /playlist-groups
    Note right of Client: Request includes playlist/group data

    CF_Worker->>CF_Worker: 1. Validate request body (Zod schema)
    CF_Worker->>CF_Worker: 2. Generate server IDs (UUID, slug, timestamps)
    CF_Worker->>CF_Worker: 3. Sign data with Ed25519 private key
    CF_Worker->>CF_Worker: 4. Create queue message with operation type

    CF_Worker->>CF_Queue: 5. Queue write operation message
    Note right of CF_Queue: Message contains: {operation, id, timestamp, data}

    CF_Worker->>Client: 6. Return signed playlist/group (201/200)
    Note right of Client: Response includes signature, server-generated IDs

    Note over CF_Queue,CF_KV: Async Processing (Cloudflare handles)

    CF_Queue->>CF_Consumer: 7. Deliver message batch
    CF_Consumer->>CF_Consumer: 8. Process write operations
    CF_Consumer->>CF_KV: 9. Persist to KV storage
    CF_Consumer->>CF_Queue: 10a. ACK (success) or 10b. NAK (failure)
    Note right of CF_Queue: Cloudflare handles retry logic automatically
```

### Self-Hosted Node.js Deployment

```mermaid
sequenceDiagram
    participant Client
    participant Node_Server as Node.js Server
    participant NATS_JS as NATS JetStream
    participant NATS_Consumer as NATS Consumer
    participant Node_API as Node.js API (Internal)
    participant ETCD as etcd Storage

    Note over Client,ETCD: Create/Update Playlist/Playlist Group Flow (Self-Hosted)

    Client->>Node_Server: POST/PUT/PATCH /playlists or /playlist-groups
    Note right of Client: Request includes playlist/group data

    Node_Server->>Node_Server: 1. Validate request body (Zod schema)
    Node_Server->>Node_Server: 2. Generate server IDs (UUID, slug, timestamps)
    Node_Server->>Node_Server: 3. Sign data with Ed25519 private key
    Node_Server->>Node_Server: 4. Create queue message with operation type

    Node_Server->>NATS_JS: 5. Publish message to JetStream
    Note right of NATS_JS: Message contains: {operation, id, timestamp, data}

    Node_Server->>Client: 6. Return signed playlist/group (201/200)
    Note right of Client: Response includes signature, server-generated IDs

    Note over NATS_JS,ETCD: Async Processing (Separate Consumer)

    NATS_Consumer->>NATS_JS: 7. Poll for messages
    NATS_JS->>NATS_Consumer: 8. Deliver message batch
    NATS_Consumer->>NATS_Consumer: 9. Process batch of messages

    loop For each message in batch
        NATS_Consumer->>Node_API: 10. POST /api/v1/queues/process-message
        Note right of Node_API: Internal API call with message data
        Node_API->>Node_API: 11. Process write operation
        Node_API->>ETCD: 12. Persist to etcd storage
        Node_API->>NATS_Consumer: 13. Return processing result
    end

    NATS_Consumer->>NATS_JS: 14a. ACK all messages (success) or 14b. NAK all messages (failure)
    Note right of NATS_JS: Consumer handles retry logic based on response
```

---

## Detailed Message Flow

### Message Structure

Both deployments use the same message structure:

```typescript
interface WriteOperationMessage {
  id: string; // Unique message ID
  timestamp: string; // ISO timestamp
  operation:
    | 'create_playlist'
    | 'update_playlist'
    | 'create_playlist_group'
    | 'update_playlist_group';
  data: {
    playlist?: Playlist; // For playlist operations
    playlistGroup?: PlaylistGroup; // For playlist group operations
    playlistId?: string; // For update operations
  };
  retryCount?: number; // For retry tracking
}
```

### Queue Processing Flow

#### Cloudflare Workers Processing

```mermaid
sequenceDiagram
    participant CF_Queue as Cloudflare Queue
    participant CF_Consumer as CF Queue Consumer
    participant Processor as Queue Processor
    participant Storage as Storage Service
    participant CF_KV as Cloudflare KV

    CF_Queue->>CF_Consumer: Deliver message batch
    CF_Consumer->>Processor: processWriteOperations(batch)

    Processor->>Processor: Create QueueProcessorService
    Processor->>Processor: Create StorageService

    loop For each message in batch
        Processor->>Processor: processMessage(message)

        alt create_playlist
            Processor->>Storage: savePlaylist(playlist, false)
            Storage->>CF_KV: PUT /playlists/{id}
        else update_playlist
            Processor->>Storage: savePlaylist(playlist, true)
            Storage->>CF_KV: PUT /playlists/{id}
        else create_playlist_group
            Processor->>Storage: savePlaylistGroup(group, env, false)
            Storage->>CF_KV: PUT /playlist-groups/{id}
        else update_playlist_group
            Processor->>Storage: savePlaylistGroup(group, env, true)
            Storage->>CF_KV: PUT /playlist-groups/{id}
        end
    end

    Processor->>CF_Consumer: Return ProcessingResult
    CF_Consumer->>CF_Queue: ACK all (success) or NAK all (failure)
```

#### Self-Hosted Processing

```mermaid
sequenceDiagram
    participant NATS_JS as NATS JetStream
    participant Consumer as NATS Consumer
    participant Node_API as Node.js API
    participant Processor as Queue Processor
    participant Storage as Storage Service
    participant ETCD as etcd Storage

    Consumer->>NATS_JS: Fetch messages (batch)
    NATS_JS->>Consumer: Return message batch

    loop For each message in batch
        Consumer->>Node_API: POST /api/v1/queues/process-message
        Node_API->>Processor: processWriteOperations(messageBatch)

        Processor->>Processor: Create QueueProcessorService
        Processor->>Processor: Create StorageService

        Processor->>Processor: processMessage(message)

        alt create_playlist
            Processor->>Storage: savePlaylist(playlist, false)
            Storage->>ETCD: PUT /dp1/playlists/{id}
        else update_playlist
            Processor->>Storage: savePlaylist(playlist, true)
            Storage->>ETCD: PUT /dp1/playlists/{id}
        else create_playlist_group
            Processor->>Storage: savePlaylistGroup(group, env, false)
            Storage->>ETCD: PUT /dp1/playlist-groups/{id}
        else update_playlist_group
            Processor->>Storage: savePlaylistGroup(group, env, true)
            Storage->>ETCD: PUT /dp1/playlist-groups/{id}
        end

        Processor->>Node_API: Return ProcessingResult
        Node_API->>Consumer: Return success/error response
    end

    Consumer->>NATS_JS: ACK all (success) or NAK all (failure)
```

---

## Error Handling and Retry Logic

### Cloudflare Workers

```mermaid
sequenceDiagram
    participant CF_Queue as Cloudflare Queue
    participant CF_Consumer as CF Queue Consumer
    participant CF_KV as Cloudflare KV

    CF_Queue->>CF_Consumer: Deliver message batch

    alt Processing Success
        CF_Consumer->>CF_KV: Persist data successfully
        CF_Consumer->>CF_Queue: batch.ackAll()
        Note right of CF_Queue: Messages removed from queue
    else Processing Failure
        CF_Consumer->>CF_Queue: batch.retryAll()
        Note right of CF_Queue: Cloudflare handles retry with exponential backoff
        Note right of CF_Queue: Max retries: 3, Dead letter queue after max retries
    else Unexpected Error
        CF_Consumer->>CF_Queue: batch.retryAll()
        Note right of CF_Queue: Retry on any unhandled exceptions
    end
```

### Self-Hosted

```mermaid
sequenceDiagram
    participant NATS_JS as NATS JetStream
    participant Consumer as NATS Consumer
    participant Node_API as Node.js API

    Consumer->>NATS_JS: Fetch messages (batch)
    NATS_JS->>Consumer: Return message batch

    loop For each message
        Consumer->>Node_API: POST /api/v1/queues/process-message

        alt API Success
            Node_API->>Consumer: Return success response
        else API Error (4xx)
            Node_API->>Consumer: Return error response
            Note right of Consumer: Permanent failure - don't retry
        else API Error (5xx)
            Node_API->>Consumer: Return error response
            Note right of Consumer: Temporary failure - will retry
        end
    end

    alt All Messages Success
        Consumer->>NATS_JS: ACK all messages
        Note right of NATS_JS: Messages removed from stream
    else Any Message Failed
        Consumer->>NATS_JS: NAK all messages
        Note right of NATS_JS: Messages redelivered after ack_wait timeout
        Note right of NATS_JS: Consumer implements exponential backoff
    end
```

---

## Key Differences Between Deployments

| Aspect          | Cloudflare Workers    | Self-Hosted Node.js            |
| --------------- | --------------------- | ------------------------------ |
| **Storage**     | Cloudflare KV         | etcd                           |
| **Queue**       | Cloudflare Queue      | NATS JetStream                 |
| **Consumer**    | Built-in CF consumer  | Separate Node.js service       |
| **Processing**  | Direct database calls | HTTP API calls                 |
| **Retry Logic** | Cloudflare managed    | Custom implementation          |
| **Scaling**     | Automatic             | Manual/container orchestration |
| **Monitoring**  | Cloudflare dashboard  | Custom metrics/logging         |
