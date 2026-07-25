const FREE_EXPORT_USED_KEY = "autocutFreeExportUsedAt";

type PrivateMetadata = Record<string, unknown>;

const userExportLocks = new Map<string, Promise<void>>();

export function hasUsedFreeExport(privateMetadata: PrivateMetadata) {
  return typeof privateMetadata[FREE_EXPORT_USED_KEY] === "string";
}

export function freeExportMetadata() {
  return { [FREE_EXPORT_USED_KEY]: new Date().toISOString() };
}

export function dodoCheckoutUrl() {
  const value = process.env.DODO_PAYMENTS_CHECKOUT_URL;
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function withUserExportLock<T>(userId: string, task: () => Promise<T>) {
  const previous = userExportLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  userExportLocks.set(userId, current);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (userExportLocks.get(userId) === current) userExportLocks.delete(userId);
  }
}
