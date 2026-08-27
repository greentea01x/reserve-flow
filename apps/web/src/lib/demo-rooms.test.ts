import { describe, expect, it } from 'vitest';
import { selectDemoRooms } from './demo-rooms';

describe('selectDemoRooms', () => {
  it('keeps the canonical three-room order and ignores extra rooms', () => {
    const selected = selectDemoRooms([
      { code: 'overflow', name: 'Overflow Room' },
      { code: 'grove', name: 'Grove Room' },
      { code: 'summit', name: 'Summit Room' },
      { code: 'horizon', name: 'Horizon Room' },
    ]);

    expect(selected.map((room) => room.code)).toEqual(['horizon', 'summit', 'grove']);
  });

  it('falls back to a stable three-room list before demo data is loaded', () => {
    const selected = selectDemoRooms([
      { code: 'z', name: 'Zulu' },
      { code: 'b', name: 'Bravo' },
      { code: 'a', name: 'Alpha' },
      { code: 'c', name: 'Charlie' },
    ]);

    expect(selected.map((room) => room.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
});
