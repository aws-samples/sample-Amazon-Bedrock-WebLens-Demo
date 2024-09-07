import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaPython from '@aws-cdk/aws-lambda-python-alpha';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as logs from 'aws-cdk-lib/aws-logs';

interface KBStackProps extends cdk.StackProps {
    customerName: string;
    scrapeUrls?: string[];
}

export class KBStack extends cdk.Stack {
    public readonly knowledgeBaseId: string;
    constructor(scope: cdk.App, id: string, props: KBStackProps) {
        super(scope, id, props);
        let customerName = props.customerName.toLowerCase();
        customerName = customerName.replace(/[^a-z0-9]/g, '');
        customerName = customerName.replace(/^[0-9]+/, '');
        if (customerName === '' || customerName.length < 3) {
            customerName = 'customer' + Math.random().toString(36).substring(2, 7);
        }
        customerName = customerName.substring(0, 28); // Ensure it's not too long
        const collectionName = `${customerName}-collection`;

        // Create an IAM role for the Knowledge Base
        const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
            assumedBy: new iam.CompositePrincipal(
                new iam.ServicePrincipal('bedrock.amazonaws.com'),
                new iam.ServicePrincipal('lambda.amazonaws.com')
            ),
            // Add necessary permissions to the role
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ],
        });

        // Create an IAM role for the InitializeIndexLambda
        const indexRole = new iam.Role(this, 'InitializeIndexLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ],
        });

        // Add permissions for OpenSearch Serverless and Bedrock
        knowledgeBaseRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'aoss:*',
                'bedrock:InvokeModel'
            ],
            resources: ['*'],
        }));

        // Create OpenSearch Serverless Access Policy
        const ossAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'OSSAccessPolicy', {
            name: `${customerName}-access-policy`,
            type: 'data',
            description: 'Access policy for Bedrock Knowledge Base collection',
            policy: JSON.stringify([
                {
                    Description: "Access for Bedrock Knowledge Base",
                    Rules: [
                        {
                            ResourceType: "index",
                            Resource: ["index/" + collectionName + "/*"],
                            Permission: ["aoss:*"]
                        },
                        {
                            ResourceType: "collection",
                            Resource: ["collection/" + collectionName],
                            Permission: ["aoss:*"]
                        }
                    ],
                    Principal: [knowledgeBaseRole.roleArn, indexRole.roleArn]
                }
            ])
        });

        // Create OpenSearch Serverless Network Policy
        const ossNetworkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'OSSNetworkPolicy', {
            name: `${customerName}-network-policy`,
            type: 'network',
            policy: JSON.stringify( [{"Rules":[
                {"ResourceType":"collection","Resource":["collection/" + collectionName]},
                {"ResourceType":"dashboard","Resource":["collection/" + collectionName]}],"AllowFromPublic":true},
            ]
            )
            }
        );
        
        // Create OpenSearch Serverless Security Policy
        const ossSecurityPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'OSSSecurityPolicy', {
            name: `${customerName}-security-policy`,
            type: 'encryption',
            policy: JSON.stringify({
                "Rules": [{"ResourceType": "collection", "Resource": ["collection/" + collectionName]}],
                "AWSOwnedKey": true
            })
        });

        // Create OpenSearch Serverless Collection
        const ossCollection = new opensearchserverless.CfnCollection(this, 'MyCollection', {
            name: collectionName,
            type: 'VECTORSEARCH',
        });

        ossCollection.addDependency(ossSecurityPolicy);
        ossNetworkPolicy.addDependency(ossCollection);
        ossAccessPolicy.addDependency(ossCollection);

        indexRole.addToPolicy(new iam.PolicyStatement({
            actions: ['aoss:*'],
            resources: [ossCollection.attrArn],
        }));

        // Create a Lambda function to initialize the index
        const initializeIndexLambda = new lambdaPython.PythonFunction(this, 'InitializeIndexLambda', {
            entry: path.join(__dirname, 'initialize-index-lambda'),
            runtime: lambda.Runtime.PYTHON_3_9,
            index: 'index.py',
            handler: 'lambda_handler',
            timeout: cdk.Duration.seconds(300),
            environment: {
                COLLECTION_ENDPOINT: ossCollection.attrCollectionEndpoint,
            },
            role: indexRole
        });

        // Create a provider for the initialize index custom resource
        const initializeIndexProvider = new cr.Provider(this, 'InitializeIndexProvider', {
            onEventHandler: initializeIndexLambda,
            logRetention: logs.RetentionDays.ONE_DAY,
        });

        // Create the OSS Index Custom Resource
        const ossIndexResource = new cdk.CustomResource(this, 'CreateIndexResource', {
            serviceToken: initializeIndexProvider.serviceToken,
            properties: {
                CollectionEndpoint: ossCollection.attrCollectionEndpoint,
            },
        });

        ossIndexResource.node.addDependency(ossAccessPolicy);
        ossIndexResource.node.addDependency(ossNetworkPolicy);
        ossIndexResource.node.addDependency(ossSecurityPolicy);


        // Create the Knowledge Base
        const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'MyKnowledgeBase', {
            name: `${customerName}-knowledge-base`,
            roleArn: knowledgeBaseRole.roleArn,
            
            knowledgeBaseConfiguration: {
                type: 'VECTOR',
                vectorKnowledgeBaseConfiguration: {
                    embeddingModelArn: 'arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v1',
                },
            },
            storageConfiguration: {
                type: 'OPENSEARCH_SERVERLESS',
                opensearchServerlessConfiguration: {
                    collectionArn: ossCollection.attrArn,
                    fieldMapping: {
                        metadataField: 'metadata',
                        textField: 'text',
                        vectorField: 'vector_field'
                    },
                    vectorIndexName: 'my_vector_index'
                },
            },
            description: 'Bedrock Knowledge Base',
        });
        knowledgeBase.node.addDependency(ossIndexResource);

        // Create a new role for the Lambda function
        const dataSourceLambdaRole = new iam.Role(this, 'DataSourceLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        });

        // Add permissions for Bedrock operations
        dataSourceLambdaRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'bedrock:CreateDataSource',
                'bedrock:DeleteDataSource',
                'bedrock:ListDataSources',
                'bedrock:GetDataSource',
                'bedrock:UpdateDataSource'
            ],
            resources: ['*'],
        }));

        // Add permissions for passing the role to Bedrock
        dataSourceLambdaRole.addToPolicy(new iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [knowledgeBaseRole.roleArn],
        }));

        // Create Bedrock Knowledge Base Custom ResourceLambda
        const datasourceLambda = new lambda.Function(this, 'DataSourceLambda', {
            runtime: lambda.Runtime.PYTHON_3_9,
            handler: 'index.lambda_handler',
            timeout: cdk.Duration.seconds(300),
            code: lambda.Code.fromAsset(path.join(__dirname, 'create-datasource')),
            role: dataSourceLambdaRole,
            environment: {
                KNOWLEDGE_BASE_ROLE_ARN: knowledgeBaseRole.roleArn,
            },
        });

        // Create a provider for the data source custom resource
        const dataSourceProvider = new cr.Provider(this, 'DataSourceProvider', {
            onEventHandler: datasourceLambda,
            logRetention: logs.RetentionDays.ONE_DAY,
        });


        // Create Data Source Custom Resource
        const brDataSourceResource = new cdk.CustomResource(this, 'BRDataSourceResource', {
            serviceToken: dataSourceProvider.serviceToken,
            properties: {
                urls: props?.scrapeUrls,
                knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
                
            },
        });

        // Create a new role for the Ingestion Job Lambda function
        const ingestionJobLambdaRole = new iam.Role(this, 'IngestionJobLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        });

        // Add permissions for Bedrock operations
        ingestionJobLambdaRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'bedrock:StartIngestionJob',
                'bedrock:GetIngestionJob',
                'bedrock:ListIngestionJobs'
            ],
            resources: ['*'],
        }));

        // Create Ingestion Job Lambda
        const ingestionJobLambda = new lambda.Function(this, 'IngestionJobLambda', {
            runtime: lambda.Runtime.PYTHON_3_9,
            timeout: cdk.Duration.seconds(300),
            handler: 'index.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, 'start-ingestion-job')),
            role: ingestionJobLambdaRole,
        });

        // Create a provider for the ingestion job custom resource
        const ingestionJobProvider = new cr.Provider(this, 'IngestionJobProvider', {
            onEventHandler: ingestionJobLambda,
            logRetention: logs.RetentionDays.ONE_DAY,
        });

        // Create Ingestion Job Custom Resource
        const brIngestionJobResource = new cdk.CustomResource(this, 'BRIngestionJobResource', {
            serviceToken: ingestionJobProvider.serviceToken,
            properties: {
                knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
                dataSourceId: brDataSourceResource.getAtt('dataSourceId')
            },
        });

        brIngestionJobResource.node.addDependency(brDataSourceResource);
        this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    }
}