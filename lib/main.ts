#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { CoreLayerStack } from './stacks/corelayer.stack'

const app = new cdk.App()
new CoreLayerStack( app, 'FW24-Core-Layer' )