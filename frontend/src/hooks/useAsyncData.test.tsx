import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useAsyncData } from './useAsyncData';

// The pages' data hooks are built on this; swapping mock data for an API call keeps the same behaviour
describe('useAsyncData', () => {
  it('starts loading, then returns the data', async () => {
    const load = vi.fn().mockResolvedValue({ value: 42 });
    const { result } = renderHook(() => useAsyncData(load));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ value: 42 });
    expect(result.current.error).toBeNull();
  });

  it('reports an error, and reload() tries again', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useAsyncData(load));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe('ok'));
    expect(result.current.error).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
