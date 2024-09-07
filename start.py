#!/usr/bin/env python3
import argparse
import subprocess
import sys
import json
import os
import shutil
import threading

def npm_install():
    subprocess.run(["npm", "install"], check=True)

def check_cdk_cli():
    if shutil.which('cdk') is None:
        print("CDK CLI is not found in your system PATH.")
        print("Please install the AWS CDK CLI by following the instructions at:")
        print("https://docs.aws.amazon.com/cdk/v2/guide/cli.html")
        print("After installation, restart your terminal and run this script again.")
        sys.exit(1)

def check_docker():
    if shutil.which('docker') is None:
        print("Docker is not found in your system PATH.")
        print("Please install Docker by following the instructions at:")
        print("https://docs.docker.com/get-docker/")
        print("After installation, restart your terminal and run this script again.")
        sys.exit(1)
        
def check_ecr_login():
    try:
        # Check if we're logged in to ECR Public
        result = subprocess.run(["docker", "image", "ls", "public.ecr.aws/z6v3b4o4/aws-cli"], capture_output=True, text=True)
        if "REPOSITORY" in result.stdout:
            print("Already logged in to ECR Public.")
        else:
            print("Logging in to ECR Public...")
            login_command = "aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws/z6v3b4o4"
            subprocess.run(login_command, shell=True, check=True)
            print("Successfully logged in to ECR Public.")
    except subprocess.CalledProcessError as e:
        print(f"Error logging in to ECR Public: {e}")
        sys.exit(1)

def run_command(command):
    try:
        print("Running command: ", command)
        subprocess.run(command, check=True, shell=True)
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {e}")
        sys.exit(1)

def deploy(stack=None):
    context = load_context()
    command = "cdk deploy"
    if stack:
        if stack == "app":
            stack_name = f"KB-{context['customerName']}-AppStack"
        elif stack == "kb":
            stack_name = f"KB-{context['customerName']}-KBStack"
        else:
            print("Invalid stack option. Please choose 'app' or 'kb'.")
            return
        command += f" {stack_name}"
    else:
        command += " --all"
    command += " --require-approval never"
    print(f"*** 🚀 Deploying {'all stacks' if not stack else stack} ***")
    run_command(command)
    print("*** ✅ Stack deployed successfully ***")
    print("If this is the first time you've deployed this stack, you will need to wait for the Knowledge Base to finish crawling the web. This can take a while.")
    print("You can check the status of the Knowledge Base in the AWS console at https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/knowledge-bases")

def destroy(stack=None):
    context = load_context()
    command = "cdk destroy"
    if stack:
        if stack == "app":
            stack_name = f"KB-{context['customerName']}-AppStack"
        elif stack == "kb":
            stack_name = f"KB-{context['customerName']}-KBStack"
        else:
            print("Invalid stack option. Please choose 'app' or 'kb'.")
            return
        command += f" {stack_name}"
    else:
        command += " --all"
    print(f"*** 🚀 Destroying {'all stacks' if not stack else stack} ***")
    run_command(command)

def synth(stack=None):
    command = "cdk synth"
    if stack:
        command += f" {stack}"
    run_command(command)

def check_context_file(customer_name):
    context_file = os.path.join('customers', f"{customer_name}.json")
    required_keys = ['scrapeUrls', 'customerName', 'customerIndustry']
    optional_keys = ['customerLogo', 'customerFavicon']
    
    if not os.path.exists(context_file) or os.path.getsize(context_file) == 0:
        print(f"*** ⛔️ Context file for {customer_name} is missing or empty. Let's set it up! ***")
        create_context_file({}, customer_name)
    else:
        with open(context_file, 'r') as f:
            context = json.load(f)
        if not all(key in context and context[key] for key in required_keys):
            print(f"*** ⛔️ Context file for {customer_name} is incomplete. Let's update it! ***")
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

    context['scrapeUrls'] = [url.strip().strip('"') for url in get_input('scrapeUrls', "Enter comma-separated URLs to scrape").split(',')]
    context['customerName'] = customer_name
    context['customerIndustry'] = get_input('customerIndustry', "Enter customer industry")

    os.makedirs('customers', exist_ok=True)
    with open(os.path.join('customers', f"{customer_name}.json"), 'w') as f:
        json.dump(context, f, indent=2)
    print(f"Context file for {customer_name} has been created/updated successfully!")

def load_customer_context(customer_name):
    customer_file = os.path.join('customers', f"{customer_name}.json")
    if not os.path.exists(customer_file):
        print(f"Customer {customer_name} does not exist.")
        sys.exit(1)
    
    with open(customer_file, 'r') as f:
        context = json.load(f)
    
    with open('cdk.context.json', 'w') as f:
        json.dump(context, f, indent=2)
    
    print(f"Loaded context for customer: {customer_name}")

def list_customers():
    customers_dir = 'customers'
    if not os.path.exists(customers_dir):
        print("No customers found.")
        return
    customers = [f.split('.')[0] for f in os.listdir(customers_dir) if f.endswith('.json')]
    if not customers:
        print("No customers found.")
    else:
        print("Available customers:")
        for customer in customers:
            print(f"- {customer}")

def create_customer():
    customer_name = input("Enter new customer name: ").strip()
    if not customer_name:
        print("Customer name cannot be empty.")
        return
    
    customer_file = os.path.join('customers', f"{customer_name}.json")
    if os.path.exists(customer_file):
        print(f"Customer {customer_name} already exists.")
        return
    
    create_context_file({}, customer_name)
    print(f"Customer {customer_name} created successfully.")

def load_context():
    with open('cdk.context.json', 'r') as f:
        return json.load(f)

def run_local():
    # Check if python or python3 is on the path and set python_command
    python_command = None
    for cmd in ['python', 'python3']:
        try:
            subprocess.run([cmd, '--version'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            python_command = cmd
            break
        except subprocess.CalledProcessError:
            continue
        except FileNotFoundError:
            continue

    if python_command is None:
        print("Error: Neither 'python' nor 'python3' found on the system path.")
        sys.exit(1)

    print(f"Using Python command: {python_command}")
    def run_frontend():
        frontend_dir = os.path.join("lib", "frontend")
        if not os.path.exists(frontend_dir):
            print(f"Frontend directory not found: {frontend_dir}")
            return
        os.chdir(frontend_dir)
        process = subprocess.Popen("npm run start", shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        stream_output(process, "Frontend")

    def run_backend():
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        os.chdir(backend_dir)
        process = subprocess.Popen(f"{python_command} start.py", shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        stream_output(process, "Backend")

    print("Starting local development environment...")
    frontend_thread = threading.Thread(target=run_frontend)
    backend_thread = threading.Thread(target=run_backend)

    frontend_thread.start()
    backend_thread.start()

    try:
        frontend_thread.join()
        backend_thread.join()
    except KeyboardInterrupt:
        print("\nStopping local development environment...")

def main():
    check_cdk_cli()
    check_docker()

    parser = argparse.ArgumentParser(description="CDK Deployment Script")
    parser.add_argument("command", choices=["deploy", "destroy", "synth", "list", "create", "local"], help="Command to execute")
    parser.add_argument("stack", nargs="?", choices=["app", "kb"], help="Stack to operate on (optional)")
    parser.add_argument("--customer", help="Customer name")

    args = parser.parse_args()

    if args.command == "local":
        run_local()
        return

    if args.command == "list":
        list_customers()
        return
    elif args.command == "create":
        create_customer()
        return

    if not args.customer:
        print("Please specify a customer using --customer")
        sys.exit(1)

    check_context_file(args.customer)
    load_customer_context(args.customer)
    npm_install()

    if args.command == "deploy":
        deploy(args.stack)
    elif args.command == "destroy":
        destroy(args.stack)
    elif args.command == "synth":
        synth(args.stack)

if __name__ == "__main__":
    main()