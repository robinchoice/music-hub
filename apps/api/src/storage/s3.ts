import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: 'eu-central-1',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
});

const bucket = process.env.S3_BUCKET!;

// The signed Content-Length and Content-Type make the bucket reject uploads of any
// other size or type, so what was checked when issuing the URL is what gets stored.
export async function createUploadUrl(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(s3, command, { expiresIn: 900, signableHeaders: new Set(['content-type']) }); // 15 min
}

export async function createDownloadUrl(key: string, expiresIn = 3600, downloadName?: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    // Makes the browser save the file instead of playing it in a new tab
    ResponseContentDisposition: downloadName
      ? `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`
      : undefined,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

export async function getObjectBuffer(key: string): Promise<Uint8Array<ArrayBuffer>> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(command);
  return response.Body!.transformToByteArray() as Promise<Uint8Array<ArrayBuffer>>;
}

// Reads the object chunk by chunk, for files too large to hold in memory
export async function getObjectStream(key: string): Promise<ReadableStream<Uint8Array>> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(command);
  return response.Body!.transformToWebStream();
}

export async function putObject(key: string, body: string | Uint8Array, contentType: string): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await s3.send(command);
}

// Size of a stored object, or null if there is none.
export async function getObjectSize(key: string): Promise<number | null> {
  const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
  try {
    const head = await s3.send(command);
    return head.ContentLength ?? null;
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// Browsers upload to and stream from presigned URLs directly, so the bucket
// must allow the app's origin. Replaces any existing CORS rules.
export async function allowBrowserAccess(origins: string[]): Promise<void> {
  const command = new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['GET', 'HEAD', 'PUT'],
          AllowedHeaders: ['*'],
        },
      ],
    },
  });
  await s3.send(command);
}

export async function deleteObject(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  await s3.send(command);
}
