import boto3
import time
from botocore.exceptions import ClientError

bedrock_agent = boto3.client('bedrock-agent')

def lambda_handler(event, context):
    if event['RequestType'] == 'Create':
        return create_data_source(event, context)
    elif event['RequestType'] == 'Update':
        return update_data_source(event, context)
    elif event['RequestType'] == 'Delete':
        return delete_data_source(event, context)

def create_data_source(event, context):
    try:
        props = event['ResourceProperties']
        knowledge_base_id = props['knowledgeBaseId']
        urls = [{"url": url} for url in props['urls']]
        print(urls)
        response = bedrock_agent.create_data_source(
            knowledgeBaseId=knowledge_base_id,
            name='WebCrawlerDataSource',
            description='Web crawler data source for Bedrock Knowledge Base',
            dataDeletionPolicy='RETAIN',  # Add this line
            dataSourceConfiguration={
                'type': 'WEB',
                'webConfiguration': {
                    'crawlerConfiguration': {
                        'crawlerLimits': {
                            'rateLimit': 300  # Max rate, adjust as needed
                        },
                        'scope': 'SUBDOMAINS'  # Adjust scope as needed
                    },
                    'sourceConfiguration': {
                        'urlConfiguration': {
                            'seedUrls': urls
                        }
                    }
                }
            },
            vectorIngestionConfiguration={
                'chunkingConfiguration': {
                    'chunkingStrategy': 'NONE',
                }
            }
        )

        data_source_id = response['dataSource']['dataSourceId']
        status = response['dataSource']['status']
        print(response)
        
        if status != 'AVAILABLE':
            failure_reasons = response['dataSource'].get('failureReasons', [])
            if failure_reasons:
                raise Exception(f"Data source creation failed. Reasons: {', '.join(failure_reasons)}")

        return {
            'Status': 'SUCCESS',
            'PhysicalResourceId': data_source_id,
            'Data': {
                'dataSourceId': data_source_id
            }
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        raise e
def delete_data_source(event, context):
    try:
        knowledge_base_id = event['ResourceProperties']['knowledgeBaseId']
        data_source_id = event['PhysicalResourceId']
        bedrock_agent.delete_data_source(knowledgeBaseId=knowledge_base_id, dataSourceId=data_source_id)
        max_retries = 30
        retry_delay = 5  # seconds

        for attempt in range(max_retries):
            try:
                bedrock_agent.get_data_source(knowledgeBaseId=knowledge_base_id, dataSourceId=data_source_id)
                print(f"Data source still exists. Attempt {attempt + 1}/{max_retries}")
                time.sleep(retry_delay)
            except ClientError as e:
                if e.response['Error']['Code'] == 'ResourceNotFoundException':
                    print("Data source successfully deleted")
                    return {
                        'Status': 'SUCCESS',
                        'Data': {}
                    }
                else:
                    print(f"Unexpected error: {e}")
                    raise e

        print(f"Data source not deleted after {max_retries} attempts")
        raise Exception("Failed to confirm data source deletion")
    except Exception as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            print("Data source successfully deleted")
            return {
                        'Status': 'SUCCESS',
                        'Data': {}
                    }
        else:
            print(f"Unexpected error: {e}")
            raise e
def update_data_source(event, context):
    try:
        props = event['ResourceProperties']
        knowledge_base_id = props['knowledgeBaseId']
        data_source_id = props['dataSourceId']
        urls = [{"url": url} for url in props['urls']]
        bedrock_agent.update_data_source(
            knowledgeBaseId=knowledge_base_id, 
            dataSourceId=data_source_id, 
            name='WebCrawlerDataSource', 
            description='Web crawler data source for Bedrock Knowledge Base',
            dataSourceConfiguration={
                'type': 'WEB',
                'webConfiguration': {
                    'crawlerConfiguration': {
                        'crawlerLimits': {
                            'rateLimit': 300  # Max rate, adjust as needed
                        },
                        'scope': 'DEFAULT'  # Adjust scope as needed
                    },
                    'sourceConfiguration': {
                        'urlConfiguration': {
                            'seedUrls': urls
                        }
                    }
                }
            }
        )
        return {
            'Status': 'SUCCESS',
            'Data': {}
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        raise e