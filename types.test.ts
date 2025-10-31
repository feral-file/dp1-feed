import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValidationResult } from 'dp1-js';

const successResult: ValidationResult = { success: true };

const dp1Mock = {
  signDP1Playlist: vi.fn(),
  validateDisplayPrefs: vi.fn<() => ValidationResult>(() => successResult),
  validateDpVersion: vi.fn<() => ValidationResult>(() => successResult),
  validateRepro: vi.fn<() => ValidationResult>(() => successResult),
  validateProvenance: vi.fn<() => ValidationResult>(() => successResult),
  validatePlaylistItem: vi.fn<() => ValidationResult>(() => successResult),
};

vi.mock('dp1-js', () => ({
  Playlist: {} as any,
  signDP1Playlist: dp1Mock.signDP1Playlist,
  validateDisplayPrefs: dp1Mock.validateDisplayPrefs,
  validateDpVersion: dp1Mock.validateDpVersion,
  validateRepro: dp1Mock.validateRepro,
  validateProvenance: dp1Mock.validateProvenance,
  validatePlaylistItem: dp1Mock.validatePlaylistItem,
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
  dp1Mock.signDP1Playlist.mockReset();
  dp1Mock.validateDisplayPrefs.mockReset();
  dp1Mock.validateDpVersion.mockReset();
  dp1Mock.validateRepro.mockReset();
  dp1Mock.validateProvenance.mockReset();
  dp1Mock.validatePlaylistItem.mockReset();

  dp1Mock.validateDisplayPrefs.mockImplementation(() => successResult);
  dp1Mock.validateDpVersion.mockImplementation(() => successResult);
  dp1Mock.validateRepro.mockImplementation(() => successResult);
  dp1Mock.validateProvenance.mockImplementation(() => successResult);
  dp1Mock.validatePlaylistItem.mockImplementation(() => successResult);
}

const loadTypes = () => import('./types');

describe('types schemas integration with dp1-js validators', () => {
  beforeEach(() => {
    resetValidatorMocks();
    vi.resetModules();
  });

  it('propagates display validation issues from dp1-js with nested paths', async () => {
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

  it('falls back to dp1-js error message when no granular issues are provided', async () => {
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

  it('falls back to single issue for playlist item when no granular issues are provided', async () => {
    dp1Mock.validatePlaylistItem.mockImplementationOnce(() => ({
      success: false as const,
      error: { message: 'Generic item error', issues: [] },
    }));

    const { PlaylistSchema } = await loadTypes();

    const result = PlaylistSchema.safeParse({
      dpVersion: '1.0.0',
      id: '550e8400-e29b-41d4-a716-446655440000',
      slug: 'test-slug',
      title: 'Stored Playlist',
      created: '2024-01-01T00:00:00.000Z',
      items: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Item',
          source: 'https://example.com/item.html',
          duration: 120,
          license: 'open',
          created: '2024-01-01T00:00:00.000Z',
        },
      ],
      signature: 'ed25519:0x1234567890abcdef',
    });

    expect(result.success).toBe(false);
    // Path should point to the array element (items.0)
    const issue = result.error?.issues[0];
    expect(issue?.path.slice(0, 2)).toEqual(['items', 0]);
    expect(issue?.message).toBe('Generic item error');
  });

  it('surfaces dpVersion validation errors returned by dp1-js', async () => {
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

  it('invokes playlist item validator for stored playlists', async () => {
    dp1Mock.validatePlaylistItem.mockImplementationOnce(() => ({
      success: false as const,
      error: { message: 'Invalid playlist item', issues: [{ path: 'source', message: 'bad' }] },
    }));

    const { PlaylistSchema } = await loadTypes();

    const result = PlaylistSchema.safeParse({
      dpVersion: '1.0.0',
      id: '550e8400-e29b-41d4-a716-446655440000',
      slug: 'test-slug',
      title: 'Stored Playlist',
      created: '2024-01-01T00:00:00.000Z',
      items: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Item',
          source: 'https://example.com/item.html',
          duration: 120,
          license: 'open',
          created: '2024-01-01T00:00:00.000Z',
        },
      ],
      signature: 'ed25519:0x1234567890abcdef',
    });

    expect(result.success).toBe(false);
    expect(dp1Mock.validatePlaylistItem).toHaveBeenCalledTimes(1);
    const issue = result.error?.issues[0];
    expect(issue?.path.at(-1)).toBe('source');
    expect(issue?.message).toBe('bad');
  });

  it('accepts playlist input when all dp1-js validators succeed', async () => {
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

  it('creates playlists with generated identifiers and timestamps', async () => {
    const { createPlaylistFromInput } = await loadTypes();

    const playlist = createPlaylistFromInput(basePlaylistInput);

    expect(playlist.id).toMatch(/[0-9a-f-]{36}/);
    expect(playlist.slug).toMatch(/^test-playlist-\d{4}$/);
    expect(new Date(playlist.created as string).toString()).not.toBe('Invalid Date');
    playlist.items.forEach(item => {
      expect(item.id).toMatch(/[0-9a-f-]{36}/);
      expect(new Date(item.created as string).toString()).not.toBe('Invalid Date');
    });
  });

  it('identifies protected fields during update validation', async () => {
    const { validateNoProtectedFields } = await loadTypes();

    const result = validateNoProtectedFields({ title: 'Ok', id: 'override', slug: 'custom' });
    expect(result.isValid).toBe(false);
    expect(result.protectedFields).toEqual(['id', 'slug']);
  });
});
