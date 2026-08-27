const DEMO_ROOM_LIMIT = 3;
const ROOM_ORDER = new Map([
  ['horizon', 0],
  ['summit', 1],
  ['grove', 2],
]);

/** Keep every employee booking surface on the same three-room demo catalogue. */
export const selectDemoRooms = <RoomLike extends { code: string; name: string }>(
  rooms: readonly RoomLike[],
): RoomLike[] =>
  [...rooms]
    .sort((left, right) => {
      const byDemoOrder =
        (ROOM_ORDER.get(left.code.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
        (ROOM_ORDER.get(right.code.toLowerCase()) ?? Number.MAX_SAFE_INTEGER);
      return byDemoOrder === 0 ? left.name.localeCompare(right.name) : byDemoOrder;
    })
    .slice(0, DEMO_ROOM_LIMIT);
