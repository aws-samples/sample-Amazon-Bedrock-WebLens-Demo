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

# Get the DynamoDB table name from environment variable
PRODUCT_TABLE_NAME = os.environ.get('PRODUCT_TABLE_NAME', 'kb-products')

# Retriever setup
retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id=knowledge_base_id,
    retrieval_config={"vectorSearchConfiguration": {"numberOfResults": 5}},
)

# Products retriever setup
products_retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id=knowledge_base_id,
    retrieval_config={"vectorSearchConfiguration": {"numberOfResults": 10}},
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
        modelId="anthropic.claude-3-haiku-20240307-v1:0",
        messages=[{"role": "user", "content": [{"text": f"{customer_info_prompt}\n\nCustomer Context: {customer_info_context}"}]}],
        inferenceConfig={"maxTokens": 500, "temperature": 0, "topP": 1},
    )
    customer_info = customer_info_response["output"]["message"]["content"][0]["text"]
    
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
        modelId="anthropic.claude-3-haiku-20240307-v1:0",
        messages=[{"role": "user", "content": [{"text": chat_suggested_questions_prompt}]}],
        inferenceConfig={"maxTokens": 500, "temperature": 0, "topP": 1},
    )
    
    suggested_questions_text = chat_suggested_questions["output"]["message"]["content"][0]["text"]
    suggested_questions_list = re.findall(r'<question>(.*?)</question>', suggested_questions_text)
    print(f"Suggested questions: {suggested_questions_list}")
    response_cache[chat_suggested_questions_cache_key] = suggested_questions_list

@app.route('/', methods=['GET'])
def index():
    return "Hello, world!"
        
@app.route('/chat-suggested-questions', methods=['GET'])
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
        modelId="anthropic.claude-3-sonnet-20240229-v1:0",
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

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    
    chat_history = data.get('chat_history', [])
    prompt_modifier = data.get('prompt_modifier', "Informative, empathetic, and friendly")

    print(f"Chat history: {chat_history}")
    def generate():
        question = data['question']
        # Use tool calling to determine which tool to use
        response = BEDROCK_CLIENT.converse(
            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
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
                            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
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
                    modelId="anthropic.claude-3-sonnet-20240229-v1:0",
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
                        modelId="anthropic.claude-3-sonnet-20240229-v1:0",
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
                modelId="anthropic.claude-3-sonnet-20240229-v1:0",
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

@app.route('/products', methods=['GET'])
def get_products():
    limit = request.args.get('limit', default=12, type=int)
    def generate():
        try:
            # Scan the DynamoDB table to get all products
            response = DYNAMODB_CLIENT.scan(
                TableName=PRODUCT_TABLE_NAME,
                Limit=limit
            )
            products = response.get('Items', [])

            for product in products:
                # Convert DynamoDB format to regular dictionary
                product_dict = {
                    'name': product['name']['S'],
                    'display_name': product['display_name']['S'],
                    'description': product['description']['S'],
                    'external_link': product['external_link']['S'],
                    'internal_link': product['internal_link']['S'],
                    'icon': product['icon']['S']
                }
                yield f"data: {json.dumps(product_dict)}\n\n"

            if not products:
                # If no products in DynamoDB, generate them as before
                for product in generate_products(limit):
                    yield f"data: {json.dumps(product)}\n\n"

            yield f"data: {json.dumps({'type': 'stop'})}\n\n"
        except Exception as e:
            print(f"Error retrieving products: {str(e)}")
            yield f"data: {json.dumps({'error': 'Failed to retrieve products'})}\n\n"

    return Response(generate(), mimetype='text/event-stream')

@app.route('/products', methods=['POST'])
def add_product():
    try:
        new_product = request.json
        new_product['name'] = new_product['name'].lower().replace(" ", "-").replace("/", "-").replace("&", "-")

        DYNAMODB_CLIENT.put_item(
            TableName=PRODUCT_TABLE_NAME,
            Item={
                'name': {'S': new_product['name']},
                'display_name': {'S': new_product['display_name']},
                'description': {'S': new_product['description']},
                'external_link': {'S': new_product.get('external_link', '#')},
                'internal_link': {'S': new_product['internal_link']},
                'icon': {'S': new_product.get('icon', 'cube')}
            }
        )
        return jsonify({'message': 'Product added successfully'}), 201
    except Exception as e:
        print(f"Error adding new product: {str(e)}")
        return jsonify({'error': 'Failed to add new product'}), 500

def generate_products(limit):
    print(f"Customer Info: {customer_info}")

    # Step 3: Retrieve documents and extract product information
    products = []
    processed_products = set()  # Set to keep track of processed product names
    product_questions = [f"What are the main products and services offered by {customer_name}?"]

    for question in product_questions:
        print(f"Question: {question}")
        if len(products) >= limit:
            break  # Stop processing if we've reached the limit

        docs = products_retriever.get_relevant_documents(question)
        
        for doc in docs:
            if len(products) >= limit:
                break  # Stop processing if we've reached the limit

            extraction_prompt = f"""
            Extract structured product or service information from the following text, focusing on answering: {question}
            
            Return the result as a JSON array of objects with the following structure:
            [
                {{
                    "name": "Specific product or service name",
                    "description": "A brief, clear description of the product or service",
                    "link": "URL to the product or service page if available, otherwise null",
                    "icon": "An appropriate Font Awesome icon name (without the 'fa-' prefix) that represents this product or service"
                }}
            ]
            If no clear products or services are identified, return an empty array.

            Text: {doc.page_content}
            """
            
            try:
                extraction_response = BEDROCK_CLIENT.converse(
                    modelId="anthropic.claude-3-sonnet-20240229-v1:0",
                    system=[{"text": system_prompt}],
                    messages=[{"role": "user", "content": [{"text": extraction_prompt}]}],
                    inferenceConfig={"maxTokens": 1000, "temperature": 0, "topP": 1},
                )
                response_content = extraction_response["output"]["message"]["content"][0]["text"]
                
                # Use regex to find the JSON array in the response
                json_match = re.search(r'\[.*?\]', response_content, re.DOTALL)
                if json_match:
                    json_str = json_match.group()
                    extracted_info = json.loads(json_str)
                else:
                    print(f"No JSON array found in the response for question: {question}")
                    continue
                
                for product in extracted_info:
                    if len(products) >= limit:
                        break  # Stop processing if we've reached the limit

                    if product.get("name") and product.get("name") != "Unknown Product":
                        display_name = product["name"]  # Keep the original name as display name
                        product_name = display_name.lower().strip().replace(" ", "-").replace("/", "-").replace("&", "-")
                        if product_name not in processed_products:
                            # Extract link from metadata
                            metadata_link = doc.metadata.get('location', {}).get('webLocation', {}).get('url')
                            
                            # Use metadata link if available, otherwise use extracted link or default to "#"
                            product["external_link"] = metadata_link or product.get("link") or "#"
                            product["internal_link"] = f"/product/{product_name}"
                            # Ensure there's an icon, default to 'cube' if not provided
                            if not product.get("icon"):
                                product["icon"] = "cube"
                            
                            # Add display_name to the product dictionary
                            product["display_name"] = display_name
                            product["name"] = product_name  # This is now the URL-friendly name
                            
                            products.append(product)
                            processed_products.add(product_name)
                            print(f"Product: {json.dumps(product, indent=2)}")
                            
                            # Yield the product immediately
                            yield product
                        else:
                            print(f"Skipping duplicate product: {product_name}")
            except json.JSONDecodeError as e:
                print(f"JSON decode error for question '{question}': {str(e)}")
                print(f"Problematic JSON string: {json_str if 'json_str' in locals() else 'Not available'}")
            except Exception as e:
                print(f"Error extracting product information for question '{question}': {str(e)}")
                print(f"Document content: {doc.page_content}")
            
    print(f"Total unique products extracted: {len(products)}")

    # Store the generated products in DynamoDB
    for product in products:
        try:
            DYNAMODB_CLIENT.put_item(
                TableName=PRODUCT_TABLE_NAME,
                Item={
                    'name': {'S': product['name']},
                    'display_name': {'S': product['display_name']},
                    'description': {'S': product['description']},
                    'external_link': {'S': product['external_link']},
                    'internal_link': {'S': product['internal_link']},
                    'icon': {'S': product['icon']}
                }
            )
        except Exception as e:
            print(f"Error storing product in DynamoDB: {str(e)}")

@app.route('/product-details/<product_name>', methods=['GET'])
def get_product_details(product_name):
    print(f"Fetching details for product: {product_name}")

    def generate():
        try:
            # Try to get the product from DynamoDB
            response = DYNAMODB_CLIENT.get_item(
                TableName=PRODUCT_TABLE_NAME,
                Key={'name': {'S': product_name}}
            )
            item = response.get('Item')

            if item:
                display_name = item['display_name']['S']
                product_details = json.loads(item['product_details']['S']) if 'product_details' in item else {}

                if not product_details:
                    # If product_details is not present or empty, generate details
                    sections = [
                        {"type": "overview", "prompt": f"Provide a brief, one paragraph overview of {display_name} as it relates to {customer_name}."},
                        {"type": "features", "prompt": f"List the key features of the {display_name} product or service that {customer_name} offers."},
                        {"type": "benefits", "prompt": f"Describe the main benefits of using the {display_name} product or service that {customer_name} offers."},
                        {"type": "pricing", "prompt": f"Explain the pricing structure or plans for {display_name}, if available."}
                    ]

                    for section in sections:
                        docs = products_retriever.get_relevant_documents(f"{display_name} {customer_name} {section['type']}")
                        context = "\n\n".join([doc.metadata['location']['webLocation']['url'] + "\n\n" + doc.page_content for doc in docs])

                        section_prompt = f"""
                        Based on the following information about {display_name}, {section['prompt']}
                        Use markdown formatting for better readability.
                        If the information is not available in the context, state that it's not available.
                        
                        Context: {context}

                        Do not include any framing language such as "According to the context" or "Here is an overview of" in your responses, just get straight to the point!
                        """

                        yield f"data: {json.dumps({'type': 'section_start', 'section': section['type']})}\n\n"

                        response = BEDROCK_CLIENT.converse_stream(
                            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
                            system=[{"text": system_prompt}],
                            messages=[{"role": "user", "content": [{"text": section_prompt}]}],
                            inferenceConfig={"maxTokens": 500, "temperature": 0, "topP": 1},
                        )

                        section_content = ""
                        for chunk in response["stream"]:
                            if "contentBlockDelta" in chunk:
                                text = chunk["contentBlockDelta"]["delta"]["text"]
                                section_content += text
                                yield f"data: {json.dumps({'type': 'content', 'section': section['type'], 'content': text})}\n\n"

                        product_details[section['type']] = section_content
                        yield f"data: {json.dumps({'type': 'section_end', 'section': section['type']})}\n\n"

                    # Update only the product_details field in DynamoDB
                    try:
                        DYNAMODB_CLIENT.update_item(
                            TableName=PRODUCT_TABLE_NAME,
                            Key={'name': {'S': product_name}},
                            UpdateExpression="SET product_details = :details",
                            ExpressionAttributeValues={
                                ':details': {'S': json.dumps(product_details)}
                            },
                            # Add this condition to ensure we don't create a new item if it doesn't exist
                            ConditionExpression="attribute_exists(#name)",
                            ExpressionAttributeNames={
                                "#name": "name"
                            }
                        )
                    except ClientError as e:
                        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                            print(f"Product {product_name} does not exist in DynamoDB. Cannot update product_details.")
                        else:
                            print(f"Error updating product details in DynamoDB: {str(e)}")

                # Yield the product details
                yield f"data: {json.dumps(product_details)}\n\n"
                yield f"data: {json.dumps({'type': 'stop'})}\n\n"
            else:
                print(f"Product {product_name} not found in DynamoDB.")
                yield f"data: {json.dumps({'error': 'Product not found'})}\n\n"
        except ClientError as e:
            print(f"Error retrieving product from DynamoDB: {str(e)}")
            yield f"data: {json.dumps({'error': 'Failed to retrieve product details'})}\n\n"

    return Response(generate(), mimetype='text/event-stream')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=os.environ.get('DEBUG', False))
