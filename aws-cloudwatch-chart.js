/*

	aws-cloudwatch-chart

	A Node module to draw charts for AWS CloudWatch metrics
	https://github.com/jeka-kiselyov/aws-cloudwatch-chart

	Usage:

	let AwsCloudWatchChart = require('aws-cloudwatch-chart');
	let config = require('./config.json');
	let acs = new AwsCloudWatchChart(config);

	acs.getChart().then(function(chart){
		chart.save('image.png').then(function(filename){
			//// filename should be == 'image.png' this is your chart.
		}
	});

	or

	acs.getChart().then(function(chart){
		chart.get().then(function(image){
			//// image is png image.
		}
	});

	config.json example:

	{
		"metrics": [	/// array of metrics settings
			{
				/// Title of metrics. Will be displayed on chart's legend. Should be unique
				"title": "Server1 Max CPU",
				/// AWS namespace
				/// http://docs.aws.amazon.com/AmazonCloudWatch/latest/DeveloperGuide/aws-namespaces.html
				"namespace": "AWS/EC2",
				/// Metric name
				/// http://docs.aws.amazon.com/AmazonCloudWatch/latest/DeveloperGuide/CW_Support_For_AWS.html
				"metricName": "CPUUtilization",
				/// Statistics values. 'Maximum' and "Average" supported
				"statistic": "Maximum",
				/// Unit. http://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_GetMetricStatistics.html
				/// 'Percent' and 'Count' currently supported
				"unit": "Percent",
				/// Chart line color for this metric
				"color": "af9cf4",
				/// Line thickness in px
				"thickness": 2,
				/// Dashed or solid
				"dashed": false,
				/// This parameter is for Dimensions array. Different for different metrics namespaces
				/// http://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_Dimension.html
				"dimensions": [
					{
						"Name":"InstanceId",
						"Value": "i-2d55aad0"
					}
				]
			}
		],
		"timeOffset": 1440,		//// Get statistic for last 1440 minutes
		"timePeriod": 60,		//// Get statistic for each 60 seconds
		"chartSamples": 20,		//// Data points extrapolated on chart
		"width": 1000,			//// Result image width. Maximum value for width or height is 1,000. Width x height cannot exceed 300,000.
		"height":250			 //// Result image height. Maximum value for width or height is 1,000. Width x height cannot exceed 300,000.
	}

*/

module.exports = (function() {

	const http = require('http');
	const request = require('request');
	const fs = require('fs');
    const AWS = require('aws-sdk');
    const cloudwatchClient = new AWS.CloudWatch();

	const defaultConfig = {
		timeOffset: 1440,
		timePeriod: 60,
		chartSamples: 24,
		width: 1000,
		height: 250
	};

	function AwsCloudWatchChart(config) {
		console.log('in AwsCloudWatchChart');

		this.metrics = [];

		if (typeof(config) !== 'object')
			throw new Error('Must provide config object');

		this.config = Object.assign(
			{},
			defaultConfig,
			config
		);

		if (!Array.isArray(this.config.metrics)) {
			throw new Error('config.metrics array required');
		}

		if (this.config.width > 1000 || this.config.height > 1000 || this.config.height * this.config.width > 300000)
			throw new Error('Maximum value for width or height is 1,000. Width x height cannot exceed 300,000.');

		if (this.config.width < 1 || this.config.height < 1)
			throw new Error('Invalid width and height parameters');

		if (this.config.timePeriod % 60 !== 0)
			throw new Error('config.timePeriod should be based on 60');

		for (let k in this.config.metrics) {
			this.addMetric(this.config.metrics[k]);
		}
	}

	AwsCloudWatchChart.prototype.addMetric = function(params)
	{
		let m = new AwsCloudWatchChartMetric(this);

		for (let k in params)
		{
			console.log(`Parameter: ${k}`);
			switch(k.toLowerCase()) {
				case 'title':
					m.title = '' + params[k];
					break;
				case 'statistic':
					m.statistic = params[k];
					break;
				case 'namespace':
					m.Namespace = '' + params[k];
					break;
				case 'metricname':
					m.MetricName = '' + params[k];
					break;
				case 'color':
					m.color = params[k];
					break;
				case 'unit':
					m.Unit = params[k];
					break;
				case 'thickness':
					m.thickness = parseInt(params[k], 10);
					break;
				case 'dashed':
					m.dashed = (params[k] ? true : false);
					break;
				case 'dimensions':
					m.Dimensions = params[k];
					break;
				default:
					throw new Error(`Unknown parameter: ${k}`);
			}
		}

		this.metrics.push(m);
		return m;
	}

	AwsCloudWatchChart.prototype.getStartTimeString = function()
	{
		let i = new Date;
		i.setTime(i.getTime() - this.config.timeOffset*60*1000);
		return (i.getUTCMonth()+1)+"/"+i.getUTCDate()+" "+("0" + i.getUTCHours()).slice(-2)+':'+("0" + i.getUTCMinutes()).slice(-2);
	}

	AwsCloudWatchChart.prototype.getToTimeString = function()
	{
		let i = new Date;
		return (i.getUTCMonth()+1)+"/"+i.getUTCDate()+" "+("0" + i.getUTCHours()).slice(-2)+':'+("0" + i.getUTCMinutes()).slice(-2);
	}


	AwsCloudWatchChart.prototype.getChart = function()
	{
		let metricsPromises = [];

		for (let k in this.metrics) {
			metricsPromises.push(this.metrics[k].getStatistics());
		}

		return Promise.all(metricsPromises)
			.then(() => {
				return Promise.resolve(this);
			});
	}

	AwsCloudWatchChart.prototype.listMetrics = function(namespace, metricName)
	{
		return cloudwatchClient.listMetrics({
			Namespace: namespace,
			MetricName: metricName
		})
		.promise()
		.then(data => {
			return Promise.resolve(data.Metrics);
		})
		.catch(err => {
			throw new Error(`Error loading metrics list: ${err}`);
		});
	}

	AwsCloudWatchChart.prototype.EXTENDED_MAP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.';

	AwsCloudWatchChart.prototype.extendedEncode = function(arrVals, maxVal)
	{
		let chartData = '';
		let EXTENDED_MAP_LENGTH = this.EXTENDED_MAP.length;
		for (let i = 0, len = arrVals.length; i < len; i++)
		{
			let numericVal = new Number(arrVals[i]);
			// Scale the value to maxVal.
			let scaledVal = Math.floor(EXTENDED_MAP_LENGTH * EXTENDED_MAP_LENGTH * numericVal / maxVal);

			if(scaledVal > (EXTENDED_MAP_LENGTH * EXTENDED_MAP_LENGTH) - 1)
			{
				chartData += "..";
			} else if (scaledVal < 0) {
				chartData += '__';
			} else {
				// Calculate first and second digits and add them to the output.
				let quotient = Math.floor(scaledVal / EXTENDED_MAP_LENGTH);
				let remainder = scaledVal - EXTENDED_MAP_LENGTH * quotient;

				chartData += this.EXTENDED_MAP.charAt(quotient) + this.EXTENDED_MAP.charAt(remainder);
			}
		}

		return chartData;
	}

	AwsCloudWatchChart.prototype.save = function(filename)
	{
		let url = this.getURL();

		let file = fs.createWriteStream(filename);

		return new Promise((resolve, reject) => {
			http.get(url, (response) => {
				response.pipe(file);

				file.on('finish', () => {
					file.close(() => {
						resolve(filename);
					});
				});
			}).on('error', err => {
				fs.unlink(filename);

				reject(new Error(err));
			});
		});
	}

	AwsCloudWatchChart.prototype.get = function() {
		let url = this.getURL();

		let requestSettings = {
			 method: 'GET',
			 url: url,
			 encoding: null
		};

		return new Promise((resolve, reject) => {
			request(requestSettings, (error, response, body) => {
				if (!error && response.statusCode == 200)
				{
					resolve(body);
				} else {
					reject(new Error(error || response.statusCode));
				}
			});
		});
	}

	AwsCloudWatchChart.prototype.getURL = function() {
		let startTime = false;
		let endTime = false;
		let absMaxValue = 0;

		for (let km in this.metrics)
		  for (let ks in this.metrics[km].datapoints)
			{
				let d = new Date(this.metrics[km].datapoints[ks].Timestamp);
				if (endTime === false)
					endTime = d;
				if (startTime === false)
					startTime = d;

				if (d > endTime)
					endTime = d;
				if (d < startTime)
					startTime = d;
			}

		let diff = endTime - startTime;
		diff = diff / this.config.chartSamples;

		let timeLabels = [];
		let prevTime = false;

		for (let i = startTime; i <= endTime; i.setTime(i.getTime() + diff)) {
			if (prevTime !== false)
			{
				timeLabels.push({
					text: ("0" + i.getUTCHours()).slice(-2)+':'+("0" + i.getUTCMinutes()).slice(-2),
					start: new Date(prevTime),
					end: new Date(i.getTime())
				});
			}

			prevTime = i.getTime();
		}

		let labels = [];
		for (let k in timeLabels)
			labels.push( timeLabels[k].text );

		let datasets = [];
		for (let km in this.metrics)
		{
			let dataset = [];

			for (let ktl in timeLabels)
			{
				let maxInPeriod = 0;
				let totalInPeriod = 0;
				let totalInPeriodCount = 0;

				for (let ks in this.metrics[km].datapoints)
				{
					let d = new Date(this.metrics[km].datapoints[ks].Timestamp);
					if (d > timeLabels[ktl].start && d <= timeLabels[ktl].end)
					{
						if (typeof(this.metrics[km].datapoints[ks].Maximum) !== 'undefined')
						if (maxInPeriod < this.metrics[km].datapoints[ks].Maximum)
							maxInPeriod = this.metrics[km].datapoints[ks].Maximum;

						if (typeof(this.metrics[km].datapoints[ks].Average) !== 'undefined')
						{
							totalInPeriod+=this.metrics[km].datapoints[ks].Average;
							totalInPeriodCount++;
						}
					}
				}

				let averageInPeriod = totalInPeriod;
				if (totalInPeriodCount > 0)
					averageInPeriod = totalInPeriod / totalInPeriodCount;

				let toPush = averageInPeriod;
				if (this.metrics[km].statistic == 'Maximum')
					toPush = maxInPeriod;

				if (toPush > absMaxValue)
					absMaxValue = toPush;

				dataset.push(toPush);
			}

			datasets.push(dataset);
		}

		let topEdge = Math.ceil(absMaxValue*1.2);

        let datasetsAsStrings = [];

		for (let k in datasets)
			datasetsAsStrings.push(this.extendedEncode(datasets[k],topEdge));

		let datasetsAsString = datasetsAsStrings.join(',');

		let titles = [];
		for (let km in this.metrics)
			titles.push(this.metrics[km].getTitle());

		let colors = [];
		for (let km in this.metrics)
			colors.push(this.metrics[km].color);

		let styles = [];
		for (let km in this.metrics) {
			if (this.metrics[km].dashed)
				styles.push(this.metrics[km].thickness+',5,5');
			else
				styles.push(this.metrics[km].thickness);
		}


		let url = 'http://chart.googleapis.com/chart?';
		// https://developers.google.com/chart/image/docs/chart_params
		url += 'cht=lc&';
		url += 'chxl=0:|'+labels.join('|')+'&';
		url += 'chxt=x,y&';
		url += 'chco='+colors.join(',')+'&';
		url += 'chls='+styles.join('|')+'&';
		url += 'chs='+this.config.width+'x'+this.config.height+'&';
		url += 'chxr=1,0,'+topEdge+',10&'
		url += 'chg=20,10,1,5&';
		url += 'chdl='+titles.join('|')+'&'
		url += 'chd=e:'+datasetsAsString;

		return url;
	}


	function AwsCloudWatchChartMetric(AwsCloudWatchChart) {
		// Gross stuff, but some are expected at certain points (probably just Dimensions).
		// @TODO: Remove when other cleanup done
		this.Dimensions = [];

		this.AwsCloudWatchChart = AwsCloudWatchChart;

		this.datapoints = [];

		this.statistic	= 'Average';
		this.color		= 'FF0000';
		this.thickness	= '1';
		this.dashed	 = false;
	}

	AwsCloudWatchChartMetric.prototype.getStatistics = function()
	{
		let endTime = new Date;
		let startTime = new Date;

		const chartConfig = this.AwsCloudWatchChart.config;

		startTime.setTime(endTime.getTime() - chartConfig.timeOffset*60*1000);

		let params = {
			StartTime: startTime,
			EndTime: endTime,
			MetricName: this.MetricName,
			Namespace: this.Namespace,
			Period: chartConfig.timePeriod,
			Statistics: [ this.statistic ],
			Dimensions: this.Dimensions,
			Unit: this.Unit
		};

		return cloudwatchClient.getMetricStatistics(params).promise()
			.then(data => {

				for (const k in data.Datapoints) {
					this.datapoints.push(data.Datapoints[k]);
				}

				return Promise.resolve(this.datapoints);
			})
	}

	AwsCloudWatchChartMetric.prototype.getTitle = function()
	{
		if (typeof this.title === 'string') {
			return this.title;
		}

		if (this.Dimensions.length > 0) {
			return this.Dimensions[0].Value || '';
		}

		return '';
	}

	return AwsCloudWatchChart;

})();
