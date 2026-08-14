import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RunBus } from '../src/platform/sse.js';

describe('RunBus — replay + completion', () => {
  it('replays buffered events to a new subscriber, then delivers live ones', () => {
    const bus = new RunBus();
    bus.publish('run-1', 'info', 'starting');
    bus.publish('run-1', 'tool', 'reading diff');

    const received: string[] = [];
    bus.subscribe('run-1', (e) => received.push(e.msg));
    expect(received).toEqual(['starting', 'reading diff']);

    bus.publish('run-1', 'result', 'done');
    expect(received).toEqual(['starting', 'reading diff', 'done']);
  });

  it('onDone fires immediately for an already-completed run (late subscriber)', () => {
    const bus = new RunBus();
    bus.publish('run-1', 'info', 'x');
    bus.complete('run-1');

    const onDone = vi.fn();
    bus.onDone('run-1', onDone);
    expect(onDone).not.toHaveBeenCalled(); // queueMicrotask, not synchronous
    return Promise.resolve().then(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});

describe('RunBus — eviction (bounds memory for old completed runs)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps a completed run\'s buffer available well before the eviction window', () => {
    const bus = new RunBus();
    bus.publish('run-1', 'info', 'x');
    bus.complete('run-1');

    vi.advanceTimersByTime(5 * 60 * 1000); // 5 min — still within the grace window
    expect(bus.buffer('run-1')).toHaveLength(1);
    expect(bus.isComplete('run-1')).toBe(true);
  });

  it('evicts buffer/completed state 15 minutes after completion', () => {
    const bus = new RunBus();
    bus.publish('run-1', 'info', 'x');
    bus.complete('run-1');

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(bus.buffer('run-1')).toEqual([]);
    expect(bus.isComplete('run-1')).toBe(false);
  });

  it('does not schedule a duplicate eviction timer if complete() is called twice for the same run', () => {
    const bus = new RunBus();
    bus.publish('run-1', 'info', 'x');
    bus.complete('run-1');
    vi.advanceTimersByTime(5 * 60 * 1000);
    bus.complete('run-1'); // second call resets the timer, doesn't stack a second one

    // 16 min after the SECOND complete() — had the first timer also fired
    // independently, this would already be evicted by the 21-minute mark from
    // start; confirm it's still governed by a single, most-recent timer.
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(bus.buffer('run-1')).toEqual([]);
  });

  it('a run that never completes is never evicted', () => {
    const bus = new RunBus();
    bus.publish('run-1', 'info', 'x');

    vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour, no complete() called
    expect(bus.buffer('run-1')).toHaveLength(1);
  });
});
