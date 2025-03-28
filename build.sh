#!/bin/bash

aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws/z6v3b4o4
docker build -t gaitd .
docker tag gaitd:latest public.ecr.aws/z6v3b4o4/gaitd:latest
docker push public.ecr.aws/z6v3b4o4/gaitd:latest

