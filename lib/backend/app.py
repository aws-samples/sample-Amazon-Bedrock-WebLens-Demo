from flask import Flask, request, Response, jsonify
from flask_cors import CORS
import os
import boto3
import json
from langchain_community.retrievers import AmazonKnowledgeBasesRetriever
from botocore.config import Config
import re
from dotenv import load_dotenv
from botocore.exceptions import ClientError
import uuid
import base64
import random
import io
from PIL import Image

# Check if any of the required environment variables are missing
required_env_vars = ["AWS_REGION", "CUSTOMER_NAME", "KNOWLEDGE_BASE_ID"]
if any(env_var not in os.environ for env_var in required_env_vars):
    # Load environment variables from .env.local file only if any required variable is missing
    load_dotenv('.env.local')

app = Flask(__name__)
CORS(app)

# Environment variables
aws_region = os.environ["AWS_REGION"]
customer_name = os.environ["CUSTOMER_NAME"]
knowledge_base_id = os.environ["KNOWLEDGE_BASE_ID"]

# AWS setup
config = Config(retries={'max_attempts': 10, 'mode': 'adaptive'})
BEDROCK_CLIENT = boto3.client("bedrock-runtime", 'us-east-1', config=config)
DYNAMODB_CLIENT = boto3.client('dynamodb', region_name=aws_region)

good_model_id = "anthropic.claude-3-sonnet-20240229-v1:0"
fast_model_id = "anthropic.claude-3-haiku-20240307-v1:0"

# Get the DynamoDB table name from environment variable
PRODUCT_TABLE_NAME = os.environ.get('PRODUCT_TABLE_NAME', f"{customer_name}-kb-products")
SITE_INFO_TABLE_NAME = os.environ.get('SITE_INFO_TABLE_NAME', f"{customer_name}-kb-info")
CATALOGS_TABLE_NAME = os.environ.get('CATALOGS_TABLE_NAME', f"{customer_name}-kb-catalogs")
IDEATORS_TABLE_NAME = os.environ.get('IDEATORS_TABLE_NAME', f"{customer_name}-kb-ideators")
PRODUCT_IDEAS_TABLE_NAME = os.environ.get('PRODUCT_IDEAS_TABLE_NAME', f"{customer_name}-kb-product-ideas")
IDEA_ITEMS_TABLE_NAME = os.environ.get('IDEA_ITEMS_TABLE_NAME', f"{customer_name}-kb-idea-items")

# Retriever setup
retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id=knowledge_base_id,
    retrieval_config={"vectorSearchConfiguration": {"numberOfResults": 5}},
)

# Products retriever setup
products_retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id=knowledge_base_id,
    retrieval_config={"vectorSearchConfiguration": {"numberOfResults": 15}},
)

system_prompt = """
You are a helpful assistant that works for {customer_name}. You are an expert at answering questions about {customer_name} and their products and services. 
You are friendly and empathetic, and you are always willing to help.
Always answer questions from {customer_name}'s perspective.
You should always respond in English. 
"""

# Question rewriting template
condense_question_template = """Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question, in its original language.

Chat History:
{chat_history}

Follow Up Input: {question}
Standalone question:"""

# Prompt template
template = """
Human: You are a helpful and talkative {customer_name} assistant that answers questions directly and only using the information provided in the context below. 
Guidance for answers:
    - Do not include any framing language such as "According to the context" in your responses, but rather act is if the information is coming from your memory banks. 
    - Simply answer the question clearly and with lots of detail using only the relevant details from the information below. If the context does not contain the answer, say "I don't know."
    - Use the royal "We" in your responses. 
    - Use line breaks to separate paragraphs or distinct points. Insert a "<br>" tag at the end of each paragraph or where you want a line break.
    - Finally, you should use the following guidance to control the tone: {prompt_modifier}

Now read this context and answer the question at the bottom. 

Context: {context}

Question: "Hey {customer_name} Chatbot! {question}

A:
"""

# Cache basic company info
response_cache = {}

customer_info_cache_key = f"customer_info_response_{customer_name}"
        
if customer_info_cache_key in response_cache:
    customer_info = response_cache[customer_info_cache_key]
else:
    customer_info_prompt = f"Who is {customer_name}? Provide a brief description of the company and its main business areas."
    customer_info_docs = products_retriever.get_relevant_documents(f"{customer_name} company and business areas")
    customer_info_context = "\n".join([doc.page_content for doc in customer_info_docs])
    
    customer_info_response = BEDROCK_CLIENT.converse(
        modelId=fast_model_id,
        messages=[{"role": "user", "content": [{"text": f"{customer_info_prompt}\n\nCustomer Context: {customer_info_context}"}]}],
        inferenceConfig={"maxTokens": 1000, "temperature": 0, "topP": 1},
    )
    customer_info = customer_info_response["output"]["message"]["content"][0]["text"]
    print(f"Customer Info: {customer_info}")
    response_cache[customer_info_cache_key] = customer_info

chat_suggested_questions_cache_key = f"chat_suggested_questions_{customer_name}"

if chat_suggested_questions_cache_key in response_cache:
    chat_suggested_questions = response_cache[chat_suggested_questions_cache_key]
else:
    chat_suggested_questions_prompt = f"""Based on this information about {customer_name}: {customer_info}, generate 3-5 very short questions about the company. 
    Wrap your response in <question> tags. 

    Example:

    <question>What is {customer_name}'s primary business?</question>
    <question>What are {customer_name}'s main products and services?</question>
    """
    chat_suggested_questions = BEDROCK_CLIENT.converse(
        modelId=fast_model_id,
        messages=[{"role": "user", "content": [{"text": chat_suggested_questions_prompt}]}],
        inferenceConfig={"maxTokens": 500, "temperature": 0, "topP": 1},
    )
    
    suggested_questions_text = chat_suggested_questions["output"]["message"]["content"][0]["text"]
    suggested_questions_list = re.findall(r'<question>(.*?)</question>', suggested_questions_text)
    print(f"Suggested questions: {suggested_questions_list}")
    response_cache[chat_suggested_questions_cache_key] = suggested_questions_list

@app.route('/api/', methods=['GET'])
def index():
    return "Hello, world!"
        
@app.route('/api/chat-suggested-questions', methods=['GET'])
def get_chat_suggested_questions():
    return response_cache[chat_suggested_questions_cache_key]

# Add this after other global variables
TOOL_CONFIG = {
    "tools": [
        {
            "toolSpec": {
                "name": "retrieve_information",
                "description": "Retrieves relevant information from the knowledge base",
                "inputSchema": {
                    "json": {
                        "type": "object",
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "The user's question"
                            }
                        },
                        "required": ["question"]
                    }
                }
            }
        },
        {
            "toolSpec": {
                "name": "visualize_products",
                "description": "Creates a visualization of products based on the user's question",
                "inputSchema": {
                    "json": {
                        "type": "object",
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "The user's question about product visualization"
                            }
                        },
                        "required": ["question"]
                    }
                }
            }
        }
    ]
}

# Add this function to generate the visualization data
def visualize_products(question):
    # Fetch all products from DynamoDB
    response = DYNAMODB_CLIENT.scan(
        TableName=PRODUCT_TABLE_NAME
    )
    products = response['Items']

    # Convert DynamoDB items to a list of dictionaries
    product_list = [
        {
            'name': item['display_name']['S'],
            'description': item['description']['S']
        }
        for item in products
    ]

    # Generate visualization suggestion using LLM
    visualization_prompt = f"""
    Based on the following question about product visualization: "{question}"
    and the given list of products:
    {json.dumps(product_list, indent=2)}

    Suggest a useful and interesting visualization. Your response should be a JSON object with the following structure:
    {{
        "chart_type": "The type of chart (must be one of: 'bar', 'pie', 'line', 'radar')",
        "title": "A title for the visualization",
        "description": "A brief description of what the visualization shows",
        "data": [
            {{
                "category": "Category or name for this data point",
                "value": "Numeric value for this data point"
            }}
            // ... more data points ...
        ]
    }}

    Ensure the data structure is appropriate for the chosen chart type and provides meaningful insights based on the question.
    Only use the chart types specified above ('bar', 'pie', 'line', 'radar').
    Always include 'category' and 'value' keys in each data point.
    """

    print(f"Visualization prompt: {visualization_prompt}")

    visualization_response = BEDROCK_CLIENT.converse(
        modelId=good_model_id,
        system=[{"text": system_prompt}],
        messages=[{"role": "user", "content": [{"text": visualization_prompt}]}],
        inferenceConfig={"maxTokens": 1000, "temperature": 0, "topP": 1},
    )

    response_content = visualization_response["output"]["message"]["content"][0]["text"]
    
    # Use regex to find the JSON object in the response
    json_match = re.search(r'\{.*\}', response_content, re.DOTALL)
    if json_match:
        json_str = json_match.group()
        visualization_data = json.loads(json_str)
    else:
        print("No JSON object found in the response")
        visualization_data = {}

    print(f"Visualization data: {visualization_data}")

    # Validate and clean up the visualization data
    if 'data' in visualization_data:
        for item in visualization_data['data']:
            if 'category' not in item:
                item['category'] = 'Unknown'
            if 'value' not in item or not isinstance(item['value'], (int, float)):
                item['value'] = 0

    return visualization_data

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    
    chat_history = data.get('chat_history', [])
    prompt_modifier = data.get('prompt_modifier', "Informative, empathetic, and friendly")

    print(f"Chat history: {chat_history}")
    def generate():
        question = data['question']
        # Use tool calling to determine which tool to use
        response = BEDROCK_CLIENT.converse(
            modelId=good_model_id,
            system=[{"text": system_prompt}],
            messages=[
                {"role": "user", "content": [{"text": f"Question: {question}"}]}
            ],
            inferenceConfig={"maxTokens": 512, "temperature": 0, "topP": 1},
            toolConfig=TOOL_CONFIG
        )
        print(f"Response: {response}")
        if response["stopReason"] == "tool_use":
            tool_call = next(item["toolUse"] for item in response["output"]["message"]["content"] if "toolUse" in item)
            if tool_call["name"] == "retrieve_information":
                question_to_answer = tool_call["input"]["question"]
                
                # Rewrite question if there's chat history
                if len(chat_history) >= 2:
                    chat_history_str = "\n".join([f"Human: {chat_history[i]}\nAI: {chat_history[i+1]}" for i in range(0, len(chat_history) - 1, 2)])
                    rewrite_prompt = condense_question_template.format(chat_history=chat_history_str, question=question_to_answer)
                    try:
                        rewrite_response = BEDROCK_CLIENT.converse(
                            modelId=good_model_id,
                            system=[{"text": system_prompt}],
                            messages=[{"role": "user", "content": [{"text": rewrite_prompt}]}],
                            inferenceConfig={"maxTokens": 512, "temperature": 0, "topP": 1},
                        )
                        rewritten_question = rewrite_response["output"]["message"]["content"][0]["text"]
                    except Exception as e:
                        print(f"Error in question rewriting: {e}")
                        rewritten_question = question_to_answer
                else:
                    print(f"No chat history, using original question: {question_to_answer}")
                    rewritten_question = question_to_answer
                print(f"Rewritten question: {rewritten_question}")

                # Retrieve relevant documents
                docs = retriever.get_relevant_documents(rewritten_question)
                context = "\n".join([doc.page_content for doc in docs])

                # Extract sources
                sources = []
                for doc in docs:
                    if doc.metadata['location'] != "":
                        url = doc.metadata['location']['webLocation']['url']
                        if url not in sources:
                            sources.append(url)

                # Yield the sources immediately
                yield f"data: {json.dumps({'type': 'metadata', 'sources': sources})}\n\n"

                # Construct the prompt
                prompt = template.format(
                    customer_name=customer_name,
                    prompt_modifier=prompt_modifier,
                    context=context,
                    question=rewritten_question
                )

                # Generate the response
                response = BEDROCK_CLIENT.converse_stream(
                    modelId=good_model_id,
                    system=[{"text": system_prompt}],
                    messages=[{"role": "user", "content": [{"text": prompt}]}],
                    inferenceConfig={
                        "temperature": 0,
                        "maxTokens": 1000,
                    }
                )

                for chunk in response["stream"]:
                    if "contentBlockDelta" in chunk:
                        text = chunk["contentBlockDelta"]["delta"]["text"]
                        yield f"data: {json.dumps({'type': 'content', 'content': text})}\n\n"
            elif tool_call["name"] == "visualize_products":
                question = tool_call["input"]["question"]
                visualization_data = visualize_products(question)
                yield f"data: {json.dumps({'type': 'visualization', 'content': visualization_data})}\n\n"
        
        else:
            print("No tools called, using default behavior")
            # Default behavior (existing logic)
            question_to_answer = question
            
            # Rewrite question if there's chat history
            if len(chat_history) >= 2:
                chat_history_str = "\n".join([f"Human: {chat_history[i]}\nAI: {chat_history[i+1]}" for i in range(0, len(chat_history) - 1, 2)])
                rewrite_prompt = condense_question_template.format(chat_history=chat_history_str, question=question_to_answer)
                try:
                    rewrite_response = BEDROCK_CLIENT.converse(
                        modelId=good_model_id,
                        system=[{"text": system_prompt}],
                        messages=[{"role": "user", "content": [{"text": rewrite_prompt}]}],
                        inferenceConfig={"maxTokens": 512, "temperature": 0, "topP": 1},
                    )
                    rewritten_question = rewrite_response["output"]["message"]["content"][0]["text"]
                except Exception as e:
                    print(f"Error in question rewriting: {e}")
                    rewritten_question = question_to_answer
            else:
                print(f"No chat history, using original question: {question_to_answer}")
                rewritten_question = question_to_answer
            print(f"Rewritten question: {rewritten_question}")

            # Retrieve relevant documents
            docs = retriever.get_relevant_documents(rewritten_question)
            context = "\n".join([doc.page_content for doc in docs])

            # Extract sources
            sources = []
            for doc in docs:
                if doc.metadata['location'] != "":
                    url = doc.metadata['location']['webLocation']['url']
                    if url not in sources:
                        sources.append(url)

            # Yield the sources immediately
            yield f"data: {json.dumps({'type': 'metadata', 'sources': sources})}\n\n"

            # Construct the prompt
            prompt = template.format(
                customer_name=customer_name,
                prompt_modifier=prompt_modifier,
                context=context,
                question=rewritten_question
            )

            # Generate the response
            response = BEDROCK_CLIENT.converse_stream(
                modelId=good_model_id,
                system=[{"text": system_prompt}],
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={
                    "temperature": 0,
                    "maxTokens": 1000,
                }
            )

            for chunk in response["stream"]:
                if "contentBlockDelta" in chunk:
                    text = chunk["contentBlockDelta"]["delta"]["text"]
                    yield f"data: {json.dumps({'type': 'content', 'content': text})}\n\n"
        
            
            

        yield f"data: {json.dumps({'type': 'stop'})}\n\n"

    return Response(generate(), mimetype='text/event-stream')

@app.route('/api/site-items', methods=['GET'])
def get_site_items():
    prompt = request.args.get('prompt', type=str)
    item_type = request.args.get('item_type', default='', type=str)
    limit = request.args.get('limit', default=12, type=int)
    generate_images = request.args.get('generate_images', default='False', type=str).lower() == 'true'
    print("generate_images: ", generate_images)
    if not prompt or not item_type:
        return jsonify({'error': 'Both prompt and item_type are required'}), 400

    def generate():
        try:
            print(f"Searching for existing items in DynamoDB for prompt: {prompt}, item_type: {item_type}")
            # Initialize pagination variables
            last_evaluated_key = None
            items_count = 0

            while True:
                # Prepare query parameters
                query_params = {
                    'TableName': SITE_INFO_TABLE_NAME,
                    'KeyConditionExpression': 'item_type = :item_type',
                    'ExpressionAttributeValues': {
                        ':item_type': {'S': item_type}
                    }
                }

                # Add ExclusiveStartKey for pagination if available
                if last_evaluated_key:
                    query_params['ExclusiveStartKey'] = last_evaluated_key

                # Execute the query
                response = DYNAMODB_CLIENT.query(**query_params)
                
                items = response.get('Items', [])
                items_count += len(items)

                # Process and yield items
                for item in items:
                    item_dict = {
                        'title': item['title']['S'],
                        'description': item['description']['S'],
                        'icon': item['icon']['S'],
                        'link': item['link']['S']
                    }
                    if 'image' in item:
                        item_dict['image'] = item['image']['S']
                    yield f"data: {json.dumps(item_dict)}\n\n"

                # Check if there are more items to fetch
                last_evaluated_key = response.get('LastEvaluatedKey')
                if not last_evaluated_key:
                    break

            print(f"Found {items_count} items in DynamoDB")

            if items_count == 0:
                # If no items in DynamoDB, generate them based on the prompt
                print(f"No items found in DynamoDB, generating new items")
                for item in generate_site_items(prompt, item_type, limit, generate_images):
                    yield f"data: {json.dumps(item)}\n\n"

            yield f"data: {json.dumps({'type': 'stop'})}\n\n"
        except Exception as e:
            print(f"Error retrieving or generating site items: {e}")
            import traceback
            print("Error details:")
            print(traceback.format_exc())
            yield f"data: {json.dumps({'error': 'Failed to retrieve or generate site items'})}\n\n"

    return Response(generate(), mimetype='text/event-stream')

def generate_site_items(prompt, item_type, limit, generate_images):
    print(f"Generating items for prompt: {prompt}, item_type: {item_type}")

    processed_titles = set()
# To keep track of processed item titles
    item_count = 0

    docs = products_retriever.get_relevant_documents(f"{customer_name} {prompt}")
    
    for doc in docs:
        if item_count >= limit:
            break  # Stop processing if we've reached the limit

        context = doc.metadata['location']['webLocation']['url'] + "\n\n" + doc.page_content

        extraction_prompt = f"""
        Based on the following information below about {customer_name} and the classifier: "{prompt}", extract relevant items.
        
        <context>
        {context}
        </context>
        
        <instructions>
        For each item, provide:
        1. A title - The name, title, or key feature of the item
        2. A brief description of the product as it relates to {customer_name} and {prompt}
        3. An appropriate Font Awesome icon name (without the 'fa-' prefix)
        {'''4. A prompt to generate a generic stock image for the item. Be generic. Do not mention company or brand names''' if generate_images else ""}
        Use a consistent naming convention for all the titles. 

        Return the result as a JSON array of objects with the following structure:
        [
            {{
                "title": "Item title",
                "description": "Brief description of the item",
                "icon": "font-awesome-icon-name",
                {'''"image_prompt": "A stock image of..."''' if generate_images else ""}
            }}
        ]
        If no clear items are identified, return an empty array.

        Don't repeat items. If items sound similar, combine them into a single item.

        Think through what's being asked for in the prompt classifier: "{prompt}" and only extract the items that are relevant to the prompt.

        Context:
        """
        
        if len(processed_titles) > 0:
            extraction_prompt += f"\nHere are the items that have already been extracted. Do not duplicate anything of these items: {processed_titles}"
        print(f"Extraction prompt: {extraction_prompt}")
        try:
            extraction_response = BEDROCK_CLIENT.converse(
                modelId=good_model_id,
                system=[{"text": system_prompt}],
                messages=[{"role": "user", "content": [{"text": extraction_prompt}]}],
                inferenceConfig={"maxTokens": 1000, "temperature": 0.5, "topP": 1},
            )
            response_content = extraction_response["output"]["message"]["content"][0]["text"]

            print(f"Extraction response: {response_content}")
            
            # Use regex to find the JSON array in the response
            json_match = re.search(r'\[.*?\]', response_content, re.DOTALL)
            if json_match:
                json_str = json_match.group()
                extracted_items = json.loads(json_str)
            else:
                print(f"No JSON array found in the response for document: {doc.metadata['location']['webLocation']['url']}")
                continue
            print(f"Extracted items: {extracted_items}")
     
            for item in extracted_items:
                metadata_link = doc.metadata.get('location', {}).get('webLocation', {}).get('url')
                if item_count >= limit:
                    break  # Stop processing if we've reached the limit

                if item.get("title") and item["title"] not in processed_titles:
                    processed_titles.add(item["title"])
                    item_count += 1
                    if generate_images:
                        # Generate an image for the item
                        try:
                            image_prompt = item.get("image_prompt", f"A stock image of {item['title']}")
                            image_request = {
                                "taskType": "TEXT_IMAGE",
                                "textToImageParams": {"text": image_prompt},
                                "imageGenerationConfig": {
                                    "numberOfImages": 1,
                                    "quality": "standard",
                                    "cfgScale": 8.0,
                                    "height": 384,
                                    "width": 704,
                                    "seed": random.randint(0, 2147483647),
                                },
                            }
                            retries = 0
                            max_retries = 3
                            while retries < max_retries:
                                try:
                                    response = BEDROCK_CLIENT.invoke_model(
                                        modelId="amazon.titan-image-generator-v2:0",
                                        body=json.dumps(image_request)
                                    )
                                    break  # If successful, exit the loop
                                except Exception as e:
                                    retries += 1
                                    if retries == max_retries:
                                        print(f"Failed to invoke model after {max_retries} attempts: {str(e)}")
                                        raise  # Re-raise the last exception if all retries failed
                                    print(f"Attempt {retries} failed. Retrying...")
                            response_body = json.loads(response["body"].read())
                            image_base64 = response_body["images"][0]
                            
                            # Compress the image to fit into 400kb
                            image_data = base64.b64decode(image_base64)
                            image = Image.open(io.BytesIO(image_data))
                            
                            # Start with a high quality and reduce it until the image is small enough
                            quality = 95
                            # Resize the image to about 70% of its original width
                            # new_width = int(image.width * 0.7)
                            # new_height = int(image.height * (new_width / image.width))
                            # image = image.resize((new_width, new_height), Image.LANCZOS)

                            while True:
                                buffer = io.BytesIO()
                                image.save(buffer, format="JPEG", quality=quality)
                                if buffer.getbuffer().nbytes <= 400 * 1024 or quality <= 5:
                                    break
                                quality -= 5
                            # Convert the compressed image back to base64
                            compressed_image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
                            
                            # Add the compressed image to the item
                            item['image'] = compressed_image_base64
                        except Exception as e:
                            print(f"Error generating image: {str(e)}")
                            print(f"Image prompt: {image_prompt}")
                            item['image'] = None  # Set to None if image generation fails

                    # Store the item in DynamoDB
                    try:
                        dynamodb_item = {
                            'item_type': {'S': item_type},
                            'title': {'S': item['title']},
                            'description': {'S': item['description']},
                            'icon': {'S': item.get('icon', 'cube')},
                            'link': {'S': metadata_link},
                            'image_prompt': {'S': item.get('image_prompt', '')}
                        }
                        if 'image' in item and item['image']:
                            dynamodb_item['image'] = {'S': item['image']}

                        DYNAMODB_CLIENT.put_item(
                            TableName=SITE_INFO_TABLE_NAME,
                            Item=dynamodb_item
                        )
                    except Exception as e:
                        print(f"Error storing item in DynamoDB: {str(e)}")

                    yield item

        except Exception as e:
            print(f"Error extracting items from document: {str(e)}")

    print(f"Total items generated: {item_count}")

from botocore.exceptions import ClientError

@app.route('/api/site-items', methods=['DELETE'])
def delete_site_item():
    data = request.json
    title = data.get('title')
    item_type = data.get('item_type')
    
    if not item_type:
        return jsonify({'error': 'item_type is required'}), 400

    if not title:  # We only need to check for title, as item_type is required for both cases
        try:
            # Scan for all items with the given item_type
            print(f"Scanning for items with item_type: {item_type}")
            response = DYNAMODB_CLIENT.scan(
                TableName=SITE_INFO_TABLE_NAME,
                FilterExpression='item_type = :item_type',
                ExpressionAttributeValues={':item_type': {'S': item_type}}
            )
            items = response['Items']
            print(f"Found {len(items)} items to delete")

            # Delete each item individually
            deleted_count = 0
            for item in items:
                try:
                    DYNAMODB_CLIENT.delete_item(
                        TableName=SITE_INFO_TABLE_NAME,
                        Key={
                            'item_type': {'S': item_type},
                            'title': {'S': item['title']['S']}  # Assuming 'title' is a string attribute
                        }
                    )
                    deleted_count += 1
                except ClientError as e:
                    print(f"Error deleting item {item['title']['S']}: {e}")

            print(f"Successfully deleted {deleted_count} out of {len(items)} items")
            return jsonify({'message': f'Successfully deleted {deleted_count} items'}), 200
        except ClientError as e:
            print(f"Error scanning or deleting items: {e}")
            return jsonify({'error': 'Failed to delete items'}), 500
    else:
        try:
            DYNAMODB_CLIENT.delete_item(
                TableName=SITE_INFO_TABLE_NAME,
                Key={'item_type': {'S': item_type}, 'title': {'S': title}}
            )
            return jsonify({'message': f'Successfully deleted item: {title}'}), 200
        except ClientError as e:
            print(f"Error deleting single item: {e}")
            return jsonify({'error': 'Failed to delete item'}), 500

@app.route('/api/catalogs', methods=['GET'])
def get_catalogs():
    try:
        response = DYNAMODB_CLIENT.scan(
            TableName=CATALOGS_TABLE_NAME
        )
        catalogs = response.get('Items', [])
        return jsonify([{
            'id': catalog['id']['S'],
            'name': catalog['name']['S'],
            'route': catalog['route']['S'],
            'prompt': catalog['prompt']['S'],
            'generateImages': catalog['generateImages']['BOOL'],
            'icon': catalog['icon']['S'] if 'icon' in catalog else None
        } for catalog in catalogs])
    except Exception as e:
        print(f"Error retrieving catalogs: {str(e)}")
        return jsonify({'error': 'Failed to retrieve catalogs'}), 500

@app.route('/api/catalogs', methods=['POST'])
def add_catalog():
    new_catalog = request.json
    try:
        # Generate an icon using Bedrock fast model
        icon_prompt = f"""Suggest a FontAwesome icon name (without the 'fa-' prefix) that best represents this concept: 
        
        {new_catalog['name']}. 
        
        Respond with only the icon name, nothing else."""
        
        icon_response = BEDROCK_CLIENT.converse(
            modelId=fast_model_id,
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": icon_prompt}]}],
            inferenceConfig={"maxTokens": 1000, "temperature": 0.5, "topP": 1},
        )
        
        icon_name = icon_response["output"]["message"]["content"][0]["text"]
        
        # Ensure the icon name is valid (you might want to add more validation)
        if not icon_name or len(icon_name) > 20:
            icon_name = "list"  # Default icon if the generated one is invalid
        
        catalog_id = str(uuid.uuid4())
        DYNAMODB_CLIENT.put_item(
            TableName=CATALOGS_TABLE_NAME,
            Item={
                'id': {'S': catalog_id},
                'name': {'S': new_catalog['name']},
                'route': {'S': new_catalog['route']},
                'prompt': {'S': new_catalog['prompt']},
                'generateImages': {'BOOL': new_catalog['generateImages']},
                'icon': {'S': icon_name}
            }
        )
        return jsonify({'id': catalog_id, **new_catalog}), 201
    except Exception as e:
        print(f"Error adding new catalog: {str(e)}")
        return jsonify({'error': 'Failed to add new catalog'}), 500

@app.route('/api/catalogs/<catalog_id>', methods=['PUT'])
def update_catalog(catalog_id):
    try:
        updated_catalog = request.json
        update_expression = []
        expression_attribute_names = {}
        expression_attribute_values = {}

        if 'name' in updated_catalog:
            update_expression.append('#name = :name')
            expression_attribute_names['#name'] = 'name'
            expression_attribute_values[':name'] = {'S': updated_catalog['name']}

        if 'route' in updated_catalog:
            update_expression.append('#route = :route')
            expression_attribute_names['#route'] = 'route'
            expression_attribute_values[':route'] = {'S': updated_catalog['route']}

        if 'prompt' in updated_catalog:
            update_expression.append('#prompt = :prompt')
            expression_attribute_names['#prompt'] = 'prompt'
            expression_attribute_values[':prompt'] = {'S': updated_catalog['prompt']}

        if 'generateImages' in updated_catalog:
            update_expression.append('#generateImages = :generateImages')
            expression_attribute_names['#generateImages'] = 'generateImages'
            expression_attribute_values[':generateImages'] = {'BOOL': updated_catalog['generateImages']}

        if update_expression:
            DYNAMODB_CLIENT.update_item(
                TableName=CATALOGS_TABLE_NAME,
                Key={'id': {'S': catalog_id}},
                UpdateExpression="SET " + ", ".join(update_expression),
                ExpressionAttributeNames=expression_attribute_names,
                ExpressionAttributeValues=expression_attribute_values
            )
        return jsonify(updated_catalog)
    except Exception as e:
        print(f"Error updating catalog:")
        print(e.with_traceback)
        return jsonify({'error': 'Failed to update catalog'}), 500

@app.route('/api/catalogs/<catalog_id>', methods=['DELETE'])
def delete_catalog(catalog_id):
    try:
        DYNAMODB_CLIENT.delete_item(
            TableName=CATALOGS_TABLE_NAME,
            Key={'id': {'S': catalog_id}}
        )
        return jsonify({'message': 'Catalog deleted successfully'})
    except Exception as e:
        print(f"Error deleting catalog: {str(e)}")
        return jsonify({'error': 'Failed to delete catalog'}), 500

@app.route('/api/ideators', methods=['POST'])
def add_ideator():
    try:
        new_ideator = request.json
        ideator_id = str(uuid.uuid4())
        DYNAMODB_CLIENT.put_item(
            TableName=IDEATORS_TABLE_NAME,
            Item={
                'id': {'S': ideator_id},
                'name': {'S': new_ideator['name']},
                'route': {'S': new_ideator['route']},
                'prompt': {'S': new_ideator['prompt']},
                'generateImages': {'BOOL': new_ideator['generateImages']}
            }
        )
        return jsonify({'id': ideator_id, **new_ideator}), 201
    except Exception as e:
        print(f"Error adding new product ideator: {str(e)}")
        print(e.with_traceback)
        print(e.with_context)
        return jsonify({'error': 'Failed to add new product ideator'}), 500

@app.route('/api/ideators/<ideator_id>', methods=['PUT'])
def update_ideator(ideator_id):
    try:
        updated_ideator = request.json
        update_expression = []
        expression_attribute_names = {}
        expression_attribute_values = {}

        if 'name' in updated_ideator:
            update_expression.append('#name = :name')
            expression_attribute_names['#name'] = 'name'
            expression_attribute_values[':name'] = {'S': updated_ideator['name']}

        if 'route' in updated_ideator:
            update_expression.append('#route = :route')
            expression_attribute_names['#route'] = 'route'
            expression_attribute_values[':route'] = {'S': updated_ideator['route']}

        if 'prompt' in updated_ideator:
            update_expression.append('#prompt = :prompt')
            expression_attribute_names['#prompt'] = 'prompt'
            expression_attribute_values[':prompt'] = {'S': updated_ideator['prompt']}

        if 'generateImages' in updated_ideator:
            update_expression.append('#generateImages = :generateImages')
            expression_attribute_names['#generateImages'] = 'generateImages'
            expression_attribute_values[':generateImages'] = {'BOOL': updated_ideator['generateImages']}

        if update_expression:
            DYNAMODB_CLIENT.update_item(
                TableName=IDEATORS_TABLE_NAME,
                Key={'id': {'S': ideator_id}},
                UpdateExpression="SET " + ", ".join(update_expression),
                ExpressionAttributeNames=expression_attribute_names,
                ExpressionAttributeValues=expression_attribute_values
            )
        return jsonify(updated_ideator)
    except Exception as e:
        print(f"Error updating ideator: {str(e)}")
        return jsonify({'error': 'Failed to update ideator'}), 500

@app.route('/api/ideators/<ideator_id>', methods=['DELETE'])
def delete_ideator(ideator_id):
    try:
        DYNAMODB_CLIENT.delete_item(
            TableName=IDEATORS_TABLE_NAME,
            Key={'id': {'S': ideator_id}}
        )
        return jsonify({'message': 'Ideator deleted successfully'})
    except Exception as e:
        print(f"Error deleting ideator: {str(e)}")
        return jsonify({'error': 'Failed to delete ideator'}), 500

@app.route('/api/ideators/<ideator_id>', methods=['GET'])
def get_ideator(ideator_id):
    try:
        response = DYNAMODB_CLIENT.get_item(
            TableName=IDEATORS_TABLE_NAME,
            Key={'id': {'S': ideator_id}}
        )
        ideator = response.get('Item')
        if ideator:
            return jsonify(ideator)
        else:
            return jsonify({'error': 'Ideator not found'}), 404
    except Exception as e:
        print(f"Error retrieving ideator: {str(e)}")
        return jsonify({'error': 'Failed to retrieve ideator'}), 500

@app.route('/api/ideators', methods=['GET'])
def get_ideators():
    try:
        response = DYNAMODB_CLIENT.scan(
            TableName=IDEATORS_TABLE_NAME
        )
        ideators = response.get('Items', [])
        return jsonify([{
            'id': ideator['id']['S'],
            'name': ideator['name']['S'],
            'route': ideator['route']['S'],
            'prompt': ideator['prompt']['S'],
            'generateImages': ideator['generateImages']['BOOL']
        } for ideator in ideators])
    except Exception as e:
        print(f"Error listing ideators: {str(e)}")
        return jsonify({'error': 'Failed to list ideators'}), 500

@app.route('/api/idea-item/<item_type>/<title>', methods=['GET'])
def get_idea_item(item_type, title):
    item_type = item_type.lower().replace(" ", "-")
    print(f"Getting idea item for {item_type} with title {title}")
    try:
        response = DYNAMODB_CLIENT.get_item(
            TableName=IDEA_ITEMS_TABLE_NAME,
            Key={'item_type': {'S': item_type}, 'title': {'S': title}}
        )
        item = response.get('Item')
        if item:
            json_item = {
                'title': item['title']['S'],
                'description': item['description']['S'],
                'icon': item.get('icon', {}).get('S', 'lightbulb'),
                'image': item.get('image', {}).get('S'),
                'link': item.get('link', {}).get('S', '')
            }
            return jsonify(json_item)
        else:
            return jsonify({'error': 'Idea item not found'}), 404
    except Exception as e:
        print(f"Error retrieving idea item: {str(e)}")
        return jsonify({'error': 'Failed to retrieve idea item'}), 500

@app.route('/api/idea-items', methods=['GET'])
def get_idea_items():
    prompt = request.args.get('prompt')
    item_type = request.args.get('item_type')
    limit = int(request.args.get('limit', 12))
    generate_images = request.args.get('generate_images', 'false').lower() == 'true'

    if not prompt or not item_type:
        return jsonify({'error': 'Prompt and item_type are required'}), 400

 
            
        
    # If no items exist, generate new ones using Bedrock Claude
    def generate_items():
       
        # First, try to fetch existing items from DynamoDB
        response = DYNAMODB_CLIENT.query(
            TableName=IDEA_ITEMS_TABLE_NAME,
            KeyConditionExpression='item_type = :item_type',
            ExpressionAttributeValues={':item_type': {'S': item_type}}
        )
        
        existing_items = response.get('Items', [])
        print(f"Existing {len(existing_items)} items")
        if existing_items:
            for dbItem in existing_items[:limit]:
                item = {
                    'title': dbItem['title']['S'],
                    'description': dbItem['description']['S'],
                    'icon': dbItem.get('icon', {}).get('S', 'lightbulb'),
                    'image': dbItem.get('image', {}).get('S'),
                    'link': dbItem.get('link', {}).get('S', '')
                }
                yield f"data: {json.dumps(item)}\n\n"
            yield f"data: {json.dumps({'type': 'stop'})}\n\n"
            return
        else:
            print("No existing items found")
        processed_titles = set()
        item_count = 0
        
        system_prompt = """You are an AI assistant tasked with generating product ideas based on a given prompt. 
        Provide creative and innovative product ideas that align with the prompt."""

        extraction_prompt = f"""Based the <prompt> and <customer_info> below, generate exactly {limit} unique product ideas.

        <prompt>
        {prompt}
        </prompt>

        <customer_info>
        {customer_info}
        </customer_info>

        For each item, provide:
        1. A title - The name or key feature of the product idea
        2. A brief description of the product idea and how it relates to the prompt
        3. An appropriate Font Awesome icon name (without the 'fa-' prefix)
        {'''4. A prompt to generate a generic stock image for the item. Be generic. Do not mention company or brand names''' if generate_images else ""}

        Return the result as a JSON array of objects with the following structure:
        [
            {{
                "title": "Product idea title",
                "description": "Brief description of the product idea",
                "icon": "font-awesome-icon-name",
                {'''"image_prompt": "A stock image of..."''' if generate_images else ""}
            }}
        ]

        Ensure each idea is unique and creative. If no clear ideas can be generated, return an empty array."""

        print(f"Extraction prompt: {extraction_prompt}")
        try:
            extraction_response = BEDROCK_CLIENT.converse(
                modelId=good_model_id,
                system=[{"text": system_prompt}],
                messages=[{"role": "user", "content": [{"text": extraction_prompt}]}],
                inferenceConfig={"maxTokens": 2000, "temperature": 0.7, "topP": 1},
            )
            response_content = extraction_response["output"]["message"]["content"][0]["text"]
            print(f"Extraction response: {response_content}")
            json_match = re.search(r'\[.*?\]', response_content, re.DOTALL)
            if json_match:
                json_str = json_match.group()
                extracted_items = json.loads(json_str)
            else:
                print(f"No JSON array found in the response")
                return

            for item in extracted_items:
                if item_count >= limit:
                    break

                if item.get("title") and item["title"] not in processed_titles:
                    processed_titles.add(item["title"])
                    item_count += 1

                    if generate_images:
                        # Generate an image for the item (similar to the existing code)
                        image_prompt = item.get("image_prompt", f"A stock image of {item['title']}")
                        
                        image_request = {
                            "taskType": "TEXT_IMAGE",
                            "textToImageParams": {"text": image_prompt},
                            "imageGenerationConfig": {
                                "numberOfImages": 1,
                                "quality": "standard",
                                "cfgScale": 8.0,
                                "height": 384,
                                "width": 704,
                                "seed": random.randint(0, 2147483647),
                            },
                        }
                        
                        retries = 0
                        max_retries = 3
                        while retries < max_retries:
                            try:
                                response = BEDROCK_CLIENT.invoke_model(
                                    modelId="amazon.titan-image-generator-v2:0",
                                    body=json.dumps(image_request)
                                )
                                break  # If successful, exit the loop
                            except Exception as e:
                                retries += 1
                                if retries == max_retries:
                                    print(f"Failed to invoke model after {max_retries} attempts: {str(e)}")
                                    raise  # Re-raise the last exception if all retries failed
                                print(f"Attempt {retries} failed. Retrying...")
                        response_body = json.loads(response["body"].read())
                        image_base64 = response_body["images"][0]

                        # Compress the image to fit into 400kb
                        image_data = base64.b64decode(image_base64)
                        image = Image.open(io.BytesIO(image_data))
                        quality = 95
                        while True:
                            buffer = io.BytesIO()
                            image.save(buffer, format="JPEG", quality=quality)
                            if buffer.getbuffer().nbytes <= 400 * 1024 or quality <= 5:
                                break
                            quality -= 5
                        compressed_image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
                        item['image'] = compressed_image_base64

                    # Store the item in DynamoDB
                    try:
                        dynamodb_item = {
                            'item_type': {'S': item_type},
                            'title': {'S': item['title']},
                            'description': {'S': item['description']},
                            'icon': {'S': item.get('icon', 'lightbulb')},
                        }
                        if 'image' in item and item['image']:
                            dynamodb_item['image'] = {'S': item['image']}

                        DYNAMODB_CLIENT.put_item(
                            TableName=IDEA_ITEMS_TABLE_NAME,
                            Item=dynamodb_item
                        )
                    except Exception as e:
                        print(f"Error storing item in DynamoDB: {str(e)}")
                    print(f"Item stored in DynamoDB: {item}")
                    yield f"data: {json.dumps(item)}\n\n"

        except Exception as e:
            print(f"Error generating items: {str(e)}")

    return Response(generate_items(), mimetype='text/event-stream')

# New endpoint to generate press release and social media post
@app.route('/api/idea-details', methods=['POST'])
def get_idea_details():
    data = request.json
    title = data.get('title')
    item_type = data.get('item_type')
    description = data.get('description', '')

    if not title or not item_type:
        return jsonify({'error': 'Title and item_type are required'}), 400

    def generate():
            # Check if details already exist in DynamoDB
            response = DYNAMODB_CLIENT.get_item(
                TableName=IDEA_ITEMS_TABLE_NAME,
                Key={
                    'item_type': {'S': item_type.lower()},
                    'title': {'S': title}
                }
            )
            
            existing_item = response.get('Item')
            if existing_item and 'details' in existing_item:
                print("Details exist")
                # If details exist, return them immediately
                details = json.loads(existing_item['details']['S'])
                print(f"Details: {details}")
                yield f"data: {json.dumps({'type': 'press_release_start'})}\n\n"
                yield f"data: {json.dumps({'type': 'press_release', 'content': details['press_release']})}\n\n"
                yield f"data: {json.dumps({'type': 'press_release_end'})}\n\n"
                yield f"data: {json.dumps({'type': 'social_media_start'})}\n\n"
                yield f"data: {json.dumps({'type': 'social_media', 'content': details['social_media_post']})}\n\n"
                yield f"data: {json.dumps({'type': 'social_media_end'})}\n\n"
                yield f"data: {json.dumps({'type': 'customer_reviews_start'})}\n\n"
                yield f"data: {json.dumps({'type': 'customer_reviews', 'content': details['customer_reviews']})}\n\n"
                yield f"data: {json.dumps({'type': 'customer_reviews_end'})}\n\n"
                yield f"data: {json.dumps({'type': 'stop'})}\n\n"
                return

            # Generate Press Release
            press_release_prompt = f"""Create a press release for the product idea titled "{title}" with description "{description}"

            The product is being offered by {customer_name}. Here is some additional information about the company: {customer_info} 
            
            Format the press release using markdown, including appropriate headers, paragraphs, and emphasis where needed.
            
            Do not include any framing language such as "According to the context" or "Here is an overview of" in your responses, just get straight to the point!
             """
            press_release_response = BEDROCK_CLIENT.converse_stream(
                modelId=good_model_id,
                system=[{"text": system_prompt}],
                messages=[{"role": "user", "content": [{"text": press_release_prompt}]}],
                inferenceConfig={"maxTokens": 1000, "temperature": 0.7, "topP": 1},
            )

            press_release = ""
            yield f"data: {json.dumps({'type': 'press_release_start'})}\n\n"
            for chunk in press_release_response["stream"]:
                if "contentBlockDelta" in chunk:
                    text = chunk["contentBlockDelta"]["delta"]["text"]
                    press_release += text
                    yield f"data: {json.dumps({'type': 'press_release', 'content': text})}\n\n"
            yield f"data: {json.dumps({'type': 'press_release_end'})}\n\n"

            # Generate Social Media Post
            social_media_prompt = f"""Create a fun and engaging social media post for the product idea titled "{title}" with description "{description}" 
            
            The product is being offered by {customer_name}. Here is some additional information about the company: {customer_info} 
            Format the social media post using markdown, including appropriate emphasis and line breaks. Use emojis and hashtags where appropriate.
            
            Do not include any preamble language such as "Here is an overview of" in your responses, just get straight to the point!
            """
            social_media_response = BEDROCK_CLIENT.converse_stream(
                modelId=fast_model_id,
                system=[{"text": system_prompt}],
                messages=[{"role": "user", "content": [{"text": social_media_prompt}]}],
                inferenceConfig={"maxTokens": 300, "temperature": 0.7, "topP": 1},
            )

            social_media_post = ""
            yield f"data: {json.dumps({'type': 'social_media_start'})}\n\n"
            for chunk in social_media_response["stream"]:
                if "contentBlockDelta" in chunk:
                    text = chunk["contentBlockDelta"]["delta"]["text"]
                    social_media_post += text
                    yield f"data: {json.dumps({'type': 'social_media', 'content': text})}\n\n"
            yield f"data: {json.dumps({'type': 'social_media_end'})}\n\n"

            # Generate Customer Reviews
            reviews_prompt = f"""
            Generate 3-4  positive and realistic customer reviews for the following product idea:
            Company Name: {customer_name}
            Product Name: {title}
            Product Description: {description}

            For each review, provide:
            1. A customer name (first name and last initial)
            2. A rating (4 or 5) out of 5 stars
            3. A positive, realistic comment about the product. The comment should be 2-3 sentences and relate to the 
                product (and possibly the company)in a real-world context.
            4. Randomly decide if it's a verified purchase (70% chance) or a top reviewer (20% chance)

            Format the response as a JSON array of objects, like so:
            [
                {{
                    "name": "John Doe",
                    "rating": 5,
                    "comment": "This product will be a game changer for my business!",
                    "verified": true/false,
                    "topReviewer": true/false
                }}
            ]

            Ensure the reviews are diverse in opinion.

            Do not include any preamble language such as "According to the context" or "Here is an overview of" in your responses, just get straight to the point!
            
            """
            print(f"Reviews prompt: {reviews_prompt}")
            
            # Using fast_model_id for quicker generation
            reviews_response = BEDROCK_CLIENT.converse(
                modelId=fast_model_id,
                system=[{"text": system_prompt}],
                messages=[{"role": "user", "content": [{"text": reviews_prompt}]}],
                inferenceConfig={"maxTokens": 1000, "temperature": 0.7, "topP": 1},
            )
            yield f"data: {json.dumps({'type': 'customer_reviews_start'})}\n\n"
            
            reviews = reviews_response["output"]["message"]["content"][0]["text"]
            # print(f"Reviews: {reviews}")
            # parse out the json array from the reviews string that may contain other text
                # Use regex to find the JSON object in the response
            json_match = re.search(r'\[.*?\]', reviews, re.DOTALL)
            if json_match:
                json_str = json_match.group()
                print(f"JSON string: {json_str}")
                reviews_json = json.loads(json_str)
            else:
                print("No JSON object found in the response")
                reviews_json = {}

            yield f"data: {json.dumps({'type': 'customer_reviews', 'content': reviews_json})}\n\n"

            yield f"data: {json.dumps({'type': 'customer_reviews_end'})}\n\n"
            # Save details to DynamoDB
            details = {
                'press_release': press_release,
                'social_media_post': social_media_post,
                'customer_reviews': reviews_json
            }
            # Update only the details field in DynamoDB
            try:
                DYNAMODB_CLIENT.update_item(
                    TableName=IDEA_ITEMS_TABLE_NAME,
                    Key={
                        'item_type': {'S': item_type.lower()},
                        'title': {'S': title}
                    },
                    UpdateExpression='SET details = :details',
                    ExpressionAttributeValues={':details': {'S': json.dumps(details)}}
                )
            except Exception as e:
                print(f"Error updating details in DynamoDB: {str(e)}")

            yield f"data: {json.dumps({'type': 'stop'})}\n\n"

    return Response(generate(), mimetype='text/event-stream')
# New endpoint to generate customer reviews

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=os.environ.get('DEBUG', False))
