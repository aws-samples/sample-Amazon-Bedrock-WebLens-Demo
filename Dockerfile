FROM robertd/alpine-aws-cdk

# Copy the current directory to the image
COPY . /app

#install docker
RUN apk add --update docker openrc
RUN rc-update add docker boot


# Set the working directory to /app
WORKDIR /app