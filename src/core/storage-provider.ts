export interface StorageProvider {
  upload(fileName: string, content: string | Buffer, bucketName?: string): Promise<void>;
  getSignedUrl(fileName: string, bucketName?: string): Promise<string>;
  download(fileName: string, bucketName?: string): Promise<any>;
}

export class S3StorageProvider implements StorageProvider {
  constructor(private defaultBucket?: string) {}

  async upload(fileName: string, content: string | Buffer, bucketName?: string): Promise<void> {
    const { uploadFile } = await import('../client/s3');
    await uploadFile(fileName, content, bucketName || this.defaultBucket || '');
  }

  async getSignedUrl(fileName: string, bucketName?: string): Promise<string> {
    const { getSignedUrlForDownload } = await import('../client/s3');
    return await getSignedUrlForDownload(bucketName || this.defaultBucket || '', fileName);
  }

  async download(fileName: string, bucketName?: string): Promise<any> {
    const { getFile } = await import('../client/s3');
    return await getFile(fileName, bucketName || this.defaultBucket || '');
  }
}
