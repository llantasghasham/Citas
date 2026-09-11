import { db } from '@/lib/db/client';
import type { TenantScope } from '@/lib/db/tenant';

export interface StoredRender {
  data: Uint8Array<ArrayBuffer>;
  contentHash: string;
}

/**
 * Where a generated image is kept so it is produced once and not once per
 * visitor. This matters on exactly one day: the afternoon the invitation is
 * forwarded around a WhatsApp group, when every preview would otherwise start
 * its own copy of Chromium.
 *
 * The bytes live in PostgreSQL because that works in any deployment with
 * nothing to configure. Moving to object storage with a CDN means replacing
 * this one file.
 */
export interface RenderStore {
  find(scope: TenantScope, versionId: string, contentHash: string): Promise<StoredRender | null>;
  save(input: {
    scope: TenantScope;
    versionId: string;
    contentHash: string;
    data: Uint8Array<ArrayBuffer>;
    width: number;
    height: number;
  }): Promise<void>;
}

export const databaseRenderStore: RenderStore = {
  async find(scope, versionId, contentHash) {
    const row = await db(scope).render.findFirst({
      where: { versionId, kind: 'png', contentHash },
      select: { data: true },
    });
    if (row?.data == null) return null;
    return { data: new Uint8Array(row.data), contentHash };
  },

  async save({ scope, versionId, contentHash, data, width, height }) {
    const prisma = db(scope);
    // One image per version: an older fingerprint is a picture of an invitation
    // that no longer exists.
    await prisma.render.deleteMany({ where: { versionId, kind: 'png' } });
    await prisma.render.create({
      data: {
        versionId,
        kind: 'png',
        contentHash,
        data: Buffer.from(data),
        width,
        height,
        bytes: data.byteLength,
      },
    });
  },
};

/**
 * Caching needs a row to hang the image off, which only exists when PostgreSQL
 * is the data source. With the JSON file there is nothing to key on, so every
 * request renders — acceptable, because that mode is for local demos.
 */
export function getRenderStore(): RenderStore | null {
  return process.env['DATA_SOURCE'] === 'database' ? databaseRenderStore : null;
}
