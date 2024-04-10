import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client();

export const uploadFile = async (fileName: string, contents: any, bucketName: string) => {
    
    const uploadCommand = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: contents,
    });

    const result = await s3Client.send(uploadCommand);
    return result;
}

export const deleteFile = async (fileName: string, bucketName: string) => {
    
    const deleteCommand = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: fileName,
    });

    const result = await s3Client.send(deleteCommand);
    return result;
}
