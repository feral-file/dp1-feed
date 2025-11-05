import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValidationResult } from 'ff-dp1-js';

const successResult: ValidationResult = { success: true };

const dp1Mock = {
  signDP1Playlist: vi.fn(),
  validateDisplayPrefs: vi.fn<() => ValidationResult>(() => successResult),
  validateDpVersion: vi.fn<() => ValidationResult>(() => successResult),
  validateRepro: vi.fn<() => ValidationResult>(() => successResult),
  validateProvenance: vi.fn<() => ValidationResult>(() => successResult),
  validateEntity: vi.fn<() => ValidationResult>(() => successResult),
  validateDynamicQuery: vi.fn<() => ValidationResult>(() => successResult),
  validateChannel: vi.fn<() => ValidationResult>(() => successResult),
  parseDP1Playlist: vi.fn(),
};

vi.mock('ff-dp1-js', () => ({
  Playlist: {} as any,
  Channel: {} as any,
  ValidationIssue: {} as any,
  signDP1Playlist: dp1Mock.signDP1Playlist,
  validateDisplayPrefs: dp1Mock.validateDisplayPrefs,
  validateDpVersion: dp1Mock.validateDpVersion,
  validateRepro: dp1Mock.validateRepro,
  validateProvenance: dp1Mock.validateProvenance,
  validateEntity: dp1Mock.validateEntity,
  validateDynamicQuery: dp1Mock.validateDynamicQuery,
  validateChannel: dp1Mock.validateChannel,
  parseDP1Playlist: dp1Mock.parseDP1Playlist,
}));

const baseItem = {
  title: 'Artwork',
  source: 'https://example.com/art.html',
  duration: 120,
  license: 'open' as const,
};

const basePlaylistInput = {
  dpVersion: '1.0.0',
  title: 'Test Playlist',
  items: [baseItem],
};

function resetValidatorMocks() {
  Object.values(dp1Mock).forEach(fn => {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as any).mockReset();
  });

  dp1Mock.validateDisplayPrefs.mockImplementation(() => successResult);
  dp1Mock.validateDpVersion.mockImplementation(() => successResult);
  dp1Mock.validateRepro.mockImplementation(() => successResult);
  dp1Mock.validateProvenance.mockImplementation(() => successResult);
  dp1Mock.validateEntity.mockImplementation(() => successResult);
  dp1Mock.validateDynamicQuery.mockImplementation(() => successResult);
  dp1Mock.validateChannel.mockImplementation(() => successResult);
  dp1Mock.parseDP1Playlist.mockImplementation(() => ({ playlist: {}, error: null }));
}

const loadTypes = () => import('./types');

describe('types schemas integration with ff-dp1-js validators', () => {
  beforeEach(() => {
    resetValidatorMocks();
    vi.resetModules();
  });

  it('propagates display validation issues from ff-dp1-js with nested paths', async () => {
    dp1Mock.validateDisplayPrefs.mockImplementationOnce(() => ({
      success: false as const,
      error: {
        message: 'Invalid display preferences',
        issues: [{ path: 'autoplay', message: 'autoplay must be a boolean' }],
      },
    }));

    const { PlaylistInputSchema } = await loadTypes();

    const result = PlaylistInputSchema.safeParse({
      ...basePlaylistInput,
      items: [
        {
          ...baseItem,
          display: { autoplay: 'yes' },
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(dp1Mock.validateDisplayPrefs).toHaveBeenCalledWith({ autoplay: 'yes' });
    const issue = result.error?.issues[0];
    expect(issue?.path.slice(-2)).toEqual(['display', 'autoplay']);
    expect(issue?.message).toBe('autoplay must be a boolean');
  });

  it('falls back to ff-dp1-js error message when no granular display issues are provided', async () => {
    dp1Mock.validateDisplayPrefs.mockImplementationOnce(() => ({
      success: false as const,
      error: { message: 'Generic display error', issues: [] },
    }));

    const { PlaylistInputSchema } = await loadTypes();

    const result = PlaylistInputSchema.safeParse({
      ...basePlaylistInput,
      items: [
        {
          ...baseItem,
          display: { autoplay: true },
        },
      ],
    });

    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.path.at(-1)).toBe('display');
    expect(issue?.message).toBe('Generic display error');
  });

  it('propagates reproduction and provenance validation issues with full paths', async () => {
    dp1Mock.validateRepro.mockImplementationOnce(() => ({
      success: false as const,
      error: {
        message: 'Invalid reproduction',
        issues: [{ path: 'frameHash.sha256', message: 'bad frame hash' }],
      },
    }));
    dp1Mock.validateProvenance.mockImplementationOnce(() => ({
      success: false as const,
      error: {
        message: 'Invalid provenance',
        issues: [{ path: 'contract.address', message: 'missing address' }],
      },
    }));

    const { PlaylistInputSchema } = await loadTypes();

    const result = PlaylistInputSchema.safeParse({
      ...basePlaylistInput,
      items: [
        {
          ...baseItem,
          repro: { frameHash: {} },
          provenance: { contract: {} },
        },
      ],
    });

    expect(result.success).toBe(false);
    const reproIssue = result.error?.issues.find(issue => issue.message === 'bad frame hash');
    const provenanceIssue = result.error?.issues.find(issue => issue.message === 'missing address');
    expect(reproIssue?.path.slice(-3)).toEqual(['repro', 'frameHash', 'sha256']);
    expect(provenanceIssue?.path.slice(-3)).toEqual(['provenance', 'contract', 'address']);
  });

  it('falls back to single issue for repro and provenance when no granular issues', async () => {
    dp1Mock.validateRepro.mockImplementationOnce(() => ({
      success: false,
      error: { message: 'Generic repro error', issues: [] },
    }));
    dp1Mock.validateProvenance.mockImplementationOnce(() => ({
      success: false,
      error: { message: 'Generic provenance error', issues: [] },
    }));

    const { PlaylistInputSchema } = await loadTypes();

    const result = PlaylistInputSchema.safeParse({
      ...basePlaylistInput,
      items: [
        {
          ...baseItem,
          repro: { any: 'value' },
          provenance: { any: 'value' },
        },
      ],
    });

    expect(result.success).toBe(false);
    const reproIssue = result.error?.issues.find(issue => issue.path.at(-1) === 'repro');
    const provIssue = result.error?.issues.find(issue => issue.path.at(-1) === 'provenance');
    expect(reproIssue?.message).toBe('Generic repro error');
    expect(provIssue?.message).toBe('Generic provenance error');
  });

  it('surfaces dpVersion validation errors returned by ff-dp1-js', async () => {
    dp1Mock.validateDpVersion.mockImplementation(() => ({
      success: false as const,
      error: { message: 'dpVersion is not semver', issues: [] },
    }));

    const { PlaylistInputSchema } = await loadTypes();

    const result = PlaylistInputSchema.safeParse(basePlaylistInput);
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.path).toEqual(['dpVersion']);
    expect(issue?.message).toBe('dpVersion is not semver');
  });

  it('maps parseDP1Playlist validation_error details to zod issues in PlaylistSchema', async () => {
    dp1Mock.parseDP1Playlist.mockImplementationOnce(() => ({
      playlist: null,
      error: {
        type: 'validation_error',
        message: 'playlist invalid',
        details: [
          { path: 'items.0.source', message: 'invalid source' },
          { path: 'title', message: 'too long' },
        ],
      },
    }));

    const { PlaylistSchema } = await loadTypes();
    const result = PlaylistSchema.safeParse({ any: 'value' });
    expect(result.success).toBe(false);
    const messages = (result.error?.issues || []).map(i => i.message);
    expect(messages).toContain('invalid source');
    expect(messages).toContain('too long');
    const itemIssue = result.error?.issues.find(i => i.message === 'invalid source');
    // Expect path to include items -> index -> source, where index is a string
    expect(itemIssue?.path.at(-3)).toBe('items');
    expect(itemIssue?.path.slice(-2)).toEqual(['0', 'source']);
  });

  it('maps parseDP1Playlist invalid_json to a single zod issue with message', async () => {
    dp1Mock.parseDP1Playlist.mockImplementationOnce(() => ({
      playlist: null,
      error: { type: 'invalid_json', message: 'malformed json' },
    }));

    const { PlaylistSchema } = await loadTypes();
    const result = PlaylistSchema.safeParse({ any: 'value' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('malformed json');
  });

  it('accepts playlist input when all ff-dp1-js validators succeed', async () => {
    const { PlaylistInputSchema } = await loadTypes();
    const result = PlaylistInputSchema.safeParse({
      ...basePlaylistInput,
      defaults: { display: { margin: '10px' } },
      items: [
        {
          ...baseItem,
          display: { margin: '5px' },
          repro: { engine: 'unknown' },
          provenance: { type: 'offChainURI' },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(dp1Mock.validateDisplayPrefs).toHaveBeenCalledTimes(2); // defaults + item
    expect(dp1Mock.validateRepro).toHaveBeenCalledTimes(1);
    expect(dp1Mock.validateProvenance).toHaveBeenCalledTimes(1);
  });

  it('validates PlaylistInputSchema item/ref/source formats and dynamic rules', async () => {
    const { PlaylistInputSchema } = await loadTypes();

    // invalid URL-like fields
    const bad = PlaylistInputSchema.safeParse({
      ...basePlaylistInput,
      items: [
        {
          ...baseItem,
          source: 'not a url',
          ref: 'also bad',
          duration: 0,
          license: 'free',
        },
      ],
    } as any);

    expect(bad.success).toBe(false);
    const messages = (bad.error?.issues || []).map(i => i.message);
    expect(messages.join(' ')).toMatch(/Invalid|must|enum|minimum|regex/);

    // dynamicQueries OR items must be present
    const missing = PlaylistInputSchema.safeParse({
      ...basePlaylistInput,
      items: [],
      dynamicQueries: [],
    });
    expect(missing.success).toBe(false);

    const okayWithDynamic = PlaylistInputSchema.safeParse({
      dpVersion: '1.0.0',
      title: 'only dynamic',
      items: [],
      dynamicQueries: [{}],
    } as any);
    expect(okayWithDynamic.success).toBe(true);
  });

  it('validates PlaylistUpdateSchema rules for non-empty items or dynamicQueries when provided', async () => {
    const { PlaylistUpdateSchema } = await loadTypes();

    const invalid = PlaylistUpdateSchema.safeParse({ items: [], dynamicQueries: [] });
    expect(invalid.success).toBe(false);

    const valid1 = PlaylistUpdateSchema.safeParse({ items: [{ ...baseItem }] });
    const valid2 = PlaylistUpdateSchema.safeParse({ dynamicQueries: [{}] } as any);
    const valid3 = PlaylistUpdateSchema.safeParse({});
    expect(valid1.success && valid2.success && valid3.success).toBe(true);
  });

  it('validates ChannelInputSchema URL patterns and required constraints', async () => {
    const { ChannelInputSchema } = await loadTypes();

    const bad = ChannelInputSchema.safeParse({
      title: 'Chan',
      playlists: ['not a url'],
    } as any);
    expect(bad.success).toBe(false);

    const good = ChannelInputSchema.safeParse({
      title: 'Chan',
      playlists: ['http://example.com/p1.json'],
    });
    expect(good.success).toBe(true);
  });

  it('maps validateChannel results via ChannelSchema', async () => {
    dp1Mock.validateChannel.mockImplementationOnce(() => ({
      success: false,
      error: {
        message: 'channel invalid',
        issues: [{ path: 'playlists.0', message: 'not reachable' }],
      },
    }));

    const { ChannelSchema } = await loadTypes();
    const result = ChannelSchema.safeParse({ any: 'value' });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.path.slice(-2)).toEqual(['playlists', '0']);
    expect(issue?.message).toBe('not reachable');
  });

  it('creates playlists with generated identifiers and timestamps', async () => {
    const { createPlaylistFromInput } = await loadTypes();

    const playlist = createPlaylistFromInput(basePlaylistInput);

    expect(playlist.id).toMatch(/[0-9a-f-]{36}/);
    expect(playlist.slug).toMatch(/^test-playlist-\d{4}$/);
    expect(new Date(playlist.created as string).toString()).not.toBe('Invalid Date');
    playlist.items?.forEach(item => {
      expect(item.id).toMatch(/[0-9a-f-]{36}/);
      expect(new Date(item.created as string).toString()).not.toBe('Invalid Date');
    });
  });

  it('creates channels with generated identifiers and timestamps', async () => {
    const { createChannelFromInput } = await loadTypes();
    const channel = createChannelFromInput({
      title: 'Channel Title',
      playlists: ['http://example.com/p1.json'],
    } as any);

    expect(channel.id).toMatch(/[0-9a-f-]{36}/);
    expect(channel.slug).toMatch(/^channel-title-\d{4}$/);
    expect(new Date(channel.created as string).toString()).not.toBe('Invalid Date');
  });

  it('createItemContentHash is deterministic and order-invariant', async () => {
    const { createItemContentHash } = await loadTypes();

    const a = {
      title: 'A',
      source: 'https://example.com/a',
      duration: 10,
      license: 'open',
      ref: 'ipfs://hash',
      override: { x: 1, y: 2 },
      display: { margin: '1px' },
      repro: { engine: 'e' },
      provenance: { type: 'offChainURI' },
    } as const;

    const b = {
      source: 'https://example.com/a',
      duration: 10,
      license: 'open',
      title: 'A',
      provenance: { type: 'offChainURI' },
      repro: { engine: 'e' },
      display: { margin: '1px' },
      override: { y: 2, x: 1 },
      ref: 'ipfs://hash',
    } as const;

    const h1 = await createItemContentHash(a as any);
    const h2 = await createItemContentHash(b as any);
    expect(h1).toBe(h2);

    const h3 = await createItemContentHash({ ...a, title: 'B' } as any);
    expect(h3).not.toBe(h1);
  });

  it('identifies protected fields during update validation for playlist and channel', async () => {
    const { validateNoProtectedFields } = await loadTypes();

    const p = validateNoProtectedFields(
      { title: 'Ok', id: 'override', slug: 'custom' },
      'playlist'
    );
    expect(p.isValid).toBe(false);
    expect(p.protectedFields).toEqual(['id', 'slug']);

    const c = validateNoProtectedFields({ title: 'Ok', created: 'now', signature: 'x' }, 'channel');
    expect(c.isValid).toBe(false);
    expect(c.protectedFields).toEqual(['created', 'signature']);
  });

  it('generateSlug outputs lowercased, hyphenated, and length-bounded slugs', async () => {
    const { generateSlug } = await loadTypes();

    const slug = generateSlug('Hello World! This Is A Very Long Title $$$ With Symbols');
    expect(slug).toMatch(/^[a-z0-9-]+-\d{4}$/);
    expect(slug.length).toBeLessThanOrEqual(64);
  });
});
