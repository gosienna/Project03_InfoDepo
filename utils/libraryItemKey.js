/** Stable React keys / upload status maps — driveId is unique across stores. */
export const libraryItemKey = (item) => `${item?.type || 'item'}-${item?.driveId || ''}`;
