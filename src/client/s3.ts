import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Command } from "@smithy/smithy-client";
import { MetadataBearer, RequestPresigningArguments } from "@smithy/types";


export const defaultS3Client = new S3Client();

export const uploadFile = async (fileName: string, contents: any, bucketName: string) => {
    
    const uploadCommand = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: contents,
    });

    const result = await defaultS3Client.send(uploadCommand);
    return result;
}

export const deleteFile = async (fileName: string, bucketName: string) => {
    
    const deleteCommand = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: fileName,
    });

    const result = await defaultS3Client.send(deleteCommand);
    return result;
}

export const getSignedUrlForCommand = async <InputTypesUnion extends object, InputType extends InputTypesUnion, OutputType extends MetadataBearer = MetadataBearer>( 
    command: Command<InputType, OutputType, any, InputTypesUnion, MetadataBearer>, 
    options: RequestPresigningArguments = { expiresIn: 15 * 60 },
    client: S3Client = defaultS3Client,
) => {  
    return await getSignedUrl(client, command as any, options);
}

export type SignedUrlForFileUploadOptions = {
    fileName: string, 
    bucketName: string, 
    contentType?: string, 
    expiresIn?: number
};

export const getSignedUrlForFileUpload = async ({ bucketName, fileName, contentType, expiresIn = 15 * 60 }: SignedUrlForFileUploadOptions ) => {

    const command = new PutObjectCommand({ 
        Bucket: bucketName, 
        Key: fileName, 
        ContentType: contentType 
    });

    return await getSignedUrlForCommand(command, {expiresIn});
}