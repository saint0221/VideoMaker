import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION || 'ap-northeast-2';

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({ region: REGION });
  }
  return _client;
}

export function s3Enabled(): boolean {
  return !!BUCKET;
}

function projectKey(id: string, filename: string): string {
  return `projects/${id}/${filename}`;
}

export function uploadToS3(id: string, filename: string, body: Buffer | string): void {
  if (!BUCKET) return;
  const key = projectKey(id, filename);
  const ContentType = filename.endsWith('.json')
    ? 'application/json'
    : filename.endsWith('.md')
    ? 'text/markdown'
    : 'application/octet-stream';
  getClient()
    .send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType }))
    .catch((err) => console.error(`[S3] upload failed: ${key}`, err));
}

export async function downloadFromS3(id: string, filename: string): Promise<Buffer | null> {
  if (!BUCKET) return null;
  const key = projectKey(id, filename);
  try {
    const res = await getClient().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null;
    console.error(`[S3] download failed: ${key}`, err);
    return null;
  }
}

export async function deleteProjectFromS3(id: string): Promise<void> {
  if (!BUCKET) return;
  const prefix = `projects/${id}/`;
  try {
    let continuationToken: string | undefined;
    do {
      const res = await getClient().send(
        new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: continuationToken })
      );
      const keys = (res.Contents ?? []).map((o) => o.Key).filter(Boolean) as string[];
      await Promise.all(
        keys.map((k) =>
          getClient()
            .send(new DeleteObjectCommand({ Bucket: BUCKET!, Key: k }))
            .catch((err) => console.error(`[S3] delete failed: ${k}`, err))
        )
      );
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
  } catch (err) {
    console.error(`[S3] list for delete failed: ${prefix}`, err);
  }
}
