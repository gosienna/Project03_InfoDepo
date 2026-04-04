/** DB `id` is only unique per object store — pair with MIME type for stable React keys and maps. */
export const libraryItemKey = (item) => `${item?.type || 'item'}-${item?.id}`;
