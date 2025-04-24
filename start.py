#!/usr/bin/env python3
import argparse
import subprocess
import sys
import json
import os
import shutil
import threading
import time

# -- Removed base64 import since bodies are sent as plain JSON

def check_customers_dir():
    if not os.path.exists('customers'):
        print("📂 Creating customers directory...")
        os.makedirs('customers')

def npm_install():
    run_command("npm install")

def check_cdk_cli():
    if shutil.which('cdk') is None:
        print("    ❌ CDK CLI is not found in your system PATH.")
        print("Please install the AWS CDK CLI by following the instructions at:")
        print("    🔗 https://docs.aws.amazon.com/cdk/v2/guide/cli.html")
        print("    After installation, restart your terminal and run this script again.")
        sys.exit(1)
    print("    ✅ CDK CLI is found in your system PATH.")

def check_docker():
    if shutil.which('docker') is None:
        print("    ❌ Docker is not found in your system PATH.")
        print("Please install Docker by following the instructions at:")
        print("    🔗 https://docs.docker.com/get-docker/")
        print("After installation, restart your terminal and run this script again.")
        sys.exit(1)
    print("    ✅ Docker is found in your system PATH.")

def run_command(command):
    try:
        command_list = command if isinstance(command, list) else command.split()
        print(f"🚀 Running command: {' '.join(command_list)}")
        subprocess.run(command_list, check=True)
    except subprocess.CalledProcessError as e:
        print(f"❌ Error executing command: {e}")
        sys.exit(1)

def deploy(stack=None):
    print("🚀 Deploying CDK stack...")
    context = load_context()
    command = "cdk deploy"
    if stack:
        if stack == "app":
            stack_name = f"KB-{context['customerName']}-AppStack"
        elif stack == "kb":
            stack_name = f"KB-{context['customerName']}-KBStack"
        else:
            print("❌ Invalid stack option. Please choose 'app' or 'kb'.")
            return
        command += f" {stack_name}"
    else:
        command += " --all"
    command += " --require-approval never"
    print(f"    Deploying {'all stacks' if not stack else stack}...")
    run_command(command)
    print("""✅ Stack deployed successfully! You can use the above DemoFrontendURL to access the demo.

ℹ️  If this is the first time you've deployed this stack, you will need to wait for the Knowledge Base to finish crawling the web. This can take a while.")

🔍 You can check the status of the Knowledge Base in the AWS console at:

🔗 https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/knowledge-bases"""
)

def destroy(stack=None):
    context = load_context()
    command = "cdk destroy"
    if stack:
        if stack == "app":
            stack_name = f"KB-{context['customerName']}-AppStack"
        elif stack == "kb":
            stack_name = f"KB-{context['customerName']}-KBStack"
        else:
            print("❌ Invalid stack option. Please choose 'app' or 'kb'.")
            return
        command += f" {stack_name}"
    else:
        command += " --all"
    print(f"💥 Destroying {'all stacks' if not stack else stack}...")
    run_command(command)

def synth(stack=None):
    command = "cdk synth"
    if stack:
        command += f" {stack}"
    run_command(command)

def check_context_file(customer_name):
    context_file = os.path.join('customers', f"{customer_name}.json")
    required_keys = ['scrapeUrls', 'customerName', 'customerIndustry']

    if not os.path.exists(context_file) or os.path.getsize(context_file) == 0:
        print(f"⛔️ Context file for {customer_name} is missing or empty. Let's set it up!")
        create_context_file({}, customer_name)
    else:
        with open(context_file, 'r') as f:
            context = json.load(f)
        if not all(key in context and context[key] for key in required_keys):
            print(f"⛔️ Context file for {customer_name} is incomplete. Let's update it!")
            create_context_file(context, customer_name)

def create_context_file(existing_context, customer_name):
    context = existing_context.copy()
    def get_input(key, prompt, required=True):
        existing_value = context.get(key, '')
        prompt_with_default = f"{prompt} ({existing_value}): " if existing_value else f"{prompt}: "
        while True:
            value = input(prompt_with_default).strip() or existing_value
            if value or not required:
                return value
            print("This field is required. Please enter a value.")

    context['scrapeUrls'] = [url.strip().strip('"') for url in get_input('scrapeUrls', "    Enter comma-separated URLs to scrape").split(',')]
    context['customerName'] = customer_name
    context['customerIndustry'] = get_input('customerIndustry', "    Enter customer industry")

    os.makedirs('customers', exist_ok=True)
    with open(os.path.join('customers', f"{customer_name}.json"), 'w') as f:
        json.dump(context, f, indent=2)
    print(f"✅ Context file for {customer_name} has been created/updated successfully!")

def load_customer_context(customer_name):
    customer_file = os.path.join('customers', f"{customer_name}.json")
    if not os.path.exists(customer_file):
        print(f"❌ Customer {customer_name} does not exist.")
        sys.exit(1)
    with open(customer_file, 'r') as f:
        context = json.load(f)
    with open('cdk.context.json', 'w') as f:
        json.dump(context, f, indent=2)
    print(f"✅ Loaded context for customer: {customer_name}")

def list_customers():
    customers_dir = 'customers'
    if not os.path.exists(customers_dir):
        print("📂 No customers found.")
        return
    customers = [f.split('.')[0] for f in os.listdir(customers_dir) if f.endswith('.json')]
    if not customers:
        print("📂 No customers found.")
    else:
        print("📋 Available customers:")
        for customer in customers:
            print(f"  • {customer}")

def create_customer():
    customer_name = input("Enter new customer name: ").strip()
    if not customer_name:
        print("❌ Customer name cannot be empty.")
        return
    customer_file = os.path.join('customers', f"{customer_name}.json")
    if os.path.exists(customer_file):
        print(f"❌ Customer {customer_name} already exists.")
        return
    create_context_file({}, customer_name)
    print(f"✅ Customer {customer_name} created successfully.")

def load_context():
    with open('cdk.context.json', 'r') as f:
        return json.load(f)

def check_bedrock_models():
    models_check_file = os.path.join('customers', "bedrock_models_check.json")
    if os.path.exists(models_check_file):
        with open(models_check_file, 'r') as f:
            check_data = json.load(f)
        if check_data and all(status == "available" for status in check_data.values()):
            print("    ✅ Using cached Bedrock models check. All required models are available.")
            return

    print("🔍 Checking for required Bedrock models...")
    required_models = [
        "anthropic.claude-3-sonnet-20240229-v1:0",
        "anthropic.claude-3-haiku-20240307-v1:0",
        "amazon.titan-image-generator-v2:0"
    ]
    models_status = {}
    for model_id in required_models:
        print(f"  Testing model: {model_id}")
        try:
            if "claude" in model_id:
                # Use updated Claude prompt format without base64
                body = json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 10,
                    "messages": [
                        {"role": "user", "content": [{"type": "text", "text": "Hello"}]} 
                    ]
                })
            elif "titan-image-generator" in model_id:
                # Use plain JSON for image generator payload
                body = json.dumps({
                    "taskType": "TEXT_IMAGE",
                    "textToImageParams": {
                        "text": "A simple test image",
                        "negativeText": "blurry, distorted, low quality",
                    },
                    "imageGenerationConfig": {
                        "quality": "standard",
                        "width": 512,
                        "height": 512,
                        "numberOfImages": 1,
                        "cfgScale": 8.0,
                        "seed": 42
                    }
                })

            # Invoke the model with plain JSON body
            command = [
                "aws", "bedrock-runtime", "invoke-model",
                "--model-id", model_id,
                "--body", body,
                "--content-type", "application/json",
                "--region", "us-east-1",
                "--output", "json",
                "output.txt"
            ]
            result = subprocess.run(command, capture_output=True, text=True, check=True)
            if result.returncode == 0:
                print(f"    ✅ Model {model_id} is available and functioning.")
                models_status[model_id] = "available"
            else:
                print(f"    ❌ Error invoking model {model_id}: {result.stderr}")
                models_status[model_id] = "error"
        except subprocess.CalledProcessError as e:
            print(f"    ❌ Error invoking model {model_id}: {e.stderr}")
            models_status[model_id] = "error"

    if all(status == "available" for status in models_status.values()):
        with open(models_check_file, 'w') as f:
            json.dump(models_status, f)
        print("    ✅ All required Bedrock models are available and functioning.")
    else:
        print("    ❌ Some required Bedrock models are not available.")
        print("Please ensure you have access to these models in the us-east-1 region.")
        print("🔗 https://docs.aws.amazon.com/bedrock/latest/userguide/model-access-modify.html")
        sys.exit(1)

def run_process(command, working_dir, prefix):
    current_dir = os.getcwd()
    os.chdir(working_dir)
    try:
        command_list = command if isinstance(command, list) else command.split()
        print(f"🚀 Running process: {' '.join(command_list)}")
        process = subprocess.Popen(
            command_list,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        for line in iter(process.stdout.readline, ''):
            sys.stdout.write(f"{prefix}: {line}")
            sys.stdout.flush()
    finally:
        os.chdir(current_dir)

def main():
    print("🔍 Checking for required dependencies...")
    check_customers_dir()
    check_cdk_cli()
    check_docker()
    check_bedrock_models()

    parser = argparse.ArgumentParser(description="CDK Deployment Script")
    parser.add_argument("command", choices=["deploy", "destroy", "synth", "list", "create"], help="Command to execute")
    parser.add_argument("stack", nargs="?", choices=["app", "kb"], help="Stack to operate on (optional)")
    parser.add_argument("--customer", help="Customer name")

    args = parser.parse_args()

    if args.command == "list":
        list_customers()
        return
    elif args.command == "create":
        create_customer()
        return

    if not args.customer:
        print("❌ Please specify a customer using --customer")
        sys.exit(1)

    check_context_file(args.customer)
    load_customer_context(args.customer)
    print("📦 Installing npm dependencies...")
    npm_install()

    if args.command == "deploy":
        deploy(args.stack)
    elif args.command == "destroy":
        destroy(args.stack)
    elif args.command == "synth":
        synth(args.stack)

if __name__ == "__main__":
    main()