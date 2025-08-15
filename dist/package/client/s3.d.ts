import { S3Client } from '@aws-sdk/client-s3';
import { Command } from "@smithy/smithy-client";
import { MetadataBearer, RequestPresigningArguments } from "@smithy/types";
export declare const defaultS3Client: S3Client;
export declare const uploadFile: (fileName: string, contents: any, bucketName: string) => Promise<import("@aws-sdk/client-s3").PutObjectCommandOutput>;
export declare const deleteFile: (fileName: string, bucketName: string) => Promise<import("@aws-sdk/client-s3").DeleteObjectCommandOutput>;
export declare const getFile: (fileName: string, bucketName: string) => Promise<import("@aws-sdk/client-s3").GetObjectCommandOutput>;
export declare const getFileMetadata: (fileName: string, bucketName: string) => Promise<import("@aws-sdk/client-s3").HeadObjectCommandOutput>;
export declare const getSignedUrlForCommand: <InputTypesUnion extends object, InputType extends InputTypesUnion, OutputType extends MetadataBearer = MetadataBearer>(command: Command<InputType, OutputType, any, InputTypesUnion, MetadataBearer>, options?: RequestPresigningArguments, client?: S3Client) => Promise<string>;
export type SignedUrlForFileUploadOptions = {
    fileName: string;
    bucketName: string;
    contentType?: string;
    expiresIn?: number;
    customDomain?: string;
    metadata?: Record<string, string>;
};
export declare const getSignedUrlForFileUpload: ({ bucketName, fileName, contentType, expiresIn, customDomain, metadata }: SignedUrlForFileUploadOptions) => Promise<string>;
