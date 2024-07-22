---
sidebar_position: 5
---

# Adding Custom Domain

FW24 simplifies the process of adding custom domain for your APIs, buckets and amplify site. Custom domains require ACM certificate. If you don't specify certificateArn, fw24 will add an ACM for your domain. In either case, you will need to add the DNS validation record to your DNS provider. More on that here: [ACM DNS validation](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html). Please note: Deployment will not finish until certificate is validated and provisioned.


## Custom domain for API Gateway

Here is an example for adding custom domain for API gateway

```ts
const api = new APIConstruct({
	...
	domainName: YOUR_API_DOMAIN,
	certificateArn: YOUR_API_DOMAIN_CERTIFICATE,
    ...
});
```

Once the deployment is complete, you will need to create a CNAME pointing your domain to the regional endpoint of the API gateway. You can find this url in the AWS console of API Gateway. 

## Custom domain for bucket

Here is an example for adding custom domain for s3 bucket

```ts
const s3 = new BucketConstruct([
		{
			bucketName: BUCKET_NAME,
			...
			cfnDistributionConfig: {
				domainName: YOUR_BUCKET_DOMAIN,
				certificateArn: YOUR_BUCKET_DOMAIN_CERTIFICATE,
			}
            ...
		},
	]
);
```

Once Deployment is complete, you will need to create a CNAME pointing the domain for the bucket to CloudFront. You can find the CloudFront domain in the fw24 console output or in AWS console for the s3 bucket. 

## Custom domain for Amplify

Here is an example of adding custom domain for Amplify

```ts
var amplify = new SiteConstruct({
	...
	domain: YOUR_DOMAIN,
	subdomain: YOUR_SUBDOMAIN,
	mapRootDomain: YOUR_MAP_ROOT_DOMAIN === 'true' ? true : false,
    githubBranch: YOUR_GITHUB_BRANCH || 'develop',
    ...
})
```

Once the deployment is complete, you will need to create a CNAME pointing your domain to the amplify app. Follow instructions in the AWS Amplify console to finish setup. 