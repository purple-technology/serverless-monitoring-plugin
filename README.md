# serverless-monitoring-plugin
[![CI Status Badge](https://circleci.com/gh/purple-technology/serverless-monitoring-plugin.svg?style=svg)](https://github.com/purple-technology/serverless-monitoring-plugin)


This generates a CloudWatch dashboard for AWS resources. 

## Install

```sh
$ npm install --save-dev @purple/serverless-monitoring-plugin
```

Add the plugin to your `serverless.yml` file
```yml
plugins:
  - '@purple/serverless-monitoring-plugin'
```

## Supported resources


- `AWS::DynamoDB::Table`
- `AWS::ApiGateway::RestApi`
- `AWS::AppSync::GraphQLApi`
- `AWS::Cognito::UserPoolClient`
- `AWS::StepFunctions::StateMachine`
- `AWS::SQS::Queue`
- `AWS::SNS::Topic`
- `AWS::S3::Bucket`
- `AWS::Lambda::Function`
- `AWS::Logs::MetricFilter`
