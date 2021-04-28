'use strict'

module.exports = class ServerlessMonitoringPlugin {
	constructor(serverless) {
		this.serverless = serverless

		this.hooks = {
			'after:aws:package:finalize:mergeCustomProviderResources': this.process.bind(
				this
			)
		}
	}

	process() {
		const { compiledCloudFormationTemplate } = this.serverless.service.provider

		const reducers = {
			'AWS::DynamoDB::Table': this.dynamoDbReducer.bind(this),
			'AWS::ApiGateway::RestApi': this.apiGatewayReducer.bind(this),
			'AWS::AppSync::GraphQLApi': this.appSyncReducer.bind(this),
			'AWS::Cognito::UserPoolClient': this.cognitoReducer.bind(this),
			'AWS::StepFunctions::StateMachine': this.stepFunctionsReducer.bind(this),
			'AWS::SQS::Queue': this.sqsReducer.bind(this),
			'AWS::SNS::Topic': this.snsReducer.bind(this),
			'AWS::S3::Bucket': this.s3Reducer.bind(this),
			'AWS::Lambda::Function': this.lambdaReducer.bind(this),
			'AWS::Logs::MetricFilter': this.logMetricsReducer.bind(this)
		}

		const stages = ['master', 'staging', 'beta', 'develop20']

		// Prepares ordered template according to order of "reducers"
		// so that the widgets are in the dashboard then sorted accordingly
		const orderedWidgetsTemplate = Object.entries(reducers).reduce(
			(acc, [serviceName]) => ({ ...acc, [serviceName]: {} }),
			{}
		)

		const { widgets, variables } = Object.entries(
			Object.entries(compiledCloudFormationTemplate.Resources)
				.filter(([, resource]) => resource.Type in reducers)
				.reduce(
					(acc, [logicalId, resource]) => ({
						...acc,
						[resource.Type]: {
							...(typeof acc[resource.Type] !== 'undefined'
								? acc[resource.Type]
								: {}),
							[logicalId]: resource
						}
					}),
					orderedWidgetsTemplate
				)
		).reduce(
			(acc, [type, resources]) => {
				const resourcesArray = Object.entries(resources)

				if (resourcesArray.length === 0) {
					return acc
				}

				const { widgets, variables } = reducers[type](resourcesArray)

				return {
					widgets: [...acc.widgets, ...widgets],
					variables: { ...acc.variables, ...variables }
				}
			},
			{
				widgets: [...this.generalMetrics().widgets],
				variables: {}
			}
		)

		if (stages.includes(this.serverless.service.provider.stage)) {
			compiledCloudFormationTemplate.Resources['Dashboard'] = {
				Type: 'AWS::CloudWatch::Dashboard',
				Properties: {
					DashboardBody: {
						'Fn::Sub': [JSON.stringify({ widgets }), variables]
					},
					DashboardName: `${this.serverless.service.service}-${this.serverless.service.provider.stage}`
				}
			}
		}
	}

	/*

		Widgets utils

	*/

	titleWidget(title) {
		return {
			type: 'text',
			width: 24,
			height: 1,
			properties: { markdown: `# ${title}` }
		}
	}

	metricWidget({ title, metrics }) {
		return {
			type: 'metric',
			width: 4,
			height: 4,
			properties: {
				title,
				region: this.serverless.service.provider.region,
				period: 300,
				yAxis: {
					left: {
						min: 0
					},
					right: {
						min: 0
					}
				},
				view: 'timeSeries',
				stacked: false,
				metrics
			}
		}
	}

	/*

		Reducers

	*/

	generalMetrics() {
		return {
			widgets: [
				this.titleWidget('General Metrics for whole AWS account'),
				this.metricWidget({
					title: 'Lambda',
					metrics: [
						[
							'AWS/Lambda',
							'Duration',
							{ yAxis: 'right', stat: 'Average', period: 500 }
						],
						['.', 'Throttles', { stat: 'Sum', period: 500 }],
						['.', 'Invocations', { stat: 'Sum', period: 500 }],
						['.', 'Errors', { stat: 'Sum', period: 500 }]
					]
				}),
				this.metricWidget({
					title: 'Step Functions',
					metrics: [
						[
							'AWS/States',
							'ConsumedCapacity',
							'ServiceMetric',
							'StateTransition',
							{ stat: 'Sum', period: 500 }
						],
						['.', 'ThrottledEvents', '.', '.', { stat: 'Sum', period: 500 }],
						[
							'.',
							'ProvisionedRefillRate',
							'.',
							'.',
							{ stat: 'Average', period: 500 }
						],
						[
							'.',
							'ProvisionedBucketSize',
							'.',
							'.',
							{ stat: 'Average', period: 500 }
						]
					]
				})
			],
			variables: {}
		}
	}

	dynamoDbReducer(resources) {
		return {
			widgets: [
				this.titleWidget('DynamoDB Tables'),
				...resources.map(([logicalId]) =>
					this.metricWidget({
						title: logicalId.replace(/Table$/g, ''),
						metrics: [
							[
								'AWS/DynamoDB',
								'ConsumedReadCapacityUnits',
								'TableName',
								`\${${logicalId}}`,
								{ stat: 'Average' }
							],
							[
								'.',
								'ConsumedWriteCapacityUnits',
								'.',
								'.',
								{ stat: 'Average' }
							],
							[
								'.',
								'ProvisionedReadCapacityUnits',
								'.',
								'.',
								{ stat: 'Average' }
							],
							[
								'.',
								'ProvisionedWriteCapacityUnits',
								'.',
								'.',
								{ stat: 'Average' }
							],
							[
								'.',
								'ThrottledRequests',
								'.',
								'.',
								{ yAxis: 'right', stat: 'Sum' }
							],
							['.', 'UserErrors', '.', '.', { yAxis: 'right', stat: 'Sum' }],
							['.', 'SystemErrors', '.', '.', { yAxis: 'right', stat: 'Sum' }]
						]
					})
				)
			],
			variables: resources.reduce(
				(acc, [logicalId]) => ({
					...acc,
					[logicalId]: { Ref: logicalId }
				}),
				{}
			)
		}
	}

	s3Reducer(resources) {
		return {
			widgets: [
				this.titleWidget('S3 Buckets'),
				...resources.map(([logicalId]) =>
					this.metricWidget({
						title: logicalId.replace(/Bucket$/g, ''),
						metrics: [
							[
								'AWS/S3',
								'NumberOfObjects',
								'StorageType',
								'AllStorageTypes',
								'BucketName',
								`\${${logicalId}}`,
								{ stat: 'Average' }
							]
						]
					})
				)
			],
			variables: resources.reduce(
				(acc, [logicalId]) => ({
					...acc,
					[logicalId]: { Ref: logicalId }
				}),
				{}
			)
		}
	}

	sqsReducer(resources) {
		return {
			widgets: [
				this.titleWidget('SQS Queues'),
				...resources.map(([logicalId]) =>
					this.metricWidget({
						title: logicalId.replace(/Queue$/g, ''),
						metrics: [
							[
								'AWS/SQS',
								'NumberOfMessagesSent',
								'QueueName',
								`\${${logicalId}}`,
								{ stat: 'Sum' }
							]
						]
					})
				)
			],
			variables: resources.reduce(
				(acc, [logicalId]) => ({
					...acc,
					[logicalId]: { 'Fn::GetAtt': [logicalId, 'QueueName'] }
				}),
				{}
			)
		}
	}

	snsReducer(resources) {
		return {
			widgets: [
				this.titleWidget('SNS Topics'),
				...resources.map(([logicalId]) =>
					this.metricWidget({
						title: logicalId.replace(/Topic$/g, ''),
						metrics: [
							[
								'AWS/SNS',
								'NumberOfNotificationsFailed',
								'TopicName',
								`\${${logicalId}}`,
								{ stat: 'Sum' }
							]
						]
					})
				)
			],
			variables: resources.reduce(
				(acc, [logicalId]) => ({
					...acc,
					[logicalId]: { 'Fn::GetAtt': [logicalId, 'TopicName'] }
				}),
				{}
			)
		}
	}

	lambdaReducer(resources) {
		// Becuase of the AWS Dashboards UI performance issue the graphql resolvers are excluded
		const resourcesWitoutGraphql = resources.filter(
			([logicalId]) => !logicalId.startsWith('UnderscoregqlDash')
		)

		return {
			widgets: [
				this.titleWidget('Lambda Functions'),
				...resourcesWitoutGraphql.map(([logicalId, resource]) =>
					this.metricWidget({
						title: resource.Properties.FunctionName.replace(
							`${this.serverless.service.service}-${this.serverless.service.provider.stage}-`,
							''
						),
						metrics: [
							[
								'AWS/Lambda',
								'Duration',
								'FunctionName',
								`\${${logicalId}}`,
								{ yAxis: 'right', stat: 'Average' }
							],
							['.', 'Throttles', '.', '.', { stat: 'Sum' }],
							['.', 'Invocations', '.', '.', { stat: 'Sum' }],
							['.', 'Errors', '.', '.', { stat: 'Sum' }]
						]
					})
				)
			],
			variables: resourcesWitoutGraphql.reduce(
				(acc, [logicalId]) => ({
					...acc,
					[logicalId]: { Ref: logicalId }
				}),
				{}
			)
		}
	}

	cognitoReducer(resources) {
		const title = (logicalId) =>
			logicalId.replace(/Client$/g, '').replace('Cognito', '')

		return {
			widgets: [
				this.titleWidget('Cognito'),
				...resources.map(([logicalId]) =>
					this.metricWidget({
						title: `${title(logicalId)} SignUp`,
						metrics: [
							[
								'AWS/Cognito',
								'SignUpSuccesses',
								'UserPool',
								`\${${logicalId}Pool}`,
								'UserPoolClient',
								`\${${logicalId}}`,
								{ stat: 'Sum' }
							],
							['.', 'SignUpThrottles', '.', `.`, '.', `.`, { stat: 'Sum' }]
						]
					})
				),
				...resources.map(([logicalId]) =>
					this.metricWidget({
						title: `${title(logicalId)} SignIn`,
						metrics: [
							[
								'AWS/Cognito',
								'SignInSuccesses',
								'UserPool',
								`\${${logicalId}Pool}`,
								'UserPoolClient',
								`\${${logicalId}}`,
								{ stat: 'Sum' }
							],
							['.', 'SignInThrottles', '.', `.`, '.', `.`, { stat: 'Sum' }]
						]
					})
				),
				...resources.map(([logicalId]) =>
					this.metricWidget({
						title: `${title(logicalId)} TokenRefresh`,
						metrics: [
							[
								'AWS/Cognito',
								'TokenRefreshSuccesses',
								'UserPool',
								`\${${logicalId}Pool}`,
								'UserPoolClient',
								`\${${logicalId}}`,
								{ stat: 'Sum' }
							],
							[
								'.',
								'TokenRefreshThrottles',
								'.',
								`.`,
								'.',
								`.`,
								{ stat: 'Sum' }
							]
						]
					})
				)
			],
			variables: resources.reduce(
				(acc, [logicalId, resource]) => ({
					...acc,
					[`${logicalId}Pool`]: resource.Properties.UserPoolId,
					[logicalId]: { Ref: logicalId }
				}),
				{}
			)
		}
	}

	apiGatewayReducer(resources) {
		if (resources.length === 0) {
			return {
				widgets: [],
				variables: {}
			}
		}

		const [, resource] = resources[0]

		return {
			widgets: [
				this.titleWidget('API Gateway'),
				this.metricWidget({
					title: '5XX',
					metrics: [
						[
							'AWS/ApiGateway',
							'5XXError',
							'ApiName',
							resource.Properties.Name,
							'Stage',
							this.serverless.service.provider.stage,
							{ stat: 'Sum' }
						]
					]
				}),
				this.metricWidget({
					title: '4XX',
					metrics: [
						[
							'AWS/ApiGateway',
							'4XXError',
							'ApiName',
							resource.Properties.Name,
							'Stage',
							this.serverless.service.provider.stage,
							{ stat: 'Sum' }
						]
					]
				}),
				this.metricWidget({
					title: 'Requests Count',
					metrics: [
						[
							'AWS/ApiGateway',
							'Count',
							'ApiName',
							resource.Properties.Name,
							'Stage',
							this.serverless.service.provider.stage,
							{ stat: 'Sum' }
						]
					]
				}),
				this.metricWidget({
					title: 'Latency',
					metrics: [
						[
							'AWS/ApiGateway',
							'Latency',
							'ApiName',
							resource.Properties.Name,
							'Stage',
							this.serverless.service.provider.stage,
							{ stat: 'Average' }
						]
					]
				})
			],
			variables: {}
		}
	}

	logMetricsReducer(resources) {
		return {
			widgets: [
				this.titleWidget('Custom Log Metrics'),
				...resources.map(([logicalId, resource]) =>
					this.metricWidget({
						title: logicalId.replace(/LogMetric$/g, ''),
						metrics: resource.Properties.MetricTransformations.map((metric) => [
							metric.MetricNamespace,
							metric.MetricName,
							{ stat: 'Sum' }
						])
					})
				)
			],
			variables: {}
		}
	}

	stepFunctionsReducer(resources) {
		return {
			widgets: [
				this.titleWidget('Step Functions'),
				...resources.map(([logicalId]) =>
					this.metricWidget({
						title: logicalId.replace(/StateMachine$/g, ''),
						metrics: [
							[
								'AWS/States',
								'ExecutionsTimedOut',
								'StateMachineArn',
								`\${${logicalId}}`,
								{ stat: 'Sum' }
							],
							['.', 'ExecutionThrottled', '.', `.`, { stat: 'Sum' }],
							['.', 'ExecutionsStarted', '.', `.`, { stat: 'Sum' }],
							['.', 'ExecutionsSucceeded', '.', `.`, { stat: 'Sum' }]
						]
					})
				)
			],
			variables: resources.reduce(
				(acc, [logicalId]) => ({
					...acc,
					[logicalId]: { Ref: logicalId }
				}),
				{}
			)
		}
	}

	appSyncReducer(resources) {
		if (resources.length === 0) {
			return {
				widgets: [],
				variables: {}
			}
		}

		const [logicalId] = resources[0]

		return {
			widgets: [
				this.titleWidget('AppSync API'),
				this.metricWidget({
					title: '5XX',
					metrics: [
						[
							'AWS/AppSync',
							'5XXError',
							'GraphQLAPIId',
							`\${${logicalId}}`,
							{ stat: 'Sum' }
						]
					]
				}),
				this.metricWidget({
					title: '4XX',
					metrics: [
						[
							'AWS/AppSync',
							'4XXError',
							'GraphQLAPIId',
							`\${${logicalId}}`,
							{ stat: 'Sum' }
						]
					]
				}),
				this.metricWidget({
					title: 'Latency',
					metrics: [
						[
							'AWS/AppSync',
							'Latency',
							'GraphQLAPIId',
							`\${${logicalId}}`,
							{ stat: 'Sum' }
						]
					]
				}),
				this.titleWidget('AppSync Subscriptions'),
				this.metricWidget({
					title: 'ConnectSuccess',
					metrics: [
						[
							'AWS/AppSync',
							'ConnectSuccess',
							'GraphQLAPIId',
							`\${${logicalId}}`,
							{ stat: 'Sum' }
						]
					]
				}),
				this.metricWidget({
					title: 'SubscribeSuccess',
					metrics: [
						[
							'AWS/AppSync',
							'SubscribeSuccess',
							'GraphQLAPIId',
							`\${${logicalId}}`,
							{ stat: 'Sum' }
						]
					]
				}),
				this.metricWidget({
					title: 'SubscribeClientError',
					metrics: [
						[
							'AWS/AppSync',
							'SubscribeClientError',
							'GraphQLAPIId',
							`\${${logicalId}}`,
							{ stat: 'Sum' }
						]
					]
				}),
				this.metricWidget({
					title: 'SubscribeServerError',
					metrics: [
						[
							'AWS/AppSync',
							'SubscribeServerError',
							'GraphQLAPIId',
							`\${${logicalId}}`,
							{ stat: 'Sum' }
						]
					]
				}),
				this.metricWidget({
					title: 'ActiveConnection',
					metrics: [
						[
							'AWS/AppSync',
							'ActiveConnection',
							'GraphQLAPIId',
							`\${${logicalId}}`,
							{ stat: 'Average' }
						]
					]
				}),
				this.metricWidget({
					title: 'ActiveSubscription',
					metrics: [
						[
							'AWS/AppSync',
							'ActiveSubscription',
							'GraphQLAPIId',
							`\${${logicalId}}`,
							{ stat: 'Average' }
						]
					]
				}),
				this.metricWidget({
					title: 'ConnectionDuration',
					metrics: [
						[
							'AWS/AppSync',
							'ConnectionDuration',
							'GraphQLAPIId',
							`\${${logicalId}}`,
							{ stat: 'Average' }
						]
					]
				})
			],
			variables: {
				[logicalId]: { 'Fn::GetAtt': [logicalId, 'ApiId'] }
			}
		}
	}
}
