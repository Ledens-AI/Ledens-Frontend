import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// Where the bytes of obra photos and documents live (metadata: obra_archivos).
// - Azure Blob Storage, private container, when OBRA_ARCHIVOS_BLOB_URL is set
//   (https://<account>.blob.core.windows.net). Production authenticates with the
//   Container App's managed identity (AZURE_CLIENT_ID = id-ledens-backend), which
//   needs «Storage Blob Data Contributor» on the container — no keys, no SAS.
//   OBRA_ARCHIVOS_BLOB_CONNECTION_STRING instead is for Azurite in development.
// - A local folder otherwise (OBRA_ARCHIVOS_DIR, default <DATA_DIR>/obra-archivos),
//   but never implicitly in production: /data is the 1 GB Azure Files share that
//   holds leads.jsonl, so uploads answer 503 there until Blob is configured.
// Downloads always go through the backend, which checks permissions first.
export function createStorage(env = process.env) {
  const container = env.OBRA_ARCHIVOS_CONTAINER || 'obra-archivos';
  if (env.OBRA_ARCHIVOS_BLOB_URL || env.OBRA_ARCHIVOS_BLOB_CONNECTION_STRING) return blobStorage(env, container);
  if (env.OBRA_ARCHIVOS_DIR || env.NODE_ENV !== 'production') {
    return folderStorage(env.OBRA_ARCHIVOS_DIR || path.join(env.DATA_DIR || '/data', 'obra-archivos'));
  }
  return null;
}

let shared;
export const getStorage = () => (shared === undefined ? (shared = createStorage()) : shared);

// Keys are built by the service from uuids only (<obra>/<file>[.thumb.jpg]).
const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}(\.thumb\.jpg)?$/;
const checkKey = (key) => { if (!KEY.test(key)) throw new Error('invalid storage key'); return key; };

export function folderStorage(dir) {
  const file = (key) => path.join(dir, ...checkKey(key).split('/'));
  return {
    kind: 'folder',
    async put(key, content) {
      await fsp.mkdir(path.dirname(file(key)), { recursive: true });
      await fsp.writeFile(file(key), content, { flag: 'wx' });
    },
    async get(key) {
      const f = file(key);
      const { size } = await fsp.stat(f);
      return { size, stream: fs.createReadStream(f) };
    },
    async remove(key) { await fsp.rm(file(key), { force: true }); },
  };
}

function blobStorage(env, containerName) {
  let ready;
  const container = () => (ready ||= (async () => {
    const { BlobServiceClient } = await import('@azure/storage-blob');
    let service;
    if (env.OBRA_ARCHIVOS_BLOB_CONNECTION_STRING) {
      service = BlobServiceClient.fromConnectionString(env.OBRA_ARCHIVOS_BLOB_CONNECTION_STRING);
    } else {
      const { DefaultAzureCredential } = await import('@azure/identity');
      service = new BlobServiceClient(env.OBRA_ARCHIVOS_BLOB_URL, new DefaultAzureCredential({ managedIdentityClientId: env.AZURE_CLIENT_ID }));
    }
    const c = service.getContainerClient(containerName);
    // Created private (no access option) if missing; in production the
    // container is provisioned beforehand and the identity cannot create it.
    if (env.OBRA_ARCHIVOS_BLOB_CONNECTION_STRING) await c.createIfNotExists();
    return c;
  })().catch((e) => { ready = undefined; throw e; }));
  return {
    kind: 'blob',
    async put(key, content, mime) {
      await (await container()).getBlockBlobClient(checkKey(key)).uploadData(content, {
        blobHTTPHeaders: { blobContentType: mime },
        conditions: { ifNoneMatch: '*' },
      });
    },
    async get(key) {
      const r = await (await container()).getBlobClient(checkKey(key)).download();
      return { size: r.contentLength, stream: r.readableStreamBody };
    },
    async remove(key) { await (await container()).getBlobClient(checkKey(key)).deleteIfExists(); },
  };
}
