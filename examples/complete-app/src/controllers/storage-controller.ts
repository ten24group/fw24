import { Controller, Get, Post, APIController } from '@ten24group/fw24';
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';

@Controller('storage', {
    resourceAccess: {
        buckets: ['assets-bucket']
    }
})
export class StorageController extends APIController {

    private s3 = new S3Client({
        endpoint: process.env.AWS_ENDPOINT_URL_S3,
        forcePathStyle: true
    });

    @Get('/')
    async listFiles() {
        const bucketName = process.env.BUCKET_ASSETS_BUCKET;
        const command = new ListObjectsV2Command({ Bucket: bucketName });
        const response = await this.s3.send(command);

        return {
            statusCode: 200,
            body: JSON.stringify({ files: response.Contents?.map(c => c.Key) || [] })
        };
    }

    @Post('/')
    async uploadFile(event: any) {
        const bucketName = process.env.BUCKET_ASSETS_BUCKET;
        const { name, content } = JSON.parse(event.body || '{}');

        await this.s3.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: name,
            Body: content
        }));

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "File uploaded successfully" })
        };
    }
}
