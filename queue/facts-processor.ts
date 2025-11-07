import type { MessageBatch, ProcessingResult } from './interfaces';
import type { Env } from '../types';
import type { RegistryWebhookPayload } from '../routes/registry-webhook';

/**
 * Process a batch of facts-ingest messages and materialize to KV.
 * Keys:
 * - star:${playlist_id}
 * - star:created:asc:${issued_at}:${playlist_id}
 * - star:created:desc:${issued_at}:${playlist_id}
 */
export async function processFactsBatch(
  batch: MessageBatch<{ payload: RegistryWebhookPayload }>,
  env: Env
): Promise<ProcessingResult> {
  const errors: Array<{ messageId: string; error: string }> = [];

  const playlistKV = env.storageProvider.getPlaylistStorage();

  const tasks = batch.messages.map(async msg => {
    try {
      const payload = (msg.body as any)?.payload as RegistryWebhookPayload;
      if (!payload || !payload.subject || !payload.subject.ref) {
        throw new Error('invalid payload');
      }

      // Only handle endorsement.star on playlist subjects
      if (payload.kind !== 'endorsement.star') {
        return; // ignore other kinds for now
      }
      if (payload.subject.type !== 'playlist') {
        return; // ignore non-playlist subjects
      }

      const playlistId = payload.subject.ref;

      // Derive created time from stored playlist
      const playlistRaw = await playlistKV.get(`playlist:id:${playlistId}`);
      const created = playlistRaw ? (JSON.parse(playlistRaw) as { created?: string }).created : undefined;

      const flagKey = `star:${playlistId}`;

      if (payload.status === 'active') {
        // Materialize using playlist.created when available; if missing, skip created indexes
        const ops: Promise<void>[] = [playlistKV.put(flagKey, playlistId)];
        if (created) {
          const { asc, desc } = toSortableTimestamps(created);
          const ascKey = `star:created:asc:${asc}:${playlistId}`;
          const descKey = `star:created:desc:${desc}:${playlistId}`;
          ops.push(playlistKV.put(ascKey, playlistId));
          ops.push(playlistKV.put(descKey, playlistId));
        }
        await Promise.all(ops);
      } else if (payload.status === 'revoked') {
        // Remove flag and created indexes (compute keys if created known, else scan-and-delete)
        const ops: Promise<void>[] = [playlistKV.delete(flagKey)];
        if (created) {
          const { asc, desc } = toSortableTimestamps(created);
          ops.push(playlistKV.delete(`star:created:asc:${asc}:${playlistId}`));
          ops.push(playlistKV.delete(`star:created:desc:${desc}:${playlistId}`));
        } else {
          // Fallback: scan both prefixes and delete keys ending with :playlistId
          await deleteStarIndexBySuffix(playlistKV, 'star:created:asc:', playlistId);
          await deleteStarIndexBySuffix(playlistKV, 'star:created:desc:', playlistId);
        }
        await Promise.all(ops);
      }
    } catch (err) {
      errors.push({ messageId: msg.id, error: err instanceof Error ? err.message : 'error' });
    }
  });

  await Promise.all(tasks);

  return {
    success: errors.length === 0,
    processedCount: batch.messages.length - errors.length,
    errors: errors.length ? errors : undefined,
  };
}

function toSortableTimestamps(isoTimestamp: string): { asc: string; desc: string } {
  const ms = Number.isFinite(Number(isoTimestamp)) ? Number(isoTimestamp) : Date.parse(isoTimestamp);
  const asc = String(ms).padStart(13, '0');
  const maxMs = 9999999999999;
  const desc = String(maxMs - ms).padStart(13, '0');
  return { asc, desc };
}

async function deleteStarIndexBySuffix(
  kv: { list: Function; delete: (key: string) => Promise<void> },
  prefix: string,
  playlistId: string
): Promise<void> {
  let cursor: string | undefined = undefined;
  // Paginate to find any keys ending with :playlistId
  do {
    const res: { keys: Array<{ name: string }>; list_complete: boolean; cursor?: string } =
      await kv.list({ prefix, cursor });
    const tasks: Promise<void>[] = [];
    for (const k of res.keys as Array<{ name: string }>) {
      if (k.name.endsWith(`:${playlistId}`)) {
        tasks.push(kv.delete(k.name));
      }
    }
    await Promise.all(tasks);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
}


