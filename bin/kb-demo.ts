#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { KBStack } from '../lib/kb-stack/br-kb-stack'; 
import { AppStack } from '../lib/app-stack';
const app = new cdk.App();


const extractConfig = () => {
  const scrapeUrls = app.node.tryGetContext('scrapeUrls')
  
  if (scrapeUrls === undefined) {
    console.warn('*** ⛔️ WARNING: You must provide a valid scrapeUrl   ***')
    console.warn('*** you can do this by editing cdk.context.json 🚀            ***')
    throw new Error("Missing scrapeUrls")
  } 
  const customerName = app.node.tryGetContext('customerName')
  if (customerName === undefined) {
    console.warn('*** ⛔️ WARNING: You must provide a valid customerName   ***')
    console.warn('*** you can do this by editing cdk.context.json 🚀            ***')
    throw new Error("Missing customerName")
  }
  const customerIndustry = app.node.tryGetContext('customerIndustry')
  if (customerIndustry === undefined) {
    console.warn('*** ⛔️ WARNING: You must provide a valid customerIndustry   ***')
    console.warn('*** you can do this by editing cdk.context.json 🚀            ***')
    throw new Error("Missing customerIndustry")
  }
  

  return {
    scrapeUrls,
    customerName,
    customerIndustry
  }
}

const config = extractConfig();

let stackPrefix = config.customerName
stackPrefix = "KB-" + stackPrefix.replace(/[^\w]/g, '');

const kbStack = new KBStack(app, `${stackPrefix}-KBStack`, {
  scrapeUrls: (config.scrapeUrls + "").split(","),
  customerName: config.customerName,
});

const appStack = new AppStack(app, `${stackPrefix}-AppStack`, {
  customerName: config.customerName,
  knowledgeBaseId: kbStack.knowledgeBaseId,
});