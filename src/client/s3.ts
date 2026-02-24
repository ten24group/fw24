import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Command } from "@smithy/smithy-client";
import { MetadataBearer, RequestPresigningArguments } from "@smithy/types";
import { SpanObserver } from '../observability/observers/span';


export const defaultS3Client = new S3Client({
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
});

export const uploadFile = async (fileName: string, contents: any, bucketName: string) => {
    return SpanObserver.wrap('s3.upload', async () => {
        const uploadCommand = new PutObjectCommand({
            Bucket: bucketName,
            Key: fileName,
            Body: contents,
        });

        return defaultS3Client.send(uploadCommand);
    }, {
        level: 'debug',
        data: { bucket: bucketName, key: fileName },
        tags: { component: 'storage' },
    });
};

export const deleteFile = async (fileName: string, bucketName: string) => {
    return SpanObserver.wrap('s3.delete', async () => {
        const deleteCommand = new DeleteObjectCommand({
            Bucket: bucketName,
            Key: fileName,
        });

        return defaultS3Client.send(deleteCommand);
    }, {
        level: 'debug',
        data: { bucket: bucketName, key: fileName },
        tags: { component: 'storage' },
    });
};

export const getFile = async (fileName: string, bucketName: string) => {
    return SpanObserver.wrap('s3.get', async () => {
        const getCommand = new GetObjectCommand({
            Bucket: bucketName,
            Key: fileName,
        });

        return defaultS3Client.send(getCommand);
    }, {
        level: 'debug',
        data: { bucket: bucketName, key: fileName },
        tags: { component: 'storage' },
    });
};

export const getFileMetadata = async (fileName: string, bucketName: string) => {
    return SpanObserver.wrap('s3.headObject', async () => {
        const headCommand = new HeadObjectCommand({
            Bucket: bucketName,
            Key: fileName,
        });

        return defaultS3Client.send(headCommand);
    }, {
        level: 'debug',
        data: { bucket: bucketName, key: fileName },
        tags: { component: 'storage' },
    });
};

export const getSignedUrlForCommand = async <InputTypesUnion extends object, InputType extends InputTypesUnion, OutputType extends MetadataBearer = MetadataBearer>(
    command: Command<InputType, OutputType, any, InputTypesUnion, MetadataBearer>,
    options: RequestPresigningArguments = { expiresIn: 15 * 60 },
    client: S3Client = defaultS3Client,
) => {
    return await getSignedUrl(client, command as any, options);
};

export type SignedUrlForFileUploadOptions = {
    fileName: string,
    bucketName: string,
    contentType?: string,
    expiresIn?: number,
    customDomain?: string,
    metadata?: Record<string, string>
};

export const getSignedUrlForFileUpload = async ({ bucketName, fileName, contentType, expiresIn = 15 * 60, customDomain, metadata }: SignedUrlForFileUploadOptions) => {
    return SpanObserver.wrap('s3.getSignedUrl', async () => {
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: fileName,
            ContentType: contentType,
            Metadata: metadata,
            ChecksumAlgorithm: undefined, // Explicitly disable to prevent SDK from adding checksum headers
        });

        // Sign the Content-Type header so client can send it
        const signedUrl = await getSignedUrlForCommand(command, {
            expiresIn,
            signableHeaders: new Set(['content-type'])
        });

        if (!customDomain) {
            return signedUrl;
        }

        // Replace the default S3 endpoint, something like `...905418271365.s3.us-east-1.amazonaws.com` with `custom-domain` like `a.b.c.com`
        return signedUrl.replace(new RegExp(`${bucketName}\\.s3\\.[a-z0-9-]+\\.amazonaws\\.com`), customDomain);
    }, {
        level: 'debug',
        data: { bucket: bucketName, key: fileName, contentType },
        tags: { component: 'storage' },
    });
};
