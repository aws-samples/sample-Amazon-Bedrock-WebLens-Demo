import { Construct } from 'constructs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';

interface AppStackProps extends cdk.StackProps {
  customerName: string;
  knowledgeBaseId: string;
}

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'BackendVPC', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'BackendCluster', { vpc });

    const taskRole = new iam.Role(this, 'BackendTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    taskRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'));
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: ['bedrock:*']
    }));

    const backendService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'BackendService', {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      taskImageOptions: {
        containerPort: 5000,
        image: ecs.ContainerImage.fromAsset('lib/backend', {
          platform: Platform.LINUX_ARM64
        }),
        environment: {
          AWS_REGION: this.region,
          CUSTOMER_NAME: props.customerName,
          KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
        },
        taskRole,
      },
      publicLoadBalancer: true,
    });

    backendService.targetGroup.configureHealthCheck({
      path: '/api/',
    });

    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Delete the bucket when the stack is destroyed
      autoDeleteObjects: true, // Automatically delete all objects in the bucket when it's removed
      publicReadAccess: false,
    });

    // Create an Origin Access Identity for CloudFront
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI');
    

    // Grant read permissions to the OAI
    websiteBucket.grantRead(originAccessIdentity);

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, {
          originAccessIdentity: originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.LoadBalancerV2Origin(backendService.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
            headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('Host'),
            queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
          }),
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // Deploy the React app build
    const websiteDeployment = new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, './frontend'), {
        bundling: {
          command: [
            '/bin/sh',
            '-c',
            `npm install && npm run build && cp -r build/. /asset-output/`
          ],
          image: cdk.DockerImage.fromRegistry('node:20'),
          user: 'root',
        },
      }),s3deploy.Source.jsonData('config.json', {
        backendUrl: `/api`,
        customerName: props.customerName,
      })],

      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'Frontend URL',
    });

    // Create DynamoDB table for kb-products
    const productTable = new dynamodb.Table(this, 'KbProductsTable', {
      tableName: `${props.customerName}-kb-products`,
      partitionKey: { name: 'name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use with caution in production
    });

    // Create DynamoDB table for kb-info (site info)
    const siteInfoTable = new dynamodb.Table(this, 'KbInfoTable', {
      tableName: `${props.customerName}-kb-info`,
      partitionKey: { name: 'item_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'title', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use with caution in production
    });

    // Grant read/write permissions to the backend task for both tables
    productTable.grantReadWriteData(taskRole);
    siteInfoTable.grantReadWriteData(taskRole);

    // Add the table names to the backend service environment variables
    backendService.taskDefinition.defaultContainer?.addEnvironment(
      'PRODUCT_TABLE_NAME',
      productTable.tableName
    );
    backendService.taskDefinition.defaultContainer?.addEnvironment(
      'SITE_INFO_TABLE_NAME',
      siteInfoTable.tableName
    );

    // Create DynamoDB table for kb-catalogs
    const catalogsTable = new dynamodb.Table(this, 'KbCatalogsTable', {
      tableName: `${props.customerName}-kb-catalogs`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use with caution in production
    });

    // Grant read/write permissions to the backend task for the catalogs table
    catalogsTable.grantReadWriteData(taskRole);

    // Add the table name to the backend service environment variables
    backendService.taskDefinition.defaultContainer?.addEnvironment(
      'CATALOGS_TABLE_NAME',
      catalogsTable.tableName
    );
  }
}
